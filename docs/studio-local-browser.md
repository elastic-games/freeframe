# Local Studio browser SSO

For an isolated development checkout, run both frontends on the same visible
loopback hostname (for example, `localhost`). Configure the FreeFrame frontend:

```text
NEXT_PUBLIC_STUDIO_SSO_ENABLED=true
NEXT_PUBLIC_STUDIO_DEVELOPMENT_ORIGIN=http://localhost:3036
```

Configure the Studio frontend with
`NEXT_PUBLIC_FREEFRAME_DEVELOPMENT_ORIGIN=http://localhost:3037`. Restart both
Next development servers after changing these variables. Configure the isolated
FreeFrame API CORS allowlist to include `http://localhost:3037` and keep the
normal SSO signing secret shared by the two local backends.

Development origins require HTTP, `localhost` or `127.0.0.1`, an explicit port,
and no credentials, path, query or fragment. The browser hostname may replace
the configured loopback hostname while retaining the port. The variables are
ignored outside `NODE_ENV=development`; production origins and assertion
audiences remain unchanged. Browser aliases do not change stored provider
origins or review references.

Sign in through Studio normally, then open the version-specific FreeFrame link.
An unauthenticated `/projects/.../assets/...?...versionId=...` request is returned
to the same project path and version query after the native SSO exchange. Return
paths outside `/projects` are rejected. Browser acceptance must verify the
visible account and selected version; a redirect or successful build alone is
insufficient.

For longer local verification, `NEXT_PUBLIC_STUDIO_DEVELOPMENT_SESSION_SECONDS=1800` permits a 30-minute SSO cookie only in development with a validated loopback Studio origin. Values must be 120–3600 seconds; production remains 120 seconds. The isolated API may separately set `ACCESS_TOKEN_EXPIRE_MINUTES=30`; production settings remain unchanged. Sign in again through normal Studio SSO after restarting.
