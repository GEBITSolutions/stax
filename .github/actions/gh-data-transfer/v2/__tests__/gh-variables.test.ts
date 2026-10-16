import { describe, expect, test, jest, beforeEach } from '@jest/globals'

// Set up GitHub repository environment variable before importing any modules
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo'

// Create mock functions before jest.mock
const mockInfo = jest.fn<(message: string) => void>()
const mockDebug = jest.fn<(message: string) => void>()

// Mock dependencies
jest.mock('@actions/core', () => ({
  info: mockInfo,
  debug: mockDebug
}))

import { write_variables_to_gh_env } from '../src/gh-variables.js'
import { Octokit } from '@octokit/rest'

describe('write_variables_to_gh_env', () => {
  let mockOctokit: jest.Mocked<Octokit>

  beforeEach(() => {
    jest.clearAllMocks()

    // Create a mock Octokit instance
    mockOctokit = {
      rest: {
        actions: {
          listEnvironmentVariables: jest.fn(),
          createEnvironmentVariable: jest.fn(),
          updateEnvironmentVariable: jest.fn()
        }
      }
    } as any
  })

  test('should create new variables when they do not exist', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>
    const mockCreateEnvironmentVariable = mockOctokit.rest.actions
      .createEnvironmentVariable as jest.MockedFunction<any>

    mockListEnvironmentVariables.mockResolvedValue({
      data: {
        variables: []
      }
    })

    const variables = {
      NEW_VAR_1: 'value1',
      NEW_VAR_2: 'value2'
    }

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    expect(mockListEnvironmentVariables).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      per_page: 30,
      page: 1
    })

    expect(mockCreateEnvironmentVariable).toHaveBeenCalledTimes(2)
    expect(mockCreateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'NEW_VAR_1',
      value: 'value1'
    })
    expect(mockCreateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'NEW_VAR_2',
      value: 'value2'
    })

    expect(mockInfo).toHaveBeenCalledWith('Create variable NEW_VAR_1...')
    expect(mockInfo).toHaveBeenCalledWith('Create variable NEW_VAR_2...')
  })

  test('should update existing variables', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>
    const mockUpdateEnvironmentVariable = mockOctokit.rest.actions
      .updateEnvironmentVariable as jest.MockedFunction<any>

    mockListEnvironmentVariables.mockResolvedValue({
      data: {
        variables: [{ name: 'EXISTING_VAR' }, { name: 'ANOTHER_VAR' }]
      }
    })

    const variables = {
      EXISTING_VAR: 'updated_value',
      ANOTHER_VAR: 'another_updated_value'
    }

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    expect(mockUpdateEnvironmentVariable).toHaveBeenCalledTimes(2)
    expect(mockUpdateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'EXISTING_VAR',
      value: 'updated_value'
    })
    expect(mockUpdateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'ANOTHER_VAR',
      value: 'another_updated_value'
    })

    expect(mockInfo).toHaveBeenCalledWith('Updating variable EXISTING_VAR...')
    expect(mockInfo).toHaveBeenCalledWith('Updating variable ANOTHER_VAR...')
  })

  test('should handle mixed create and update operations', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>
    const mockCreateEnvironmentVariable = mockOctokit.rest.actions
      .createEnvironmentVariable as jest.MockedFunction<any>
    const mockUpdateEnvironmentVariable = mockOctokit.rest.actions
      .updateEnvironmentVariable as jest.MockedFunction<any>

    mockListEnvironmentVariables.mockResolvedValue({
      data: {
        variables: [{ name: 'EXISTING_VAR' }]
      }
    })

    const variables = {
      EXISTING_VAR: 'updated_value',
      NEW_VAR: 'new_value'
    }

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    expect(mockUpdateEnvironmentVariable).toHaveBeenCalledTimes(1)
    expect(mockUpdateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'EXISTING_VAR',
      value: 'updated_value'
    })

    expect(mockCreateEnvironmentVariable).toHaveBeenCalledTimes(1)
    expect(mockCreateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'NEW_VAR',
      value: 'new_value'
    })
  })

  test('should handle pagination of existing variables', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>
    const mockCreateEnvironmentVariable = mockOctokit.rest.actions
      .createEnvironmentVariable as jest.MockedFunction<any>

    // Mock paginated response
    mockListEnvironmentVariables
      .mockResolvedValueOnce({
        data: {
          variables: Array(30)
            .fill(0)
            .map((_, i) => ({ name: `VAR_${i}` }))
        }
      })
      .mockResolvedValueOnce({
        data: {
          variables: [{ name: 'VAR_30' }, { name: 'VAR_31' }]
        }
      })

    const variables = {
      NEW_VAR: 'new_value'
    }

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    // Should make 2 API calls for pagination
    expect(mockListEnvironmentVariables).toHaveBeenCalledTimes(2)
    expect(mockListEnvironmentVariables).toHaveBeenNthCalledWith(1, {
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      per_page: 30,
      page: 1
    })
    expect(mockListEnvironmentVariables).toHaveBeenNthCalledWith(2, {
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      per_page: 30,
      page: 2
    })

    expect(mockCreateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'NEW_VAR',
      value: 'new_value'
    })
  })

  test('should handle case-insensitive variable matching', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>
    const mockUpdateEnvironmentVariable = mockOctokit.rest.actions
      .updateEnvironmentVariable as jest.MockedFunction<any>

    mockListEnvironmentVariables.mockResolvedValue({
      data: {
        variables: [{ name: 'existing_var' }]
      }
    })

    const variables = {
      EXISTING_VAR: 'updated_value'
    }

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    // Should update the existing variable (case-insensitive match)
    expect(mockUpdateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'EXISTING_VAR',
      value: 'updated_value'
    })

    expect(mockInfo).toHaveBeenCalledWith('Updating variable EXISTING_VAR...')
  })

  test('should strip quotes from values', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>
    const mockCreateEnvironmentVariable = mockOctokit.rest.actions
      .createEnvironmentVariable as jest.MockedFunction<any>

    mockListEnvironmentVariables.mockResolvedValue({
      data: {
        variables: []
      }
    })

    const variables = {
      VAR_WITH_QUOTES: '"quoted_value"'
    }

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    expect(mockCreateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'VAR_WITH_QUOTES',
      value: 'quoted_value'
    })
  })

  test('should handle empty variables object', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>
    const mockCreateEnvironmentVariable = mockOctokit.rest.actions
      .createEnvironmentVariable as jest.MockedFunction<any>
    const mockUpdateEnvironmentVariable = mockOctokit.rest.actions
      .updateEnvironmentVariable as jest.MockedFunction<any>

    mockListEnvironmentVariables.mockResolvedValue({
      data: {
        variables: []
      }
    })

    const variables = {}

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    expect(mockListEnvironmentVariables).toHaveBeenCalledTimes(1)
    expect(mockCreateEnvironmentVariable).not.toHaveBeenCalled()
    expect(mockUpdateEnvironmentVariable).not.toHaveBeenCalled()
    expect(mockInfo).toHaveBeenCalledWith('Start setting variables.')
    expect(mockInfo).toHaveBeenCalledWith('Finished setting variables.')
  })

  test('should log existing variables', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>
    mockListEnvironmentVariables.mockResolvedValue({
      data: {
        variables: [{ name: 'VAR1' }, { name: 'VAR2' }]
      }
    })

    const variables = {
      NEW_VAR: 'value'
    }

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    expect(mockInfo).toHaveBeenCalledWith('Existing variables: ["VAR1","VAR2"]')
  })

  test('should handle values that are not quoted', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>
    const mockCreateEnvironmentVariable = mockOctokit.rest.actions
      .createEnvironmentVariable as jest.MockedFunction<any>

    mockListEnvironmentVariables.mockResolvedValue({
      data: {
        variables: []
      }
    })

    const variables = {
      SIMPLE_VAR: 'simple_value'
    }

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    expect(mockCreateEnvironmentVariable).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env',
      name: 'SIMPLE_VAR',
      value: 'simple_value'
    })
  })

  test('should log start and finish messages', async () => {
    const mockListEnvironmentVariables = mockOctokit.rest.actions
      .listEnvironmentVariables as jest.MockedFunction<any>

    mockListEnvironmentVariables.mockResolvedValue({
      data: {
        variables: []
      }
    })

    const variables = {
      TEST_VAR: 'test_value'
    }

    await write_variables_to_gh_env(mockOctokit as any, 'test-env', variables)

    expect(mockInfo).toHaveBeenCalledWith('Start setting variables.')
    expect(mockInfo).toHaveBeenCalledWith('Finished setting variables.')
  })
})
