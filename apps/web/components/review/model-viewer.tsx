'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useReview } from './review-provider'
import { useReviewStore } from '@/stores/review-store'
import { AnnotationCanvas } from './annotation-canvas'
import { AnnotationOverlay } from './annotation-overlay'
import { isModelView, validateModel, maxModelBytes } from '@/lib/modelView'
import type { ModelViewer as Viewer } from '@/lib/modelViewer'
import type { Asset, AssetVersion } from '@/types'

/** Notes and drawings use the existing FreeFrame comment lifecycle, with an exact 3D view attached. */
export function ModelViewer({ asset, version }: { asset: Asset; version: AssetVersion | null }) {
  const versionId = version?.id
  const host = useRef<HTMLDivElement>(null),
    outer = useRef<HTMLDivElement>(null),
    viewer = useRef<Viewer | null>(null)
  const { shareToken, shareSession } = useReview()
  const drawing = useReviewStore((s) => s.isDrawingMode),
    active = useReviewStore((s) => s.activeAnnotation),
    pending = useReviewStore((s) => s.pendingAnnotation)
  const [status, setStatus] = useState('loading'),
    [error, setError] = useState(''),
    [nonce, setNonce] = useState(0),
    [loaded, setLoaded] = useState(0)
  const [frame, setFrame] = useState({ width: 640, height: 400 }),
    [clips, setClips] = useState<string[]>([]),
    [clip, setClip] = useState(-1),
    [time, setTime] = useState(0)
  const saved = active?._modelView
  const pendingView = pending?._modelView
  const hasSaved = isModelView(saved) && saved.versionId === version?.id
  const [restored, setRestored] = useState(false)
  const ratio = hasSaved
    ? saved.aspect
    : isModelView(pendingView) && pendingView.versionId === version?.id
      ? pendingView.aspect
      : 1.6
  const locked = drawing || hasSaved || (!!pending && isModelView(pendingView))
  useEffect(() => {
    const element = outer.current
    if (!element) return
    const size = () => {
      const width = Math.max(1, Math.min(element.clientWidth, element.clientHeight * ratio))
      setFrame({ width, height: width / ratio })
    }
    const observer = new ResizeObserver(size)
    observer.observe(element)
    size()
    return () => observer.disconnect()
  }, [ratio])
  useEffect(() => {
    if (!versionId || !host.current) return
    const container = host.current,
      controller = new AbortController()
    let local: Viewer | null = null
    const id = versionId
    setStatus('loading')
    setError('')
    setRestored(false)
    setClips([])
    setClip(-1)
    setTime(0)
    useReviewStore.setState({
      captureModelView: null,
      pendingAnnotation: null,
      isDrawingMode: false,
    })
    void (async () => {
      const data = shareToken
        ? await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/share/${encodeURIComponent(shareToken)}/stream/${asset.id}?version_id=${id}${shareSession ? `&share_session=${encodeURIComponent(shareSession)}` : ''}`,
            { signal: controller.signal, cache: 'no-store' },
          ).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Model access unavailable'))))
        : await api.get<{ url: string }>(`/assets/${asset.id}/stream?version_id=${id}`)
      controller.signal.throwIfAborted()
      const response = await fetch(data.url, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        credentials: 'omit',
        cache: 'no-store',
      })
      if (!response.ok || Number(response.headers.get('content-length')) > maxModelBytes)
        throw new Error('Model could not be loaded')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Model content unavailable')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const item = await reader.read()
          if (item.done) break
          size += item.value.length
          if (size > maxModelBytes) throw new Error('Model exceeds 16 MiB')
          chunks.push(item.value)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      validateModel(bytes.buffer)
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
      const { createModelViewer } = await import('@/lib/modelViewer')
      controller.signal.throwIfAborted()
      local = await createModelViewer(container, bytes.buffer, id, sha256)
      if (controller.signal.aborted) {
        local.destroy()
        return
      }
      viewer.current = local
      const current = local
      useReviewStore.setState({ captureModelView: () => current.capture() })
      setClips(local.clipNames)
      setStatus('ready')
      setLoaded((n) => n + 1)
    })().catch((cause) => {
      if (!controller.signal.aborted) {
        setStatus('error')
        setError(cause instanceof Error ? cause.message : 'Unable to load model')
      }
    })
    return () => {
      controller.abort()
      local?.destroy()
      viewer.current = null
      useReviewStore.setState({
        captureModelView: null,
        pendingAnnotation: null,
        isDrawingMode: false,
      })
    }
  }, [asset.id, versionId, shareToken, shareSession, nonce])
  useEffect(() => {
    viewer.current?.lock(locked)
  }, [locked, loaded])
  useEffect(() => {
    if (!viewer.current) return
    if (hasSaved) {
      setRestored(viewer.current.restore(saved))
      setClip(saved.clip)
      setTime(saved.time)
    } else setRestored(false)
  }, [saved, hasSaved, loaded])
  const resume = () => {
    useReviewStore.setState({
      activeAnnotation: null,
      focusedCommentId: null,
      pendingAnnotation: null,
      isDrawingMode: false,
    })
  }
  const save = (data: Record<string, unknown>) => {
    const view = viewer.current?.capture()
    if (view) useReviewStore.getState().setPendingAnnotation({ ...data, _modelView: view })
  }
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2 p-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
        <span>
          {locked
            ? 'Saved review view · camera locked'
            : 'Drag to orbit · Right drag to pan · Scroll to zoom'}
        </span>
        <button
          type="button"
          onClick={() => viewer.current?.reset()}
          disabled={status !== 'ready' || locked}
          className="text-accent disabled:opacity-50"
        >
          Reset view
        </button>
        {locked && !drawing && (
          <button type="button" onClick={resume} className="text-accent">
            Resume orbit
          </button>
        )}
        {!!clips.length && (
          <>
            <label>
              Animation{' '}
              <select
                aria-label="Animation pose"
                value={clip}
                disabled={locked}
                className="bg-bg-secondary"
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setClip(n)
                  setTime(0)
                  viewer.current?.setPose(n, 0)
                }}
              >
                <option value={-1}>Rest pose</option>
                {clips.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {clip !== -1 && (
              <label>
                Seconds{' '}
                <input
                  aria-label="Pose time"
                  type="number"
                  min={0}
                  max={viewer.current?.duration(clip)}
                  step={0.1}
                  value={time}
                  disabled={locked}
                  className="w-20 bg-bg-secondary"
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n >= 0) {
                      setTime(n)
                      viewer.current?.setPose(clip, n)
                    }
                  }}
                />
              </label>
            )}
          </>
        )}
      </div>
      <div
        ref={outer}
        className="relative flex-1 min-h-0 flex items-center justify-center bg-bg-secondary rounded-lg overflow-hidden"
      >
        <div className="relative" style={{ width: frame.width, height: frame.height }}>
          <div ref={host} className="w-full h-full [&_canvas]:block" />
          {hasSaved && restored && <AnnotationOverlay />}
          {drawing && status === 'ready' && <AnnotationCanvas onSave={save} />}
        </div>
        {status === 'loading' && (
          <div role="status" className="absolute inset-0 grid place-items-center">
            Loading exact model version…
          </div>
        )}
        {status === 'error' && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6"
          >
            <span>{error}</span>
            <button onClick={() => setNonce((n) => n + 1)} className="text-accent">
              Retry
            </button>
          </div>
        )}
        {hasSaved && status === 'ready' && !restored && (
          <div role="alert" className="absolute bottom-3 p-3 bg-bg-primary">
            This drawing belongs to different model content. It cannot be overlaid on this version.
          </div>
        )}
      </div>
      <p className="text-xs text-text-tertiary">
        Notes save the camera, object transform, animation pose and exact model digest. Drawings are
        attached to this saved view.
      </p>
    </div>
  )
}
