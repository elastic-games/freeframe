export const STUDIO_ORIGIN = 'https://app.elasticlabs.site'

/** Presentation-only commands to the Studio parent; no identities or credentials. */
export function requestStudioControl(type: 'toggle-navigation' | 'set-theme', theme?: 'dark' | 'light') {
  if (window.parent !== window) {
    window.parent.postMessage({ type: `elastic-studio:${type}`, ...(theme ? { theme } : {}) }, STUDIO_ORIGIN)
  }
}
