'use client'

import { useEffect } from 'react'
import { useThemeStore } from '@/stores/theme-store'
import { STUDIO_ORIGIN } from '@/lib/studio-embed'

export function StudioEmbedBridge() {
  useEffect(() => {
    if (window.parent === window) return
    function receive(event: MessageEvent) {
      if (event.origin !== STUDIO_ORIGIN || event.source !== window.parent ||
          event.data?.type !== 'elastic-studio:appearance' ||
          !['dark', 'light'].includes(event.data?.theme)) return
      useThemeStore.getState().setHostTheme(event.data.theme)
      window.parent.postMessage({ type: 'elastic-studio:appearance-applied' }, STUDIO_ORIGIN)
    }
    window.addEventListener('message', receive)
    window.parent.postMessage({ type: 'elastic-studio:ready' }, STUDIO_ORIGIN)
    return () => {
      window.removeEventListener('message', receive)
      useThemeStore.getState().setHostTheme(null)
    }
  }, [])
  return null
}
