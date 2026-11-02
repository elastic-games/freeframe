import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudioEmbedBridge } from '../studio-embed-bridge'
import { useThemeStore } from '@/stores/theme-store'
import { STUDIO_ORIGIN } from '@/lib/studio-embed'

const originalParent = window.parent
// Keep the expected production origin independent of the implementation constant.
const canonicalStudioOrigin = 'https://app.elasticlabs.com'
let parentFrame: HTMLIFrameElement
let parent: Window

beforeEach(() => {
  parentFrame = document.createElement('iframe')
  document.body.appendChild(parentFrame)
  parent = parentFrame.contentWindow!
  Object.defineProperty(window, 'parent', { configurable: true, value: parent })
  localStorage.clear()
  useThemeStore.getState().setHostTheme(null)
  useThemeStore.getState().applyTheme('light')
})
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'parent', { configurable: true, value: originalParent })
  parentFrame.remove()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
function send(theme: unknown, origin = canonicalStudioOrigin, source: Window = parent) {
  act(() => window.dispatchEvent(new MessageEvent('message', {
    origin, source, data: { type: 'elastic-studio:appearance', theme },
  })))
}

describe('Studio appearance bridge', () => {
  it('uses the canonical production origin even with a local parent configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_STUDIO_LOCAL_TEST', 'false')
    vi.stubEnv('NEXT_PUBLIC_STUDIO_PARENT_ORIGIN', 'http://localhost:3036')
    vi.resetModules()
    const production = await import('@/lib/studio-embed')
    expect(production.STUDIO_ORIGIN).toBe('https://app.elasticlabs.com')
  })
  it('handshakes, changes modes live, and keeps the standalone preference', () => {
    expect(STUDIO_ORIGIN).toBe('https://app.elasticlabs.com')
    const post = vi.spyOn(parent, 'postMessage')
    render(<StudioEmbedBridge />)
    expect(post).toHaveBeenCalledWith({ type: 'elastic-studio:ready' }, canonicalStudioOrigin)
    send('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.studioEmbed).toBe('true')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(JSON.parse(localStorage.getItem('ff-theme')!).state).toEqual({ theme: 'light' })
    expect(post).toHaveBeenCalledWith({ type: 'elastic-studio:appearance-applied' }, canonicalStudioOrigin)
    send('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(useThemeStore.getState().hostTheme).toBe('light')
    expect(post).toHaveBeenCalledTimes(3)
  })
  it.each([
    'https://app.elasticlabs.site',
    'https://evil.example',
    'https://app.elasticlabs.com.evil.example',
    'https://app.elasticlabs.site.evil.example',
    'http://app.elasticlabs.com',
    'https://app.elasticlabs.com:444',
    'null',
  ])('rejects origin %s', (origin) => {
    const post = vi.spyOn(parent, 'postMessage')
    render(<StudioEmbedBridge />)
    post.mockClear()
    send('dark', origin)
    expect(useThemeStore.getState().hostTheme).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })
  it('rejects the canonical origin from another window', () => {
    const post = vi.spyOn(parent, 'postMessage')
    render(<StudioEmbedBridge />)
    post.mockClear()
    send('dark', canonicalStudioOrigin, window)
    expect(useThemeStore.getState().hostTheme).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })
  it.each(['system', '', 'LIGHT', null, undefined, true, 0, { theme: 'dark' }, ['light']])('rejects malformed mode %j', (theme) => {
    const post = vi.spyOn(parent, 'postMessage')
    render(<StudioEmbedBridge />)
    post.mockClear()
    send(theme)
    expect(useThemeStore.getState().hostTheme).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })
  it.each(['dark', 'light'] as const)('retains host %s after delayed server preference and system events', (theme) => {
    render(<StudioEmbedBridge />)
    send(theme)
    act(() => {
      useThemeStore.getState().syncFromServer({ theme: theme === 'dark' ? 'light' : 'dark' })
      useThemeStore.getState().applyTheme('system')
    })
    expect(document.documentElement.dataset.theme).toBe(theme)
  })
  it('restores standalone appearance when the bridge unmounts', () => {
    const { unmount } = render(<StudioEmbedBridge />)
    send('dark')
    expect(useThemeStore.getState().hostTheme).toBe('dark')
    unmount()
    expect(useThemeStore.getState().hostTheme).toBeNull()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.studioEmbed).toBeUndefined()
  })
  it('never enables an embed in a top-level window', () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: window })
    render(<StudioEmbedBridge />)
    send('dark', canonicalStudioOrigin, window)
    expect(useThemeStore.getState().hostTheme).toBeNull()
  })
})
