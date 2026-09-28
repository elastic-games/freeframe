# Redchain review workers

This is a narrow CLI transport for the five Redchain animation nodes. It keeps
the original FreeFrame portal and its media/comment IDs. It is inactive until
the matching Studio binding route, FreeFrame API image, migration, and five
credential hashes are deployed and canary-tested.

## Authority

Each request checks the opaque key hash, revocation state, live provider user and
editor membership, project/folder rows, and a fresh signed request to Studio.
Studio must still bind `giant-and-ghosts` to the provider project. A missing
Studio response denies the worker request; no cached permission is used. Assets
must remain in the credential's Redchain folder, and versions and comments must
remain on that asset. The API exposes no approval, delete, share, or admin route.
Provider activity identifies the distinct node actor. `review_worker_operations`
records upload/reply provenance and stable IDs; S3 upload parts go directly to
short-lived presigned URLs. The API stores only key hashes.

## Deployment order

1. Confirm live Studio and FreeFrame release identities, current binding, folder,
   health, backup, disk headroom, and rollback images. Keep the current FreeFrame
   web image and Studio owner SSO behavior.
2. Build and test Studio's signed `/api/studio/review-worker-binding` route on the
   current production base. Deploy Studio using its immutable release process;
   an unsigned request must return 403 and a signed request for the live binding
   must return 204. Removal of the binding must return 403.
3. Build and test the FreeFrame API on its current production base. Apply Alembic
   revision `f0a9c2d3e4b5` after a validated database backup. Deploy only the API
   image, preserving the current web and transcoder worker images. The API must
   have the same existing `STUDIO_NATIVE_SECRET` value that Studio uses as
   `FREEFRAME_STUDIO_NATIVE_SECRET`; do not print either value. Confirm existing
   portal browsing, SSO, and media playback before enrolling a node.
4. On one node, run `python3 tools/elastic_reviews.py init-key --node elastic-5090`.
   It creates a mode-0600 local key file and prints only its SHA-256 hash. Pass
   that hash to the deployment operator. From the FreeFrame release root, run
   `python3 -m apps.api.scripts.manage_review_workers issue --node elastic-5090
   --organization-id <Studio organization UUID> --project-id <Studio-bound provider UUID>
   --folder-id <Redchain folder UUID>
   --key-hash <node-reported SHA-256>` in the API runtime environment. Repeat
   for the remaining four nodes only after the canary succeeds.
5. On a disposable Redchain review, use the CLI to list, upload, read comments,
   and reply under the exact original comment after the corrected version is
   ready. Verify the original portal plays the result, retains the reference on
   the left, and shows the reply at the intended timecode. Record the provider
   asset/version IDs and review URL in the SVN review note. Do not call this
   artist acceptance.

## CLI

`config.json` defaults to `~/.config/elastic-reviews/config.json` with a fixed
HTTPS API URL and key-file path. The key is never passed in arguments or printed.
On Windows, `init-key` protects the key with the current user's DPAPI and writes
an encrypted `.dpapi` file; the same Windows user must run the CLI. On macOS and
Linux, it uses a mode-0600 key file.

```sh
python3 tools/elastic_reviews.py list --clip 010_Idle_01
python3 tools/elastic_reviews.py comments --asset <UUID> --version <UUID>
python3 tools/elastic_reviews.py upload --clip 010_Idle_01 --candidate v02 \
  --svn-revision 89 --file comparison.mp4 --reference-fps 24 --reference-frames 121
python3 tools/elastic_reviews.py reply --asset <UUID> --version <reviewed-UUID> \
  --corrected-version <ready-UUID> --comment <UUID> --svn-revision 89 \
  --body 'The hoof contact at 00:02:04 is corrected.'
```

The upload command checks the MP4's native FPS and full frame count with
`ffprobe`, hashes the file, finds an existing clip asset, resumes held parts, and
returns the version ID and portal URL. Retries reuse an idempotency key derived
from clip, candidate, SHA-256, and SVN revision. A reply requires a distinct,
ready corrected version and is idempotent. The CLI never approves or resolves
an artist review.

`manage_review_workers revoke --node <name>` disables that node without changing
the other four. Rotation uses `init-key` with a fresh local config path and
`manage_review_workers rotate --node <name> --key-hash <new hash>`; switch the
node's configured key file after the server accepts the new hash.
