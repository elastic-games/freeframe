'use client'
import { useTranslation } from '@/lib/i18n/locale-provider'
import { studioWorkspaceLink } from '@/lib/studio-workspace-link'

export function StudioWorkspaceEntry() {
  const tr = useTranslation()
  const href = typeof window === 'undefined' ? undefined : studioWorkspaceLink(window.location.pathname, window.location.search)
  return <div className="p-6 space-y-3">
    <h1 className="text-lg font-semibold text-text-primary">{tr('Video Reviews')}</h1>
    <p className="text-sm text-text-secondary">{tr('Open these reviews in Studio to use your signed-in account.')}</p>
    <a className="text-sm text-accent underline" href={href}>{tr('Open in Studio')}</a>
  </div>
}
