# Studio asset context

When Studio SSO is enabled, the authenticated project review toolbar offers
**Asset context** for the selected ready version. It opens the Studio shell at
`/assets` with `reviewProjectId`, `reviewAssetId` and `reviewVersionId`.
The action follows version changes and is hidden for unavailable versions.
Public share viewers do not receive an asset-context action.

These IDs are lookup inputs, not authorization or a claim that the video is
bound. The companion Studio release must resolve the exact tuple against its
persisted review bindings and current project access, then open the precise
asset/output/run or show an unavailable state. It must never guess by filename
or silently substitute the latest version. Normal Studio sign-in applies.

Production uses the fixed `https://app.elasticlabs.site` origin. Local
development uses the existing validated loopback Studio origin setting. The
link carries no credentials and escapes an embedded review with `target=_top`.
No provider database writes or new provider permissions are required.

This companion is a local candidate based on `bd5d9fb`. Integrate it with the
actual deployed FreeFrame successor before release; local checks do not prove
production compatibility or signed-in browser acceptance.

## Local checks

- Web regression suite: 83 files, 664 tests passed. Node 25 requires
  `NODE_OPTIONS=--no-experimental-webstorage` so jsdom owns browser storage.
- TypeScript and Next.js production build passed; lint passed with existing
  repository hook warnings.
- API regression suite: 658 tests passed against a separate freshly migrated
  local PostgreSQL database. The initial default test database lacked the
  existing review-clock migration and was not used as acceptance evidence.
- The new action and exact-version helper have nine focused passing tests,
  including switching versions, unavailable/deleted versions, wrong-asset
  versions, and standalone FreeFrame without Studio integration.
- Signed-in browser navigation remains pending; these checks are not visual
  acceptance or proof of production SSO compatibility.
