import { STUDIO_ORIGIN } from './studio-embed'

const PREFIX = 'elastic-studio:transport:'
const MAX_REPLY = 4_500_000
const SESSION = /^[0-9a-f-]{36}$/
type Pending = {
  envelope: unknown; sent: boolean; stream: boolean; sequence: number; bytes: number;
  resolve: (value: Response) => void; reject: (error: Error) => void;
  controller?: ReadableStreamDefaultController<Uint8Array>; ack?: () => void;
  cleanup: () => void;
}

/** One document's finite review connection to its exact Studio parent. */
export function createStudioParentTransport(host: Window, parent: Window, origin: string) {
  const documentId = crypto.randomUUID()
  let session = '', nextId = 0, disposed = false
  const pending = new Map<number, Pending>()
  const send = (message: Record<string, unknown>) => parent.postMessage(message, origin)
  const fail = (id: number, message = 'Review transport unavailable. Retry in Studio.') => {
    const p = pending.get(id)
    if (!p) return
    pending.delete(id); p.cleanup()
    const error = new Error(message)
    if (p.controller) p.controller.error(error)
    else p.reject(error)
  }
  const dispatch = (id: number, p: Pending) => {
    if (!session || p.sent) return
    p.sent = true
    send({ type: PREFIX + 'request', session, id, envelope: p.envelope })
  }
  function receive(event: MessageEvent) {
    if (disposed || event.source !== parent || event.origin !== origin) return
    const m = event.data
    if (!m || typeof m !== 'object' || Array.isArray(m)) return
    if (m.type === PREFIX + 'challenge' && Object.keys(m).length === 2 && typeof m.session === 'string' && SESSION.test(m.session)) {
      send({ type: PREFIX + 'connect', session: m.session, document: documentId })
      return
    }
    if (m.type === PREFIX + 'ready' && Object.keys(m).length === 3 && m.document === documentId && typeof m.session === 'string' && SESSION.test(m.session)) {
      if (session && session !== m.session) {
        for (const [id, p] of Array.from(pending)) if (p.sent) fail(id, 'Studio workspace changed. Retry the request.')
      }
      session = m.session
      for (const [id, p] of Array.from(pending)) dispatch(id, p)
      return
    }
    if (!session || m.session !== session || !Number.isSafeInteger(m.id)) return
    const p = pending.get(m.id)
    if (!p?.sent) return
    if (m.type === PREFIX + 'reply' && Object.keys(m).length === 5 && Number.isInteger(m.status) && m.status >= 200 && m.status <= 599 &&
        typeof m.data === 'string' && m.data.length <= MAX_REPLY && new TextEncoder().encode(m.data).length <= MAX_REPLY) {
      if (p.controller) { fail(m.id); return }
      pending.delete(m.id); p.cleanup()
      p.resolve(new Response([204, 205, 304].includes(m.status) ? null : m.data, { status: m.status, headers: { 'Content-Type': 'application/json' } }))
    } else if (m.type === PREFIX + 'open' && Object.keys(m).length === 3 && p.stream && !p.controller) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) { p.controller = controller },
        pull() { const ack = p.ack; p.ack = undefined; ack?.() },
        cancel() {
          send({ type: PREFIX + 'cancel', session, id: m.id })
          pending.delete(m.id); p.cleanup()
        },
      })
      p.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
    } else if (m.type === PREFIX + 'chunk' && Object.keys(m).length === 5 && p.controller && m.seq === p.sequence + 1 &&
        typeof m.data === 'string' && m.data.length <= 32000 && !p.ack) {
      const bytes = new TextEncoder().encode(m.data)
      p.bytes += bytes.length
      if (p.bytes > 2_000_000) { fail(m.id); send({ type: PREFIX + 'cancel', session, id: m.id }); return }
      p.sequence = m.seq
      p.controller.enqueue(bytes)
      const ack = () => send({ type: PREFIX + 'ack', session, id: m.id, seq: m.seq })
      if ((p.controller.desiredSize ?? 0) > 0) ack()
      else p.ack = ack
    } else if (m.type === PREFIX + 'end' && Object.keys(m).length === 3 && p.controller) {
      pending.delete(m.id); p.cleanup(); p.controller.close()
    }
  }
  host.addEventListener('message', receive)
  host.addEventListener('pagehide', hide)
  host.addEventListener('pageshow', show)
  function dispose() {
    if (disposed) return
    for (const id of Array.from(pending.keys())) {
      send({ type: PREFIX + 'cancel', session, id }); fail(id, 'Review workspace closed.')
    }
    disposed = true
    host.removeEventListener('message', receive)
    host.removeEventListener('pagehide', hide)
    host.removeEventListener('pageshow', show)
  }
  function hide(event: PageTransitionEvent) {
    if (!event.persisted) { dispose(); return }
    for (const id of Array.from(pending.keys())) {
      send({ type: PREFIX + 'cancel', session, id }); fail(id, 'Review workspace suspended.')
    }
    session = ''
  }
  function show(event: PageTransitionEvent) {
    if (event.persisted && !disposed) send({ type: PREFIX + 'hello', document: documentId })
  }
  return {
    dispose,
    request(envelope: unknown, signal?: AbortSignal): Promise<Response> {
      if (disposed || host === parent) return Promise.reject(new Error('Open in Studio to access these reviews.'))
      if (pending.size >= 16) return Promise.reject(new Error('Too many review requests. Retry.'))
      const encoded = JSON.stringify(envelope)
      if (!encoded || encoded.length > 2_000_000 || new TextEncoder().encode(encoded).length > 2_000_000)
        return Promise.reject(new Error('Review request too large.'))
      if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
      const id = ++nextId
      return new Promise<Response>((resolve, reject) => {
        const stream = (envelope as { path?: string })?.path === '/events'
        const cancel = () => { send({ type: PREFIX + 'cancel', session, id }); fail(id, 'Review request cancelled.') }
        const timer = setTimeout(cancel, stream ? 65_000 : 50_000)
        const handshake = setTimeout(() => { if (!pending.get(id)?.sent) cancel() }, 8000)
        const p: Pending = { envelope, sent: false, stream, sequence: 0, bytes: 0, resolve, reject,
          cleanup() { clearTimeout(timer); clearTimeout(handshake); signal?.removeEventListener('abort', cancel) } }
        pending.set(id, p)
        signal?.addEventListener('abort', cancel, { once: true })
        dispatch(id, p)
        if (!session) send({ type: PREFIX + 'hello', document: documentId })
      })
    },
  }
}
let client: ReturnType<typeof createStudioParentTransport> | undefined
export function studioParentRequest(envelope: unknown, signal?: AbortSignal) {
  if (typeof window === 'undefined') return Promise.reject(new Error('Open in Studio to access these reviews.'))
  client ??= createStudioParentTransport(window, window.parent, STUDIO_ORIGIN)
  return client.request(envelope, signal)
}
export function disposeStudioParentTransport() { client?.dispose(); client = undefined }
