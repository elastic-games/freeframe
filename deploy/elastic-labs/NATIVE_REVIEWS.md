# Elastic Labs native Reviews integration

The native pair was deployed as an owner-only preview on 2026-09-26. Studio now
reuses the original FreeFrame application inside its navigation shell, with the
`/api/studio/reviews` delegation boundary retained for integrations. Existing media,
asset/version/comment UUIDs and guest share records are preserved.

## Two dashboard entry points

### Instance-wide attribution disabled

On 2026-09-27 the owner requested removing the attribution badge everywhere
because it covered controls on the standalone project page. The deployed
instance's existing `powered_by_freeframe` branding setting was changed to
`false` through the existing branding handler after verifying the exact active
owner's superadmin role. Other branding fields were preserved. Every
`PoweredByBadge` surface reads this setting, including standalone dashboards,
asset viewers, sign-in, public shares and settings previews.

This is a live branding configuration change, requiring no application rebuild.
FreeFrame web remains `fb2691f426dd34fbf3b524084d2502525668bfff`; Studio remains
`ef7d7becfd8d682f0afc25e3c5828623ec9ef58f`. All application container identities
were preserved. The protected prior flag and receipt are at
`/var/backups/elastic-native-reviews/attribution-off-20260927T183157Z`.
Keep the setting false when applying or resetting instance branding.

Internal/public branding APIs and rendered page branding confirmed false.
The public share error page initially retained the prior 60-second server
branding cache; after refresh, its actual browser view contained no attribution.
The exact signed-in project view remains unverified because the Mac was locked
and Safari could not be accessed. The owner was asked to unlock for that check.

### Project management controls

Project owner cards expose an always-visible, outlined management button in the
footer, labelled with the project name for assistive technology. Project
Settings and Delete retain their existing authorization and confirmation
behavior; no hover or prior card selection is required to discover the menu.

The management visibility fix was deployed on 2026-09-27 as FreeFrame web
`fb2691f426dd34fbf3b524084d2502525668bfff`. Studio remained at
`ef7d7becfd8d682f0afc25e3c5828623ec9ef58f`; API/worker identities and review
data were preserved. Rollback web: `b8ff2b0e2e6ca522fcff50864e4f38fb0ada3fab`.
Protected receipt:
`/var/backups/elastic-native-reviews/card-controls-20260927T182704Z`.

Local production build, types, lint, 673 frontend cases and 634 backend cases
passed. Account-free component captures verify both themes. The Linux runtime
package preserves pnpm symlinks; an initial flattened package failed startup
and was automatically rolled back before packaging was corrected. The public
entry checks passed. Native checks now cover the four active projects, denial
for the previously deleted Studio Portal project and its sample asset,
replay/foreign scope denial, and live HLS with the 300-second expiry cap. The
stale five-project check caused a second automatic rollback before being
updated; no project was restored or otherwise changed.

Fresh signed-in Safari at the Studio Reviews URL showed outlined management
buttons on all four owner cards without hover. Echo Citadel's menu opened with
Project Settings and Delete, and Settings exposed its current editable name.
The dialog was cancelled without saving. Private full-dashboard and menu proof
is retained locally; public before/after component captures and their provenance
are in `docs/screenshots/project-controls/`. The owned preview route, dev server,
verification window, temporary runtime container and build swap were removed.

The owner requested the original FreeFrame dashboard at
`https://reviews.elasticlabs.site/` and inside Studio's workspace at
`https://app.elasticlabs.site/apps/reviews`. Keep the review-domain root and
member routes proxied to FreeFrame web; do not redirect them into the portal.
Studio remains the identity authority for both dashboards.

Studio mounts the complete FreeFrame UI in a borderless frame. Its bookmark
adapter resolves configured Studio project keys to exact FreeFrame UUIDs and
checks asset scope before returning a fixed-origin URL. FreeFrame retains its
original search, project, upload and review controls. Embedded navigation uses
a compact top bar instead of the standalone vertical rail. Middleware
and the Studio sign-in page preserve a validated local return path including
version/comment queries; the viewer selects the linked version before applying
the comment. A presentation-only bridge validates the exact origin and parent
or frame window before synchronizing Studio's light/dark mode. The host override
is ephemeral and does not replace the standalone saved preference. Navigation
and appearance requests from the compact bar operate Studio's shared controls;
embedded attribution is omitted. No locale synchronization is implied.

The `/studio` ticket exchange lives outside the branded authentication layout.
Successful sign-in transitions quietly to the requested dashboard, without a
FreeFrame logo or authentication card flashing inside Studio. An accessible
status remains available while connecting; failed exchanges still show visible
Studio sign-in and retry controls. The ticket exchange and authorization checks
are unchanged, including return-path validation and version/comment bookmarks.

The quiet-entry correction was deployed on 2026-09-27 as FreeFrame web image
`b8ff2b0e2e6ca522fcff50864e4f38fb0ada3fab`. Studio stayed at
`4b14d92ddee407f44c0bc4d1cf9e6147e4e846da` during this cutover, and the
API/worker container identities and images were preserved. The rollback web is
`562c039437b7bf5820e583e978f7ded74933561c`; the protected receipt is at
`/var/backups/elastic-native-reviews/quiet-entry-20260927T154940Z`.
Local gates passed: 669 frontend cases, 634 backend cases, production build,
types and lint. The server build, twelve public entry/auth checks and read-only
native scope/replay/HLS checks passed. Fresh signed-in Safari navigation from
the main navbar reached the original Projects dashboard with five projects.
Before/after connection-screen captures are in `docs/screenshots/studio-entry/`;
the after capture shows the quiet pending state, not a failed authentication.
The owned temporary swap and unused build stages were cleaned up; durable
swapfiles and all live/rollback image tags were retained.

The reused workspace frontend was deployed on 2026-09-26: Studio source
`c59f1da120c92c41ec3f138a6255b9c8cfc5e23d` and FreeFrame web image
`eb158e03c72a7a5a7e3289b70186a0bf5446f59d`. API and workers retain image
`016dd3c55468114d033eaf1c67295ec348c3d533`; the candidate API source matches
that release. Use the explicit release override, not the current source SHA
for every service image. The previous frontend pair and protected receipt are
retained in `/var/backups/elastic-native-reviews/reused-workspace-20260926T224051Z`.
Both inactive frontend builds, twelve public entry/auth checks and read-only
native project/replay/scope/public HLS checks passed. Fresh signed-in combined
layout verification was pending at that initial cutover.

The sidebar/appearance correction deploys Studio
`2dca6eed543270477013bee402dc5abf3f9037ab` with FreeFrame web
`562c039437b7bf5820e583e978f7ded74933561c`; API/workers still use the immutable
`016dd3c55468114d033eaf1c67295ec348c3d533` images. Configuration and data were
unchanged. The protected backup/receipt is
`/var/backups/elastic-native-reviews/theme-workspace-20260926T235909Z`.
Both local and VPS builds, 664 frontend cases, 634 backend cases and the public
entry/native/HLS checks passed. Post-deployment visual acceptance is pending
Safari availability; no successful theme interaction is claimed yet.

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
