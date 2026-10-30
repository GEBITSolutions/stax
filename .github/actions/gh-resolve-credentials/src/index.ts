import * as core from '@actions/core'
import {
  CredentialResolutionError,
  resolveCredentials,
  type ResolverInputs
} from './resolver.js'

function readInputs(): ResolverInputs {
  return {
    required: core.getInput('required', { required: true }),
    credentials: core.getInput('credentials'),
    secretBackend: core.getInput('secret-backend') || 'gh',
    environment: core.getInput('environment'),
    ghSecrets: core.getInput('gh-secrets'),
    keyVaultUrl: core.getInput('key-vault-url'),
    keyVaultSpClientId: core.getInput('key-vault-sp-client-id'),
    keyVaultSpClientSecret: core.getInput('key-vault-sp-client-secret'),
    keyVaultSpTenantId: core.getInput('key-vault-sp-tenant-id'),
    oidcEnabled: core.getInput('oidc-enabled'),
    keystoreSpClientId: core.getInput('keystore-sp-client-id'),
    keystoreSpClientSecret: core.getInput('keystore-sp-client-secret'),
    keystoreSpTenantId: core.getInput('keystore-sp-tenant-id'),
    keystoreOidcEnabled: core.getInput('keystore-oidc-enabled')
  }
}

try {
  await resolveCredentials({ inputs: readInputs() })
} catch (error) {
  // SDK and transport errors must never reach the Actions log unfiltered.
  core.setFailed(
    error instanceof CredentialResolutionError
      ? error.message
      : 'Credential resolution failed'
  )
}
