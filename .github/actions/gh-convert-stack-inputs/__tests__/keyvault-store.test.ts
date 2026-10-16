import { jest } from '@jest/globals'
import type { ServicePrincipalCredentials } from '../src/keyvault-store.js'

// Create mocks before importing modules
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetSecret = jest.fn<any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSecretClient = jest.fn<any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClientSecretCredential = jest.fn<any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClientAssertionCredential = jest.fn<any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDefaultAzureCredential = jest.fn<any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCoreInfo = jest.fn<any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCoreError = jest.fn<any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCoreSetSecret = jest.fn<any>()

// Mock implementations
mockSecretClient.mockImplementation(() => ({
  getSecret: mockGetSecret
}))

// Mock modules before import
jest.unstable_mockModule('@azure/keyvault-secrets', () => ({
  SecretClient: mockSecretClient
}))

jest.unstable_mockModule('@azure/identity', () => ({
  ClientSecretCredential: mockClientSecretCredential,
  ClientAssertionCredential: mockClientAssertionCredential,
  DefaultAzureCredential: mockDefaultAzureCredential
}))

jest.unstable_mockModule('@actions/core', () => ({
  info: mockCoreInfo,
  error: mockCoreError,
  setSecret: mockCoreSetSecret
}))

// Import after mocking
const { KeyVaultStore } = await import('../src/keyvault-store.js')

describe('KeyVaultStore', () => {
  const testKeyVaultUrl = 'https://test-vault.vault.azure.net/'
  const testProjectPrefix = 'myproject'
  const testCredentials: ServicePrincipalCredentials = {
    tenantId: 'test-tenant-id',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret'
  }

  beforeEach(() => {
    jest.clearAllMocks()
    // Reset NODE_ENV before each test
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create KeyVaultStore with service principal credentials', () => {
      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(mockClientSecretCredential).toHaveBeenCalledWith(
        testCredentials.tenantId,
        testCredentials.clientId,
        testCredentials.clientSecret
      )
      expect(mockSecretClient).toHaveBeenCalledWith(
        testKeyVaultUrl,
        expect.any(Object)
      )
      expect(mockCoreInfo).toHaveBeenCalledWith(
        `KeyVaultStore initialized for vault: ${testKeyVaultUrl}`
      )
    })

    it('should create KeyVaultStore with DefaultAzureCredential when credentials are not provided and NODE_ENV is dev', () => {
      process.env.NODE_ENV = 'dev'

      const store = new KeyVaultStore(testProjectPrefix, testKeyVaultUrl)

      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(mockDefaultAzureCredential).toHaveBeenCalled()
      expect(mockClientSecretCredential).not.toHaveBeenCalled()
      expect(mockSecretClient).toHaveBeenCalledWith(
        testKeyVaultUrl,
        expect.any(Object)
      )
    })

    it('should throw error when credentials are not provided and NODE_ENV is not dev', () => {
      process.env.NODE_ENV = 'production'

      expect(() => {
        new KeyVaultStore(testProjectPrefix, testKeyVaultUrl)
      }).toThrow(
        'Service principal credentials are required when NODE_ENV is not "dev"'
      )
    })

    it('should throw error when credentials are not provided and NODE_ENV is undefined', () => {
      delete process.env.NODE_ENV

      expect(() => {
        new KeyVaultStore(testProjectPrefix, testKeyVaultUrl)
      }).toThrow(
        'Service principal credentials are required when NODE_ENV is not "dev"'
      )
    })

    it('should use DefaultAzureCredential when credentials object is provided but clientSecret is empty', () => {
      const credentialsWithoutSecret = {
        tenantId: 'test-tenant-id',
        clientId: 'test-client-id',
        clientSecret: ''
      }

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        credentialsWithoutSecret
      )

      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(mockDefaultAzureCredential).toHaveBeenCalled()
      expect(mockClientSecretCredential).not.toHaveBeenCalled()
      expect(mockClientAssertionCredential).not.toHaveBeenCalled()
    })

    it('should use ClientAssertionCredential when oidcEnabled is true and credentials have clientId and tenantId', () => {
      const credentialsWithoutSecret = {
        tenantId: 'test-tenant-id',
        clientId: 'test-client-id',
        clientSecret: ''
      }

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        credentialsWithoutSecret,
        true
      )

      expect(store).toBeInstanceOf(KeyVaultStore)
      expect(mockClientAssertionCredential).toHaveBeenCalledWith(
        credentialsWithoutSecret.tenantId,
        credentialsWithoutSecret.clientId,
        expect.any(Function)
      )
      expect(mockClientSecretCredential).not.toHaveBeenCalled()
      expect(mockDefaultAzureCredential).not.toHaveBeenCalled()
    })
  })

  describe('getSecret', () => {
    it('should retrieve a secret successfully with proper key conversion', async () => {
      const secretValue = 'my-secret-value'
      mockGetSecret.mockResolvedValue({ value: secretValue })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      const result = await store.getSecret('MY_SECRET_KEY')

      // Key should be converted: lowercase, underscores to hyphens, with prefix
      const expectedKey = 'myproject---my-secret-key'
      expect(mockGetSecret).toHaveBeenCalledWith(expectedKey)
      expect(result).toBe(secretValue)
      expect(mockCoreInfo).toHaveBeenCalledWith(
        `Getting secret: ${expectedKey}`
      )
      expect(mockCoreInfo).toHaveBeenCalledWith(
        `Successfully retrieved secret: ${expectedKey}`
      )
      expect(mockCoreSetSecret).toHaveBeenCalledWith(secretValue)
    })

    it('should mask secret values using core.setSecret', async () => {
      const secretValue = 'super-secret-password-123'
      mockGetSecret.mockResolvedValue({ value: secretValue })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      await store.getSecret('PASSWORD')

      // Verify that setSecret was called with the actual secret value
      expect(mockCoreSetSecret).toHaveBeenCalledWith(secretValue)
      expect(mockCoreSetSecret).toHaveBeenCalledTimes(1)
    })

    it('should not call core.setSecret for empty string values because validation fails first', async () => {
      mockGetSecret.mockResolvedValue({ value: '' })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      const secretKey = 'EMPTY_SECRET'

      // This will throw before setSecret is called
      await expect(store.getSecret(secretKey)).rejects.toThrow()

      // setSecret should NOT be called because validation fails first
      expect(mockCoreSetSecret).not.toHaveBeenCalled()
    })

    it('should not call core.setSecret when secret value is undefined', async () => {
      mockGetSecret.mockResolvedValue({ value: undefined })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      await expect(store.getSecret('UNDEFINED_SECRET')).rejects.toThrow()

      // setSecret should not be called when value is undefined
      expect(mockCoreSetSecret).not.toHaveBeenCalled()
    })

    it('should not call core.setSecret when secret retrieval fails', async () => {
      mockGetSecret.mockRejectedValue(new Error('Network error'))

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      await expect(store.getSecret('FAILING_SECRET')).rejects.toThrow()

      // setSecret should not be called when getSecret fails
      expect(mockCoreSetSecret).not.toHaveBeenCalled()
    })

    it('should convert dots to hyphens in key names', async () => {
      const secretValue = 'dotted-secret-value'
      mockGetSecret.mockResolvedValue({ value: secretValue })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      const result = await store.getSecret('my.dotted.key')

      // Dots should be converted to hyphens
      const expectedKey = 'myproject---my-dotted-key'
      expect(mockGetSecret).toHaveBeenCalledWith(expectedKey)
      expect(result).toBe(secretValue)
      expect(mockCoreSetSecret).toHaveBeenCalledWith(secretValue)
    })

    it('should handle mixed underscores and dots in key names', async () => {
      const secretValue = 'mixed-secret-value'
      mockGetSecret.mockResolvedValue({ value: secretValue })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      const result = await store.getSecret('My_Mixed.Key_Name')

      // Should convert to lowercase and replace both underscores and dots with hyphens
      const expectedKey = 'myproject---my-mixed-key-name'
      expect(mockGetSecret).toHaveBeenCalledWith(expectedKey)
      expect(result).toBe(secretValue)
      expect(mockCoreSetSecret).toHaveBeenCalledWith(secretValue)
    })

    it('should throw error when secret exists but has no value', async () => {
      mockGetSecret.mockResolvedValue({ value: undefined })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      const secretKey = 'EMPTY_SECRET'
      const expectedConvertedKey = 'myproject---empty-secret'

      await expect(store.getSecret(secretKey)).rejects.toThrow(
        `Failed to get secret ${secretKey}: Secret ${expectedConvertedKey} exists but has no value`
      )

      expect(mockCoreError).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to get secret ${secretKey}`)
      )
      expect(mockCoreSetSecret).not.toHaveBeenCalled()
    })

    it('should throw error when secret retrieval fails', async () => {
      const errorMessage = 'Secret not found'
      mockGetSecret.mockRejectedValue(new Error(errorMessage))

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      const secretKey = 'NONEXISTENT_SECRET'

      await expect(store.getSecret(secretKey)).rejects.toThrow(
        `Failed to get secret ${secretKey}: ${errorMessage}`
      )

      expect(mockCoreError).toHaveBeenCalledWith(
        `Failed to get secret ${secretKey}: ${errorMessage}`
      )
      expect(mockCoreSetSecret).not.toHaveBeenCalled()
    })

    it('should handle non-Error exceptions', async () => {
      const errorMessage = 'Unknown error occurred'
      mockGetSecret.mockRejectedValue(errorMessage)

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      const secretKey = 'FAILING_SECRET'

      await expect(store.getSecret(secretKey)).rejects.toThrow(
        `Failed to get secret ${secretKey}: ${errorMessage}`
      )
      expect(mockCoreSetSecret).not.toHaveBeenCalled()
    })

    it('should work with different project prefixes', async () => {
      const secretValue = 'prefixed-secret'
      mockGetSecret.mockResolvedValue({ value: secretValue })

      const customPrefix = 'custom-project'
      const store = new KeyVaultStore(
        customPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      await store.getSecret('test_key')

      const expectedKey = 'custom-project---test-key'
      expect(mockGetSecret).toHaveBeenCalledWith(expectedKey)
      expect(mockCoreSetSecret).toHaveBeenCalledWith(secretValue)
    })

    it('should handle secrets with only lowercase and hyphens', async () => {
      const secretValue = 'already-formatted'
      mockGetSecret.mockResolvedValue({ value: secretValue })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      await store.getSecret('already-formatted-key')

      const expectedKey = 'myproject---already-formatted-key'
      expect(mockGetSecret).toHaveBeenCalledWith(expectedKey)
      expect(mockCoreSetSecret).toHaveBeenCalledWith(secretValue)
    })

    it('should handle empty secret values (empty string) as invalid', async () => {
      mockGetSecret.mockResolvedValue({ value: '' })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      const secretKey = 'EMPTY_STRING_SECRET'
      const expectedConvertedKey = 'myproject---empty-string-secret'

      // Empty string should be treated as having no value
      await expect(store.getSecret(secretKey)).rejects.toThrow(
        `Failed to get secret ${secretKey}: Secret ${expectedConvertedKey} exists but has no value`
      )
      // setSecret is NOT called because validation fails before it
      expect(mockCoreSetSecret).not.toHaveBeenCalled()
    })
  })

  describe('Key conversion edge cases', () => {
    it('should handle keys with consecutive special characters', async () => {
      const secretValue = 'special-chars-value'
      mockGetSecret.mockResolvedValue({ value: secretValue })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      await store.getSecret('key__with..consecutive___special....chars')

      // Multiple consecutive underscores/dots should all become hyphens
      const expectedKey =
        'myproject---key--with--consecutive---special----chars'
      expect(mockGetSecret).toHaveBeenCalledWith(expectedKey)
      expect(mockCoreSetSecret).toHaveBeenCalledWith(secretValue)
    })

    it('should handle keys starting or ending with special characters', async () => {
      const secretValue = 'edge-case-value'
      mockGetSecret.mockResolvedValue({ value: secretValue })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      await store.getSecret('_start.middle_end.')

      const expectedKey = 'myproject----start-middle-end-'
      expect(mockGetSecret).toHaveBeenCalledWith(expectedKey)
      expect(mockCoreSetSecret).toHaveBeenCalledWith(secretValue)
    })

    it('should handle numeric keys', async () => {
      const secretValue = 'numeric-value'
      mockGetSecret.mockResolvedValue({ value: secretValue })

      const store = new KeyVaultStore(
        testProjectPrefix,
        testKeyVaultUrl,
        testCredentials
      )

      await store.getSecret('123_456.789')

      const expectedKey = 'myproject---123-456-789'
      expect(mockGetSecret).toHaveBeenCalledWith(expectedKey)
      expect(mockCoreSetSecret).toHaveBeenCalledWith(secretValue)
    })
  })
})
