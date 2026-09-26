import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CommentPanel } from '../comment-panel'
import { useReviewStore } from '@/stores/review-store'

const noop = async () => {}
const comment = {
  id: 'comment-1', asset_id: 'asset-1', version_id: 'version-1', parent_id: null,
  author_id: 'user-1',
  author: { id: 'user-1', name: 'Reviewer', avatar_url: null },
  body: 'Check this frame', timecode_start: null, timecode_end: null,
  resolved: false, visibility: 'all', created_at: '', updated_at: '',
  replies: [], reactions: [], attachments: [],
} as never

describe('comment review links', () => {
  beforeEach(() => {
    useReviewStore.getState().reset()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('copies a project asset link with both its exact version and comment', () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    window.history.replaceState({}, '', '/projects/project-1')
    render(
      <CommentPanel
        comments={[comment]} currentUserId="user-1"
        onResolve={noop} onDelete={noop} onAddReaction={noop} onRemoveReaction={noop}
        onReply={() => {}}
      />,
    )

    fireEvent.click(screen.getByTitle('Comment actions'))
    fireEvent.click(screen.getByText('Copy Link'))

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = new URL(writeText.mock.calls[0][0])
    expect(copied.pathname).toBe('/projects/project-1/assets/asset-1')
    expect(copied.searchParams.get('versionId')).toBe('version-1')
    expect(copied.searchParams.get('commentId')).toBe('comment-1')
  })
})
