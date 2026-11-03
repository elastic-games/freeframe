import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const parentRequest = vi.hoisted(() => { process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS = 'true'; return vi.fn() })
vi.mock('@/lib/studio-parent-transport', () => ({ studioParentRequest: parentRequest }))
import { useSSE } from '../use-sse'
afterEach(() => { cleanup(); parentRequest.mockReset(); vi.useRealTimers() })
it('parses chunked real SSE, reconnects the finite stream, and cancels on scope change/unmount', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const signals: AbortSignal[] = []
  parentRequest.mockImplementation(async (_envelope, signal) => {
    signals.push(signal)
    return new Response(new ReadableStream({ start(c) { stream = c } }), { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const onNewComment = vi.fn()
  const view = renderHook(({ project }) => useSSE(project, { onNewComment }), { initialProps: { project: 'one' } })
  await waitFor(() => expect(view.result.current.isConnected).toBe(true))
  await act(async () => {
    stream.enqueue(new TextEncoder().encode('event: new_com'))
    stream.enqueue(new TextEncoder().encode('ment\ndata: {"asset_id":"a","comment_id":"c"}\n\n'))
  })
  expect(onNewComment).toHaveBeenCalledWith({ asset_id: 'a', comment_id: 'c' })
  vi.useFakeTimers()
  await act(async () => { stream.close(); await Promise.resolve() })
  await act(async () => { await vi.advanceTimersByTimeAsync(1001) })
  expect(parentRequest).toHaveBeenCalledTimes(2)
  view.rerender({ project: 'two' })
  expect(signals[1].aborted).toBe(true)
  await act(async () => { await Promise.resolve() })
  expect(parentRequest.mock.calls.at(-1)?.[0]).toEqual({ method: 'GET', path: '/events', project: 'two' })
  view.unmount(); expect(signals.at(-1)?.aborted).toBe(true)
})
it.each([401, 403, 404])('stops reconnecting denied streams (%i) until the scope changes', async status => {
  vi.useFakeTimers()
  parentRequest.mockResolvedValue(Response.json({ detail: 'Denied' }, { status }))
  const view = renderHook(() => useSSE('one'))
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(view.result.current.isConnected).toBe(false)
  expect(parentRequest).toHaveBeenCalledTimes(1)
})
