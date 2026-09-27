# Native preparation, not activated

Isolated deployed backend baseline 016dd3c55468114d033eaf1c67295ec348c3d533.
Frontend remains its separately deployed fb2691f426dd34fbf3b524084d2502525668bfff.
No production operation is included in this preparation receipt.

Exact 64 installed Python distributions are captured in requirements.lock. Native
Python must be 3.11.16; local syntax/unit tooling 3.11.5 is not runtime parity proof.
PG15.19→native PG18.6 migration needs a dedicated nonsuperuser role/database and
logical restore rehearsal. DATABASE_URL uses existing SQLAlchemy socket syntax;
new bounded settings default to previous pool 5/overflow 10/timeout 30 seconds.
Native planned API two workers with pool 2/overflow 0; worker role bounds require
real concurrent workflow proof before activation, including nested sessions.

Redis7.4.11 cache/pubsub parses unix:///run/socket?db=0; Celery5.6.3/Kombu broker
and result backend parse redis+socket:///run/socket?virtual_host=0. Optional
CELERY_BROKER_URL/CELERY_RESULT_BACKEND_URL preserve REDIS_URL fallback by default.
Queue names, concurrency 1 per existing worker, retry/ack semantics and beat
schedule are unchanged. Durable queue/RDB/AOF migration and controller drain
must be rehearsed without lost or duplicate tasks before a cutover window.

Media runtime parity remains required: FFmpeg7.1.5-0+deb13u1 codec features,
ImageMagick7.1.1-43Q16 delegates/config/fonts, MinIO RELEASE.2025-04-22T22-12-26Z
with exact object/metadata recovery. No unsupported new binary or model is
substituted. Packaging/install/cutover/recovery scripts are not yet prepared.

Host-wide reviewed capacity target: Studio 18 + Mem0 7 + FreeFrame 11 + admin/backup 8
= 44 of native PG 50; these are potential established connection bounds, not current
RSS or observed connections. Wave4 identity pools are currently inactive and
activation requires a new capacity review. FreeFrame's provisional 11 accounts for
API 2×2, three worker parent/child pairs×1 each and beat 1; nesting/parent connection
lifetime still needs an isolated concurrent fixture. No max_connections increase
or PgBouncer hides pool multiplication.
