import { buildLogArgs } from '../src/git.js'

describe('buildLogArgs', () => {
  it('uses committer-date-order by default', () => {
    const args = buildLogArgs('committer-time')
    expect(args).toContain('--committer-date-order')
    expect(args).not.toContain('--topo-order')
  })

  it('uses topo-order for topological', () => {
    const args = buildLogArgs('topological')
    expect(args).toContain('--topo-order')
    expect(args).not.toContain('--committer-date-order')
  })
})
