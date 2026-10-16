import { describe, expect, test, jest, beforeEach } from '@jest/globals'

// Set up environment variables before any imports
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo'

// Create mocks before importing modules
const mockGetInput = jest.fn<(name: string, options?: any) => string>()
const mockSetFailed = jest.fn<(message: string) => void>()
const mockInfo = jest.fn<(message: string) => void>()
const mockDebug = jest.fn<(message: string) => void>()
const mockExistsSync = jest.fn<(path: any) => boolean>()
const mockReadFileSync = jest.fn<(path: any) => Buffer>()
const mockWriteSecrets = jest.fn<() => Promise<void>>()
const mockWriteVariables = jest.fn<() => Promise<void>>()

// Mock modules
jest.mock('@actions/core', () => ({
  getInput: mockGetInput,
  setFailed: mockSetFailed,
  info: mockInfo,
  debug: mockDebug
}))

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync
}))

jest.mock('../src/gh-secrets.js', () => ({
  write_secrets_to_gh_env: mockWriteSecrets
}))

jest.mock('../src/gh-variables.js', () => ({
  write_variables_to_gh_env: mockWriteVariables
}))

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({}))
}))

jest.mock('../src/keyvault-store.js', () => ({
  KeyVaultStore: jest.fn().mockImplementation(() => ({
    setSecret: jest.fn(),
    setSecrets: jest.fn(),
    getSecret: jest.fn()
  }))
}))

const mockSetSsmSecrets = jest.fn<() => Promise<void>>()
const mockSsmParameterStore = jest.fn()

jest.mock('../src/ssm-store.js', () => ({
  SsmParameterStore: mockSsmParameterStore.mockImplementation(() => ({
    setSecrets: mockSetSsmSecrets,
    getSecret: jest.fn()
  }))
}))

// Now import the module to test
import { run } from '../src/main.js'

describe('run', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default mock implementations
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{}',
        variables: '{}',
        secretsFile: '',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })
    mockExistsSync.mockReturnValue(false)
    mockWriteSecrets.mockResolvedValue(undefined)
    mockWriteVariables.mockResolvedValue(undefined)
  })

  test('should fail when neither GitHub token nor KeyVault credentials are provided', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'github-token') return ''
      return ''
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      'GitHub Token, SSM Parameter Prefix or KeyVault Url and Credentials (url + client-id + tenant-id) is required'
    )
  })

  test('should succeed with KeyVault OIDC (no client-secret, only url + client-id + tenant-id)', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': '',
        'key-vault-url': 'https://test-vault.vault.azure.net/',
        'key-vault-sp-client-id': 'test-client-id',
        'key-vault-sp-client-secret': '',
        'key-vault-sp-tenant-id': 'test-tenant-id',
        secrets: '{}',
        variables: '{}',
        secretsFile: '',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    await run()

    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  test('should fail with KeyVault when client-id is missing', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': '',
        'key-vault-url': 'https://test-vault.vault.azure.net/',
        'key-vault-sp-client-id': '',
        'key-vault-sp-client-secret': '',
        'key-vault-sp-tenant-id': 'test-tenant-id',
        secrets: '{}',
        variables: '{}',
        secretsFile: '',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      'GitHub Token, SSM Parameter Prefix or KeyVault Url and Credentials (url + client-id + tenant-id) is required'
    )
  })

  test('should successfully process secrets and variables from JSON input', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{"SECRET_KEY":"secret_value"}',
        variables: '{"VAR_KEY":"var_value"}',
        secretsFile: '',
        variablesFile: '',
        'environment-name': 'production'
      }
      return inputs[name] || ''
    })

    await run()

    expect(mockInfo).toHaveBeenCalledWith('Starting action')
    expect(mockInfo).toHaveBeenCalledWith('Using Environment: production')
    expect(mockInfo).toHaveBeenCalledWith('Exporting Secret: SECRET_KEY')
    expect(mockInfo).toHaveBeenCalledWith('Exporting Variable: VAR_KEY')
    expect(mockWriteSecrets).toHaveBeenCalledWith(
      expect.anything(),
      'production',
      { SECRET_KEY: 'secret_value' }
    )
    expect(mockWriteVariables).toHaveBeenCalledWith(
      expect.anything(),
      'production',
      { VAR_KEY: 'var_value' }
    )
  })

  test('should throw error for invalid secrets JSON', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: 'invalid-json',
        variables: '{}',
        secretsFile: '',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse JSON secrets')
    )
  })

  test('should throw error for invalid variables JSON', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{}',
        variables: 'invalid-json',
        secretsFile: '',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse JSON variables')
    )
  })

  test('should read and parse secrets from file', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{}',
        variables: '{}',
        secretsFile: '/path/to/secrets.txt',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    mockExistsSync.mockImplementation((path) => {
      return path === '/path/to/secrets.txt'
    })

    mockReadFileSync.mockImplementation((path) => {
      if (path === '/path/to/secrets.txt') {
        return Buffer.from('SECRET1=value1\nSECRET2="value2"')
      }
      return Buffer.from('')
    })

    await run()

    expect(mockInfo).toHaveBeenCalledWith('Exporting Secret: SECRET1')
    expect(mockInfo).toHaveBeenCalledWith('Exporting Secret: SECRET2')
    expect(mockWriteSecrets).toHaveBeenCalledWith(
      expect.anything(),
      'test-env',
      { SECRET1: 'value1', SECRET2: 'value2' }
    )
  })

  test('should read and parse variables from file', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{}',
        variables: '{}',
        secretsFile: '',
        variablesFile: '/path/to/variables.txt',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    mockExistsSync.mockImplementation((path) => {
      return path === '/path/to/variables.txt'
    })

    mockReadFileSync.mockImplementation((path) => {
      if (path === '/path/to/variables.txt') {
        return Buffer.from('VAR1=value1\nVAR2="value2"')
      }
      return Buffer.from('')
    })

    await run()

    expect(mockInfo).toHaveBeenCalledWith('Exporting Variable: VAR1')
    expect(mockInfo).toHaveBeenCalledWith('Exporting Variable: VAR2')
    expect(mockWriteVariables).toHaveBeenCalledWith(
      expect.anything(),
      'test-env',
      { VAR1: 'value1', VAR2: 'value2' }
    )
  })

  test('should merge file and JSON inputs with file taking precedence', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{"SECRET1":"json_value"}',
        variables: '{"VAR1":"json_value"}',
        secretsFile: '/path/to/secrets.txt',
        variablesFile: '/path/to/variables.txt',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    mockExistsSync.mockReturnValue(true)

    mockReadFileSync.mockImplementation((path) => {
      if (path === '/path/to/secrets.txt') {
        return Buffer.from('SECRET1=file_value\nSECRET2=file_secret')
      }
      if (path === '/path/to/variables.txt') {
        return Buffer.from('VAR1=file_value\nVAR2=file_var')
      }
      return Buffer.from('')
    })

    await run()

    // File values should override JSON values
    expect(mockWriteSecrets).toHaveBeenCalledWith(
      expect.anything(),
      'test-env',
      { SECRET1: 'file_value', SECRET2: 'file_secret' }
    )
    expect(mockWriteVariables).toHaveBeenCalledWith(
      expect.anything(),
      'test-env',
      { VAR1: 'file_value', VAR2: 'file_var' }
    )
  })

  test('should handle malformed secrets file', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{}',
        variables: '{}',
        secretsFile: '/path/to/bad-secrets.txt',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    mockExistsSync.mockImplementation((path) => {
      return path === '/path/to/bad-secrets.txt'
    })

    mockReadFileSync.mockImplementation(() => {
      throw new Error('File read error')
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse Secrets File')
    )
  })

  test('should handle malformed variables file', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{}',
        variables: '{}',
        secretsFile: '',
        variablesFile: '/path/to/bad-variables.txt',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    mockExistsSync.mockImplementation((path) => {
      return path === '/path/to/bad-variables.txt'
    })

    mockReadFileSync.mockImplementation(() => {
      throw new Error('File read error')
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse Secrets File')
    )
  })

  test('should convert all values to strings', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{"NUM_SECRET":123,"BOOL_SECRET":true}',
        variables: '{"NUM_VAR":456,"BOOL_VAR":false}',
        secretsFile: '',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    await run()

    expect(mockWriteSecrets).toHaveBeenCalledWith(
      expect.anything(),
      'test-env',
      { NUM_SECRET: '123', BOOL_SECRET: 'true' }
    )
    expect(mockWriteVariables).toHaveBeenCalledWith(
      expect.anything(),
      'test-env',
      { NUM_VAR: '456', BOOL_VAR: 'false' }
    )
  })

  test('should handle empty secrets and variables', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{}',
        variables: '{}',
        secretsFile: '',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    await run()

    expect(mockWriteSecrets).toHaveBeenCalledWith(
      expect.anything(),
      'test-env',
      {}
    )
    expect(mockWriteVariables).toHaveBeenCalledWith(
      expect.anything(),
      'test-env',
      {}
    )
  })

  test('should handle file with quotes around values', async () => {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'test-token',
        secrets: '{}',
        variables: '{}',
        secretsFile: '/path/to/secrets.txt',
        variablesFile: '',
        'environment-name': 'test-env'
      }
      return inputs[name] || ''
    })

    mockExistsSync.mockImplementation((path) => {
      return path === '/path/to/secrets.txt'
    })

    mockReadFileSync.mockImplementation((path) => {
      if (path === '/path/to/secrets.txt') {
        return Buffer.from('"KEY1"="value1"\n"KEY2"="value2"')
      }
      return Buffer.from('')
    })

    await run()

    expect(mockWriteSecrets).toHaveBeenCalledWith(
      expect.anything(),
      'test-env',
      { KEY1: 'value1', KEY2: 'value2' }
    )
  })

  describe('SSM Parameter Store sink', () => {
    const ssmInputs: Record<string, string> = {
      'github-token': '',
      secrets: '{"DB_PASSWORD":"pw"}',
      variables: '{"GREETING":"hello"}',
      secretsFile: '',
      variablesFile: '',
      'environment-name': 'test-env',
      'ssm-parameter-prefix': '/example/cicd',
      'aws-region': 'eu-central-1',
      'aws-role-arn': 'arn:aws:iam::123456789012:role/keystore'
    }

    beforeEach(() => {
      mockGetInput.mockImplementation((name: string) => ssmInputs[name] || '')
    })

    test('an SSM prefix alone satisfies the backend requirement', async () => {
      await run()

      expect(mockSetFailed).not.toHaveBeenCalled()
    })

    test('variables and secrets are written together as SecureString parameters', async () => {
      await run()

      expect(mockSetSsmSecrets).toHaveBeenCalledWith({
        DB_PASSWORD: 'pw',
        GREETING: 'hello'
      })
    })

    test('the store receives the environment prefix and AWS credentials', async () => {
      await run()

      expect(mockSsmParameterStore).toHaveBeenCalledWith(
        'test-env',
        '/example/cicd',
        expect.objectContaining({
          region: 'eu-central-1',
          roleArn: 'arn:aws:iam::123456789012:role/keystore'
        }),
        undefined
      )
    })

    test('no SSM prefix leaves the store untouched', async () => {
      mockGetInput.mockImplementation(
        (name: string) =>
          ({ ...ssmInputs, 'ssm-parameter-prefix': '', 'github-token': 'tok' })[
            name
          ] || ''
      )

      await run()

      expect(mockSsmParameterStore).not.toHaveBeenCalled()
    })
  })
})
