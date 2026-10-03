'use client'

import { useEffect, useState } from 'react'
import { Layers } from 'lucide-react'
import { studioAssetContextUrl } from '@/lib/studio-asset-context'
import type { AssetVersion } from '@/types'

export function StudioAssetContextLink({ projectId, assetId, version }: {
  projectId: string
  assetId: string
  version: AssetVersion | null
}) {
  const [hostname, setHostname] = useState<string>()
  useEffect(() => setHostname(window.location.hostname), [])
  if (process.env.NEXT_PUBLIC_STUDIO_SSO_ENABLED !== 'true' || !hostname) return null
  const href = studioAssetContextUrl(projectId, assetId, version, hostname)
  if (!href) return null
  return (
    <a href={href} target="_top" aria-label="Open asset sources and production context in Studio"
      title="Asset sources and production context"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 h-8 text-xs font-medium border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
      <Layers className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden lg:inline">Asset context</span>
    </a>
  )
}
