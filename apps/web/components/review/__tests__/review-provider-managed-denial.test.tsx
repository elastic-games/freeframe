import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewProvider, useReview } from '../review-provider'
import { useReviewStore } from '@/stores/review-store'
import { ApiError } from '@/lib/api'

const mock = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: { get: mock.get },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message) }
  },
}))

function Probe() {
  const review = useReview()
  return <div>
    <span data-testid="asset">{review.asset?.id ?? 'none'}</span>
    <span data-testid="comments">{review.comments.length}</span>
    <span data-testid="error">{review.errorStatus ?? 'none'}</span>
    <button onClick={review.retry}>Retry</button>
  </div>
}

const previousManaged = process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS
beforeEach(() => {
  process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS = 'true'
  useReviewStore.getState().reset()
  mock.get.mockReset()
})
afterEach(() => { process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS = previousManaged })

it('clears a previous asset and comments on a denied project switch, then retries only the current asset', async () => {
  let denyB = true
  mock.get.mockImplementation(async (path: string) => {
    if (path === '/assets/B' && denyB) {
      throw new ApiError(403, 'Review access denied.')
    }
    if (path.endsWith('/versions')) return [{ id: `version-${path.split('/')[2]}`, version_number: 1, processing_status: 'ready' }]
    if (path.endsWith('/comments')) return [{ id: `comment-${path.split('/')[2]}` }]
    return { id: path.split('/')[2], name: 'Review', latest_version: null }
  })

  const view = render(<ReviewProvider assetId="A"><Probe /></ReviewProvider>)
  await waitFor(() => expect(screen.getByTestId('asset')).toHaveTextContent('A'))
  await waitFor(() => expect(screen.getByTestId('comments')).toHaveTextContent('1'))

  view.rerender(<ReviewProvider assetId="B"><Probe /></ReviewProvider>)
  await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('403'))
  expect(screen.getByTestId('asset')).toHaveTextContent('none')
  expect(screen.getByTestId('comments')).toHaveTextContent('0')
  expect(useReviewStore.getState().currentAsset).toBeNull()
  expect(useReviewStore.getState().currentVersion).toBeNull()

  denyB = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByTestId('asset')).toHaveTextContent('B'))
  await waitFor(() => expect(screen.getByTestId('comments')).toHaveTextContent('1'))
  expect(screen.getByTestId('error')).toHaveTextContent('none')
})
