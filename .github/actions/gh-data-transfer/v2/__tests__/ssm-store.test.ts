import { describe, expect, test, jest, beforeEach } from '@jest/globals'

const mockInfo = jest.fn<(message: string) => void>()
const mockError = jest.fn<(message: string) => void>()
const mockSetSecret = jest.fn<(value: string) => void>()
const mockGetIDToken = jest.fn<(audience?: string) => Promise<string>>()
const mockSend = jest.fn<(command: unknown) => Promise<unknown>>()
const mockFromWebToken = jest.fn()
const mockFromNodeProviderChain = jest.fn()

jest.mock('@actions/core', () => ({
  info: mockInfo,
  error: mockError,
  setSecret: mockSetSecret,
  getIDToken: mockGetIDToken
}))

class PutParameterCommand {
  constructor(public input: Record<string, unknown>) {}
}
class GetParameterCommand {
  constructor(public input: Record<string, unknown>) {}
}
class DescribeParametersCommand {
  constructor(public input: Record<string, unknown>) {}
}

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest
    .fn()
    .mockImplementation((config: unknown) => ({ config, send: mockSend })),
  PutParameterCommand,
  GetParameterCommand,
  DescribeParametersCommand,
  ParameterType: { STRING: 'String', SECURE_STRING: 'SecureString' }
}))

jest.mock('@aws-sdk/credential-providers', () => ({
  fromWebToken: mockFromWebToken,
  fromNodeProviderChain: mockFromNodeProviderChain
}))

import {
  SsmParameterStore,
  convertKey,
  normalizePrefix
} from '../src/ssm-store'
import { SSMClient } from '@aws-sdk/client-ssm'

const ENV = 'e2e-key-vault-cicd-store'
const PREFIX = '/example/cicd'
const REGION = 'eu-central-1'

/** Rejects every GetParameter so writes are never skipped as unchanged. */
function parameterNotFound(): void {
  mockSend.mockImplementation(async (command: unknown) => {
    if (command instanceof GetParameterCommand) {
      throw new Error('ParameterNotFound')
    }
    return {}
  })
}

function putInputs(): Record<string, unknown>[] {
  return mockSend.mock.calls
    .map(([command]) => command)
    .filter(
      (command): command is PutParameterCommand =>
        command instanceof PutParameterCommand
    )
    .map((command) => command.input)
}

function store(kmsKeyId?: string): SsmParameterStore {
  return new SsmParameterStore(
    ENV,
    PREFIX,
    { region: REGION, accessKeyId: 'AKIA', secretAccessKey: 'shh' },
    kmsKeyId
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSend.mockReset()
  parameterNotFound()
})

describe('key layout', () => {
  test('produces the flat Key Vault compatible name', () => {
    expect(convertKey('Stack_Id--Computed.Greeting', ENV)).toBe(
      `${ENV}---stack-id--computed-greeting`
    )
  })

  test('parameter name joins the SSM prefix with the flat key', () => {
    expect(store().parameterName('e2e-script-output--computed_greeting')).toBe(
      `${PREFIX}/${ENV}---e2e-script-output--computed-greeting`
    )
  })

  test.each([
    ['example/cicd', '/example/cicd'],
    ['/example/cicd/', '/example/cicd'],
    ['//example/cicd//', '/example/cicd']
  ])('normalizePrefix(%s) === %s', (input, expected) => {
    expect(normalizePrefix(input)).toBe(expected)
  })

  test('rejects an empty prefix', () => {
    expect(() => normalizePrefix('  /  ')).toThrow(/must not be empty/)
  })

  test('rejects a key producing an illegal parameter name', () => {
    expect(() => store().parameterName('bad key!')).toThrow(
      /Invalid parameter name/
    )
  })

  test('rejects a key exceeding the name length budget', () => {
    expect(() => store().parameterName('a'.repeat(1000))).toThrow(
      /must not exceed 947 characters/
    )
  })
})

describe('writes', () => {
  test('secrets are stored as SecureString parameters', async () => {
    await store().setSecrets({ COMPUTED_SECRET: 'rotated' })

    expect(putInputs()).toEqual([
      {
        Name: `${PREFIX}/${ENV}---computed-secret`,
        Value: 'rotated',
        Type: 'SecureString',
        Overwrite: true
      }
    ])
  })

  test('a customer managed KMS key is applied to every parameter', async () => {
    await store('alias/example-cicd').setSecrets({ A: 'a', B: 'b' })

    expect(putInputs()).toEqual([
      expect.objectContaining({ KeyId: 'alias/example-cicd' }),
      expect.objectContaining({ KeyId: 'alias/example-cicd' })
    ])
  })

  test('unchanged values are not rewritten', async () => {
    mockSend.mockImplementation(async (command: unknown) => {
      if (command instanceof GetParameterCommand) {
        return { Parameter: { Value: 'hello', Type: 'SecureString' } }
      }
      if (command instanceof DescribeParametersCommand) {
        return { Parameters: [{ KeyId: 'alias/aws/ssm' }] }
      }
      return {}
    })

    await store().setSecrets({ GREETING: 'hello', OTHER: 'changed' })

    expect(putInputs()).toEqual([
      expect.objectContaining({ Name: `${PREFIX}/${ENV}---other` })
    ])
  })

  function stored(type: string, keyId?: string): void {
    mockSend.mockImplementation(async (command: unknown) => {
      if (command instanceof GetParameterCommand) {
        return { Parameter: { Value: 'same', Type: type } }
      }
      if (command instanceof DescribeParametersCommand) {
        return { Parameters: [{ KeyId: keyId }] }
      }
      return {}
    })
  }

  test('a stored plaintext String is not skipped, so AWS rejects the type change', async () => {
    mockSend.mockImplementation(async (command: unknown) => {
      if (command instanceof GetParameterCommand) {
        return { Parameter: { Value: 'same', Type: 'String' } }
      }
      throw new Error('HierarchyTypeMismatchException')
    })

    await expect(store().setSecrets({ TOKEN: 'same' })).rejects.toThrow(
      /Failed to set parameter TOKEN: HierarchyTypeMismatchException/
    )
  })

  test('a secret encrypted with another KMS key is rewritten', async () => {
    stored('SecureString', 'alias/old')

    await store('alias/new').setSecrets({ TOKEN: 'same' })

    expect(putInputs()).toEqual([
      expect.objectContaining({ KeyId: 'alias/new' })
    ])
  })

  test('a secret with the same value, type and KMS key is skipped', async () => {
    stored('SecureString', 'alias/new')

    await store('alias/new').setSecrets({ TOKEN: 'same' })

    expect(putInputs()).toHaveLength(0)
  })

  test('the AWS managed key is assumed when no KMS key is configured', async () => {
    stored('SecureString', 'alias/aws/ssm')

    await store().setSecrets({ TOKEN: 'same' })

    expect(putInputs()).toHaveLength(0)
  })

  test('an unreadable parameter is still written', async () => {
    mockSend.mockImplementation(async (command: unknown) => {
      if (command instanceof GetParameterCommand) {
        throw new Error('AccessDeniedException')
      }
      return {}
    })

    await store().setSecrets({ GREETING: 'hello' })

    expect(putInputs()).toHaveLength(1)
  })

  test('nothing is sent for an empty payload', async () => {
    await store().setSecrets({})

    expect(mockSend).not.toHaveBeenCalled()
  })

  test('an oversized value is rejected before any write', async () => {
    await expect(
      store().setSecrets({ SMALL: 'a', BIG: 'x'.repeat(4097) })
    ).rejects.toThrow(/exceeding the 4096 byte standard tier limit/)

    expect(putInputs()).toHaveLength(0)
  })

  test('an invalid key is rejected before any write', async () => {
    await expect(store().setSecrets({ 'bad key!': 'a' })).rejects.toThrow(
      /Invalid parameter name/
    )

    expect(putInputs()).toHaveLength(0)
  })

  test('a failed write surfaces the key and the cause', async () => {
    mockSend.mockImplementation(async (command: unknown) => {
      if (command instanceof GetParameterCommand) {
        throw new Error('ParameterNotFound')
      }
      throw new Error('ThrottlingException')
    })

    await expect(store().setSecrets({ GREETING: 'hello' })).rejects.toThrow(
      /Failed to set parameter GREETING: ThrottlingException/
    )
  })
})

describe('reads', () => {
  test('masks and returns the decrypted value', async () => {
    mockSend.mockImplementation(async () => ({
      Parameter: { Value: 'rotated' }
    }))

    await expect(store().getSecret('COMPUTED_SECRET')).resolves.toBe('rotated')
    expect(mockSetSecret).toHaveBeenCalledWith('rotated')
  })

  test('a valueless parameter is an error', async () => {
    mockSend.mockImplementation(async () => ({ Parameter: {} }))

    await expect(store().getSecret('COMPUTED_SECRET')).rejects.toThrow(
      /exists but has no value/
    )
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
    await config.credentials()

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
    new SsmParameterStore(ENV, PREFIX, { region: REGION })

    expect(mockFromNodeProviderChain).toHaveBeenCalled()
  })

  test('a missing region is rejected', () => {
    expect(() => new SsmParameterStore(ENV, PREFIX, { region: '' })).toThrow(
      /AWS region is required/
    )
  })
})
