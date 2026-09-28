const localParent = process.env.NEXT_PUBLIC_STUDIO_PARENT_ORIGIN
export const STUDIO_ORIGIN = (process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_STUDIO_LOCAL_TEST === 'true') &&
  localParent && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(localParent)
  ? localParent : 'https://app.elasticlabs.site'

/** Presentation-only commands to the Studio parent; no identities or credentials. */
export function requestStudioControl(type: 'toggle-navigation' | 'set-theme', theme?: 'dark' | 'light') {
  if (window.parent !== window) {
    window.parent.postMessage({ type: `elastic-studio:${type}`, ...(theme ? { theme } : {}) }, STUDIO_ORIGIN)
  }
}
