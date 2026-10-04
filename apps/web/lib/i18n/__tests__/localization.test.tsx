import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'
import { getTranslation, LANGUAGES, normalizeLocale } from '../translate'
import { russianMessages } from '../messages'
import { LocaleProvider, useLocale, useTranslation } from '../locale-provider'
import { StudioEmbedBridge } from '@/components/shared/studio-embed-bridge'
import { STUDIO_ORIGIN } from '@/lib/studio-embed'
import { formatRelativeTime } from '@/lib/utils'
import { ModelViewer } from '@/components/review/model-viewer'
import { useReviewStore } from '@/stores/review-store'
import type { Asset, AssetVersion } from '@/types'

const engine = vi.hoisted(() => ({ create: vi.fn(), destroy: vi.fn(), capture: vi.fn() }))
vi.mock('@/components/review/review-provider', () => ({ useReview: () => ({}) }))
vi.mock('@/lib/api', () => ({ api: { get: async () => ({ url: 'https://fixture.invalid/model' }) } }))
vi.mock('@/lib/modelViewer', () => ({ createModelViewer: engine.create }))
vi.mock('@/lib/modelView', async (original) => ({ ...await original<object>(), validateModel: vi.fn() }))
vi.mock('@/components/review/annotation-canvas', () => ({ AnnotationCanvas: () => null }))
vi.mock('@/components/review/annotation-overlay', () => ({ AnnotationOverlay: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function Controls() {
  const { setLocale } = useLocale(), tr = useTranslation()
  return <><button onClick={() => setLocale('ru')}>Switch</button><span>{tr('Reset view')}</span></>
}

describe('English/Russian review presentation', () => {
  it('offers exactly two languages and safely normalizes regional and legacy values', () => {
    expect(LANGUAGES).toEqual(['en', 'ru'])
    expect(normalizeLocale(' RU_ru ')).toBe('ru')
    expect(normalizeLocale('de')).toBe('en')
    expect(normalizeLocale('ar')).toBe('en')
  })
  it('preserves interpolation values and all placeholders in the reviewed catalog', () => {
    for (const [en, ru] of Object.entries(russianMessages)) {
      const keys = (s: string) => Array.from(s.matchAll(/\{(\w+)\}/g)).map(x => x[1]).sort()
      expect(keys(ru), en).toEqual(keys(en))
    }
    expect(getTranslation('ru')('Manage {value0}', { value0: 'Castle.glb' })).toBe('Управление Castle.glb')
    expect(getTranslation('ru')('My authored note')).toBe('My authored note')
    expect(formatRelativeTime(new Date(Date.now() - 120000).toISOString(), 'ru')).toBe('2 минуты назад')
  })
  it('updates live document language, cookie and controls without remounting content', () => {
    let mounts = 0
    function Child() { useTranslation(); useEffect(() => { mounts++ }, []); return <Controls /> }
    render(<LocaleProvider><Child /></LocaleProvider>)
    fireEvent.click(screen.getByText('Switch'))
    expect(screen.getByText('Сбросить ракурс')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ru')
    expect(document.cookie).toContain('ff_locale=ru')
    expect(mounts).toBe(1)
  })
  it('only accepts language handoff from the exact Studio parent, and rejects unsupported values', () => {
    const original = window.parent, frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const parent = frame.contentWindow!
    Object.defineProperty(window, 'parent', { configurable: true, value: parent })
    const view = render(<LocaleProvider><StudioEmbedBridge /><Controls /></LocaleProvider>)
    function send(locale: unknown, origin = STUDIO_ORIGIN, source: Window = parent) {
      act(() => window.dispatchEvent(new MessageEvent('message', { origin, source, data: { type: 'elastic-studio:appearance', theme: 'dark', locale } })))
    }
    try {
      send('ru', 'https://evil.invalid'); send('ru', STUDIO_ORIGIN, window)
      expect(screen.getByText('Reset view')).toBeInTheDocument()
      send('ru')
      expect(screen.getByText('Сбросить ракурс')).toBeInTheDocument()
      send('de')
      expect(document.documentElement.lang).toBe('ru')
      send('en')
      expect(document.documentElement.lang).toBe('en')
    } finally { view.unmount(); Object.defineProperty(window, 'parent', { configurable: true, value: original }); frame.remove() }
  })
  it('keeps the same loaded model, camera capture and pending drawing when language changes', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(20))))
    const camera = { position: [2, 4, 6], object: [1, 2, 3], time: 1.25 }
    engine.capture.mockReturnValue(camera)
    engine.create.mockResolvedValue({ clipNames: [], capture: engine.capture, destroy: engine.destroy, lock: vi.fn(), restore: vi.fn(), reset: vi.fn() })
    useReviewStore.setState({ activeAnnotation: null, pendingAnnotation: null, isDrawingMode: false })
    render(<LocaleProvider><Controls /><ModelViewer asset={{ id: 'fixture-asset' } as Asset} version={{ id: 'fixture-version' } as AssetVersion} /></LocaleProvider>)
    await waitFor(() => expect(engine.create).toHaveBeenCalledTimes(1))
    const before = useReviewStore.getState().captureModelView
    await waitFor(() => expect(before).toBeTruthy())
    const drawing = { strokes: ['authored stroke'] }
    act(() => useReviewStore.setState({ pendingAnnotation: drawing }))
    fireEvent.click(screen.getByText('Switch'))
    expect(engine.create).toHaveBeenCalledTimes(1)
    expect(engine.destroy).not.toHaveBeenCalled()
    expect(useReviewStore.getState().captureModelView).toBe(before)
    expect(before!()).toEqual(camera)
    expect(useReviewStore.getState().pendingAnnotation).toEqual(drawing)
  })
  it('requires Russian catalog entries for literal UI translation calls', () => {
    const root = process.cwd()
    function scan(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name)
        if (entry.isDirectory() && entry.name !== '__tests__') scan(file)
        else if (file.endsWith('.tsx') && !file.includes('.test.')) {
          const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
          const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && node.expression.getText(ast) === 'tr' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
              expect(russianMessages[node.arguments[0].text], `${file}: ${node.arguments[0].text}`).toBeTruthy()
            }
            ts.forEachChild(node, visit)
          }
          visit(ast)
        }
      }
    }
    scan(join(root, 'app')); scan(join(root, 'components'))
  })
})
