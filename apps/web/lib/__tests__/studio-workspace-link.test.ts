import { expect, it } from 'vitest'
import { studioWorkspaceLink } from '../studio-workspace-link'
const project = '11111111-1111-4111-8111-111111111111', asset = project.replaceAll('1', '2')
const base = 'https://app.elasticlabs.com/apps/reviews'
it('preserves exact asset/version/comment and project/folder bookmarks without credentials', () => {
  expect(studioWorkspaceLink(`/projects/${project}/assets/${asset}`, `?versionId=${asset}&commentId=${project}&token=private`))
    .toBe(`${base}/projects/${project}/assets/${asset}?version=${asset}&commentId=${project}`)
  expect(studioWorkspaceLink(`/projects/${project}`, `?folder=${asset}`)).toBe(`${base}/projects/${project}?folder=${asset}`)
})
it('rejects malformed bookmarks, foreign origins and conflicting versions', () => {
  for (const [path, search] of [['//evil.invalid', ''], ['/projects/../settings', ''], [`/projects/${project}`, '?folder=https://evil.invalid'],
    [`/projects/${project}/assets/${asset}`, `?version=${project}&versionId=${asset}`]]) expect(studioWorkspaceLink(path, search)).toBe(base)
})
