import { describe, expect, test, jest, beforeEach } from '@jest/globals'
import type { SsmParameterStore as Store } from '../src/ssm-store.js'

const mockInfo = jest.fn<(message: string) => void>()
const mockError = jest.fn<(message: string) => void>()
const mockSetSecret = jest.fn<(value: string) => void>()
const mockGetIDToken = jest.fn<(audience?: string) => Promise<string>>()
const mockSend = jest.fn<(command: unknown) => Promise<unknown>>()
const mockFromWebToken = jest.fn()
const mockFromNodeProviderChain = jest.fn()

jest.unstable_mockModule('@actions/core', () => ({
  info: mockInfo,
  error: mockError,
  setSecret: mockSetSecret,
  getIDToken: mockGetIDToken
}))

class GetParameterCommand {
  constructor(public input: Record<string, unknown>) {}
}

jest.unstable_mockModule('@aws-sdk/client-ssm', () => ({
  SSMClient: jest
    .fn()
    .mockImplementation((config: unknown) => ({ config, send: mockSend })),
  GetParameterCommand
}))

jest.unstable_mockModule('@aws-sdk/credential-providers', () => ({
  fromWebToken: mockFromWebToken,
  fromNodeProviderChain: mockFromNodeProviderChain
}))

// Dynamic import: ESM mocks must be registered before these modules load,
// static imports are hoisted above unstable_mockModule.
const { SsmParameterStore, normalizePrefix } =
  await import('../src/ssm-store.js')
const { SSMClient } = await import('@aws-sdk/client-ssm')

const ENV = 'e2e-key-vault-cicd-store'
const PREFIX = '/example/cicd'
const REGION = 'eu-central-1'

function store(): Store {
  return new SsmParameterStore(ENV, PREFIX, {
    region: REGION,
    accessKeyId: 'AKIA',
    secretAccessKey: 'shh'
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSend.mockReset()
})

describe('key layout', () => {
  test.each([
    ['dns__database_password', `${ENV}---dns--database-password`],
    ['stack.DNS.var_x', `${ENV}---stack-dns-var-x`]
  ])('%s maps to the flat Key Vault key %s', (key, flatKey) => {
    expect(store().parameterName(key)).toBe(`${PREFIX}/${flatKey}`)
  })

  test.each([
    ['example/cicd', '/example/cicd'],
    ['/example/cicd/', '/example/cicd']
  ])('normalizePrefix(%s) === %s', (input, expected) => {
    expect(normalizePrefix(input)).toBe(expected)
  })

  test('rejects an empty prefix', () => {
    expect(() => normalizePrefix(' / ')).toThrow(/must not be empty/)
  })

  test('exposes the keystore label used in resolution logs', () => {
    expect(store().storeLabel).toBe('SSM')
  })
})

describe('reads', () => {
  test('requests decryption, masks the value and returns it', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: 'kv_secret_password' } })

    await expect(store().getSecret('dns__database_password')).resolves.toBe(
      'kv_secret_password'
    )

    const command = mockSend.mock.calls[0][0] as GetParameterCommand
    expect(command.input).toEqual({
      Name: `${PREFIX}/${ENV}---dns--database-password`,
      WithDecryption: true
    })
    expect(mockSetSecret).toHaveBeenCalledWith('kv_secret_password')
  })

  test('a missing parameter is reported with the SDK error code', async () => {
    // SSM sends no message for ParameterNotFound; the SDK puts the code in name.
    mockSend.mockRejectedValue(
      Object.assign(new Error('UnknownError'), { name: 'ParameterNotFound' })
    )

    await expect(store().getSecret('dns__missing')).rejects.toThrow(
      'Failed to get parameter dns__missing: ParameterNotFound: UnknownError'
    )
  })

  test('a valueless parameter is an error', async () => {
    mockSend.mockResolvedValue({ Parameter: {} })

    await expect(store().getSecret('dns__empty')).rejects.toThrow(
      /exists but has no value/
    )
  })

  test('an illegal key never reaches the API', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: 'x' } })

    await expect(store().getSecret('bad key!')).rejects.toThrow(
      /Invalid parameter name/
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('an overlong key never reaches the API', async () => {
    await expect(store().getSecret('a'.repeat(1000))).rejects.toThrow(
      /must not exceed 947 characters/
    )
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('authentication', () => {
  test('static keys take precedence and carry the session token', async () => {
    new SsmParameterStore(ENV, PREFIX, {
      region: REGION,
      roleArn: 'arn:aws:iam::123456789012:role/ignored',
      accessKeyId: 'AKIA',
      secretAccessKey: 'shh',
      sessionToken: 'tok'
    })

    const config = jest.mocked(SSMClient).mock.calls[0][0] as {
      credentials: () => Promise<unknown>
    }
    await expect(config.credentials()).resolves.toEqual({
      accessKeyId: 'AKIA',
      secretAccessKey: 'shh',
      sessionToken: 'tok'
    })
    expect(mockFromWebToken).not.toHaveBeenCalled()
  })

  test('a role arn federates the GitHub OIDC token to STS', async () => {
    mockGetIDToken.mockResolvedValue('oidc-token')
    mockFromWebToken.mockReturnValue(async () => ({ accessKeyId: 'ASIA' }))

    new SsmParameterStore(ENV, PREFIX, {
      region: REGION,
      roleArn: 'arn:aws:iam::123456789012:role/keystore'
    })

    const config = jest.mocked(SSMClient).mock.calls[0][0] as {
      credentials: () => Promise<unknown>
    }
    await expect(config.credentials()).resolves.toEqual({ accessKeyId: 'ASIA' })

    expect(mockGetIDToken).toHaveBeenCalledWith('sts.amazonaws.com')
    expect(mockFromWebToken).toHaveBeenCalledWith(
      expect.objectContaining({
        roleArn: 'arn:aws:iam::123456789012:role/keystore',
        webIdentityToken: 'oidc-token',
        clientConfig: { region: REGION }
      })
    )
  })

  test('falls back to the ambient provider chain', () => {
    const ambient = async () => ({ accessKeyId: 'AMBIENT' })
    mockFromNodeProviderChain.mockReturnValue(ambient)

    new SsmParameterStore(ENV, PREFIX, { region: REGION })

    const config = jest.mocked(SSMClient).mock.calls[0][0] as {
      credentials: unknown
    }
    expect(config.credentials).toBe(ambient)
  })

  test('a missing region is rejected', () => {
    expect(() => new SsmParameterStore(ENV, PREFIX, { region: '' })).toThrow(
      /AWS region is required/
    )
  })
})
