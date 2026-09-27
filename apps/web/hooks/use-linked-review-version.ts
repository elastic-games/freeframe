'use client'
import { useEffect, useRef } from 'react'
import { useReviewStore } from '@/stores/review-store'
import type { AssetVersion } from '@/types'

export function useLinkedReviewVersion(assetId: string | undefined, versions: AssetVersion[], requested: string | null, loading: boolean) {
  const applied = useRef('')
  const setCurrentVersion = useReviewStore((state) => state.setCurrentVersion)
  useEffect(() => {
    if (loading || !assetId || !requested) return
    const key = `${assetId}:${requested}`
    if (applied.current === key) return
    const target = versions.find((version) => version.id === requested && version.asset_id === assetId)
    if (!target) return
    applied.current = key
    setCurrentVersion(target)
  }, [assetId, versions, requested, loading, setCurrentVersion])
}
