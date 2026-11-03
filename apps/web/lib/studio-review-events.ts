import { studioParentRequest } from './studio-parent-transport'

/** EventSource-shaped consumer of the real finite BFF SSE stream. No polling or credentials. */
export class StudioReviewEvents {
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  denied = false
  private controller = new AbortController()
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private listeners = new Map<string, (event: MessageEvent) => void>()

  constructor(project: string) { void this.consume(project) }
  addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, listener) }
  close() { this.controller.abort(); void this.reader?.cancel().catch(() => {}) }

  private async consume(project: string) {
    try {
      const response = await studioParentRequest({ method: 'GET', path: '/events', project }, this.controller.signal)
      this.denied = [401, 403, 404].includes(response.status)
      if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream'))
        throw new Error('Review updates unavailable')
      if (this.controller.signal.aborted) return
      this.onopen?.(new Event('open'))
      this.reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let pending = ''
      while (!this.controller.signal.aborted) {
        const part = await this.reader.read()
        if (part.done) break
        pending += decoder.decode(part.value, { stream: true })
        if (pending.length > 128000) throw new Error('Review event too large')
        let end: number
        while ((end = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2)
          const type = frame.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim()
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
          if (type) this.listeners.get(type)?.(new MessageEvent(type, { data }))
        }
      }
    } catch { /* finite connection ends; the hook owns reconnect and current-grant checks */ }
    finally {
      await this.reader?.cancel().catch(() => {})
      if (!this.controller.signal.aborted) this.onerror?.(new Event('error'))
    }
  }
}
