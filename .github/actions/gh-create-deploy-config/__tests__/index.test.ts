import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import {
  apply_stack_filter as original_apply_stack_filter,
  generate_stackfilter as original_generate_stackfilter
} from '../src/stackFilterN.js'
import { generate_layerdeployment as original_generate_layerdeployment } from '../src/layerDeploymentN.js'
import {
  convert_implicit_to_explicit_dependencies as original_convert_implicit_to_explicit_dependencies,
  prune_external_dependencies as original_prune_external_dependencies
} from '../src/stackDependencyN.js'

const apply_stack_filter = jest.fn(original_apply_stack_filter)
const generate_stackfilter = jest.fn(original_generate_stackfilter)
const generate_layerdeployment = jest.fn(original_generate_layerdeployment)
const convert_implicit_to_explicit_dependencies = jest.fn(
  original_convert_implicit_to_explicit_dependencies
)
const prune_external_dependencies = jest.fn(
  original_prune_external_dependencies
)

jest.unstable_mockModule('@actions/core', () => core)
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
      [{ id: 'stack-1' }],
      'stack-1',
      {}
    )
    expect(convert_implicit_to_explicit_dependencies).toHaveBeenCalledWith([
      { id: 'stack-1' }
    ])
    expect(prune_external_dependencies).toHaveBeenCalledWith([
      { id: 'stack-1' }
    ])
    expect(apply_stack_filter).toHaveBeenCalledWith(
      [{ id: 'stack-1' }],
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
      [{ id: 'stack-1' }],
      '',
      {}
    )
    expect(convert_implicit_to_explicit_dependencies).toHaveBeenCalledWith([
      { id: 'stack-1' }
    ])
    expect(apply_stack_filter).not.toHaveBeenCalled()
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
    core.warning.mockImplementation(() => undefined)

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
})
