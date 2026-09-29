'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { STUDIO_ORIGIN } from '@/lib/studio-embed'

/** Keep the Studio address in step with navigation inside its Reviews frame. */
export function StudioRouteBridge() {
  const pathname = usePathname()
  const search = useSearchParams().toString()

  useEffect(() => {
    if (window.parent === window) return
    window.parent.postMessage(
      { type: 'elastic-studio:location', path: `${pathname}${search ? `?${search}` : ''}` },
      STUDIO_ORIGIN,
    )
  }, [pathname, search])

  return null
}
