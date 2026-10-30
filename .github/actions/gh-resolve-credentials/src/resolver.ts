import * as core from '@actions/core'
import { KeyVaultStore } from '../../gh-convert-stack-inputs/src/keyvault-store.js'
import { convertKey } from '../../gh-convert-stack-inputs/src/keystore-key.js'

const ALLOWED_CREDENTIALS = new Set([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'HCLOUD_TOKEN',
  'INFRACOST_API_KEY',
  'CI_GITHUB_PAT',
  'CI_GITHUB_TOKEN_TERRAFORM',
  'TF_PROVIDER_GH_OWNER'
])
const REFERENCE = /^(secret_backend|gh)\.secret\.([A-Za-z0-9_]+)$/
const NAME = /^[A-Z][A-Z0-9_]*$/

type VaultReader = Pick<KeyVaultStore, 'getSecret'>
type VaultFactory = (
  prefix: string,
  url: string,
  credentials: { tenantId: string; clientId: string; clientSecret: string },
  oidcEnabled: boolean
) => VaultReader

type ActionCore = Pick<
  typeof core,
  'setSecret' | 'exportVariable' | 'setOutput'
>

export interface ResolverInputs {
  required: string
  credentials: string
  secretBackend: string
  environment: string
  ghSecrets: string
  keyVaultUrl: string
  keyVaultSpClientId: string
  keyVaultSpClientSecret: string
  keyVaultSpTenantId: string
  oidcEnabled: string
  keystoreSpClientId: string
  keystoreSpClientSecret: string
  keystoreSpTenantId: string
  keystoreOidcEnabled: string
}

export class CredentialResolutionError extends Error {}

function parseObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    throw new CredentialResolutionError(`${label} must be a JSON object`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CredentialResolutionError(`${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function vaultFactory(
  prefix: string,
  url: string,
  credentials: { tenantId: string; clientId: string; clientSecret: string },
  oidcEnabled: boolean
): VaultReader {
  return new KeyVaultStore(prefix, url, credentials, oidcEnabled)
}

function createVaultReader(
  inputs: ResolverInputs,
  createVault: VaultFactory
): VaultReader {
  if (!inputs.keyVaultUrl) {
    throw new CredentialResolutionError(
      'REPO_KEYSTORE_KEY_VAULT_URL is required for mapped vault credentials'
    )
  }
  try {
    const url = new URL(inputs.keyVaultUrl)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('Invalid vault origin')
    }
  } catch {
    throw new CredentialResolutionError(
      'REPO_KEYSTORE_KEY_VAULT_URL must be an HTTPS vault origin'
    )
  }
  if (!inputs.environment) {
    throw new CredentialResolutionError(
      'Environment is required for mapped vault credentials'
    )
  }
  const keystore = !!inputs.keystoreSpClientId
  const clientId = keystore
    ? inputs.keystoreSpClientId
    : inputs.keyVaultSpClientId
  const tenantId = keystore
    ? inputs.keystoreSpTenantId
    : inputs.keyVaultSpTenantId
  const clientSecret = keystore
    ? inputs.keystoreSpClientSecret
    : inputs.keyVaultSpClientSecret
  const oidcEnabled =
    (keystore ? inputs.keystoreOidcEnabled : inputs.oidcEnabled) === 'true'
  if (!clientId || !tenantId || (!oidcEnabled && !clientSecret)) {
    throw new CredentialResolutionError(
      'Key Vault service principal credentials are incomplete'
    )
  }
  try {
    return createVault(
      inputs.environment,
      inputs.keyVaultUrl,
      { tenantId, clientId, clientSecret },
      oidcEnabled
    )
  } catch {
    throw new CredentialResolutionError(
      'Key Vault client initialization failed for mapped credentials'
    )
  }
}

export async function resolveCredentials({
  inputs,
  actionCore = core,
  createVault = vaultFactory
}: {
  inputs: ResolverInputs
  actionCore?: ActionCore
  createVault?: VaultFactory
}): Promise<string[]> {
  const credentials = parseObject(inputs.credentials, 'credentials')
  const secrets = parseObject(inputs.ghSecrets, 'gh-secrets')
  if (inputs.secretBackend !== 'gh' && inputs.secretBackend !== 'vault') {
    throw new CredentialResolutionError('secret-backend must be gh or vault')
  }
  for (const [name, reference] of Object.entries(credentials)) {
    if (!NAME.test(name))
      throw new CredentialResolutionError('Credential name is not allowed')
    if (!ALLOWED_CREDENTIALS.has(name)) {
      throw new CredentialResolutionError(`Credential ${name} is not allowed`)
    }
    if (typeof reference !== 'string' || !REFERENCE.test(reference)) {
      throw new CredentialResolutionError(
        `Credential ${name} must be a gh.secret.KEY or secret_backend.secret.KEY reference`
      )
    }
  }
  const githubSecrets = new Map(
    Object.entries(secrets).map(([name, value]) => [name.toUpperCase(), value])
  )
  const required = [
    ...new Set(
      inputs.required
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    )
  ]
  for (const name of required) {
    if (!NAME.test(name))
      throw new CredentialResolutionError(
        'Required credential name is not allowed'
      )
    if (!ALLOWED_CREDENTIALS.has(name)) {
      throw new CredentialResolutionError(
        `Required credential ${name} is not allowed`
      )
    }
  }
  const resolved: string[] = []
  let vault: VaultReader | undefined
  for (const name of required) {
    const reference = credentials[name]
    if (reference === undefined) continue
    const match = REFERENCE.exec(reference as string)!
    const key = match[2]
    const backend = match[1] === 'gh' ? 'gh' : inputs.secretBackend
    let value: unknown
    if (backend === 'gh') {
      value = githubSecrets.get(key.toUpperCase())
      if (typeof value !== 'string' || !value) {
        throw new CredentialResolutionError(
          `Credential ${name}: GitHub secret ${key.toUpperCase()} is missing`
        )
      }
    } else {
      const secretName = convertKey(key, inputs.environment)
      vault ??= createVaultReader(inputs, createVault)
      try {
        value = await vault.getSecret(key)
      } catch {
        throw new CredentialResolutionError(
          `Credential ${name}: Key Vault secret ${secretName} is missing`
        )
      }
      if (typeof value !== 'string' || !value) {
        throw new CredentialResolutionError(
          `Credential ${name}: Key Vault secret ${secretName} is missing`
        )
      }
    }
    actionCore.setSecret(value)
    actionCore.exportVariable(name, value)
    resolved.push(name)
  }
  actionCore.setOutput('resolved', JSON.stringify(resolved))
  return resolved
}
