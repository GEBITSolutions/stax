import { buildLogArgs } from '../src/git.js'

describe('buildLogArgs', () => {
  it('uses date-order for committer-time', () => {
    const args = buildLogArgs('committer-time')
    expect(args).toContain('--date-order')
    expect(args).not.toContain('--topo-order')
  })

  it('uses topo-order for topological', () => {
    const args = buildLogArgs('topological')
    expect(args).toContain('--topo-order')
    expect(args).not.toContain('--date-order')
  })
})
