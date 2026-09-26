> Historical iframe configuration. The native Reviews candidate uses
> [NATIVE_REVIEWS.md](NATIVE_REVIEWS.md). With `STUDIO_NATIVE_ONLY=true`,
> ticket exchange and preexisting standalone sessions for Studio-linked users
> are rejected; the old admin mapping below does not authorize native access.

# Elastic Labs Studio sign in and portal embed

Studio is the identity authority for this deployment. A member signs in at
`app.elasticlabs.site`, opens Video Reviews, and the embedded FreeFrame page asks
Studio for a 45-second signed assertion. FreeFrame checks its signature and
claims, consumes the nonce once in Redis, and creates or updates a linked local
user with the same UUID as the Studio user. Local FreeFrame records remain for
project membership, comments, and audit attribution; members have no separate
FreeFrame password. The first member to open Reviews must be a Studio admin.

## Production configuration

- Generate a distinct random `FREEFRAME_SSO_SECRET` of at least 32 characters on
  the VPS. Put the same value in Studio's root-owned **web** environment file and
  FreeFrame's root-owned environment file. Never commit or print it.
- Set `FREEFRAME_ADMIN_STUDIO_USER_IDS` in Studio's root-owned web environment
  to the reviewed organization owner UUID. Studio's current global account role
  is `user` even for that owner; an explicit UUID grants the first FreeFrame
  administrator. A future Studio global `admin` role also maps to FreeFrame
  admin. Never infer this authority from an email address.
- Set `STUDIO_SSO_ENABLED=true`, `NEXT_PUBLIC_STUDIO_SSO_ENABLED=true`, and
  `ACCESS_TOKEN_EXPIRE_MINUTES=2` for FreeFrame. Rebuild its web image because
  the `NEXT_PUBLIC_` settings are compiled into the client.
- Serve FreeFrame at `https://reviews.elasticlabs.site` and its MinIO endpoint
  at `https://review-media.elasticlabs.site`. Install the nginx `frame-ancestors`
  rule that permits only `https://app.elasticlabs.site` to embed FreeFrame.
- Deploy the Studio ticket route and iframe page from the same reviewed source
  revision. The live Studio release must include the Mac-side changes before it
  is replaced.

The Studio ticket route permits credentialed browser requests only from the
FreeFrame origin. FreeFrame checks the HMAC, audience, issuer, expiry, identity
UUID, and one-time nonce before issuing a short FreeFrame access token. Native
FreeFrame password, email-code, refresh, invite, and first-user setup paths are
disabled in Studio SSO mode. Share links continue to support external reviewers
according to each link's permissions.

Studio logout or account removal prevents new tickets. A previously issued
FreeFrame access token may remain valid for up to two minutes; the access token
is not refreshable without a current Studio session. FreeFrame account
deactivation still blocks that user even if Studio remains active.

## Acceptance checks

1. Studio guest cannot obtain a ticket; another origin receives 403.
2. Studio admin enters the iframe without a second sign in and becomes the first
   FreeFrame administrator; a non-admin cannot claim an empty instance.
3. A second Studio member gets the same FreeFrame UUID and a non-admin role.
4. Replaying, altering, or expiring a ticket fails; Redis failure fails closed.
5. After Studio sign out, token renewal fails and the existing short token
   expires. Native FreeFrame login and account creation stay disabled.
6. Portal iframe, upload, video playback, drawings, comments, and share links
   work in Chrome and Safari. Only the portal origin may frame FreeFrame.
