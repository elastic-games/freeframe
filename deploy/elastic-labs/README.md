# Elastic Labs VPS deployment

This branch starts from FreeFrame's validated `stable` release. The deployment is
separate from the existing Elastic Labs Studio service: it has its own Compose
project, PostgreSQL volume, Redis volume, MinIO volume, and loopback ports.
Host nginx remains the only owner of ports 80 and 443.

## Before deployment

1. Check VPS CPU, memory, disk headroom and Docker availability. Video transcoding
   can be expensive; set the worker count according to measured capacity.
2. Point `reviews.elasticlabs.site` and `review-media.elasticlabs.site` at the
   portal VPS. Both names require TLS certificates before browsers upload media.
3. Follow `STUDIO_SSO.md` to enable Studio account sign in. SMTP is still used
   for notifications, while Studio handles member authentication.
4. Create `.env.prod` from `env.prod.example` at the FreeFrame repository root.
   Replace every placeholder with a distinct secret where appropriate; keep the
   file outside Git and restrict it to the deployment operator.
5. Review the existing portal's nginx configuration and backups before adding
   `nginx.http.conf`. Keep the portal server block and database untouched.

## Bring up and verify

Run from the FreeFrame repository root:

```sh
docker compose --env-file .env.prod -f deploy/elastic-labs/compose.yml config
docker compose --env-file .env.prod -f deploy/elastic-labs/compose.yml up -d --build
curl --fail http://127.0.0.1:8100/health
curl --fail http://127.0.0.1:3100/
sudo nginx -t
```

Install the nginx server blocks, obtain certificates for both new names, and
verify HTTPS, Studio sign in, upload, timestamped comments, drawings, playback,
and `GET /api/assets/{asset_id}/comments` with an authorized account. Portal
`/reviews` embeds FreeFrame after the Studio ticket exchange. Give Codex a
scoped review account or a permitted share link when hosted access is ready.
Do not place FreeFrame access tokens in the portal frontend or repository.

Back up and restore-test the three named volumes before treating the service as
durable. Keep the old local review sidecar until its feedback is imported into a
FreeFrame asset and checked in the hosted UI.
