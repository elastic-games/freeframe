import type { Asset, AssetVersion } from '@/types'

/** Production credit is separate from the historical uploading account. */
export function assetDisplayCredit(
  asset: Asset & { latest_version?: AssetVersion | null },
  uploaderNames: Record<string, string>,
): string | undefined {
  const credit = asset.latest_version?.production_credit?.trim()
  return credit || uploaderNames[asset.created_by]
}
