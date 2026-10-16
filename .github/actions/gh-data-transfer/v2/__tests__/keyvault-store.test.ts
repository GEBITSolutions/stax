import { describe, expect, test, jest, beforeEach } from '@jest/globals'

// Create mock functions before jest.mock
const mockInfo = jest.fn<(message: string) => void>()
const mockError = jest.fn<(message: string) => void>()
const mockGetIDToken = jest.fn<() => Promise<string>>()
const mockSetSecret = jest.fn()
const mockGetSecret = jest.fn()

// Mock dependencies
jest.mock('@actions/core', () => ({
  info: mockInfo,
  error: mockError,
  getIDToken: mockGetIDToken
}))

jest.mock('@azure/keyvault-secrets', () => ({
  SecretClient: jest.fn().mockImplementation(() => ({
    setSecret: mockSetSecret,
    getSecret: mockGetSecret
  }))
}))

jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn(),
  ClientAssertionCredential: jest.fn(),
  DefaultAzureCredential: jest.fn()
}))

// Import after mocks are set up
import {
  KeyVaultStore,
  ServicePrincipalCredentials
} from '../src/keyvault-store'
import {
  ClientSecretCredential,
  ClientAssertionCredential,
  DefaultAzureCredential
} from '@azure/identity'

describe('KeyVaultStore', () => {
  const testKeyVaultProjectPrefix = 'test.project.dev'
  const testKeyVaultUrl = 'https://test-vault.vault.azure.net/'
  const testCredentials: ServicePrincipalCredentials = {
    tenantId: 'test-tenant-id',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret'
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Set NODE_ENV to 'dev' for all tests by default
    process.env.NODE_ENV = 'dev'

    // Reset mock implementations
    mockSetSecret.mockReset()
    mockGetSecret.mockReset()
  })

  describe('constructor', () => {
    test('should create instance with service principal credentials', () => {
      const store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(ClientSecretCredential).toHaveBeenCalledWith(
        testCredentials.tenantId,
        testCredentials.clientId,
        testCredentials.clientSecret
      )
      expect(mockInfo).toHaveBeenCalledWith(
        `KeyVaultStore initialized for vault: ${testKeyVaultUrl}`
      )
    })

    test('should create instance with DefaultAzureCredential when NODE_ENV is dev', () => {
      process.env.NODE_ENV = 'dev'

      const store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl
      )

      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(DefaultAzureCredential).toHaveBeenCalled()
      expect(mockInfo).toHaveBeenCalledWith(
        `KeyVaultStore initialized for vault: ${testKeyVaultUrl}`
      )
    })

    test('should throw error when credentials are missing and NODE_ENV is not dev', () => {
      process.env.NODE_ENV = 'production'

      expect(
        () => new KeyVaultStore(testKeyVaultProjectPrefix, testKeyVaultUrl)
      ).toThrow(
        'Service principal credentials are required when NODE_ENV is not "dev"'
      )
    })

    test('should use ClientSecretCredential when credentials are provided', () => {
      const store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      expect(ClientSecretCredential).toHaveBeenCalledWith(
        testCredentials.tenantId,
        testCredentials.clientId,
        testCredentials.clientSecret
      )
      expect(ClientAssertionCredential).not.toHaveBeenCalled()
      expect(DefaultAzureCredential).not.toHaveBeenCalled()
      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(mockInfo).toHaveBeenCalledWith(
        'KeyVault auth mode: ClientSecretCredential'
      )
    })

    test('should use ClientAssertionCredential (OIDC) when clientId and tenantId provided without clientSecret', () => {
      const oidcCredentials: ServicePrincipalCredentials = {
        tenantId: 'test-tenant-id',
        clientId: 'test-client-id',
        clientSecret: undefined
      }

      const store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        oidcCredentials
      )

      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(ClientAssertionCredential).toHaveBeenCalledWith(
        oidcCredentials.tenantId,
        oidcCredentials.clientId,
        expect.any(Function)
      )
      expect(ClientSecretCredential).not.toHaveBeenCalled()
      expect(DefaultAzureCredential).not.toHaveBeenCalled()
      expect(mockInfo).toHaveBeenCalledWith(
        'KeyVault auth mode: OIDC (ClientAssertionCredential)'
      )
    })

    test('should use ClientAssertionCredential (OIDC) when clientSecret is empty string', () => {
      const oidcCredentials: ServicePrincipalCredentials = {
        tenantId: 'test-tenant-id',
        clientId: 'test-client-id',
        clientSecret: ''
      }

      const store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        oidcCredentials
      )

      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(ClientAssertionCredential).toHaveBeenCalledWith(
        oidcCredentials.tenantId,
        oidcCredentials.clientId,
        expect.any(Function)
      )
      expect(ClientSecretCredential).not.toHaveBeenCalled()
    })

    test('should use DefaultAzureCredential when credentials have no clientId', () => {
      process.env.NODE_ENV = 'dev'

      const store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl
      )

      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(DefaultAzureCredential).toHaveBeenCalled()
      expect(ClientSecretCredential).not.toHaveBeenCalled()
      expect(ClientAssertionCredential).not.toHaveBeenCalled()
      expect(mockInfo).toHaveBeenCalledWith(
        'KeyVault auth mode: DefaultAzureCredential (fallback)'
      )
    })

    test('should handle different Key Vault URLs', () => {
      const urls = [
        'https://my-vault.vault.azure.net/',
        'https://prod-vault.vault.azure.net/',
        'https://dev-vault.vault.azure.net/'
      ]

      urls.forEach((url) => {
        jest.clearAllMocks()
        const store = new KeyVaultStore(
          testKeyVaultProjectPrefix,
          url,
          testCredentials
        )

        expect(store).toBeInstanceOf(KeyVaultStore)
        expect(mockInfo).toHaveBeenCalledWith(
          `KeyVaultStore initialized for vault: ${url}`
        )
      })
    })
  })

  describe('setSecret', () => {
    let store: KeyVaultStore

    beforeEach(() => {
      store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )
      jest.clearAllMocks()
    })

    test('should successfully set a secret with valid name', async () => {
      const secretName = 'test-secret'
      const secretValue = 'test-value'
      const expectedSecretName = 'test-project-dev---test-secret'

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecret(secretName, secretValue)

      expect(mockSetSecret).toHaveBeenCalledWith(
        expectedSecretName,
        secretValue
      )
      expect(mockInfo).toHaveBeenCalledWith(
        `Setting secret: ${expectedSecretName}`
      )
      expect(mockInfo).toHaveBeenCalledWith(
        `Successfully set secret: ${expectedSecretName}`
      )
    })

    test('should accept secret names with alphanumeric characters and convert them', async () => {
      const testCases = [
        { input: 'secret123', expected: 'test-project-dev---secret123' },
        { input: 'SECRET123', expected: 'test-project-dev---secret123' },
        { input: 'secret-name', expected: 'test-project-dev---secret-name' },
        {
          input: 'my-secret-key',
          expected: 'test-project-dev---my-secret-key'
        },
        { input: 'abc123def456', expected: 'test-project-dev---abc123def456' },
        {
          input: 'TEST-SECRET-NAME',
          expected: 'test-project-dev---test-secret-name'
        }
      ]

      mockSetSecret.mockResolvedValue({} as any)

      for (const { input, expected } of testCases) {
        jest.clearAllMocks()
        await store.setSecret(input, 'value')

        expect(mockSetSecret).toHaveBeenCalledWith(expected, 'value')
        expect(mockInfo).toHaveBeenCalledWith(`Setting secret: ${expected}`)
        expect(mockInfo).toHaveBeenCalledWith(
          `Successfully set secret: ${expected}`
        )
      }
    })

    test('should convert underscores to hyphens and lowercase', async () => {
      const testCases = [
        { input: 'SECRET_NAME', expected: 'test-project-dev---secret-name' },
        {
          input: 'My_Secret_Key',
          expected: 'test-project-dev---my-secret-key'
        },
        {
          input: 'TEST_SECRET_123',
          expected: 'test-project-dev---test-secret-123'
        },
        { input: 'simple_key', expected: 'test-project-dev---simple-key' }
      ]

      mockSetSecret.mockResolvedValue({} as any)

      for (const { input, expected } of testCases) {
        jest.clearAllMocks()
        await store.setSecret(input, 'value')

        expect(mockSetSecret).toHaveBeenCalledWith(expected, 'value')
        expect(mockInfo).toHaveBeenCalledWith(`Setting secret: ${expected}`)
        expect(mockInfo).toHaveBeenCalledWith(
          `Successfully set secret: ${expected}`
        )
      }
    })

    test('should reject secret names with invalid characters', async () => {
      const invalidNames = [
        'secret name',
        'secret@name',
        'secret#name',
        'secret/name',
        'secret\\name'
      ]

      for (const name of invalidNames) {
        jest.clearAllMocks()
        await expect(store.setSecret(name, 'value')).rejects.toThrow(
          `Failed to set secret ${name}: Invalid secret name: ${name}. Secret names must only contain alphanumeric characters and hyphens.`
        )

        expect(mockSetSecret).not.toHaveBeenCalled()
        expect(mockError).toHaveBeenCalled()
      }
    })

    test('should handle different secret values', async () => {
      const secretValues = [
        'simple-value',
        'complex-value-with-special-chars-!@#$%',
        JSON.stringify({ key: 'value' }),
        'multi\nline\nvalue',
        '',
        'very-long-value-'.repeat(100)
      ]

      mockSetSecret.mockResolvedValue({} as any)

      for (const value of secretValues) {
        jest.clearAllMocks()
        await store.setSecret('test-secret', value)

        expect(mockSetSecret).toHaveBeenCalledWith(
          'test-project-dev---test-secret',
          value
        )
      }
    })

    test('should throw error when setSecret fails', async () => {
      const secretName = 'test-secret'
      const secretValue = 'test-value'
      const errorMessage = 'Azure Key Vault error'

      mockSetSecret.mockRejectedValue(new Error(errorMessage))

      await expect(store.setSecret(secretName, secretValue)).rejects.toThrow(
        `Failed to set secret ${secretName}: ${errorMessage}`
      )

      expect(mockError).toHaveBeenCalledWith(
        `Failed to set secret ${secretName}: ${errorMessage}`
      )
    })

    test('should handle non-Error exceptions', async () => {
      const secretName = 'test-secret'
      const secretValue = 'test-value'

      mockSetSecret.mockRejectedValue('String error')

      await expect(store.setSecret(secretName, secretValue)).rejects.toThrow(
        `Failed to set secret ${secretName}: String error`
      )

      expect(mockError).toHaveBeenCalledWith(
        `Failed to set secret ${secretName}: String error`
      )
    })

    test('should log appropriate messages on success', async () => {
      const secretName = 'my-secret'
      const secretValue = 'my-value'
      const expectedSecretName = 'test-project-dev---my-secret'

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecret(secretName, secretValue)

      expect(mockInfo).toHaveBeenCalledTimes(2)
      expect(mockInfo).toHaveBeenNthCalledWith(
        1,
        `Setting secret: ${expectedSecretName}`
      )
      expect(mockInfo).toHaveBeenNthCalledWith(
        2,
        `Successfully set secret: ${expectedSecretName}`
      )
    })

    test('should handle Azure-specific error responses', async () => {
      const secretName = 'test-secret'
      const azureError = new Error('Unauthorized. Request not authorized')
      ;(azureError as any).statusCode = 401

      mockSetSecret.mockRejectedValue(azureError)

      await expect(store.setSecret(secretName, 'value')).rejects.toThrow(
        'Failed to set secret test-secret: Unauthorized. Request not authorized'
      )
    })

    test('should validate secret name before attempting to set', async () => {
      const invalidName = 'invalid name with spaces'

      await expect(store.setSecret(invalidName, 'value')).rejects.toThrow(
        `Failed to set secret ${invalidName}: Invalid secret name: ${invalidName}. Secret names must only contain alphanumeric characters and hyphens.`
      )

      expect(mockSetSecret).not.toHaveBeenCalled()
    })
  })

  describe('setSecrets', () => {
    let store: KeyVaultStore

    beforeEach(() => {
      store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )
      jest.clearAllMocks()
    })

    test('should successfully set multiple secrets with conversion', async () => {
      const secrets = {
        SECRET_1: 'value-1',
        Secret_2: 'value-2',
        'secret-3': 'value-3'
      }

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecrets(secrets)

      expect(mockSetSecret).toHaveBeenCalledTimes(3)
      expect(mockSetSecret).toHaveBeenCalledWith(
        'test-project-dev---secret-1',
        'value-1'
      )
      expect(mockSetSecret).toHaveBeenCalledWith(
        'test-project-dev---secret-2',
        'value-2'
      )
      expect(mockSetSecret).toHaveBeenCalledWith(
        'test-project-dev---secret-3',
        'value-3'
      )
      expect(mockInfo).toHaveBeenCalledWith('Setting 3 secrets')
      expect(mockInfo).toHaveBeenCalledWith('Successfully set all 3 secrets')
    })

    test('should handle empty secrets object', async () => {
      const secrets = {}

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecrets(secrets)

      expect(mockSetSecret).not.toHaveBeenCalled()
      expect(mockInfo).toHaveBeenCalledWith('Setting 0 secrets')
      expect(mockInfo).toHaveBeenCalledWith('Successfully set all 0 secrets')
    })

    test('should validate all secret names before setting any', async () => {
      const secrets = {
        'valid-secret-1': 'value-1',
        'invalid secret': 'value-2', // space is invalid
        'valid-secret-2': 'value-3'
      }

      await expect(store.setSecrets(secrets)).rejects.toThrow(
        'Invalid secret name'
      )

      // Should not have called setSecret for any secrets since validation failed
      expect(mockSetSecret).not.toHaveBeenCalled()
    })

    test('should set secrets in parallel', async () => {
      const secrets = {
        'secret-1': 'value-1',
        'secret-2': 'value-2',
        'secret-3': 'value-3',
        'secret-4': 'value-4',
        'secret-5': 'value-5'
      }

      const callOrder: string[] = []
      mockSetSecret.mockImplementation((key: string) => {
        callOrder.push(key)
        return Promise.resolve({})
      })

      await store.setSecrets(secrets)

      // All secrets should be called
      expect(mockSetSecret).toHaveBeenCalledTimes(5)
      // Verify all secrets were set (order may vary due to parallel execution)
      expect(callOrder).toHaveLength(5)
      expect(callOrder).toContain('test-project-dev---secret-1')
      expect(callOrder).toContain('test-project-dev---secret-2')
      expect(callOrder).toContain('test-project-dev---secret-3')
      expect(callOrder).toContain('test-project-dev---secret-4')
      expect(callOrder).toContain('test-project-dev---secret-5')
    })

    test('should log individual secret setting with converted names', async () => {
      const secrets = {
        MY_SECRET: 'my-value',
        ANOTHER_SECRET: 'another-value'
      }

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecrets(secrets)

      expect(mockInfo).toHaveBeenCalledWith(
        'Setting secret: test-project-dev---my-secret'
      )
      expect(mockInfo).toHaveBeenCalledWith(
        'Successfully set secret: test-project-dev---my-secret'
      )
      expect(mockInfo).toHaveBeenCalledWith(
        'Setting secret: test-project-dev---another-secret'
      )
      expect(mockInfo).toHaveBeenCalledWith(
        'Successfully set secret: test-project-dev---another-secret'
      )
    })

    test('should throw error if any secret fails to set', async () => {
      const secrets = {
        'secret-1': 'value-1',
        'secret-2': 'value-2',
        'secret-3': 'value-3'
      }

      mockSetSecret.mockImplementation((key: string) => {
        if (key === 'test-project-dev---secret-2') {
          return Promise.reject(new Error('Azure Key Vault error'))
        }
        return Promise.resolve({})
      })

      await expect(store.setSecrets(secrets)).rejects.toThrow(
        'Failed to set secret secret-2: Azure Key Vault error'
      )

      expect(mockSetSecret).toHaveBeenCalledTimes(3)
      expect(mockError).toHaveBeenCalledWith(
        'Failed to set secret secret-2: Azure Key Vault error'
      )
    })

    test('should handle non-Error exceptions in individual secrets', async () => {
      const secrets = {
        'secret-1': 'value-1',
        'secret-2': 'value-2'
      }

      mockSetSecret.mockImplementation((key: string) => {
        if (key === 'test-project-dev---secret-1') {
          return Promise.reject('String error')
        }
        return Promise.resolve({})
      })

      await expect(store.setSecrets(secrets)).rejects.toThrow(
        'Failed to set secret secret-1: String error'
      )

      expect(mockError).toHaveBeenCalledWith(
        'Failed to set secret secret-1: String error'
      )
    })

    test('should accept secrets with valid naming patterns and convert them', async () => {
      const secrets = {
        SECRET_123: 'value1',
        SECRET_NAME: 'value2',
        MY_SECRET_123: 'value3',
        A: 'value4',
        '123': 'value5'
      }

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecrets(secrets)

      expect(mockSetSecret).toHaveBeenCalledTimes(5)
      expect(mockSetSecret).toHaveBeenCalledWith(
        'test-project-dev---secret-123',
        'value1'
      )
      expect(mockSetSecret).toHaveBeenCalledWith(
        'test-project-dev---secret-name',
        'value2'
      )
      expect(mockSetSecret).toHaveBeenCalledWith(
        'test-project-dev---my-secret-123',
        'value3'
      )
      expect(mockSetSecret).toHaveBeenCalledWith(
        'test-project-dev---a',
        'value4'
      )
      expect(mockSetSecret).toHaveBeenCalledWith(
        'test-project-dev---123',
        'value5'
      )
      expect(mockInfo).toHaveBeenCalledWith('Successfully set all 5 secrets')
    })

    test('should reject secrets with invalid characters', async () => {
      const invalidSecrets: Array<Record<string, string>> = [
        { 'secret name': 'value' },
        { 'secret@name': 'value' },
        { 'secret/name': 'value' }
      ]

      for (const secrets of invalidSecrets) {
        jest.clearAllMocks()

        await expect(store.setSecrets(secrets)).rejects.toThrow(
          `Invalid secret name`
        )

        expect(mockSetSecret).not.toHaveBeenCalled()
      }
    })

    test('should handle different value types as strings', async () => {
      const secrets = {
        'simple-secret': 'simple-value',
        'json-secret': JSON.stringify({ key: 'value' }),
        'multiline-secret': 'line1\nline2\nline3',
        'numeric-string': '12345',
        'special-chars': '!@#$%^&*()',
        'empty-but-space': ' '
      }

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecrets(secrets)

      expect(mockSetSecret).toHaveBeenCalledTimes(6)
      Object.entries(secrets).forEach(([key, value]) => {
        const expectedKey = `test-project-dev---${key}`
        expect(mockSetSecret).toHaveBeenCalledWith(expectedKey, value)
      })
    })

    test('should propagate error from outer catch block', async () => {
      // Mock an error during validation (before individual setSecret calls)
      const invalidSecrets = {
        'invalid@name': 'value'
      }

      await expect(store.setSecrets(invalidSecrets)).rejects.toThrow(
        'Failed to set secrets: Invalid secret name'
      )

      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to set secrets:')
      )
    })

    test('should handle large number of secrets', async () => {
      const secrets: Record<string, string> = {}
      for (let i = 1; i <= 50; i++) {
        secrets[`secret-${i}`] = `value-${i}`
      }

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecrets(secrets)

      expect(mockSetSecret).toHaveBeenCalledTimes(50)
      expect(mockInfo).toHaveBeenCalledWith('Setting 50 secrets')
      expect(mockInfo).toHaveBeenCalledWith('Successfully set all 50 secrets')
    })

    test('should handle partial failure in parallel execution', async () => {
      const secrets = {
        'secret-1': 'value-1',
        'secret-2': 'value-2',
        'secret-3': 'value-3',
        'secret-4': 'value-4'
      }

      mockSetSecret.mockImplementation((key: string) => {
        if (
          key === 'test-project-dev---secret-2' ||
          key === 'test-project-dev---secret-4'
        ) {
          return Promise.reject(new Error(`Failed for ${key}`))
        }
        return Promise.resolve({})
      })

      // Promise.all will reject as soon as any promise rejects
      await expect(store.setSecrets(secrets)).rejects.toThrow(
        'Failed to set secret'
      )

      expect(mockSetSecret).toHaveBeenCalledTimes(4)
    })

    test('should log setting count before starting', async () => {
      const secrets = {
        'secret-1': 'value-1',
        'secret-2': 'value-2'
      }

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecrets(secrets)

      // Verify the initial log happens
      const infoCalls = (mockInfo as jest.Mock).mock.calls
      expect(infoCalls[0][0]).toBe('Setting 2 secrets')
    })
  })

  describe('getSecret', () => {
    let store: KeyVaultStore

    beforeEach(() => {
      store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )
      jest.clearAllMocks()
    })

    test('should successfully retrieve a secret', async () => {
      const secretName = 'test-secret'
      const secretValue = 'test-value'

      mockGetSecret.mockResolvedValue({
        value: secretValue
      } as any)

      const result = await store.getSecret(secretName)

      expect(result).toBe(secretValue)
      expect(mockGetSecret).toHaveBeenCalledWith(secretName)
      expect(mockInfo).toHaveBeenCalledWith(`Getting secret: ${secretName}`)
      expect(mockInfo).toHaveBeenCalledWith(
        `Successfully retrieved secret: ${secretName}`
      )
    })

    test('should throw error when secret has no value', async () => {
      const secretName = 'empty-secret'

      mockGetSecret.mockResolvedValue({
        value: undefined
      } as any)

      await expect(store.getSecret(secretName)).rejects.toThrow(
        `Secret ${secretName} exists but has no value`
      )

      expect(mockError).toHaveBeenCalledWith(
        `Failed to get secret ${secretName}: Secret ${secretName} exists but has no value`
      )
    })

    test('should throw error when secret does not exist', async () => {
      const secretName = 'non-existent-secret'
      const errorMessage = 'Secret not found'

      mockGetSecret.mockRejectedValue(new Error(errorMessage))

      await expect(store.getSecret(secretName)).rejects.toThrow(
        `Failed to get secret ${secretName}: ${errorMessage}`
      )

      expect(mockError).toHaveBeenCalledWith(
        `Failed to get secret ${secretName}: ${errorMessage}`
      )
    })

    test('should retrieve different types of secret values', async () => {
      const secretValues = [
        'simple-value',
        JSON.stringify({ complex: 'object' }),
        'multi\nline\nvalue',
        '12345',
        'special-chars-!@#$%^&*()',
        ' ' // single space - valid secret value
      ]

      for (const value of secretValues) {
        jest.clearAllMocks()
        mockGetSecret.mockResolvedValue({ value } as any)

        const result = await store.getSecret('test-secret')

        expect(result).toBe(value)
        expect(mockInfo).toHaveBeenCalledWith('Getting secret: test-secret')
        expect(mockInfo).toHaveBeenCalledWith(
          'Successfully retrieved secret: test-secret'
        )
      }
    })

    test('should handle non-Error exceptions', async () => {
      const secretName = 'test-secret'

      mockGetSecret.mockRejectedValue('String error')

      await expect(store.getSecret(secretName)).rejects.toThrow(
        `Failed to get secret ${secretName}: String error`
      )

      expect(mockError).toHaveBeenCalledWith(
        `Failed to get secret ${secretName}: String error`
      )
    })

    test('should log appropriate messages on success', async () => {
      const secretName = 'my-secret'
      const secretValue = 'my-value'

      mockGetSecret.mockResolvedValue({
        value: secretValue
      } as any)

      await store.getSecret(secretName)

      expect(mockInfo).toHaveBeenCalledTimes(2)
      expect(mockInfo).toHaveBeenNthCalledWith(
        1,
        `Getting secret: ${secretName}`
      )
      expect(mockInfo).toHaveBeenNthCalledWith(
        2,
        `Successfully retrieved secret: ${secretName}`
      )
    })

    test('should handle Azure 404 errors', async () => {
      const secretName = 'missing-secret'
      const notFoundError = new Error('Secret not found')
      ;(notFoundError as any).statusCode = 404

      mockGetSecret.mockRejectedValue(notFoundError)

      await expect(store.getSecret(secretName)).rejects.toThrow(
        'Failed to get secret missing-secret: Secret not found'
      )
    })

    test('should handle network errors', async () => {
      const secretName = 'test-secret'
      const networkError = new Error('Network timeout')

      mockGetSecret.mockRejectedValue(networkError)

      await expect(store.getSecret(secretName)).rejects.toThrow(
        'Failed to get secret test-secret: Network timeout'
      )
    })

    test('should retrieve secrets with different names', async () => {
      const secretNames = [
        'secret-1',
        'SECRET-2',
        'my-api-key',
        'database-password',
        'azure-storage-key'
      ]

      mockGetSecret.mockResolvedValue({ value: 'test-value' } as any)

      for (const name of secretNames) {
        jest.clearAllMocks()
        await store.getSecret(name)

        expect(mockGetSecret).toHaveBeenCalledWith(name)
        expect(mockInfo).toHaveBeenCalledWith(`Getting secret: ${name}`)
      }
    })
  })

  describe('integration scenarios', () => {
    test('should handle setting and getting the same secret', async () => {
      const store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )
      const secretName = 'integration-secret'
      const secretValue = 'integration-value'
      const expectedSecretName = 'test-project-dev---integration-secret'

      mockSetSecret.mockResolvedValue({} as any)
      mockGetSecret.mockResolvedValue({ value: secretValue } as any)

      await store.setSecret(secretName, secretValue)
      const result = await store.getSecret(expectedSecretName)

      expect(result).toBe(secretValue)
      expect(mockSetSecret).toHaveBeenCalledWith(
        expectedSecretName,
        secretValue
      )
      expect(mockGetSecret).toHaveBeenCalledWith(expectedSecretName)
    })

    test('should handle multiple sequential operations', async () => {
      const store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      mockSetSecret.mockResolvedValue({} as any)
      mockGetSecret.mockResolvedValue({ value: 'value' } as any)

      await store.setSecret('secret-1', 'value-1')
      await store.setSecret('secret-2', 'value-2')
      await store.getSecret('test-project-dev---secret-1')
      await store.getSecret('test-project-dev---secret-2')

      expect(mockSetSecret).toHaveBeenCalledTimes(2)
      expect(mockGetSecret).toHaveBeenCalledTimes(2)
    })

    test('should maintain state across multiple operations', async () => {
      const store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecret('secret-1', 'value-1')
      await store.setSecret('secret-2', 'value-2')
      await store.setSecret('secret-3', 'value-3')

      expect(mockSetSecret).toHaveBeenCalledTimes(3)
      expect(mockSetSecret).toHaveBeenNthCalledWith(
        1,
        'test-project-dev---secret-1',
        'value-1'
      )
      expect(mockSetSecret).toHaveBeenNthCalledWith(
        2,
        'test-project-dev---secret-2',
        'value-2'
      )
      expect(mockSetSecret).toHaveBeenNthCalledWith(
        3,
        'test-project-dev---secret-3',
        'value-3'
      )
    })
  })

  describe('error handling edge cases', () => {
    let store: KeyVaultStore

    beforeEach(() => {
      store = new KeyVaultStore(
        testKeyVaultProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )
      jest.clearAllMocks()
    })

    test('should handle null secret values gracefully', async () => {
      mockGetSecret.mockResolvedValue({ value: null } as any)

      await expect(store.getSecret('test-secret')).rejects.toThrow(
        'Secret test-secret exists but has no value'
      )
    })

    test('should handle empty string secret names', async () => {
      // Empty string becomes "test-project---" which is valid (14 chars, alphanumeric+hyphen)
      mockSetSecret.mockResolvedValue({} as any)

      await store.setSecret('', 'value')

      expect(mockSetSecret).toHaveBeenCalledWith('test-project-dev---', 'value')
    })

    test('should handle Azure throttling errors', async () => {
      const throttleError = new Error('Too many requests')
      ;(throttleError as any).statusCode = 429

      mockSetSecret.mockRejectedValue(throttleError)

      await expect(store.setSecret('test-secret', 'value')).rejects.toThrow(
        'Failed to set secret test-secret: Too many requests'
      )
    })

    test('should handle Azure permission errors', async () => {
      const permissionError = new Error('Forbidden')
      ;(permissionError as any).statusCode = 403

      mockGetSecret.mockRejectedValue(permissionError)

      await expect(store.getSecret('test-secret')).rejects.toThrow(
        'Failed to get secret test-secret: Forbidden'
      )
    })
  })
})
