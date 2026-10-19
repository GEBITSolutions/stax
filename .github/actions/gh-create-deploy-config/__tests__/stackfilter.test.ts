import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import { ITerraformConfig } from '../src/types.js'

jest.unstable_mockModule('@actions/core', () => core)

const { generate_stackfilter } = await import('../src/stackFilterN.js')

describe('generate_stackfilter', () => {
  const mockConfig: ITerraformConfig[] = [
    { id: 'stack-1', 'stack-groups': ['group-a'], depends_on: ['stack-2'] },
    { id: 'stack-2', 'stack-groups': ['group-a'], depends_on: [] },
    { id: 'stack-3', 'stack-groups': ['group-b'], depends_on: ['stack-1'] },
    { id: 'stack-4', 'stack-groups': ['group-b'], depends_on: [] },
    { id: 'stack-5', depends_on: ['stack-3'] },
    { id: 'stack-6', depends_on: [] }
  ]

  const mock_global_vars = {
    has_release_tag: true,
    stage: 'dev'
  }

  it('should return the original stack filter when no groups or dependencies are provided', () => {
    const result = generate_stackfilter(
      mockConfig,
      'stack-1,stack-2',
      mock_global_vars
    )
    expect(result).toEqual(['stack-1', 'stack-2'])
  })

  it('should resolve stack groups correctly', () => {
    const result = generate_stackfilter(mockConfig, 'group-a', mock_global_vars)
    expect(result).toContain('stack-1')
    expect(result).toContain('stack-2')
  })

  it("should resolve before dependencies when using '>'", () => {
    const result = generate_stackfilter(
      mockConfig,
      '>stack-3',
      mock_global_vars
    )
    expect(result).toContain('stack-3')
    expect(result).toContain('stack-1')
    expect(result).toContain('stack-2')
  })

  it("should resolve after dependencies when using '<'", () => {
    const result = generate_stackfilter(
      mockConfig,
      'stack-3<',
      mock_global_vars
    )
    expect(result).toContain('stack-3')
    expect(result).toContain('stack-5')
  })

  it("should resolve both before and after dependencies when using '>' and '<'", () => {
    const result = generate_stackfilter(
      mockConfig,
      '>stack-3<',
      mock_global_vars
    )
    expect(result).toContain('stack-1')
    expect(result).toContain('stack-2')
    expect(result).toContain('stack-3')
    expect(result).toContain('stack-5')
  })

  it('should remove stacks that fail conditional checks', () => {
    const configWithCondition: ITerraformConfig[] = [
      ...mockConfig,
      { id: 'stack-conditional', if: 'false' }
    ]

    const result = generate_stackfilter(
      configWithCondition,
      'stack-conditional,stack-1',
      mock_global_vars
    )
    expect(result).not.toContain('stack-conditional')
  })

  it('should remove stacks that fail condition checks with empty stack_filter input', () => {
    const result = generate_stackfilter(
      [...mockConfig, { id: 'stack-conditional', if: 'false' }],
      '',
      mock_global_vars
    )
    expect(result).toEqual([])
  })

  it('should correctly replace variables in conditions', () => {
    const configWithCondition: ITerraformConfig[] = [
      { id: 'stack-conditional', if: `{has_release_tag} === true` }
    ]

    const result = generate_stackfilter(
      configWithCondition,
      'stack-conditional',
      mock_global_vars
    )
    expect(result).toContain('stack-conditional')
  })

  it('should not add duplicate stack IDs', () => {
    const result = generate_stackfilter(
      mockConfig,
      'group-a,stack-1',
      mock_global_vars
    )
    expect(result).toEqual(['stack-1', 'stack-2'])
  })
  it('should return empty array if no stack id is provided', () => {
    const result = generate_stackfilter(mockConfig, '', mock_global_vars)
    expect(result).toEqual([])
  })

  it('should warn when stack id is not found', () => {
    const result = generate_stackfilter(
      mockConfig,
      'non-existent-stack',
      mock_global_vars
    )
    // Should still return the stack id even though it's not found (warning is issued)
    expect(result).toContain('non-existent-stack')
    expect(core.warning).toHaveBeenCalledWith(
      'Stack non-existent-stack not found in config'
    )
  })
})
