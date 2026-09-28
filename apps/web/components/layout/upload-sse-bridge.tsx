'use client'

import { useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { useUploadStore, type UploadFile } from '@/stores/upload-store'
import { useSSE } from '@/hooks/use-sse'

/**
 * Bridges SSE transcode events to the upload store.
 * Renders one SSE connection per project that has processing uploads.
 * Also polls every 5s as a fallback for missed SSE events (e.g. fast-processing files).
 */
/**
 * How often to fall back to polling, for rows the store can reconcile against
 * the server. 0 means not at all.
 *
 * The gate used to be the SSE list, which is `processing` only, so a panel whose
 * one stopped upload is `interrupted` was never polled -- and noticing that the
 * same upload was resumed in another tab is the reason interrupted rows are
 * reconciled in the first place. A row another tab is sending is polled for the
 * same reason: to notice when that tab stops.
 *
 * Those get a slower cadence than processing rows. A transcode can finish
 * between two SSE events, which is a five-second question; being resumed
 * elsewhere is not. And an interrupted row survives a reload by design, so a
 * stale one on the 5s timer would poll for as long as the tab stays open.
 *
 * The cadence is store-wide, so one processing row puts the others on 5s too.
 * That is bounded, since processing rows do not stay processing.
 */
export function pollIntervalFor(files: UploadFile[]): number {
  if (files.some((f) => f.status === 'processing' && f.assetId)) return 5000
  if (files.some((f) => (f.status === 'interrupted' && f.assetId) || f.status === 'elsewhere')) {
    return 30000
  }
  return 0
}

export function UploadSSEBridge() {
  const pathname = usePathname()
  const files = useUploadStore((s) => s.files)
  const refreshProcessingItems = useUploadStore((s) => s.refreshProcessingItems)
  const managed = process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS === 'true'
  const currentProject = pathname?.match(/\/projects\/([0-9a-f]{8}-[0-9a-f-]{27,})(?:\/|$)/i)?.[1]
  const scopedFiles = managed ? files.filter((file) => file.projectId === currentProject) : files

  const processingProjectIds = useMemo(() => {
    const ids = new Set<string>()
    for (const f of scopedFiles) {
      if (f.status === 'processing' && f.projectId) {
        ids.add(f.projectId)
      }
    }
    return Array.from(ids)
  }, [scopedFiles])

  const pollInterval = useMemo(() => pollIntervalFor(scopedFiles), [scopedFiles])

  useEffect(() => {
    if (!pollInterval) return
    const timer = setInterval(() => { refreshProcessingItems() }, pollInterval)
    return () => clearInterval(timer)
  }, [pollInterval, refreshProcessingItems])

  return (
    <>
      {processingProjectIds.map((pid) => (
        <SSEListener key={pid} projectId={pid} />
      ))}
    </>
  )
}

function SSEListener({ projectId }: { projectId: string }) {
  const { updateProcessingProgress, markProcessingComplete, markProcessingFailed } = useUploadStore()

  useSSE(projectId, {
    onTranscodeProgress: (data) => {
      updateProcessingProgress(data.asset_id, data.percent)
    },
    onTranscodeComplete: (data) => {
      markProcessingComplete(data.asset_id)
    },
    onTranscodeFailed: (data) => {
      markProcessingFailed(data.asset_id, data.error)
    },
  })

  return null
}
