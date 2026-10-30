import { jest, describe, expect, test } from '@jest/globals'
import { resolveCredentials, type ResolverInputs } from '../src/resolver.js'
import { KeyVaultReadError } from '../../gh-convert-stack-inputs/src/keyvault-store.js'

function fixture(overrides: Partial<ResolverInputs> = {}) {
  const inputs: ResolverInputs = {
    required: 'AWS_ACCESS_KEY_ID,HCLOUD_TOKEN',
    credentials: JSON.stringify({
      AWS_ACCESS_KEY_ID: 'gh.secret.wasabi_id',
      HCLOUD_TOKEN: 'secret_backend.secret.hcloud_token'
    }),
    secretBackend: 'vault',
    environment: 'Prod_01',
    ghSecrets: JSON.stringify({
      WASABI_ID: 'github-id',
      HCLOUD_TOKEN: 'not-vault-value'
    }),
    keyVaultUrl: 'https://test.vault.azure.net/',
    keyVaultSpClientId: 'arm-client',
    keyVaultSpClientSecret: 'arm-secret',
    keyVaultSpTenantId: 'arm-tenant',
    oidcEnabled: 'false',
    keystoreSpClientId: '',
    keystoreSpClientSecret: '',
    keystoreSpTenantId: '',
    keystoreOidcEnabled: 'false',
    ...overrides
  }
  const events: string[] = []
  const exports: Record<string, string> = {}
  const outputs: Record<string, string> = {}
  const actionCore = {
    setSecret: (value: string) => {
      events.push(`mask:${value}`)
    },
    exportVariable: (name: string, value: string) => {
      events.push(`export:${name}:${value}`)
      exports[name] = value
    },
    setOutput: (name: string, value: string) => {
      outputs[name] = value
    }
  }
  const getSecret = jest.fn(async (_key: string) => 'vault-token')
  const createVault = jest.fn(
    (
      _prefix: string,
      _url: string,
      _auth: {
        tenantId: string
        clientId: string
        clientSecret: string
      },
      _oidc: boolean
    ) => ({ getSecret })
  )
  const execute = () => resolveCredentials({ inputs, actionCore, createVault })
  return {
    inputs,
    actionCore,
    getSecret,
    createVault,
    exports,
    outputs,
    events,
    execute
  }
}

describe('mapped credential resolution', () => {
  test('uses GitHub and Key Vault per reference, masking before each export', async () => {
    const run = fixture()
    expect(await run.execute()).toEqual(['AWS_ACCESS_KEY_ID', 'HCLOUD_TOKEN'])
    expect(run.exports).toEqual({
      AWS_ACCESS_KEY_ID: 'github-id',
      HCLOUD_TOKEN: 'vault-token'
    })
    expect(run.events).toEqual([
      'mask:github-id',
      'export:AWS_ACCESS_KEY_ID:github-id',
      'mask:vault-token',
      'export:HCLOUD_TOKEN:vault-token'
    ])
    expect(run.outputs.resolved).toBe('["AWS_ACCESS_KEY_ID","HCLOUD_TOKEN"]')
    expect(run.createVault).toHaveBeenCalledWith(
      'Prod_01',
      'https://test.vault.azure.net/',
      {
        tenantId: 'arm-tenant',
        clientId: 'arm-client',
        clientSecret: 'arm-secret'
      },
      false
    )
    expect(run.getSecret).toHaveBeenCalledWith('hcloud_token')
  })

  test('gh.secret stays GitHub-only even under vault backend and normalizes key case', async () => {
    const run = fixture({
      required: 'HCLOUD_TOKEN',
      credentials: JSON.stringify({ HCLOUD_TOKEN: 'gh.secret.hcloud_token' }),
      ghSecrets: JSON.stringify({ hcloud_token: 'github-token' }),
      keyVaultUrl: ''
    })
    await run.execute()
    expect(run.exports.HCLOUD_TOKEN).toBe('github-token')
    expect(run.createVault).not.toHaveBeenCalled()
  })

  test('secret_backend.secret uses GitHub only when effective backend is gh', async () => {
    const run = fixture({
      required: 'HCLOUD_TOKEN',
      secretBackend: 'gh',
      keyVaultUrl: ''
    })
    await run.execute()
    expect(run.exports.HCLOUD_TOKEN).toBe('not-vault-value')
    expect(run.createVault).not.toHaveBeenCalled()
  })

  test('unmapped names and unused vault mappings never cause vault access or overwrite env', async () => {
    const run = fixture({ required: 'AWS_ACCESS_KEY_ID,INFRACOST_API_KEY' })
    run.exports.INFRACOST_API_KEY = 'legacy-value'
    await run.execute()
    expect(run.exports.INFRACOST_API_KEY).toBe('legacy-value')
    expect(run.outputs.resolved).toBe('["AWS_ACCESS_KEY_ID"]')
    expect(run.createVault).not.toHaveBeenCalled()
  })

  test('empty GitHub value hard-fails without trying vault or exporting fallback', async () => {
    const run = fixture({
      required: 'HCLOUD_TOKEN',
      secretBackend: 'gh',
      ghSecrets: JSON.stringify({ HCLOUD_TOKEN: '' })
    })
    await expect(run.execute()).rejects.toThrow(
      'Credential HCLOUD_TOKEN: GitHub secret HCLOUD_TOKEN is missing'
    )
    expect(run.exports).toEqual({})
    expect(run.createVault).not.toHaveBeenCalled()
  })

  test('missing and empty Key Vault values hard-fail with converted name, never leaking SDK errors', async () => {
    const missing = fixture({ required: 'HCLOUD_TOKEN' })
    missing.getSecret.mockRejectedValueOnce(
      new KeyVaultReadError('hcloud_token', true)
    )
    await expect(missing.execute()).rejects.toThrow(
      'Credential HCLOUD_TOKEN: Key Vault secret prod-01---hcloud-token is missing'
    )
    expect(missing.exports).toEqual({})
    const empty = fixture({ required: 'HCLOUD_TOKEN' })
    empty.getSecret.mockResolvedValueOnce('')
    await expect(empty.execute()).rejects.toThrow(
      'Credential HCLOUD_TOKEN: Key Vault secret prod-01---hcloud-token is missing'
    )
    expect(empty.exports).toEqual({})
  })

  test('vault authentication and transport failures retain a safe unavailable signal', async () => {
    const run = fixture({ required: 'HCLOUD_TOKEN' })
    run.getSecret.mockRejectedValueOnce(
      new Error('SDK error with sensitive body')
    )
    const error = await run.execute().catch((cause) => cause)
    expect(error.message).toBe(
      'Credential HCLOUD_TOKEN: Key Vault secret prod-01---hcloud-token could not be read'
    )
    expect(error.message).not.toContain('sensitive body')
    expect(run.exports).toEqual({})
  })

  test('selects dedicated keystore SP and OIDC if its client ID is configured', async () => {
    const run = fixture({
      required: 'HCLOUD_TOKEN',
      keystoreSpClientId: 'keystore-id',
      keystoreSpClientSecret: '',
      keystoreSpTenantId: 'keystore-tenant',
      keystoreOidcEnabled: 'true'
    })
    await run.execute()
    expect(run.createVault).toHaveBeenCalledWith(
      'Prod_01',
      'https://test.vault.azure.net/',
      {
        tenantId: 'keystore-tenant',
        clientId: 'keystore-id',
        clientSecret: ''
      },
      true
    )
  })

  test('does not silently switch to ARM SP when dedicated keystore SP is incomplete', async () => {
    const run = fixture({
      required: 'HCLOUD_TOKEN',
      keystoreSpClientId: 'keystore-id'
    })
    await expect(run.execute()).rejects.toThrow(
      'Key Vault service principal credentials are incomplete'
    )
    expect(run.createVault).not.toHaveBeenCalled()
  })

  test('validates credential names, references and backend, even for unused mappings', async () => {
    for (const credentials of [
      { ARM_CLIENT_ID: 'gh.secret.ID' },
      { HCLOUD_TOKEN: 'env.HCLOUD_TOKEN' },
      { hcloud_token: 'gh.secret.ID' }
    ]) {
      const run = fixture({
        required: 'AWS_ACCESS_KEY_ID',
        credentials: JSON.stringify(credentials)
      })
      await expect(run.execute()).rejects.toThrow()
      expect(run.exports).toEqual({})
    }
    const invalidBackend = fixture({ secretBackend: 'ssm' })
    await expect(invalidBackend.execute()).rejects.toThrow(
      'secret-backend must be gh or vault'
    )
  })

  test('requires a vault URL only when an actually required reference selects vault', async () => {
    const run = fixture({ required: 'HCLOUD_TOKEN', keyVaultUrl: '' })
    await expect(run.execute()).rejects.toThrow(
      'REPO_KEYSTORE_KEY_VAULT_URL is required'
    )
    expect(run.createVault).not.toHaveBeenCalled()
  })
})
