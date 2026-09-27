import { act, cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StudioSignInPage from '../page'

const { replace, signIn } = vi.hoisted(() => ({ replace: vi.fn(), signIn: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/lib/auth', () => ({ signInWithStudio: signIn }))

let complete: (token: string | null) => void
beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/studio')
  signIn.mockImplementation(() => new Promise<string | null>((resolve) => { complete = resolve }))
})
afterEach(cleanup)

describe('quiet Studio ticket exchange', () => {
  it('renders no splash or auth card while connecting, including before hydration', () => {
    const html = renderToString(<StudioSignInPage />)
    expect(html).not.toMatch(/FreeFrame|<img|<h1|Connecting your Studio/)
    render(<StudioSignInPage />)
    expect(screen.getByRole('status')).toHaveClass('sr-only')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
  it('opens the requested asset, version and comment only after successful sign-in', async () => {
    const target = '/projects/p1/assets/a1?version=v1&comment=c1'
    window.history.replaceState(null, '', `/studio?from=${encodeURIComponent(target)}`)
    render(<StudioSignInPage />)
    await act(async () => complete('access-token'))
    expect(replace).toHaveBeenCalledWith(target)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('defaults to projects and rejects external return destinations', async () => {
    window.history.replaceState(null, '', '/studio?from=https%3A%2F%2Fevil.example')
    render(<StudioSignInPage />)
    await act(async () => complete('access-token'))
    expect(replace).toHaveBeenCalledWith('/projects')
  })
  it('keeps a visible sign-in and retry path when authorization fails', async () => {
    render(<StudioSignInPage />)
    await act(async () => complete(null))
    expect(replace).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in to Elastic Labs Studio')
    expect(screen.getByRole('link', { name: 'Open Studio sign in' })).toHaveAttribute('target', '_top')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
  it('does not redirect after leaving the transition', async () => {
    const { unmount } = render(<StudioSignInPage />)
    unmount()
    await act(async () => complete('access-token'))
    expect(replace).not.toHaveBeenCalled()
  })
})
