import { getAccessToken, refreshAccessToken } from './auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const STUDIO_MANAGED = process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS === 'true'
const STUDIO_TRANSPORT_URL = process.env.NEXT_PUBLIC_STUDIO_TRANSPORT_URL || 'https://app.elasticlabs.site/api/studio/freeframe-transport'

/** The provider ID in the page URL identifies this tab's project. Studio
 * resolves the exact active canonical binding again for each operation. */
function managedProject(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return window.location.pathname.match(/\/projects\/([0-9a-f]{8}-[0-9a-f-]{27,})\b/i)?.[1]
}

async function managedRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const url = new URL(path, 'https://reviews.elasticlabs.site')
  if (url.origin !== 'https://reviews.elasticlabs.site') throw new ApiError(400, 'Invalid review path')
  const pathProject = url.pathname.match(/^\/projects\/([0-9a-f]{8}-[0-9a-f-]{27,})(?:\/|$)/i)?.[1]
  return fetch(STUDIO_TRANSPORT_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: managedProject() || pathProject, method, path: url.pathname,
      query: url.search.slice(1), body,
    }),
    cache: 'no-store',
  })
}

export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

interface RequestOptions {
  headers?: Record<string, string>
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const buildHeaders = (token: string | null): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  const execute = async (token: string | null): Promise<Response> => {
    if (STUDIO_MANAGED) return managedRequest(method, path, body)
    return fetch(`${API_URL}${path}`, {
      method,
      headers: buildHeaders(token),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  let token = getAccessToken()
  let response = await execute(token)

  // On 401, attempt a token refresh and retry once
  if (!STUDIO_MANAGED && response.status === 401) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      response = await execute(newToken)
    }
  }

  if (!response.ok) {
    let detail = response.statusText
    try {
      const errorBody = await response.json()
      if (errorBody?.detail) {
        if (typeof errorBody.detail === 'string') {
          detail = errorBody.detail
        } else if (Array.isArray(errorBody.detail)) {
          // FastAPI validation errors: [{loc: [...], msg: "...", type: "..."}]
          detail = errorBody.detail
            .map((e: { msg?: string; loc?: string[] }) => e.msg || 'Validation error')
            .join('; ')
        } else {
          detail = JSON.stringify(errorBody.detail)
        }
      }
    } catch {
      // ignore parse errors; use statusText as fallback
    }
    throw new ApiError(response.status, detail)
  }

  // Handle empty responses (e.g. 204 No Content, or empty body)
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as unknown as T
  }

  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return undefined as unknown as T
  }

  const text = await response.text()
  if (!text) {
    return undefined as unknown as T
  }

  return JSON.parse(text) as T
}

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  if (STUDIO_MANAGED) throw new ApiError(403, 'This upload operation is unavailable in Studio Reviews')
  const buildHeaders = (token: string | null): Record<string, string> => {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    return headers
  }

  const execute = async (token: string | null): Promise<Response> => {
    return fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: formData,
    })
  }

  let token = getAccessToken()
  let response = await execute(token)

  if (response.status === 401) {
    const newToken = await refreshAccessToken()
    if (newToken) response = await execute(newToken)
  }

  if (!response.ok) {
    let detail = response.statusText
    try {
      const errorBody = await response.json()
      if (errorBody?.detail) detail = typeof errorBody.detail === 'string' ? errorBody.detail : JSON.stringify(errorBody.detail)
    } catch {}
    throw new ApiError(response.status, detail)
  }

  if (response.status === 204) return undefined as unknown as T
  const text = await response.text()
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T)
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>('GET', path, undefined, options),

  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),

  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),

  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, body, options),

  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),

  upload: <T>(path: string, formData: FormData) =>
    uploadRequest<T>(path, formData),
}

export type { ApiError as ApiErrorType }
