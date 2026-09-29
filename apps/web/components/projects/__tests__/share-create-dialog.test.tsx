import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ShareCreateDialog } from '../share-create-dialog'
import type { AssetResponse, ShareLink } from '@/types'

const mock = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  get: vi.fn(),
  copy: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: { post: mock.post, patch: mock.patch, get: mock.get } }))
vi.mock('@/lib/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils')>()),
  copyToClipboard: mock.copy,
}))

const link = (token: string, target: 'asset' | 'project'): ShareLink => ({
  id: `id-${token}`,
  token,
  title: target === 'asset' ? 'FireBreath' : 'Giant & Ghosts',
  asset_id: target === 'asset' ? 'asset-1' : null,
  folder_id: null,
  project_id: 'project-1',
  description: null,
  created_by: 'owner',
  expires_at: null,
  permission: 'comment',
  allow_download: false,
  is_enabled: true,
  visibility: 'public',
  show_versions: true,
  show_watermark: false,
  appearance: null,
  created_at: '',
  deleted_at: null,
  has_password: false,
  password_value: null,
})

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_STUDIO_SSO_ENABLED', 'true')
  mock.post.mockReset()
  mock.patch.mockReset().mockResolvedValue({})
  mock.get.mockReset().mockImplementation(async (path: string) =>
    path.endsWith('/details') ? link(path.split('/')[2], 'asset') : [],
  )
  mock.copy.mockReset().mockResolvedValue(true)
})
afterEach(() => vi.unstubAllEnvs())

describe('ShareCreateDialog result', () => {
  it('keeps a newly created video link in the dialog for immediate copying', async () => {
    const created = link('video-token', 'asset')
    mock.post.mockResolvedValue(created)
    const onOpenChange = vi.fn()
    const onShareCreated = vi.fn()
    render(
      <ShareCreateDialog
        open
        onOpenChange={onOpenChange}
        projectId="project-1"
        currentFolderId={null}
        assets={[]}
        folders={[]}
        preselectedItem={{ type: 'asset', id: 'asset-1', name: 'FireBreath' }}
        onShareCreated={onShareCreated}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /^Create$/ }))
    const copy = await screen.findByRole('button', { name: 'Copy Link' })
    expect(screen.getByText('https://app.elasticlabs.site/share/video-token')).toBeInTheDocument()
    fireEvent.click(copy)
    await waitFor(() => expect(mock.copy).toHaveBeenCalledWith('https://app.elasticlabs.site/share/video-token'))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(onShareCreated).toHaveBeenCalledOnce()
    expect(mock.post).toHaveBeenCalledWith('/assets/asset-1/share', { title: 'FireBreath' })
  })

  it('shows the project URL after creation even when an optional settings patch fails', async () => {
    mock.post.mockResolvedValue(link('project-token', 'project'))
    mock.patch.mockRejectedValue(new Error('settings unavailable'))
    const onOpenChange = vi.fn()
    const onShareCreated = vi.fn()
    const assets = [{ id: 'asset-1', name: 'FireBreath' }] as AssetResponse[]
    const view = render(
      <ShareCreateDialog
        open
        onOpenChange={onOpenChange}
        projectId="project-1"
        currentFolderId={null}
        assets={assets}
        folders={[]}
        onShareCreated={onShareCreated}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Create$/ }))
    expect(await screen.findByText('https://app.elasticlabs.site/share/project-token')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Link' })).toBeInTheDocument()
    expect(screen.getByText(/some settings could not be saved/i)).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(onShareCreated).toHaveBeenCalledOnce()
    expect(mock.post).toHaveBeenCalledWith('/projects/project-1/share', { title: 'Shared Project' })

    // A parent SWR refresh may hand the dialog a new assets array while open.
    view.rerender(
      <ShareCreateDialog
        open
        onOpenChange={onOpenChange}
        projectId="project-1"
        currentFolderId={null}
        assets={[...assets]}
        folders={[]}
        onShareCreated={onShareCreated}
      />,
    )
    expect(screen.getByRole('button', { name: 'Copy Link' })).toBeInTheDocument()
  })
})
