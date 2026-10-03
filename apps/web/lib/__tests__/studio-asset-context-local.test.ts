import { afterEach, expect, it, vi } from 'vitest'
import type { AssetVersion } from '@/types'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
it('keeps an explicitly isolated managed fixture return inside its local Studio', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_STUDIO_LOCAL_TEST', 'true')
  vi.stubEnv('NEXT_PUBLIC_STUDIO_PARENT_ORIGIN', 'http://localhost:3029')
  vi.resetModules()
  const { studioAssetContextUrl } = await import('../studio-asset-context')
  const project = '11111111-1111-4111-8111-111111111111'
  const asset = '22222222-2222-4222-8222-222222222222'
  const version = { id: '33333333-3333-4333-8333-333333333333', asset_id: asset, processing_status: 'ready', deleted_at: null } as AssetVersion
  expect(new URL(studioAssetContextUrl(project, asset, version, 'localhost')!).origin).toBe('http://localhost:3029')
  expect(new URL(studioAssetContextUrl(project, asset, version, 'reviews.elasticlabs.site')!).origin).toBe('https://app.elasticlabs.site')
})
