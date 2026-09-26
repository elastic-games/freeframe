# Elastic Labs native Reviews integration

The native pair was deployed as an owner-only preview on 2026-09-26. It accompanies
Studio's native library/viewer and `/api/studio/reviews` boundary. Existing media,
asset/version/comment UUIDs and guest share records are preserved.

## Member login entry

In the native-only Elastic deployment, `https://reviews.elasticlabs.site/` opens
`https://app.elasticlabs.site/apps/reviews`. Studio's existing session and sign-in
form own member authentication. The standalone `/studio` page still implements
the legacy ticket exchange, which native-only mode intentionally disables; do
not send members through that page or re-enable the exchange to fix login.

Copy the exact root/login/setup/studio/projects redirect locations from
`nginx.http.conf` into the review-domain HTTPS server after Certbot setup. Old
standalone project bookmarks open the native project chooser; their FreeFrame
UUIDs are not Studio project keys. Redirects use a fixed destination and do not
forward arbitrary callback queries. Leave `/share/`, `/api/`, `/stream/hls/`,
frontend assets and the separate media-domain proxy intact.

Back up the active nginx file, run `nginx -t`, reload nginx, then run
`python3 deploy/elastic-labs/check-native-entry.py`. Check an anonymous browser
reaches Studio's sign-in form and an existing owner session reaches the native
project chooser. This routing change needs no application rebuild or database
mutation. Upstream standalone installs do not use this Elastic nginx template.

## Required configuration

Set a distinct random `STUDIO_NATIVE_SECRET` (at least 32 characters) on the host;
the matching Studio setting is `FREEFRAME_STUDIO_NATIVE_SECRET`. Never print or
commit keys. Keep the ordinary JWT and legacy SSO keys separate.

Enable `STUDIO_SSO_ENABLED=true` and `STUDIO_NATIVE_ONLY=true` for the native-only
production pairing. In this mode the legacy Studio SSO exchange returns 404 and
existing standalone access sessions for Studio-linked users are rejected. Guest
shares retain the existing link/session/password checks. The default native-only
flag is false to preserve upstream standalone installations.

Include only reviewed origins in `CORS_ALLOW_ORIGINS` and
`MINIO_CORS_ALLOWED_ORIGINS`: `https://app.elasticlabs.site` and
`https://reviews.elasticlabs.site`. Compose passes the latter to MinIO's supported
`MINIO_API_CORS_ALLOW_ORIGIN`. Check real preflight, multipart PUT and ETag
behavior; unsupported MinIO bucket CORS APIs are not proof of configuration.
Keep API/MinIO service ports bound to loopback. The included nginx safe access
format drops query capabilities and masks share paths; apply it to the final
HTTP/HTTPS review and media server blocks. Uvicorn access records are sanitized
without removing method/status logging. Do not add raw request/referrer logging.

Apply the explicit `/stream/hls/` proxy to the final review-domain HTTP/HTTPS
servers as well as `/api/`. Native Studio resolves relative HLS paths on the
review origin, so this route must reach the API unchanged, rather than the
standalone web service. Run `nginx -t` before reloading; verify master, variant
and segment requests from the public Studio origin, including CORS and expiry.

## Exact project provisioning

The linked actor must already exist and be active, with the exact Studio user
UUID. Native requests require that actor's live **owner** membership in the exact
FreeFrame project. There is no admin bypass, name/email matching, membership
synchronization or provisioning on GET.

Use `configure-native-project.py --help` inside the service runtime. Supply the
exact actor UUID, Studio organization UUID, configured Studio project key and
FreeFrame project UUID. An existing project must already have the actor's live
owner membership. Creating a project/membership requires explicit `--create`.
The helper emits a binding object for operator review; it does not apply Studio
configuration. Inventory and approve production assignments first.

## Security and cutover gates

Delegation uses its own issuer/audience/type, exact actor/org/project UUIDs,
method/path and a hash of query plus body. Assertions last 45 seconds, are
single-use through Redis and fail closed when replay storage is unavailable.
Object graph checks run before ordinary route permissions. An actor owning a
second project still cannot access it through the first project's delegation.

Native media, HLS manifests, derived segments, attachment PUTs and multipart part
URLs are capped at 300 seconds. A segment cannot outlive its parent token. Studio
renews playback at 240 seconds and reconnects authorized SSE within 55 seconds.
Already buffered/downloaded media cannot be recalled instantly.

Coordinate immutable Studio and FreeFrame releases, validated independent
backups and root-owned environment backups. Recheck playback/drawings in Safari
and Chromium, upload/processing, exact version comments and deep links,
comparison, attachments/export, shares/revoke, trash/restore, foreign scopes,
logout, and inherited Studio preferences/Mail before enabling the public pair.
No schema migration is introduced here. Do not move stable/latest/release tags.

Rollback both services to a reviewed compatible release pair while preserving
new media and review records. Do not accidentally restore broader legacy SSO.
Refer to Studio `docs/operations/freeframe-native-cutover.md` and its dated
acceptance record for the full operator sequence and outstanding gates.
