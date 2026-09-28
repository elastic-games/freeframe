import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareUrl } from '@/lib/share-url'

afterEach(() => vi.unstubAllEnvs())

describe('public review links', () => {
  it('uses the portal for Studio SSO reviews', () => {
    vi.stubEnv('NEXT_PUBLIC_STUDIO_SSO_ENABLED', 'true')
    expect(shareUrl('review-token-123456', 'https://reviews.elasticlabs.site')).toBe(
      'https://app.elasticlabs.site/share/review-token-123456',
    )
  })

  it('keeps standalone FreeFrame links on their own origin', () => {
    expect(shareUrl('review-token-123456', 'https://reviews.example.com')).toBe(
      'https://reviews.example.com/share/review-token-123456',
    )
  })
})
