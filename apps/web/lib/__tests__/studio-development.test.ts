import { describe, expect, it } from 'vitest'
import { studioFrontendOrigin, studioReturnPath, studioSessionCookieSeconds } from '../studio-development'

describe('Studio development origin', () => {
  it('retains production defaults outside development', () => {
    for (const mode of ['production', 'test']) {
      expect(studioFrontendOrigin('localhost', 'http://localhost:3036', mode)).toBe('https://app.elasticlabs.site')
    }
  })
  it('aliases only the visible loopback hostname while preserving the port', () => {
    expect(studioFrontendOrigin('localhost', 'http://127.0.0.1:3036', 'development')).toBe('http://localhost:3036')
    expect(studioFrontendOrigin('127.0.0.1', 'http://localhost:3036', 'development')).toBe('http://127.0.0.1:3036')
    expect(studioFrontendOrigin('evil.test', 'http://localhost:3036', 'development')).toBe('http://localhost:3036')
  })
  it('rejects non-loopback, credential, path, query and ambiguous development configuration', () => {
    for (const origin of ['http://evil.test:3036', 'https://localhost:3036', 'http://localhost',
      'http://user@localhost:3036', 'http://localhost:3036/', 'http://localhost:3036?x=1',
      'http://localhost:3036#x', 'http://localhost.evil.test:3036']) {
      expect(() => studioFrontendOrigin('localhost', origin, 'development')).toThrow()
    }
  })
})

describe('Studio SSO exact-version return path', () => {
  it('preserves the project asset and version query through an unauthenticated handoff', () => {
    const path = '/projects/54e5d97b-68ec-41fa-85af-aace64adf26a/assets/db2c1775-07a1-4f7b-867b-f846c9116136?versionId=aa097976-fc3a-4765-a7a7-e4fadf7d2939&commentId=test'
    expect(studioReturnPath(path)).toBe(path)
    expect(studioReturnPath('/projects')).toBe('/projects')
  })
  it('refuses outside origins, traversal, control characters and non-project destinations', () => {
    for (const value of [null, '//evil.test/x', 'https://evil.test/x', '/\\evil.test',
      '/projects/../../login', '/login?from=/projects', '/projects/%2f%2fevil.test', '/projects/\nasset']) {
      expect(studioReturnPath(value)).toBe('/projects')
    }
  })
})

describe('bounded local Studio session', () => {
  it('retains production lifetime and requires an explicit validated local origin', () => {
    expect(studioSessionCookieSeconds('1800','http://localhost:3036','production')).toBe(120)
    expect(studioSessionCookieSeconds('1800',undefined,'development')).toBe(120)
    expect(studioSessionCookieSeconds('1800','http://localhost:3036','development')).toBe(1800)
    expect(() => studioSessionCookieSeconds('1800','http://outside.test:3036','development')).toThrow()
  })
  it('rejects unbounded, non-integer or ambiguous lifetime settings', () => {
    for (const seconds of ['119','3601','Infinity','1800.5','-1','1e3']) expect(() => studioSessionCookieSeconds(seconds,'http://localhost:3036','development')).toThrow()
  })
})
