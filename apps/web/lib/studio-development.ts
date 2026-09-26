const productionOrigin = 'https://app.elasticlabs.site'

export function studioFrontendOrigin(
  browserHostname?: string,
  configured = process.env.NEXT_PUBLIC_STUDIO_DEVELOPMENT_ORIGIN,
  mode: string = process.env.NODE_ENV || 'production',
): string {
  if (mode !== 'development' || !configured) return productionOrigin
  const url = new URL(configured)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || !url.port || url.origin !== configured || url.username || url.password) {
    throw new Error('Studio development origin must be an HTTP loopback origin with an explicit port')
  }
  if (browserHostname && ['localhost', '127.0.0.1'].includes(browserHostname)) url.hostname = browserHostname
  return url.origin
}

/** Only retain same-application project paths, including the exact version query. */
export function studioReturnPath(value: string | null): string {
  if (!value || value.length > 4096 || !value.startsWith('/') || value.startsWith('//')
    || /[\\\u0000-\u001f]|%2f|%5c/i.test(value)) return '/projects'
  try {
    const url = new URL(value, 'https://freeframe-return.invalid')
    if (url.origin !== 'https://freeframe-return.invalid'
      || (url.pathname !== '/projects' && !url.pathname.startsWith('/projects/'))) return '/projects'
    return url.pathname + url.search
  } catch {
    return '/projects'
  }
}

/** Bounded local session window; production SSO cookie lifetime stays 120 seconds. */
export function studioSessionCookieSeconds(
  configured=process.env.NEXT_PUBLIC_STUDIO_DEVELOPMENT_SESSION_SECONDS,
  developmentOrigin=process.env.NEXT_PUBLIC_STUDIO_DEVELOPMENT_ORIGIN,
  mode:string=process.env.NODE_ENV || 'production',
):number {
  if (mode!=='development' || !configured || !developmentOrigin) return 120
  studioFrontendOrigin(undefined,developmentOrigin,mode)
  if (!/^\d+$/.test(configured) || Number(configured)<120 || Number(configured)>3600) throw new Error('Local Studio session must be between 120 and 3600 seconds')
  return Number(configured)
}
