'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithStudio } from '@/lib/auth'

export default function StudioSignInPage() {
  const router = useRouter()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    signInWithStudio().then((token) => {
      if (!active) return
      if (token) router.replace('/projects')
      else setFailed(true)
    })
    return () => { active = false }
  }, [router])

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Elastic Labs video reviews</h1>
      {failed ? (
        <>
          <p>Sign in to Elastic Labs Studio, then reopen Video Reviews.</p>
          <a className="underline" href="https://app.elasticlabs.site/sign-in" target="_top">Open Studio sign in</a>
          <button className="underline" onClick={() => window.location.reload()}>Try again</button>
        </>
      ) : <p>Connecting your Studio account…</p>}
    </main>
  )
}
