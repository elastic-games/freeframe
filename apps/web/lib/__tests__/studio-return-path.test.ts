import { describe, it, expect } from 'vitest'
import { studioReturnPath } from '../studio-return-path'

describe('Studio sign-in return navigation', () => {
  it('retains the asset, exact version and comment bookmark', () => {
    const path = '/projects/p/assets/a?version=v&commentId=c'
    expect(studioReturnPath(path)).toBe(path)
  })
  it('retains dashboard settings and notification routes', () => {
    expect(studioReturnPath('/settings/appearance')).toBe('/settings/appearance')
    expect(studioReturnPath('/notifications')).toBe('/notifications')
  })
  it.each([null, '//evil.invalid/projects', '/\\evil.invalid/projects', 'https://evil.invalid', '/api/auth', '/studio?from=/studio', '/projects\nLocation:evil', '/projects/../../../api/auth'])('rejects unsafe or non-dashboard destination %s', (path) => {
    expect(studioReturnPath(path)).toBe('/projects')
  })
})
