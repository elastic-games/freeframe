import { afterEach, expect, it, vi } from 'vitest'
import { createStudioParentTransport } from '../studio-parent-transport'
const origin = 'https://app.elasticlabs.com', prefix = 'elastic-studio:transport:'
const session = '11111111-1111-4111-8111-111111111111'
const active: ReturnType<typeof createStudioParentTransport>[] = []
function fixture() {
  const postMessage = vi.fn(), parent = { postMessage } as unknown as Window
  const client = createStudioParentTransport(window, parent, origin); active.push(client)
  const receive = (data: unknown, source = parent, from = origin) => window.dispatchEvent(new MessageEvent('message', { data, source, origin: from }))
  const ready = () => {
    receive({ type: prefix + 'challenge', session })
    const document = postMessage.mock.calls.find(([m]) => m.type === prefix + 'connect')?.[0].document
    receive({ type: prefix + 'ready', session, document })
  }
  const reply = (id: number, status = 200, data = '[]') => ({ type: prefix + 'reply', session, id, status, data })
  return { postMessage, parent, client, receive, ready, reply }
}
afterEach(() => { active.splice(0).forEach(c => c.dispose()); vi.useRealTimers() })
it('checks exact source and origin, correlates concurrent replies and ignores duplicates', async () => {
  const f = fixture(), one = f.client.request({ method: 'GET', path: '/projects' }), two = f.client.request({ method: 'GET', path: '/auth/me' })
  f.receive({ type: prefix + 'ready', session }, {} as Window)
  f.receive({ type: prefix + 'ready', session }, f.parent, 'https://evil.invalid')
  expect(f.postMessage.mock.calls.every(([m]) => m.type === prefix + 'hello')).toBe(true)
  f.ready(); expect(f.postMessage.mock.calls.at(-1)?.[1]).toBe(origin)
  f.receive(f.reply(1), {} as Window); f.receive(f.reply(1), f.parent, 'https://evil.invalid')
  f.receive(f.reply(2, 401, '{"detail":"Sign in"}')); f.receive(f.reply(1))
  expect((await two).status).toBe(401); expect(await (await one).json()).toEqual([])
  f.receive(f.reply(1, 403))
})
it('cancels on abort, handshake timeout, navigation and disposal', async () => {
  vi.useFakeTimers()
  const f = fixture(), controller = new AbortController(), one = f.client.request({ path: '/projects' }, controller.signal)
  const denied = expect(one).rejects.toThrow(/cancelled/); f.ready(); controller.abort(); await denied
  const two = f.client.request({ path: '/projects' }), navigated = expect(two).rejects.toThrow(/changed/)
  f.receive({ type: prefix + 'ready', session: session.replaceAll('1', '2'), document: f.postMessage.mock.calls.find(([m]) => m.type === prefix + 'connect')?.[0].document }); await navigated
  const three = f.client.request({ path: '/projects' }), closed = expect(three).rejects.toThrow(/closed/)
  f.client.dispose(); await closed
  const g = fixture(), timeout = g.client.request({ path: '/projects' }), timedOut = expect(timeout).rejects.toThrow(/cancelled/)
  await vi.advanceTimersByTimeAsync(8001); await timedOut
})
it('forwards actual SSE bytes with sequential ACKs and consumer cancellation', async () => {
  const f = fixture(), response = f.client.request({ method: 'GET', path: '/events', project: session })
  f.ready(); f.receive({ type: prefix + 'open', session, id: 1 })
  const reader = (await response).body!.getReader(), read = reader.read()
  f.receive({ type: prefix + 'chunk', session, id: 1, seq: 1, data: 'event: new_comment\ndata: {}\n\n' })
  expect(new TextDecoder().decode((await read).value)).toContain('new_comment')
  await Promise.resolve()
  expect(f.postMessage.mock.calls.some(([m]) => m.type === prefix + 'ack' && m.seq === 1)).toBe(true)
  await reader.cancel(); expect(f.postMessage.mock.calls.at(-1)?.[0].type).toBe(prefix + 'cancel')
})
it('bounds requests and concurrency and rejects standalone use', async () => {
  const f = fixture()
  await expect(f.client.request({ body: 'x'.repeat(2_000_001) })).rejects.toThrow(/too large/)
  const pending = Array.from({ length: 16 }, () => f.client.request({ path: '/projects' }).catch(e => e))
  await expect(f.client.request({ path: '/projects' })).rejects.toThrow(/Too many/)
  f.ready(); f.client.dispose(); await Promise.all(pending)
  const direct = createStudioParentTransport(window, window, origin); active.push(direct)
  await expect(direct.request({ path: '/projects' })).rejects.toThrow(/Open in Studio/)
})

it('suspends for back-forward cache and handshakes again after pageshow', async () => {
  const f = fixture(), one = f.client.request({ path: '/projects' })
  const suspended = expect(one).rejects.toThrow(/suspended/)
  f.ready()
  const hide = new Event('pagehide'); Object.defineProperty(hide, 'persisted', { value: true }); window.dispatchEvent(hide)
  await suspended
  const show = new Event('pageshow'); Object.defineProperty(show, 'persisted', { value: true }); window.dispatchEvent(show)
  expect(f.postMessage.mock.calls.at(-1)?.[0].type).toBe(prefix + 'hello')
  const next = f.client.request({ path: '/projects' }); f.ready(); f.receive(f.reply(2))
  expect((await next).status).toBe(200)
})
