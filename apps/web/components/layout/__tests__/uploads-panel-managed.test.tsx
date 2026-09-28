import { afterEach, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const mock = vi.hoisted(() => ({ fetchHistory: vi.fn(), fetchMoreHistory: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/11111111-1111-4111-8111-111111111111',
}))
vi.mock('@/stores/theme-store', () => ({ useThemeStore: () => null }))
vi.mock('@/stores/upload-store', () => ({
  useUploadStore: () => ({
    files: [], panelOpen: true, setPanelOpen: vi.fn(), clearCompleted: vi.fn(),
    removeFile: vi.fn(), fetchHistory: mock.fetchHistory,
    fetchMoreHistory: mock.fetchMoreHistory, historyHasMore: false, historyLoading: false,
  }),
}))

import { UploadsPanel } from '../uploads-panel'

afterEach(() => {
  vi.unstubAllEnvs()
  mock.fetchHistory.mockClear()
})

it('does not request account-wide upload history in Studio-managed Reviews', () => {
  vi.stubEnv('NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS', 'true')
  render(<UploadsPanel />)
  expect(mock.fetchHistory).not.toHaveBeenCalled()
})
