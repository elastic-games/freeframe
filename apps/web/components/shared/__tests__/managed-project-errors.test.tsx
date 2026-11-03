import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import ProjectsPage from '@/app/(dashboard)/projects/page'
import ProjectDetailPage from '@/app/(dashboard)/projects/[id]/page'
import { LocaleProvider } from '@/lib/i18n/locale-provider'
const mock = vi.hoisted(() => { process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS = 'true'; return { get: vi.fn(), push: vi.fn() } })
const project = '11111111-1111-4111-8111-111111111111'
vi.mock('@/lib/api', () => ({ api: { get: mock.get } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mock.push }), useParams: () => ({ id: project }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/review/comment-panel', () => ({ CommentPanel: () => null }))
vi.mock('@/components/projects/asset-grid', () => ({ AssetGrid: ({ isLoading }: { isLoading: boolean }) => <div>{isLoading ? 'Loading assets' : 'Asset grid loaded'}</div> }))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))
function mount(child: React.ReactNode, locale: 'en' | 'ru' = 'en') {
  return render(<LocaleProvider initialLocale={locale}><SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}>{child}</SWRConfig></LocaleProvider>)
}
beforeEach(() => { mock.get.mockReset(); vi.stubEnv('NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS', 'true') })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
it.each([401, 403, 503])('projects %i shows Retry, never No projects yet, and retries the actual read', async status => {
  let deny = true
  mock.get.mockImplementation(async () => { if (deny) throw Object.assign(new Error('Denied'), { status }); return [] })
  mount(<ProjectsPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load projects')
  expect(screen.queryByText('No projects yet')).not.toBeInTheDocument()
  deny = false; fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No projects yet')).toBeInTheDocument()
  expect(mock.get.mock.calls.filter(([path]) => path === '/projects').length).toBe(2)
})
it('successful empty projects remain an empty state in Russian', async () => {
  mock.get.mockResolvedValue([])
  mount(<ProjectsPage />, 'ru')
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(await screen.findByText('Проектов пока нет')).toBeInTheDocument()
})
it.each(['project', 'assets', 'folders', 'folder-tree'])('failed %s reads hide stale or empty project content and offer Retry', async operation => {
  let deny = true
  mock.get.mockImplementation(async (path: string) => {
    const matches = operation === 'project' ? path === `/projects/${project}` : path.split('?')[0].endsWith('/' + operation)
    if (matches && deny) throw Object.assign(new Error('Denied'), { status: 403 })
    if (path === `/projects/${project}`) return { id: project, name: 'Project' }
    if (path.endsWith('/trash')) return { assets: [], folders: [] }
    return []
  })
  mount(<ProjectDetailPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this project')
  expect(screen.queryByText('Asset grid loaded')).not.toBeInTheDocument()
  deny = false; fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('Asset grid loaded')).toBeInTheDocument()
})
