# Elastic 5090 legacy review credits

The 19 explicit asset/version pairs in `elastic-5090-keyfit-credits.json` are the
legacy browser-uploaded Redchain Keyfit reviews associated with work on Elastic
5090. The IDs and ready status were checked against the live worker listing on
2026-09-28. SVN/local review notes and the ChainBreaker refinement status are
the provenance. Do not infer production credit merely from the uploading account.

`asset_versions.production_credit` is a display field. `created_by` remains the
historical uploader and continues to govern existing permissions and audit
history. Future review-worker uploads populate the credit from the worker actor.

To apply on the production host, use the reviewed new release and a verified
database backup. Run its Alembic migration before switching the API/web release.
From the release root with the API runtime environment configured:

```bash
python -m apps.api.scripts.backfill_production_credits \
  --manifest deploy/elastic-labs/elastic-5090-keyfit-credits.json
python -m apps.api.scripts.backfill_production_credits \
  --manifest deploy/elastic-labs/elastic-5090-keyfit-credits.json \
  --apply --expected-count 19
```

The dry run must report exactly 19 matches before applying. The script checks
the worker binding, uploader email, project/folder, exact asset/version IDs,
ready status, version number and Keyfit title. Any mismatch aborts the entire
transaction; do not remove a guard to force it through. It is idempotent.
After deployment, verify the 19 cards display `Elastic 5090`, the asset detail
shows `Produced by Elastic 5090`, `asset_versions.created_by` still identifies
the original uploader, and unrelated Redchain reviews are unchanged.
