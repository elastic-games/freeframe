import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const PROJECT_A = '11111111-1111-4111-8111-111111111111'
const PROJECT_B = '22222222-2222-4222-8222-222222222222'
const ASSET = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS', 'true')
  vi.stubEnv('NEXT_PUBLIC_STUDIO_TRANSPORT_URL', 'https://app.elasticlabs.site/api/studio/freeframe-transport')
  window.history.replaceState(null, '', `/projects/${PROJECT_A}/assets/${ASSET}`)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('sends an exact project-scoped request to Studio without a FreeFrame bearer', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: ASSET }), {
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  const { api } = await import('../api')
  expect(await api.get(`/assets/${ASSET}/stream?version_id=${ASSET}`)).toEqual({ id: ASSET })
  const [url, options] = fetchMock.mock.calls[0]
  expect(url).toBe('https://app.elasticlabs.site/api/studio/freeframe-transport')
  expect(options.credentials).toBe('include')
  expect(options.headers.Authorization).toBeUndefined()
  expect(JSON.parse(options.body)).toEqual({
    project: PROJECT_A, method: 'GET', path: `/assets/${ASSET}/stream`,
    query: `version_id=${ASSET}`,
  })
})

it('uses the current tab URL for each project and does not refresh a denied request', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Review access denied.' }), {
    status: 403, headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  const { api } = await import('../api')
  await expect(api.get(`/projects/${PROJECT_A}/assets`)).rejects.toMatchObject({ status: 403 })
  window.history.replaceState(null, '', `/projects/${PROJECT_B}`)
  await expect(api.get(`/projects/${PROJECT_B}/assets`)).rejects.toMatchObject({ status: 403 })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).project).toBe(PROJECT_A)
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).project).toBe(PROJECT_B)
})

it('rejects an off-origin path before sending a request', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const { api } = await import('../api')
  await expect(api.get('https://evil.invalid/steal')).rejects.toMatchObject({ status: 400 })
  expect(fetchMock).not.toHaveBeenCalled()
})
