import { describe, expect, it } from 'vitest'
import { resolveReviewVersion, reviewVersionUrl } from '../review-version-link'
import type { AssetVersion } from '@/types'

const ready = {
  id: 'version-1', asset_id: 'asset-1', processing_status: 'ready', deleted_at: null,
} as AssetVersion

describe('asset review version links', () => {
  it('resolves only a ready, live version on the authenticated asset list', () => {
    expect(resolveReviewVersion('asset-1', 'version-1', [ready])).toBe(ready)
    expect(resolveReviewVersion('asset-2', 'version-1', [ready])).toBeNull()
    expect(resolveReviewVersion('asset-1', 'missing', [ready])).toBeNull()
    expect(resolveReviewVersion('asset-1', 'version-1', [{ ...ready, processing_status: 'processing' }])).toBeNull()
    expect(resolveReviewVersion('asset-1', 'version-1', [{ ...ready, deleted_at: '2026-01-01' }])).toBeNull()
  })

  it('keeps compare settings but removes a comment from the previous version', () => {
    expect(reviewVersionUrl('/projects/p/assets/a', 'compare=old&mode=sbs&commentId=c1&version=legacy', 'version-1'))
      .toBe('/projects/p/assets/a?compare=old&mode=sbs&versionId=version-1')
    expect(reviewVersionUrl('/projects/p/assets/a', 'versionId=old&commentId=c1', null))
      .toBe('/projects/p/assets/a')
  })
})
