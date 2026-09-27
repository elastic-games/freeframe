import { withBasePath } from './base-path'

const ACCESS_TOKEN_KEY = 'ff_access_token'
const REFRESH_TOKEN_KEY = 'ff_refresh_token'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const STUDIO_SSO_ENABLED = process.env.NEXT_PUBLIC_STUDIO_SSO_ENABLED === 'true'
const STUDIO_TICKET_URL = process.env.NEXT_PUBLIC_STUDIO_TICKET_URL || 'https://app.elasticlabs.site/api/reviews/sso-ticket'

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setTokens(access: string, refresh: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(ACCESS_TOKEN_KEY, access)
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh)
  // Set cookies so middleware can check auth on server side
  const maxAge = STUDIO_SSO_ENABLED ? 120 : 60 * 60 * 24 * 7
  document.cookie = `${ACCESS_TOKEN_KEY}=${access}; path=/; max-age=${maxAge}; SameSite=Lax`
  document.cookie = `${REFRESH_TOKEN_KEY}=${refresh}; path=/; max-age=${maxAge}; SameSite=Lax`
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  // Clear auth cookies
  document.cookie = `${ACCESS_TOKEN_KEY}=; path=/; max-age=0`
  document.cookie = `${REFRESH_TOKEN_KEY}=; path=/; max-age=0`
  window.location.href = withBasePath(STUDIO_SSO_ENABLED ? '/studio' : '/login')
}

/** Studio owns login; FreeFrame only exchanges a one-use identity assertion. */
export async function signInWithStudio(): Promise<string | null> {
  if (!STUDIO_SSO_ENABLED || typeof window === 'undefined') return null
  try {
    const ticketResponse = await fetch(STUDIO_TICKET_URL, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    })
    if (!ticketResponse.ok) return null
    const { ticket } = await ticketResponse.json() as { ticket: string }
    if (!ticket) return null
    const response = await fetch(`${API_URL}/auth/studio-sso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
      cache: 'no-store',
    })
    if (!response.ok) return null
    const data = await response.json() as { access_token: string }
    if (!data.access_token) return null
    setTokens(data.access_token, '')
    return data.access_token
  } catch {
    return null
  }
}

// Deduplicate concurrent refresh calls — when access token expires, multiple
// API calls may simultaneously get 401 and try to refresh. Only one should run.
let _refreshPromise: Promise<string | null> | null = null

export async function refreshAccessToken(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise

  _refreshPromise = _doRefresh()
  try {
    return await _refreshPromise
  } finally {
    _refreshPromise = null
  }
}

async function _doRefresh(): Promise<string | null> {
  if (STUDIO_SSO_ENABLED) return signInWithStudio()
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    clearTokens()
    return null
  }

  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (!response.ok) {
      // Only a refusal ends the session. 401 or 403 is the server saying this
      // refresh token is no longer valid, which is what signing out is for.
      // Anything else -- a 502 from a proxy mid-deploy, a 500, a rate limit --
      // is the server being briefly unavailable, and signing the user out for
      // it loses whatever they had open.
      if (response.status === 401 || response.status === 403) {
        clearTokens()
      }
      return null
    }

    const data = await response.json()
    const newAccessToken: string = data.access_token
    const newRefreshToken: string = data.refresh_token ?? refreshToken

    setTokens(newAccessToken, newRefreshToken)
    return newAccessToken
  } catch {
    // `fetch` rejects only on a transport failure; an HTTP error status
    // resolves and is handled above. So reaching here means the request never
    // got an answer: no network, DNS, a dropped connection. Clearing tokens
    // here signed people out for going through a tunnel, and took the page
    // they were on with it, since `clearTokens` navigates to /login.
    //
    // Callers treat null as "could not refresh" and let the original failure
    // surface, so keeping the tokens costs nothing and the session survives
    // until the network comes back.
    return null
  }
}
