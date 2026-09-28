import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

it('keeps managed upload rows separate from legacy global upload history', async () => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS', 'true')
  const oldRow = {
    id: 'legacy-row', projectId: 'old-project', fileName: 'private.mp4',
    fileSize: 1, fileType: 'video/mp4', assetName: 'private', progress: 0,
    processingProgress: 0, status: 'failed' as const, createdAt: Date.now(),
  }
  const legacy = JSON.stringify({ state: { files: [oldRow] }, version: 0 })
  window.localStorage.setItem('ff-uploads', legacy)

  const { useUploadStore } = await import('../upload-store')
  expect(useUploadStore.getState().files).toEqual([])
  useUploadStore.setState({ files: [{ ...oldRow, id: 'managed-row' }] })

  expect(window.localStorage.getItem('ff-uploads')).toBe(legacy)
  expect(window.localStorage.getItem('ff-studio-managed-uploads')).toContain('managed-row')
})
