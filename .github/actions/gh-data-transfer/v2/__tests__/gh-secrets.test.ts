import { describe, expect, test, jest, beforeEach } from '@jest/globals'

// Set up GitHub repository environment variable before importing any modules
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo'

// Valid 32-byte base64 encoded public key for testing
const VALID_PUBLIC_KEY_32_BYTES = 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE='

// Create mock functions before jest.mock
const mockInfo = jest.fn<(message: string) => void>()
const mockDebug = jest.fn<(message: string) => void>()

// Mock dependencies
jest.mock('@actions/core', () => ({
  info: mockInfo,
  debug: mockDebug
}))

import { write_secrets_to_gh_env } from '../src/gh-secrets.js'
import { Octokit } from '@octokit/rest'

describe('write_secrets_to_gh_env', () => {
  let mockOctokit: jest.Mocked<Octokit>

  beforeEach(() => {
    jest.clearAllMocks()

    // Create a mock Octokit instance
    mockOctokit = {
      rest: {
        actions: {
          getEnvironmentPublicKey: jest.fn(),
          createOrUpdateEnvironmentSecret: jest.fn()
        }
      }
    } as any
  })

  test('should retrieve environment public key', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: {
        key_id: 'test-key-id',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    })

    const secrets = {
      TEST_SECRET: 'test_value'
    }

    await write_secrets_to_gh_env(mockOctokit as any, 'test-env', secrets)

    expect(mockGetEnvironmentPublicKey).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      environment_name: 'test-env'
    })

    expect(mockDebug).toHaveBeenCalledWith(
      'Get Public Key for Environment test-env'
    )
  })

  test('should log public key information', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: {
        key_id: 'test-key-id',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    })

    const secrets = {
      SECRET1: 'value1'
    }

    await write_secrets_to_gh_env(mockOctokit as any, 'production', secrets)

    expect(mockDebug).toHaveBeenCalledWith(
      'Get Public Key for Environment production'
    )
  })

  test('should handle empty secrets object', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: {
        key_id: 'test-key-id',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    })

    const secrets = {}

    await write_secrets_to_gh_env(mockOctokit as any, 'test-env', secrets)

    expect(mockInfo).toHaveBeenCalledWith('Start setting secrets.')
    expect(mockInfo).toHaveBeenCalledWith('Finished setting secrets.')
  })

  test('should log start and finish messages', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: {
        key_id: 'test-key-id',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    })

    const secrets = {
      SECRET1: 'value1',
      SECRET2: 'value2'
    }

    await write_secrets_to_gh_env(mockOctokit as any, 'test-env', secrets)

    expect(mockInfo).toHaveBeenCalledWith('Finished setting secrets.')
  })

  test('should not call createOrUpdateEnvironmentSecret when secrets object is empty', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>
    const mockCreateOrUpdateEnvironmentSecret = mockOctokit.rest.actions
      .createOrUpdateEnvironmentSecret as jest.MockedFunction<any>

    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: {
        key_id: 'test-key-id',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    })

    const secrets = {}

    await write_secrets_to_gh_env(mockOctokit as any, 'test-env', secrets)

    expect(mockGetEnvironmentPublicKey).toHaveBeenCalledTimes(1)
    expect(mockCreateOrUpdateEnvironmentSecret).not.toHaveBeenCalled()
    expect(mockInfo).toHaveBeenCalledWith('Start setting secrets.')
    expect(mockInfo).toHaveBeenCalledWith('Finished setting secrets.')
  })

  test('should work with different environment names', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    const environments = ['dev', 'staging', 'production']

    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: {
        key_id: 'key-123',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    })

    const secrets = {
      API_KEY: 'secret-api-key'
    }

    for (const env of environments) {
      await write_secrets_to_gh_env(mockOctokit as any, env, secrets)

      expect(mockGetEnvironmentPublicKey).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        environment_name: env
      })

      jest.clearAllMocks()
    }
  })

  test('should handle API errors gracefully', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    mockGetEnvironmentPublicKey.mockRejectedValue(
      new Error('API Error: Environment not found')
    )

    const secrets = {
      SECRET: 'value'
    }

    await expect(
      write_secrets_to_gh_env(mockOctokit as any, 'invalid-env', secrets)
    ).rejects.toThrow('API Error: Environment not found')
  })

  test('should handle public key with different formats', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: {
        key_id: 'different-key-id',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    })

    const secrets = {
      SECRET_KEY: 'secret_value'
    }

    await write_secrets_to_gh_env(mockOctokit as any, 'test-env', secrets)

    expect(mockGetEnvironmentPublicKey).toHaveBeenCalledTimes(1)
    expect(mockInfo).toHaveBeenCalledWith('Finished setting secrets.')
  })

  test('should handle secrets with special characters', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: {
        key_id: 'test-key-id',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    })

    const secrets = {
      SECRET_WITH_SPECIAL: 'value!@#$%^&*()'
    }

    await write_secrets_to_gh_env(mockOctokit as any, 'test-env', secrets)

    expect(mockGetEnvironmentPublicKey).toHaveBeenCalledTimes(1)
    expect(mockInfo).toHaveBeenCalledWith('Finished setting secrets.')
  })

  test('should call debug with pkey length', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    const publicKeyResponse = {
      data: {
        key_id: 'test-key-id',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    }

    mockGetEnvironmentPublicKey.mockResolvedValue(publicKeyResponse)

    const secrets = {
      SECRET: 'value'
    }

    await write_secrets_to_gh_env(mockOctokit as any, 'test-env', secrets)

    expect(mockDebug).toHaveBeenCalledWith(
      'Get Public Key for Environment test-env'
    )
  })

  test('should handle multiple secrets', async () => {
    const mockGetEnvironmentPublicKey = mockOctokit.rest.actions
      .getEnvironmentPublicKey as jest.MockedFunction<any>

    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: {
        key_id: 'test-key-id',
        key: VALID_PUBLIC_KEY_32_BYTES
      }
    })

    const secrets = {
      SECRET1: 'value1',
      SECRET2: 'value2',
      SECRET3: 'value3',
      SECRET4: 'value4',
      SECRET5: 'value5'
    }

    await write_secrets_to_gh_env(mockOctokit as any, 'test-env', secrets)

    expect(mockGetEnvironmentPublicKey).toHaveBeenCalledTimes(1)
    expect(mockInfo).toHaveBeenCalledWith('Start setting secrets.')
    expect(mockInfo).toHaveBeenCalledWith('Finished setting secrets.')
  })
})
