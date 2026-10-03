import { studioFrontendOrigin } from './studio-development'
import { STUDIO_ORIGIN } from './studio-embed'
import type { AssetVersion } from '@/types'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Studio resolves this exact visible provider tuple under its own current session. */
export function studioAssetContextUrl(
  projectId: string,
  assetId: string,
  version: AssetVersion | null,
  browserHostname?: string,
): string | null {
  if (!uuid.test(projectId) || !uuid.test(assetId) || !version
    || !uuid.test(version.id) || version.asset_id !== assetId
    || version.deleted_at != null || version.processing_status !== 'ready') return null
  try {
    const origin = process.env.NEXT_PUBLIC_STUDIO_LOCAL_TEST === 'true' && ['localhost', '127.0.0.1'].includes(browserHostname || '')
      ? STUDIO_ORIGIN : studioFrontendOrigin(browserHostname)
    const url = new URL('/assets', origin)
    url.searchParams.set('reviewProjectId', projectId)
    url.searchParams.set('reviewAssetId', assetId)
    url.searchParams.set('reviewVersionId', version.id)
    return url.toString()
  } catch {
    return null
  }
}
