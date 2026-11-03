import { STUDIO_ORIGIN } from './studio-embed'
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
/** Reopen only the exact supported review bookmark; never forward credentials or arbitrary redirects. */
export function studioWorkspaceLink(path: string, search: string): string {
  const fallback = `${STUDIO_ORIGIN}/apps/reviews`
  if (path.length + search.length > 4096 || /[\\%#\s]/.test(path)) return fallback
  const parts = path.split('/').filter(Boolean)
  if ('/' + parts.join('/') !== path || parts[0] !== 'projects' || (parts.length > 1 && !UUID.test(parts[1])) ||
      !(parts.length === 1 || parts.length === 2 ||
        (parts.length === 3 && ['settings', 'collections'].includes(parts[2])) ||
        (parts.length === 4 && parts[2] === 'assets' && UUID.test(parts[3])))) return fallback
  const query = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const [key, value] of Array.from(query)) {
    if (!['version', 'versionId', 'commentId', 'folder', 'compare'].includes(key)) continue
    if (query.getAll(key).length !== 1 || (!(key === 'folder' && value === 'root') && !UUID.test(value))) return fallback
    const target = key === 'versionId' ? 'version' : key
    if (kept.has(target) && kept.get(target) !== value) return fallback
    kept.set(target, value)
  }
  if (parts.length === 1) return fallback
  return `${fallback}${path}${kept.size ? '?' + kept.toString() : ''}`
}
