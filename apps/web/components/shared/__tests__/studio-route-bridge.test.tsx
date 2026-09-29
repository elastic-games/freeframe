import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioRouteBridge } from '../studio-route-bridge'
import { STUDIO_ORIGIN } from '@/lib/studio-embed'

let pathname = '/projects'
let search = ''
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}))

const originalParent = window.parent
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'parent', { configurable: true, value: originalParent })
  vi.restoreAllMocks()
  pathname = '/projects'
  search = ''
})

describe('embedded Studio route bridge', () => {
  it('reports project, asset and query navigation to the exact Studio origin', () => {
    const parentFrame = document.createElement('iframe')
    document.body.appendChild(parentFrame)
    const parent = parentFrame.contentWindow!
    Object.defineProperty(window, 'parent', { configurable: true, value: parent })
    const post = vi.spyOn(parent, 'postMessage')
    const view = render(<StudioRouteBridge />)
    expect(post).toHaveBeenLastCalledWith({ type: 'elastic-studio:location', path: '/projects' }, STUDIO_ORIGIN)
    pathname = '/projects/c3106eda-2752-4aa3-a6a1-805c3c68f45b/assets/11111111-1111-4111-8111-111111111111'
    search = 'version=22222222-2222-4222-8222-222222222222'
    view.rerender(<StudioRouteBridge />)
    expect(post).toHaveBeenLastCalledWith({ type: 'elastic-studio:location', path: `${pathname}?${search}` }, STUDIO_ORIGIN)
    parentFrame.remove()
  })

  it('does not report standalone navigation', () => {
    const post = vi.spyOn(window, 'postMessage')
    render(<StudioRouteBridge />)
    expect(post).not.toHaveBeenCalled()
  })
})
