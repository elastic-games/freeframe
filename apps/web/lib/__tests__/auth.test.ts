import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setTokens, getAccessToken, getRefreshToken, clearTokens, getUsableShareAccessToken } from '../auth'

const accessToken = (expiresInSeconds: number) =>
  `header.${btoa(JSON.stringify({ type: 'access', exp: Math.floor(Date.now() / 1000) + expiresInSeconds }))}.signature`

describe('Token management', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() },
    })
    vi.clearAllMocks()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('setTokens stores access and refresh tokens in localStorage', () => {
    setTokens('access-123', 'refresh-456')
    expect(localStorage.getItem('ff_access_token')).toBe('access-123')
    expect(localStorage.getItem('ff_refresh_token')).toBe('refresh-456')
  })

  it('getAccessToken retrieves access token from localStorage', () => {
    localStorage.setItem('ff_access_token', 'my-access-token')
    expect(getAccessToken()).toBe('my-access-token')
  })

  it('getAccessToken returns null when no token stored', () => {
    expect(getAccessToken()).toBeNull()
  })

  it('does not treat a stored expired review token as a share-page login', () => {
    localStorage.setItem('ff_access_token', accessToken(-60))
    expect(getUsableShareAccessToken()).toBeNull()
  })

  it('uses a current review token for share comments', () => {
    const token = accessToken(3600)
    localStorage.setItem('ff_access_token', token)
    expect(getUsableShareAccessToken()).toBe(token)
  })

  it('getRefreshToken retrieves refresh token from localStorage', () => {
    localStorage.setItem('ff_refresh_token', 'my-refresh-token')
    expect(getRefreshToken()).toBe('my-refresh-token')
  })

  it('getRefreshToken returns null when no token stored', () => {
    expect(getRefreshToken()).toBeNull()
  })

  it('clearTokens removes both tokens from localStorage', () => {
    localStorage.setItem('ff_access_token', 'access-123')
    localStorage.setItem('ff_refresh_token', 'refresh-456')

    // Mock window.location.href setter to avoid navigation errors
    const locationMock = { href: '' }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
    })

    clearTokens()

    expect(localStorage.getItem('ff_access_token')).toBeNull()
    expect(localStorage.getItem('ff_refresh_token')).toBeNull()
  })

  it('clearTokens redirects to /login', () => {
    const locationMock = { href: '' }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
    })

    clearTokens()

    expect(window.location.href).toBe('/login')
  })
})
