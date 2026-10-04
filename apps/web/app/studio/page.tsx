'use client'

import { useTranslation } from '@/lib/i18n/locale-provider'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithStudio } from '@/lib/auth'
import { studioFrontendOrigin } from '@/lib/studio-development'
import { studioReturnPath } from '@/lib/studio-return-path'

const STUDIO_MANAGED = process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS === 'true'

export default function StudioSignInPage() {
  const tr = useTranslation()

  const router = useRouter()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (STUDIO_MANAGED) {
      router.replace(studioReturnPath(new URLSearchParams(window.location.search).get('from')))
      return
    }
    let active = true
    signInWithStudio().then((token) => {
      if (!active) return
      if (token) router.replace(studioReturnPath(new URLSearchParams(window.location.search).get('from')))
      else setFailed(true)
    })
    return () => { active = false }
  }, [router])

  // The ticket exchange is a transition, not a second login screen. Keep it
  // outside the branded auth layout so its server render cannot flash a logo
  // or sign-in card before the parent appearance handshake arrives.
  if (!failed) {
    return (
      <main className="min-h-dvh bg-bg-primary" aria-busy="true">
        <p className="sr-only" role="status">{tr("Opening Video Reviews…")}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{tr("Unable to open Video Reviews")}</h1>
      <div role="alert" className="space-y-4">
        <p>{tr("Sign in to Elastic Labs Studio, then reopen Video Reviews.")}</p>
        <a className="underline" href={`${studioFrontendOrigin(window.location.hostname)}/sign-in`} target="_top">{tr("Open Studio sign in")}</a>
        <button className="underline" onClick={() => window.location.reload()}>{tr("Try again")}</button>
      </div>
    </main>
  )
}
