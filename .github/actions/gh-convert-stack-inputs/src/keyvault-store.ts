import { SecretClient } from '@azure/keyvault-secrets'
import {
  ClientSecretCredential,
  ClientAssertionCredential,
  DefaultAzureCredential
} from '@azure/identity'
import * as core from '@actions/core'
import { SecretReader } from './types.js'
import { convertKey } from './keystore-key.js'

/**
 * Interface for service principal credentials
 */
export interface ServicePrincipalCredentials {
  tenantId: string
  clientId: string
  clientSecret: string
}

/**
 * Fetches a GitHub Actions OIDC token for Azure AD federation.
 * Requires the workflow to have 'permissions: id-token: write'.
 */
async function getGitHubOidcToken(): Promise<string> {
  const tokenRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const tokenRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN

  if (!tokenRequestUrl || !tokenRequestToken) {
    throw new Error(
      'OIDC token request environment variables are not set. ' +
        "Ensure the workflow has 'permissions: id-token: write'."
    )
  }

  const url = `${tokenRequestUrl}&audience=api://AzureADTokenExchange`
  const response = await fetch(url, {
    headers: { Authorization: `bearer ${tokenRequestToken}` }
  })

  if (!response.ok) {
    throw new Error(
      `OIDC token request failed: ${response.status} ${response.statusText}`
    )
  }

  const body = (await response.json()) as { value?: string }
  if (!body.value) {
    throw new Error('OIDC token response did not contain a token value')
  }

  core.setSecret(body.value)
  return body.value
}

/**
 * KeyVaultStore class for managing Azure Key Vault operations
 * Uses service principal authentication to connect to Azure Key Vault
 */
export class KeyVaultStore implements SecretReader {
  readonly storeLabel = 'KeyVault'
  private keyVaultProjectPrefix: string
  private keyVaultUrl: string
  private client: SecretClient

  /**
   * Creates a new KeyVaultStore instance
   * @param keyVaultProjectPrefix - Prefix for key vault secret names
   * @param keyVaultUrl - The URL of the Azure Key Vault (e.g., https://myvault.vault.azure.net/)
   * @param credentials - Service principal credentials (tenantId, clientId, clientSecret)
   * @param oidcEnabled - When true, use GitHub Actions OIDC federated token instead of client secret
   */
  constructor(
    keyVaultProjectPrefix: string,
    keyVaultUrl: string,
    credentials?: ServicePrincipalCredentials | undefined,
    oidcEnabled: boolean = false
  ) {
    this.keyVaultProjectPrefix = keyVaultProjectPrefix
    this.keyVaultUrl = keyVaultUrl

    const nodeEnv = process.env.NODE_ENV
    if (nodeEnv !== 'dev' && !credentials) {
      throw new Error(
        'Service principal credentials are required when NODE_ENV is not "dev"'
      )
    }

    let credential
    if (oidcEnabled && credentials?.tenantId && credentials?.clientId) {
      // Use OIDC federated token from GitHub Actions
      core.info('Using OIDC (ClientAssertionCredential) for KeyVault access')
      credential = new ClientAssertionCredential(
        credentials.tenantId,
        credentials.clientId,
        getGitHubOidcToken
      )
    } else if (credentials?.clientSecret) {
      credential = new ClientSecretCredential(
        credentials.tenantId,
        credentials.clientId,
        credentials.clientSecret
      )
    } else {
      credential = new DefaultAzureCredential()
    }

    this.client = new SecretClient(this.keyVaultUrl, credential)
    core.info(`KeyVaultStore initialized for vault: ${this.keyVaultUrl}`)
  }

  /**
   * Retrieves a secret from Azure Key Vault
   * @param key - The name of the secret to retrieve
   * @returns Promise that resolves with the secret value
   * @throws Error if the secret doesn't exist or operation fails
   */
  async getSecret(key: string): Promise<string> {
    try {
      const convertedKey = convertKey(key, this.keyVaultProjectPrefix)
      core.info(`Getting secret: ${convertedKey}`)
      const secret = await this.client.getSecret(convertedKey)

      if (!secret.value) {
        throw new Error(`Secret ${convertedKey} exists but has no value`)
      }

      core.info(`Successfully retrieved secret: ${convertedKey}`)
      core.setSecret(secret?.value)

      return secret.value
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      core.error(`Failed to get secret ${key}: ${errorMessage}`)
      throw new Error(`Failed to get secret ${key}: ${errorMessage}`)
    }
  }
}
