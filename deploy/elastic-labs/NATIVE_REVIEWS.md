# Elastic Labs native Reviews integration

The native pair was deployed as an owner-only preview on 2026-09-26. It accompanies
Studio's native library/viewer and `/api/studio/reviews` boundary. Existing media,
asset/version/comment UUIDs and guest share records are preserved.

## Two dashboard entry points

The owner requested the original FreeFrame dashboard at
`https://reviews.elasticlabs.site/` alongside Studio's native workspace at
`https://app.elasticlabs.site/apps/reviews`. Keep the review-domain root and
member routes proxied to FreeFrame web; do not redirect them into the portal.
Studio remains the identity authority for both dashboards.

For this dual-dashboard pairing, set `FREEFRAME_NATIVE_ONLY=false` in Studio's
web environment and `STUDIO_NATIVE_ONLY=false` in FreeFrame, with
`STUDIO_SSO_ENABLED=true` and `ACCESS_TOKEN_EXPIRE_MINUTES=2`. The deployed Studio
ticket route still requires a verified, active exact owner, current organization
management permission, a configured native project binding and the single
`FREEFRAME_ADMIN_STUDIO_USER_IDS` UUID. No other member is granted access by this
configuration change. The original dashboard uses the owner's preexisting
FreeFrame administrator role; native portal requests retain exact project
scope, single-use delegation and bounded media capabilities.

A signed-in Studio owner opening the review domain exchanges a short-lived,
single-use assertion and stays on the FreeFrame domain. A signed-out visitor
sees FreeFrame's Studio sign-in entry. Separate FreeFrame passwords, email-code,
refresh, signup and setup remain disabled in Studio SSO mode. No keys need to
change. Back up both environment files and nginx configuration, validate
`nginx -t`, recreate the API using its immutable image and restart Studio web.
No application rebuild or schema change is required for the existing deployed
pair. Run `python3 deploy/elastic-labs/check-native-entry.py` and verify the
original FreeFrame Projects dashboard with an actual Studio owner session.
Preserve `/share/`, `/api/`, `/stream/hls/`, frontend assets and media routing.

## Required configuration

Set a distinct random `STUDIO_NATIVE_SECRET` (at least 32 characters) on the host;
the matching Studio setting is `FREEFRAME_STUDIO_NATIVE_SECRET`. Never print or
commit keys. Keep the ordinary JWT and legacy SSO keys separate.

For an optional native-only pairing, enable `STUDIO_SSO_ENABLED=true` and
`STUDIO_NATIVE_ONLY=true` and set Studio `FREEFRAME_NATIVE_ONLY=true`. In this mode the legacy Studio SSO exchange returns 404 and
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
