import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudioEmbedBridge } from '../studio-embed-bridge'
import { useThemeStore } from '@/stores/theme-store'
import { STUDIO_ORIGIN } from '@/lib/studio-embed'

const originalParent = window.parent
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
})
function send(theme: unknown, origin = STUDIO_ORIGIN, source: Window = parent) {
  act(() => window.dispatchEvent(new MessageEvent('message', {
    origin, source, data: { type: 'elastic-studio:appearance', theme },
  })))
}

describe('Studio appearance bridge', () => {
  it('handshakes, changes modes live, and keeps the standalone preference', () => {
    const post = vi.spyOn(parent, 'postMessage')
    render(<StudioEmbedBridge />)
    expect(post).toHaveBeenCalledWith({ type: 'elastic-studio:ready' }, STUDIO_ORIGIN)
    send('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.studioEmbed).toBe('true')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(JSON.parse(localStorage.getItem('ff-theme')!).state).toEqual({ theme: 'light' })
    expect(post).toHaveBeenCalledWith({ type: 'elastic-studio:appearance-applied' }, STUDIO_ORIGIN)
    send('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
  it.each(['https://evil.example', 'https://app.elasticlabs.site.evil.example', 'null'])('rejects origin %s', (origin) => {
    render(<StudioEmbedBridge />)
    send('dark', origin)
    expect(useThemeStore.getState().hostTheme).toBeNull()
  })
  it('rejects the right origin from another window and malformed modes', () => {
    render(<StudioEmbedBridge />)
    send('dark', STUDIO_ORIGIN, window)
    send('system')
    send({ theme: 'dark' })
    expect(useThemeStore.getState().hostTheme).toBeNull()
  })
  it('retains the host mode after delayed server preference and system events', () => {
    render(<StudioEmbedBridge />)
    send('dark')
    act(() => {
      useThemeStore.getState().syncFromServer({ theme: 'light' })
      useThemeStore.getState().applyTheme('system')
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
  it('restores standalone appearance when the bridge unmounts', () => {
    const { unmount } = render(<StudioEmbedBridge />)
    send('dark')
    unmount()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.studioEmbed).toBeUndefined()
  })
  it('never enables an embed in a top-level window', () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: window })
    render(<StudioEmbedBridge />)
    send('dark', STUDIO_ORIGIN, window)
    expect(useThemeStore.getState().hostTheme).toBeNull()
  })
})
