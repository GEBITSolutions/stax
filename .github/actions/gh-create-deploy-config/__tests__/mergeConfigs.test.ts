import { describe, expect, it } from '@jest/globals'
import { mergeDeployConfigDocuments } from '../src/mergeConfigs.js'
import { IDeployConfigDocument } from '../src/types.js'

describe('mergeConfigs.ts', () => {
  it('merges stacks with unique ids across files', () => {
    const docs: IDeployConfigDocument[] = [
      { stacks: [{ id: 'a' }, { id: 'b' }], sourceFile: 'configs/one.yaml' },
      { stacks: [{ id: 'c' }], sourceFile: 'configs/two.yaml' }
    ]

    const merged = mergeDeployConfigDocuments(docs)

    expect(merged.stacks.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(merged.externalRepos).toEqual({})
  })

  it('throws naming both files on duplicate stack id', () => {
    const docs: IDeployConfigDocument[] = [
      { stacks: [{ id: 'a' }, { id: 'dup' }], sourceFile: 'configs/one.yaml' },
      { stacks: [{ id: 'dup' }], sourceFile: 'configs/two.yaml' }
    ]

    expect(() => mergeDeployConfigDocuments(docs)).toThrow(
      'Duplicate stack id "dup" found in "configs/one.yaml" and "configs/two.yaml"'
    )
  })

  it('merges identical externalRepos definitions without conflict', () => {
    const entries = [
      {
        repoURL: 'https://example.com/repo.git',
        targetRevision: 'main',
        token: 't'
      }
    ]
    const docs: IDeployConfigDocument[] = [
      {
        stacks: [{ id: 'a' }],
        externalRepos: { shared: entries },
        sourceFile: 'configs/one.yaml'
      },
      {
        stacks: [{ id: 'b' }],
        // structurally equal but different key order / new array instance
        externalRepos: {
          shared: [
            {
              targetRevision: 'main',
              token: 't',
              repoURL: 'https://example.com/repo.git'
            }
          ]
        },
        sourceFile: 'configs/two.yaml'
      }
    ]

    const merged = mergeDeployConfigDocuments(docs)

    expect(merged.externalRepos.shared).toEqual(entries)
  })

  it('throws on conflicting externalRepos definition for the same key', () => {
    const docs: IDeployConfigDocument[] = [
      {
        stacks: [{ id: 'a' }],
        externalRepos: {
          shared: [
            {
              repoURL: 'https://example.com/repo.git',
              targetRevision: 'main',
              token: 't'
            }
          ]
        },
        sourceFile: 'configs/one.yaml'
      },
      {
        stacks: [{ id: 'b' }],
        externalRepos: {
          shared: [
            {
              repoURL: 'https://example.com/repo.git',
              targetRevision: 'develop',
              token: 't'
            }
          ]
        },
        sourceFile: 'configs/two.yaml'
      }
    ]

    expect(() => mergeDeployConfigDocuments(docs)).toThrow(
      'Conflicting externalRepos definition for key "shared" between "configs/one.yaml" and "configs/two.yaml"'
    )
  })

  it('keeps globals per-stack (config_globals preserved from each file)', () => {
    const docs: IDeployConfigDocument[] = [
      {
        stacks: [{ id: 'a', config_globals: { env: 'dev' } }],
        sourceFile: 'configs/one.yaml'
      },
      {
        stacks: [{ id: 'b', config_globals: { env: 'prod' } }],
        sourceFile: 'configs/two.yaml'
      }
    ] as unknown as IDeployConfigDocument[]

    const merged = mergeDeployConfigDocuments(docs)

    expect(
      (merged.stacks[0] as unknown as { config_globals: unknown })
        .config_globals
    ).toEqual({ env: 'dev' })
    expect(
      (merged.stacks[1] as unknown as { config_globals: unknown })
        .config_globals
    ).toEqual({ env: 'prod' })
  })

  it('is independent of document order (shuffled input → same merged result)', () => {
    const docA: IDeployConfigDocument = {
      stacks: [{ id: 'a' }, { id: 'b' }],
      externalRepos: {
        r1: [{ repoURL: 'u1', targetRevision: 'main', token: 't1' }]
      },
      sourceFile: 'configs/one.yaml'
    }
    const docB: IDeployConfigDocument = {
      stacks: [{ id: 'c' }],
      externalRepos: {
        r2: [{ repoURL: 'u2', targetRevision: 'main', token: 't2' }]
      },
      sourceFile: 'configs/two.yaml'
    }

    const forward = mergeDeployConfigDocuments([docA, docB])
    const reverse = mergeDeployConfigDocuments([docB, docA])

    expect(new Set(forward.stacks.map((s) => s.id))).toEqual(
      new Set(reverse.stacks.map((s) => s.id))
    )
    expect(forward.externalRepos).toEqual(reverse.externalRepos)
  })

  it('handles documents whose externalRepos is an empty array', () => {
    const docs: IDeployConfigDocument[] = [
      {
        stacks: [{ id: 'a' }],
        externalRepos: [] as unknown as IDeployConfigDocument['externalRepos'],
        sourceFile: 'configs/one.yaml'
      }
    ]

    const merged = mergeDeployConfigDocuments(docs)

    expect(merged.stacks.map((s) => s.id)).toEqual(['a'])
    expect(merged.externalRepos).toEqual({})
  })
})
