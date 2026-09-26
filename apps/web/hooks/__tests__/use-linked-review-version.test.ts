import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLinkedReviewVersion } from '../use-linked-review-version'
import { useReviewStore } from '@/stores/review-store'
import type { AssetVersion } from '@/types'
const oldVersion = { id: 'v1', asset_id: 'asset', version_number: 1 } as AssetVersion
const latest = { id: 'v2', asset_id: 'asset', version_number: 2 } as AssetVersion
describe('exact version bookmark', () => {
  beforeEach(() => useReviewStore.getState().reset())
  it('waits for loaded versions, then selects an older linked version', () => {
    const { rerender } = renderHook(({ loading }) => useLinkedReviewVersion('asset', [oldVersion, latest], 'v1', loading), { initialProps: { loading: true } })
    expect(useReviewStore.getState().currentVersion).toBeNull()
    rerender({ loading: false })
    expect(useReviewStore.getState().currentVersion?.id).toBe('v1')
  })
  it('does not override a subsequent manual version selection', () => {
    const { rerender } = renderHook(({ versions }) => useLinkedReviewVersion('asset', versions, 'v1', false), { initialProps: { versions: [oldVersion, latest] } })
    act(() => useReviewStore.getState().setCurrentVersion(latest))
    rerender({ versions: [oldVersion, latest] })
    expect(useReviewStore.getState().currentVersion?.id).toBe('v2')
  })
  it('refuses a version belonging to another asset', () => {
    renderHook(() => useLinkedReviewVersion('other', [oldVersion], 'v1', false))
    expect(useReviewStore.getState().currentVersion).toBeNull()
  })
  it('applies a different bookmark when its requested version changes', () => {
    const { rerender } = renderHook(({ requested }) => useLinkedReviewVersion('asset', [oldVersion, latest], requested, false), { initialProps: { requested: 'v1' } })
    rerender({ requested: 'v2' })
    expect(useReviewStore.getState().currentVersion?.id).toBe('v2')
  })
})
