import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
jest.unstable_mockModule('@actions/core', () => core)

const {
  apply_stack_filter: original_apply_stack_filter,
  generate_stackfilter: original_generate_stackfilter
} = await import('../src/stackFilterN.js')
const { generate_layerdeployment: original_generate_layerdeployment } =
  await import('../src/layerDeploymentN.js')
const {
  convert_implicit_to_explicit_dependencies:
    original_convert_implicit_to_explicit_dependencies,
  prune_external_dependencies: original_prune_external_dependencies
} = await import('../src/stackDependencyN.js')

const apply_stack_filter = jest.fn(original_apply_stack_filter)
const generate_stackfilter = jest.fn(original_generate_stackfilter)
const generate_layerdeployment = jest.fn(original_generate_layerdeployment)
const convert_implicit_to_explicit_dependencies = jest.fn(
  original_convert_implicit_to_explicit_dependencies
)
const prune_external_dependencies = jest.fn(
  original_prune_external_dependencies
)

jest.unstable_mockModule('../src/stackFilterN.js', () => ({
  apply_stack_filter,
  generate_stackfilter
}))
jest.unstable_mockModule('../src/layerDeploymentN.js', () => ({
  generate_layerdeployment
}))
jest.unstable_mockModule('../src/stackDependencyN.js', () => ({
  convert_implicit_to_explicit_dependencies,
  prune_external_dependencies
}))

const { run } = await import('../src/index.js')

describe('index.ts', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    core.getInput.mockImplementation(() => '') // Default mock: empty input
    generate_stackfilter.mockImplementation(() => [])
    apply_stack_filter.mockImplementation(() => [])
    generate_layerdeployment.mockImplementation(() => [])
    convert_implicit_to_explicit_dependencies.mockImplementation((config) => [
      ...config
    ])
    prune_external_dependencies.mockImplementation((config) => [...config])
  })

  it('should run successfully with empty inputs', async () => {
    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'layer-deployments',
      JSON.stringify([])
    )
  })

  it('should throw an error when deploy-depth is not a valid number', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return 'invalid'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse deploy-depth to integer')
    )
  })

  it('should throw an error when deploy-config is invalid JSON', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return '1'
      if (name === 'deploy-config') return 'invalid json'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse JSON deploy-config')
    )
  })

  it('should call functions in correct order: convert → prune → generate_stackfilter → apply', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return '2'
      if (name === 'deploy-config') return JSON.stringify([{ id: 'stack-1' }])
      if (name === 'stack-filter') return 'stack-1'
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    generate_stackfilter.mockImplementation(() => ['stack-1'])
    await run()

    expect(generate_stackfilter).toHaveBeenCalledWith(
      [{ id: 'stack-1', secret_backend: 'gh' }],
      'stack-1',
      {}
    )
    expect(convert_implicit_to_explicit_dependencies).toHaveBeenCalledWith([
      { id: 'stack-1', secret_backend: 'gh' }
    ])
    expect(prune_external_dependencies).toHaveBeenCalledWith([
      { id: 'stack-1', secret_backend: 'gh' }
    ])
    expect(apply_stack_filter).toHaveBeenCalledWith(
      [{ id: 'stack-1', secret_backend: 'gh' }],
      ['stack-1']
    )
    // Verify call order: convert → prune → generate_stackfilter
    expect(
      convert_implicit_to_explicit_dependencies.mock.invocationCallOrder[0]
    ).toBeLessThan(prune_external_dependencies.mock.invocationCallOrder[0])
    expect(
      prune_external_dependencies.mock.invocationCallOrder[0]
    ).toBeLessThan(generate_stackfilter.mock.invocationCallOrder[0])
  })
  it('should not call apply_stack_filter when stackfilter is empty array', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return '2'
      if (name === 'deploy-config') return JSON.stringify([{ id: 'stack-1' }])
      if (name === 'stack-filter') return ''
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    generate_stackfilter.mockImplementation(() => [''])
    await run()

    expect(generate_stackfilter).toHaveBeenCalledWith(
      [{ id: 'stack-1', secret_backend: 'gh' }],
      '',
      {}
    )
    expect(convert_implicit_to_explicit_dependencies).toHaveBeenCalledWith([
      { id: 'stack-1', secret_backend: 'gh' }
    ])
    expect(apply_stack_filter).not.toHaveBeenCalled()
  })
  it('excludes false conditions without a stack filter and rewires surviving dependencies', async () => {
    generate_stackfilter.mockImplementation(original_generate_stackfilter)
    apply_stack_filter.mockImplementation(original_apply_stack_filter)
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-config')
        return JSON.stringify([
          { id: 'base' },
          { id: 'prod-only', if: "'{stage}' === 'prod'", depends_on: ['base'] },
          { id: 'consumer', depends_on: ['prod-only'] }
        ])
      if (name === 'global-vars') return JSON.stringify({ stage: 'dev' })
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'layer-deployments',
      JSON.stringify([
        [{ id: 'base', secret_backend: 'gh', depends_on: [], layer: 0 }],
        [
          {
            id: 'consumer',
            depends_on: ['base'],
            secret_backend: 'gh',
            layer: 1
          }
        ]
      ])
    )
  })

  it('emits an empty deployment when all stack conditions are false without a filter', async () => {
    generate_stackfilter.mockImplementation(original_generate_stackfilter)
    apply_stack_filter.mockImplementation(original_apply_stack_filter)
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-config')
        return JSON.stringify([
          { id: 'first', if: 'false' },
          { id: 'second', if: 'false', depends_on: ['first'] }
        ])
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(apply_stack_filter).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'first' }),
        expect.objectContaining({ id: 'second' })
      ]),
      []
    )
    expect(core.setOutput).toHaveBeenCalledWith('layer-deployments', '[]')
  })

  it('does not fall back to all stacks when an explicit filter selects only false conditions', async () => {
    generate_stackfilter.mockImplementation(original_generate_stackfilter)
    apply_stack_filter.mockImplementation(original_apply_stack_filter)
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-config')
        return JSON.stringify([
          { id: 'selected', if: 'false' },
          { id: 'unselected' }
        ])
      if (name === 'stack-filter') return 'selected'
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(apply_stack_filter).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'selected' }),
        expect.objectContaining({ id: 'unselected' })
      ]),
      []
    )
    expect(core.setOutput).toHaveBeenCalledWith('layer-deployments', '[]')
  })

  it('US-10 integration: stacks with external explicit deps appear in layer-deployments output', async () => {
    convert_implicit_to_explicit_dependencies.mockImplementation(
      original_convert_implicit_to_explicit_dependencies
    )
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    generate_stackfilter.mockImplementation(original_generate_stackfilter)

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return '5'
      if (name === 'deploy-config')
        return JSON.stringify([
          { id: 'infra', depends_on: [] },
          { id: 'platform', depends_on: ['ext-bootstrap'] },
          { id: 'app', depends_on: ['infra', 'ext-shared'] }
        ])
      if (name === 'stack-filter') return ''
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalledTimes(2)
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'Dependency ext-bootstrap of stack platform not found'
      )
    )
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Dependency ext-shared of stack app not found')
    )
    const outputCall = (core.setOutput as jest.Mock).mock.calls.find(
      ([name]) => name === 'layer-deployments'
    )
    expect(outputCall).toBeDefined()
    const layers = JSON.parse(outputCall![1] as string) as Array<
      Array<{ id: string }>
    >
    const scheduled = layers.flat().map((c) => c.id)
    expect(scheduled).toContain('infra')
    expect(scheduled).toContain('platform')
    expect(scheduled).toContain('app')
  })

  it('deploy-configs multi-doc path merges and levels stacks from multiple files', async () => {
    convert_implicit_to_explicit_dependencies.mockImplementation(
      original_convert_implicit_to_explicit_dependencies
    )
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    generate_stackfilter.mockImplementation(original_generate_stackfilter)

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return '5'
      if (name === 'deploy-configs')
        return JSON.stringify([
          { stacks: [{ id: 'infra', depends_on: [] }], sourceFile: 'a.yaml' },
          {
            stacks: [{ id: 'app', depends_on: ['infra'] }],
            sourceFile: 'b.yaml'
          }
        ])
      if (name === 'stack-filter') return ''
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    const outputCall = (core.setOutput as jest.Mock).mock.calls.find(
      ([name]) => name === 'layer-deployments'
    )
    const layers = JSON.parse(outputCall![1] as string) as Array<
      Array<{ id: string; layer: number }>
    >
    const infra = layers.flat().find((c) => c.id === 'infra')!
    const app = layers.flat().find((c) => c.id === 'app')!
    expect(infra).toBeDefined()
    expect(app).toBeDefined()
    // cross-file depends_on must be honored (app after infra), not pruned
    expect(app.layer).toBeGreaterThan(infra.layer)
  })

  it('deploy-configs cross-file depends_on is honored and not pruned', async () => {
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return '5'
      if (name === 'deploy-configs')
        return JSON.stringify([
          { stacks: [{ id: 'base', depends_on: [] }], sourceFile: 'a.yaml' },
          {
            stacks: [{ id: 'consumer', depends_on: ['base'] }],
            sourceFile: 'b.yaml'
          }
        ])
      if (name === 'stack-filter') return ''
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    await run()

    // 'base' exists in the merged config, so its dependency is kept (no warning)
    expect(core.warning).not.toHaveBeenCalledWith(
      expect.stringContaining('base')
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('deploy-configs wins and fails on duplicate stack id across files', async () => {
    convert_implicit_to_explicit_dependencies.mockImplementation(
      original_convert_implicit_to_explicit_dependencies
    )
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return '5'
      if (name === 'deploy-configs')
        return JSON.stringify([
          { stacks: [{ id: 'dup' }], sourceFile: 'a.yaml' },
          { stacks: [{ id: 'dup' }], sourceFile: 'b.yaml' }
        ])
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        'Duplicate stack id "dup" found in "a.yaml" and "b.yaml"'
      )
    )
  })

  it('legacy single-input path (deploy-config only) still works', async () => {
    convert_implicit_to_explicit_dependencies.mockImplementation(
      original_convert_implicit_to_explicit_dependencies
    )
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    generate_stackfilter.mockImplementation(original_generate_stackfilter)

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return '5'
      if (name === 'deploy-config')
        return JSON.stringify([
          { id: 'infra', depends_on: [] },
          { id: 'app', depends_on: ['infra'] }
        ])
      if (name === 'deploy-configs') return '[]'
      if (name === 'stack-filter') return ''
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    const outputCall = (core.setOutput as jest.Mock).mock.calls.find(
      ([name]) => name === 'layer-deployments'
    )
    const layers = JSON.parse(outputCall![1] as string) as Array<
      Array<{ id: string; layer: number }>
    >
    const scheduled = layers.flat().map((c) => c.id)
    expect(scheduled).toContain('infra')
    expect(scheduled).toContain('app')
    const infra = layers.flat().find((c) => c.id === 'infra')!
    const app = layers.flat().find((c) => c.id === 'app')!
    expect(app.layer).toBeGreaterThan(infra.layer)
  })

  it('defaults to 14 layers and schedules a 14-level chain', async () => {
    convert_implicit_to_explicit_dependencies.mockImplementation(
      original_convert_implicit_to_explicit_dependencies
    )
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    generate_stackfilter.mockImplementation(original_generate_stackfilter)

    const stacks = Array.from({ length: 14 }, (_, index) => ({
      id: `stack-${index}`,
      depends_on: index === 0 ? [] : [`stack-${index - 1}`]
    }))
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-config') return JSON.stringify(stacks)
      if (name === 'stack-filter') return ''
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    const outputCall = (core.setOutput as jest.Mock).mock.calls.find(
      ([name]) => name === 'layer-deployments'
    )
    const layers = JSON.parse(outputCall![1] as string) as Array<
      Array<{ id: string; layer: number }>
    >
    expect(layers).toHaveLength(14)
    expect(layers[13]).toEqual([
      expect.objectContaining({ id: 'stack-13', layer: 13 })
    ])
  })

  it('fails with details when a chain exceeds the configured depth', async () => {
    convert_implicit_to_explicit_dependencies.mockImplementation(
      original_convert_implicit_to_explicit_dependencies
    )
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    generate_stackfilter.mockImplementation(original_generate_stackfilter)

    const stacks = Array.from({ length: 15 }, (_, index) => ({
      id: `stack-${index}`,
      depends_on: index === 0 ? [] : [`stack-${index - 1}`]
    }))
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-config') return JSON.stringify(stacks)
      if (name === 'stack-filter') return ''
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Unable to schedule all stacks within 14 layers: ' +
        '"stack-14" (depends_on: ["stack-13"], unresolved: [])'
    )
    expect(core.setOutput).not.toHaveBeenCalledWith(
      'layer-deployments',
      expect.any(String)
    )
  })

  it('fails with unresolved dependency details for a cycle', async () => {
    convert_implicit_to_explicit_dependencies.mockImplementation(
      original_convert_implicit_to_explicit_dependencies
    )
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    generate_stackfilter.mockImplementation(original_generate_stackfilter)

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-depth') return '20'
      if (name === 'deploy-config')
        return JSON.stringify([
          { id: 'stack-a', depends_on: ['stack-b'] },
          { id: 'stack-b', depends_on: ['stack-a'] }
        ])
      if (name === 'stack-filter') return ''
      if (name === 'global-vars') return JSON.stringify({})
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Unable to schedule all stacks within 20 layers: ' +
        '"stack-a" (depends_on: ["stack-b"], unresolved: ["stack-b"]); ' +
        '"stack-b" (depends_on: ["stack-a"], unresolved: ["stack-a"])'
    )
  })

  it('schedules one Pages stack alongside other stack types with its site fields intact', async () => {
    convert_implicit_to_explicit_dependencies.mockImplementation(
      original_convert_implicit_to_explicit_dependencies
    )
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    generate_stackfilter.mockImplementation(original_generate_stackfilter)

    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-configs')
        return JSON.stringify([
          {
            sourceFile: 'infra.yaml',
            stacks: [{ id: 'infra', type: 'terraform', folder: 'infra' }]
          },
          {
            sourceFile: 'pages.yaml',
            stacks: [
              {
                id: 'docs',
                type: 'github-pages-site-deploy',
                depends_on: ['infra'],
                site_source_type: 'prebuilt',
                docs_path: 'guide',
                app_location: 'site',
                site_url: 'https://example.org/docs/'
              }
            ]
          }
        ])
      if (name === 'global-vars')
        return JSON.stringify({ dry_run: true, destroy: false })
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    const outputCall = (core.setOutput as jest.Mock).mock.calls.find(
      ([name]) => name === 'layer-deployments'
    )
    const layers = JSON.parse(outputCall![1] as string) as Array<
      Array<Record<string, unknown>>
    >
    expect(layers[0]).toEqual([
      expect.objectContaining({ id: 'infra', type: 'terraform' })
    ])
    expect(layers[1]).toEqual([
      expect.objectContaining({
        id: 'docs',
        type: 'github-pages-site-deploy',
        site_source_type: 'prebuilt',
        docs_path: 'guide',
        app_location: 'site',
        site_url: 'https://example.org/docs/'
      })
    ])
  })

  it('defaults a Pages stack source type to mkdocs without modifying other stacks', async () => {
    convert_implicit_to_explicit_dependencies.mockImplementation(
      original_convert_implicit_to_explicit_dependencies
    )
    prune_external_dependencies.mockImplementation(
      original_prune_external_dependencies
    )
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-config')
        return JSON.stringify([
          { id: 'docs', type: 'github-pages-site-deploy' },
          { id: 'infra', type: 'terraform', folder: 'infra' }
        ])
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    const outputCall = (core.setOutput as jest.Mock).mock.calls.find(
      ([name]) => name === 'layer-deployments'
    )
    const stacks = (
      JSON.parse(outputCall![1] as string) as Array<
        Array<Record<string, unknown>>
      >
    ).flat()
    expect(stacks.find((stack) => stack.id === 'docs')).toEqual(
      expect.objectContaining({ site_source_type: 'mkdocs' })
    )
    expect(stacks.find((stack) => stack.id === 'infra')).toEqual(
      expect.objectContaining({ id: 'infra', type: 'terraform', layer: 0 })
    )
    expect(stacks.find((stack) => stack.id === 'infra')).not.toHaveProperty(
      'site_source_type'
    )
  })

  it('schedules a zensical Pages stack', async () => {
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-config')
        return JSON.stringify([
          {
            id: 'docs',
            type: 'github-pages-site-deploy',
            site_source_type: 'zensical'
          }
        ])
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    const outputCall = (core.setOutput as jest.Mock).mock.calls.find(
      ([name]) => name === 'layer-deployments'
    )
    expect(JSON.parse(outputCall![1] as string)).toEqual([
      [expect.objectContaining({ id: 'docs', site_source_type: 'zensical' })]
    ])
  })

  it('leaves non-Pages stacks unaffected by Pages-only rules', async () => {
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-config')
        return JSON.stringify([
          {
            id: 'infra',
            type: 'terraform',
            folder: 'infra',
            site_source_type: 'custom'
          }
        ])
      if (name === 'global-vars') return JSON.stringify({ destroy: 'true' })
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'layer-deployments',
      JSON.stringify([
        [
          {
            id: 'infra',
            type: 'terraform',
            folder: 'infra',
            site_source_type: 'custom',
            secret_backend: 'gh',
            layer: 0
          }
        ]
      ])
    )
  })

  it('materializes the selected backend before scheduling and requires the Key Vault URL only for keyvault stacks', async () => {
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    const docs = [
      {
        sourceFile: 'first.yaml',
        deployment: { secret_backend: 'keyvault' },
        stacks: [{ id: 'early' }]
      },
      {
        sourceFile: 'second.yaml',
        stacks: [{ id: 'override', secret_backend: 'gh' }]
      }
    ]
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-configs') return JSON.stringify(docs)
      if (name === 'key-vault-url') return 'https://vault.vault.azure.net/'
      return ''
    })

    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
    const output = (core.setOutput as jest.Mock).mock.calls.find(
      ([name]) => name === 'layer-deployments'
    )
    const stacks = (
      JSON.parse(output![1] as string) as Array<
        Array<{ id: string; secret_backend: string }>
      >
    ).flat()
    expect(stacks.map((stack) => [stack.id, stack.secret_backend])).toEqual([
      ['early', 'keyvault'],
      ['override', 'gh']
    ])

    jest.clearAllMocks()
    core.getInput.mockImplementation((name) =>
      name === 'deploy-configs' ? JSON.stringify(docs) : ''
    )
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('key-vault-url is not configured')
    )
    expect(core.setOutput).not.toHaveBeenCalled()

    jest.clearAllMocks()
    core.getInput.mockImplementation((name) =>
      name === 'deploy-configs'
        ? JSON.stringify([
            {
              deployment: { secret_backend: 'keyvault' },
              stacks: [{ id: 'override', secret_backend: 'gh' }]
            }
          ])
        : ''
    )
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('schedules per-stack merged credential mappings', async () => {
    generate_layerdeployment.mockImplementation(
      original_generate_layerdeployment
    )
    core.getInput.mockImplementation((name) =>
      name === 'deploy-configs'
        ? JSON.stringify([
            {
              deployment: {
                credentials: { AWS_ACCESS_KEY_ID: 'gh.secret.DEFAULT' }
              },
              stacks: [
                {
                  id: 'first',
                  credentials: { AWS_ACCESS_KEY_ID: 'gh.secret.OVERRIDE' }
                },
                { id: 'second' }
              ]
            },
            {
              deployment: {
                credentials: { AWS_SECRET_ACCESS_KEY: 'gh.secret.SECRET' }
              },
              stacks: [{ id: 'third' }]
            }
          ])
        : ''
    )
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
    const output = (core.setOutput as jest.Mock).mock.calls.find(
      ([name]) => name === 'layer-deployments'
    )
    const stacks = (
      JSON.parse(output![1] as string) as Array<
        Array<{ id: string; credentials?: Record<string, string> }>
      >
    ).flat()
    expect(stacks.map(({ id, credentials }) => [id, credentials])).toEqual([
      [
        'first',
        {
          AWS_ACCESS_KEY_ID: 'gh.secret.OVERRIDE',
          AWS_SECRET_ACCESS_KEY: 'gh.secret.SECRET'
        }
      ],
      [
        'second',
        {
          AWS_ACCESS_KEY_ID: 'gh.secret.DEFAULT',
          AWS_SECRET_ACCESS_KEY: 'gh.secret.SECRET'
        }
      ],
      [
        'third',
        {
          AWS_ACCESS_KEY_ID: 'gh.secret.DEFAULT',
          AWS_SECRET_ACCESS_KEY: 'gh.secret.SECRET'
        }
      ]
    ])
  })

  it('rejects invalid credential names in action runtime without relying on schema', async () => {
    core.getInput.mockImplementation((name) =>
      name === 'deploy-configs'
        ? JSON.stringify([
            {
              deployment: {
                credentials: { ARM_CLIENT_SECRET: 'gh.secret.KEY' }
              },
              stacks: [{ id: 'stack' }]
            }
          ])
        : ''
    )
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('ARM_CLIENT_SECRET is not allowed')
    )
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('rejects a Hetzner token conflicting with inherited credentials', async () => {
    core.getInput.mockImplementation((name) =>
      name === 'deploy-configs'
        ? JSON.stringify([
            {
              deployment: {
                credentials: { HCLOUD_TOKEN: 'gh.secret.DEFAULT' }
              },
              stacks: []
            },
            {
              stacks: [
                {
                  id: 'packer',
                  type: 'packer',
                  build_target: 'hetzner',
                  packer_directory: 'packer',
                  packer_version: '1.14.0',
                  credentials: { HCLOUD_TOKEN: 'gh.secret.OVERRIDE' },
                  hetzner: {
                    location: 'fsn1',
                    server_type: 'cax11',
                    token: 'gh.secret.OTHER'
                  }
                }
              ]
            }
          ])
        : ''
    )
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        'hetzner.token conflicts with credentials.HCLOUD_TOKEN'
      )
    )
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('requires a Key Vault URL for a keyvault stack with inherited credentials', async () => {
    core.getInput.mockImplementation((name) =>
      name === 'deploy-configs'
        ? JSON.stringify([
            {
              deployment: {
                secret_backend: 'keyvault',
                credentials: {
                  AWS_ACCESS_KEY_ID: 'gh.secret.AWS_ACCESS_KEY_ID'
                }
              },
              stacks: [{ id: 'stack' }]
            }
          ])
        : ''
    )
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('key-vault-url is not configured')
    )
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it.each(['invalid', 'vault'])(
    'rejects invalid backend %s even when a stack overrides it',
    async (backend) => {
      core.getInput.mockImplementation((name) =>
        name === 'deploy-configs'
          ? JSON.stringify([
              {
                deployment: { secret_backend: backend },
                stacks: [{ id: 'override', secret_backend: 'gh' }]
              }
            ])
          : ''
      )
      await run()
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('deployment.secret_backend')
      )
      expect(core.setOutput).not.toHaveBeenCalled()
    }
  )

  it('rejects Hetzner token on non-Packer stacks before scheduling', async () => {
    core.getInput.mockImplementation((name) =>
      name === 'deploy-config'
        ? JSON.stringify([
            {
              id: 'infra',
              type: 'terraform',
              folder: 'infra',
              hetzner: { token: 'gh.secret.hcloud_token' }
            }
          ])
        : ''
    )
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        'hetzner.token applies only to Packer build_target hetzner'
      )
    )
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('rejects two Pages stacks across merged files before scheduling', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-configs')
        return JSON.stringify([
          {
            sourceFile: 'a.yaml',
            stacks: [{ id: 'docs-a', type: 'github-pages-site-deploy' }]
          },
          {
            sourceFile: 'b.yaml',
            stacks: [{ id: 'docs-b', type: 'github-pages-site-deploy' }]
          }
        ])
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        'More than one github-pages-site-deploy stack is configured: "docs-a" and "docs-b"'
      )
    )
    expect(generate_layerdeployment).not.toHaveBeenCalled()
  })

  it('rejects an invalid Pages site source type before scheduling', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'deploy-config')
        return JSON.stringify([
          {
            id: 'docs',
            type: 'github-pages-site-deploy',
            site_source_type: 'hugo'
          }
        ])
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        'GitHub Pages stack "docs" has invalid site_source_type: "hugo"'
      )
    )
    expect(generate_layerdeployment).not.toHaveBeenCalled()
  })

  it.each([true, 'true'])(
    'rejects destroy=%s for Pages even when dry_run is true',
    async (destroy) => {
      core.getInput.mockImplementation((name) => {
        if (name === 'deploy-config')
          return JSON.stringify([
            { id: 'docs', type: 'github-pages-site-deploy' }
          ])
        if (name === 'global-vars')
          return JSON.stringify({ dry_run: true, destroy })
        return ''
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'GitHub Pages stack "docs" does not support destroy=true.'
      )
      expect(generate_layerdeployment).not.toHaveBeenCalled()
      expect(core.setOutput).not.toHaveBeenCalledWith(
        'layer-deployments',
        expect.any(String)
      )
    }
  )
})
