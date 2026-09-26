import type { AssetVersion } from '@/types'

/** Resolve a review deep link only against the authenticated asset's visible versions. */
export function resolveReviewVersion(
  assetId: string,
  versionId: string | null,
  versions: AssetVersion[],
): AssetVersion | null {
  if (!versionId) return null
  return versions.find((version) =>
    version.id === versionId &&
    version.asset_id === assetId &&
    version.deleted_at == null &&
    version.processing_status === 'ready',
  ) ?? null
}

/** Preserve unrelated review state, but drop a comment tied to the old version. */
export function reviewVersionUrl(
  pathname: string,
  search: string,
  versionId: string | null,
): string {
  const params = new URLSearchParams(search)
  if (versionId) params.set('versionId', versionId)
  else params.delete('versionId')
  params.delete('commentId')
  params.delete('version')
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
