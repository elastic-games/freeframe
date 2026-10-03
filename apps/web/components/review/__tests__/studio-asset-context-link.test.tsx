import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioAssetContextLink } from '../studio-asset-context-link'
import type { AssetVersion } from '@/types'

const project = '11111111-1111-4111-8111-111111111111'
const asset = '22222222-2222-4222-8222-222222222222'
const first = '33333333-3333-4333-8333-333333333333'
const second = '44444444-4444-4444-8444-444444444444'
const version = (id = first) => ({ id, asset_id: asset, processing_status: 'ready', deleted_at: null } as AssetVersion)

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('Studio asset context action', () => {
  it('follows the selected version and exits an embedded review into the Studio shell', () => {
    vi.stubEnv('NEXT_PUBLIC_STUDIO_SSO_ENABLED', 'true')
    const view = render(<StudioAssetContextLink projectId={project} assetId={asset} version={version()} />)
    const link = screen.getByRole('link', { name: /sources and production/ })
    const initial = new URL(link.getAttribute('href')!)
    expect(initial.origin).toBe('https://app.elasticlabs.site')
    expect(initial.pathname).toBe('/assets')
    expect(Object.fromEntries(initial.searchParams)).toEqual({ reviewProjectId: project, reviewAssetId: asset, reviewVersionId: first })
    expect(link).toHaveAttribute('target', '_top')
    view.rerender(<StudioAssetContextLink projectId={project} assetId={asset} version={version(second)} />)
    expect(new URL(link.getAttribute('href')!).searchParams.get('reviewVersionId')).toBe(second)
  })

  it.each([
    null,
    { ...version(), processing_status: 'processing' },
    { ...version(), deleted_at: '2026-10-02' },
    { ...version(), asset_id: first },
    { ...version(), id: 'https://attacker.test/' },
  ])('does not link unavailable or mismatched version %#', (value) => {
    vi.stubEnv('NEXT_PUBLIC_STUDIO_SSO_ENABLED', 'true')
    render(<StudioAssetContextLink projectId={project} assetId={asset} version={value as AssetVersion | null} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('does not add Studio integration to standalone FreeFrame', () => {
    vi.stubEnv('NEXT_PUBLIC_STUDIO_SSO_ENABLED', 'false')
    render(<StudioAssetContextLink projectId={project} assetId={asset} version={version()} />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
