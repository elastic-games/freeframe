# Native 3D reviews

Upload a self-contained GLB v2 (at most 16 MiB) through the normal upload flow, or
publish an exact verified Studio model output to its mapped FreeFrame project.
The processing worker validates the original GLB and marks that exact original
ready; it does not alter geometry or create an inferred approval state.

Orbit, pan and zoom to the subject. Animated models offer a clip and pose time.
Saving a note captures the current view. Drawing freezes the camera; use **Save 3D
view and comment** to persist text and marks. Clicking saved feedback restores its
camera, model transform and pose before drawing the overlay. The saved viewport
aspect is retained at different window sizes. **Resume orbit** clears the focused
review view and allows navigation again.

## Persistent annotation contract

Existing `Annotation.drawing_data` stores Fabric drawing objects and
`_modelView`, with schema `freeframe-model-view/v1`. Required fields are:

- Exact `versionId` and actual raw GLB SHA-256 (`sha256`).
- Camera `position`, orbit `target`, camera `up` (three-component vectors).
- Perspective `fov` in degrees, `near`, `far`, and viewport `aspect`.
- `objectMatrix`: 16 finite values in Three.js column-major order, an invertible affine transform.
- Animation `clip` index, or -1 for rest; `time` in seconds (zero for rest).

The API verifies the metadata against the ready exact model version and actual
bounded private original bytes. Version changes clear pending drawing/capture
state. Replies retain the parent's exact version; text-only inline replies inherit
its view. A foreign version/digest is rejected. Models do not use video review
clocks or frame numbers. Studio snapshots preserve the full drawing metadata and
raw digest through the existing review bridge.

Drawings remain screen marks for a reproducible camera view. Surface pins and
geometry edits are outside this implementation. Embedded textures/buffers are
required; external resources and compressed decoder requirements are rejected.
The viewer loads Three.js only for models and disposes its GPU resources on exit.

## Upgrade and verification

Apply Alembic `ab20261003c2` after `ab20260926c1` before accepting model uploads.
This adds values to the existing PostgreSQL enums. PostgreSQL cannot safely remove
an enum value in place: rollback requires restoring the pre-upgrade backup after
reconciling model rows. Apply normal release/backup and service gates.

The 2026-10-03 local proof used a fresh synthetic PostgreSQL database, isolated S3
bucket and headless Chromium; no personal browser profile or production account.
The actual Sources_Elastic Cathedral GLB was inspected, orbited, annotated and
reloaded. Restoring its saved view produced matching model pixels, and the drawing
stayed aligned on resize. See `docs/screenshots/model-review/` for local proof.
