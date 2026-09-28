# Studio-managed Reviews handoff

This integration keeps the original FreeFrame dashboard, project pages, asset review UI, and provider asset/version/comment IDs. In managed mode, the browser sends credentialed requests to the Studio `freeframe-transport` route. Studio checks the signed-in owner, organization, and active canonical FreeFrame binding on every request, then signs a one-use native delegation for the exact provider method, path, query, and body. The FreeFrame API checks its own owner membership and object graph again. The browser never receives a FreeFrame bearer or delegation token.

## Cutover contract

The FreeFrame web image must be built with `STUDIO_MANAGED_REVIEWS=true` and `STUDIO_TRANSPORT_URL=https://app.elasticlabs.site/api/studio/freeframe-transport`. The API must have `STUDIO_NATIVE_ONLY=true` and a random `STUDIO_NATIVE_SECRET` of at least 32 bytes; Studio web must have the same value as `FREEFRAME_STUDIO_NATIVE_SECRET`. Keep the production Studio transport origin fixed at `https://reviews.elasticlabs.site`. The Studio registry must contain an active exact provider binding for each project before it appears in the dashboard. Preserve provider project, asset, version, comment, and media IDs; do not create another provider project for an existing binding. Set the S3 public endpoint and allowed CORS origin for browser media PUT/GET. Stage web, API, and Studio together, verify owner access and foreign/revoked denial, and only then expose the managed entry. `STUDIO_MANAGED_REVIEWS=false` is the default in the example deployment file.

Do not enable `NEXT_PUBLIC_STUDIO_LOCAL_TEST` or loopback origins in a production release build. Those flags are for isolated local acceptance only. They are not present in `deploy/elastic-labs/compose.yml`.

This source checkout is based on `9dc259f` of `feat/studio-native-reviews`. The observed live FreeFrame API and web identities at assessment were `016dd3c` and `fb2691f`. Reconcile release commits and image digests against the deployed versions before any cutover; a local passing build is not deployed or activated evidence.

## Scope and limits

Managed transport allows project-scoped asset/version/comment/folder reads and edits, exact member read, and multipart upload initiation/completion. It returns the canonical Studio project name in provider project responses. The standalone FreeFrame dashboard lists only active canonical bindings the owner can access. Project create, rename, archive, invite/share, instance settings, notifications, and broad user search are unavailable in managed mode until canonical lifecycle and revocation contracts are complete. Managed requests never fall back to a direct legacy provider session. An unrecognized route receives a denial from the Studio transport policy.

The managed upload panel shows only the project in the current page URL. It does not fetch the old account-wide `/me/assets` upload history, and it stores resumable rows under a separate browser key from legacy FreeFrame sessions. Clearing completed managed rows affects only the current project. A denied asset or comment read clears the previous review and shows an explicit Retry action; Retry checks the current Studio grant again.

Each new BFF request checks the current binding. An already-issued S3 object, HLS, or upload capability can remain usable for up to 300 seconds after revocation; already delivered bytes cannot be recalled. The BFF SSE stream is capped at 55 seconds and rechecks access on reconnect. Existing unmanaged public/share links are a separate provider authorization surface and are not revoked by Studio project removal. Review those links before treating canonical removal as a complete media recall. A provider snapshot/hash `/studio/review-read` endpoint is absent from this baseline; exact version and comment lineage works, but imported review snapshot verification stays unavailable.

## Rollback

If managed transport fails, disable the Studio Reviews entry and preserve active registry bindings while resolving the fault. Reverting FreeFrame web to direct SSO while canonical Studio selection remains active would restore the broad provider session bypass. Do not use that as a silent fallback. A coordinated rollback of Studio entry, web build, and native-only API flag requires a separate access review. No database migration is introduced by this FreeFrame patch; existing media and IDs remain in place.

Local mounted evidence is in `Games/Studio/audits/freeframe-project-transport-local-http-2026-09-27.json` (14 passing HTTP cases against disposable fixtures). It does not establish production readiness or signed-in browser acceptance.

The resumed isolated local runtime is under `/Users/vladimir/Desktop/elastic/shared-project-freeframe-runtime` (private directory). Its `fixture.json` and `http-checks.json` contain secret-free fixture identities and mounted HTTP results; `freeframe.env` contains private local test secrets and must not be copied into an audit or commit. The synthetic MP4 was regenerated after ephemeral `/tmp` state disappeared, so its SHA256 differs from the prior fixture while provider project/asset/version/comment IDs remain the same.
