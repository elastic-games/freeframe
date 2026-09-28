import { getAccessToken } from './auth'
import { api, ApiError } from './api'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const STUDIO_MANAGED = process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS === 'true'

export type ExportFormat = 'edl' | 'fcpxml' | 'premiere_xml' | 'csv'

export class FpsRequiredError extends Error {
  constructor() {
    super('Frame rate required')
    this.name = 'FpsRequiredError'
  }
}

const EXT: Record<ExportFormat, string> = {
  edl: 'edl',
  fcpxml: 'fcpxml',
  premiere_xml: 'xml',
  csv: 'csv',
}

export async function exportComments(opts: {
  assetId: string
  versionId: string
  format: ExportFormat
  fps?: number
  includeResolved?: boolean
}): Promise<void> {
  const params = new URLSearchParams({ format: opts.format, version_id: opts.versionId })
  if (opts.fps) params.set('fps', String(opts.fps))
  if (opts.includeResolved === false) params.set('include_resolved', 'false')

  if (STUDIO_MANAGED) {
    let content: string
    try {
      content = await api.get<string>(`/assets/${opts.assetId}/comments/export?${params}`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && !opts.fps) throw new FpsRequiredError()
      throw error
    }
    downloadBlob(new Blob([content], { type: opts.format === 'csv' ? 'text/csv' : 'text/plain' }),
      `comments.${EXT[opts.format]}`)
    return
  }

  const res = await fetch(`${API_URL}/assets/${opts.assetId}/comments/export?${params}`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  })

  if (res.status === 422) {
    const body = await res.json().catch(() => null)
    const detail = body?.detail
    if (detail?.code === 'fps_required') throw new FpsRequiredError()
    // A structured detail carries the explanation in `message`. Reading only the
    // string form turned every one of those into a bare "Export failed", which
    // is the same amount of information as saying nothing.
    throw new Error(
      typeof detail === 'string' ? detail : detail?.message || 'Export failed',
    )
  }
  if (!res.ok) throw new Error(`Export failed (${res.status})`)

  const blob = await res.blob()
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')
  downloadBlob(blob, match?.[1] || `comments.${EXT[opts.format]}`)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 1000)
}
