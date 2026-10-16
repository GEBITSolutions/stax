import { SecretClient } from '@azure/keyvault-secrets'
import {
  ClientAssertionCredential,
  ClientSecretCredential,
  DefaultAzureCredential
} from '@azure/identity'
import * as core from '@actions/core'

/**
 * Interface for service principal credentials
 * clientSecret is optional — when omitted, OIDC (ClientAssertionCredential) is used
 */
export interface ServicePrincipalCredentials {
  tenantId: string
  clientId: string
  clientSecret?: string
}

/**
 * Converts a key to Azure Key Vault compatible format
 * - Converts to lowercase
 * - Replaces underscores with hyphens
 * @param key - The original key name
 * @returns The converted key name
 */
function convertKey(key: string, keyVaultProjectPrefix: string): string {
  const convertedKey = keyVaultProjectPrefix + '---' + key
  return convertedKey.toLowerCase().replace(/_/g, '-').replace(/\./g, '-')
}

/**
 * KeyVaultStore class for managing Azure Key Vault operations
 * Uses service principal authentication to connect to Azure Key Vault
 */
export class KeyVaultStore {
  private keyVaultProjectPrefix: string
  private keyVaultUrl: string
  private client: SecretClient

  /**
   * Creates a new KeyVaultStore instance with service principal authentication
   * @param keyVaultProjectPrefix - The URL of the Azure Key Vault (e.g., https://myvault.vault.azure.net/)
   * @param keyVaultUrl - The URL of the Azure Key Vault (e.g., https://myvault.vault.azure.net/)
   * @param credentials - Service principal credentials (tenantId, clientId, clientSecret)
   */
  constructor(
    keyVaultProjectPrefix: string,
    keyVaultUrl: string,
    credentials?: ServicePrincipalCredentials | undefined
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
    if (credentials?.clientSecret) {
      // Classic service principal with client secret
      credential = new ClientSecretCredential(
        credentials.tenantId,
        credentials.clientId,
        credentials.clientSecret
      )
      core.info('KeyVault auth mode: ClientSecretCredential')
    } else if (credentials?.clientId && credentials?.tenantId) {
      // OIDC — use GitHub Actions ID token as federated assertion
      credential = new ClientAssertionCredential(
        credentials.tenantId,
        credentials.clientId,
        async () => {
          const token = await core.getIDToken('api://AzureADTokenExchange')
          return token
        }
      )
      core.info('KeyVault auth mode: OIDC (ClientAssertionCredential)')
    } else {
      // Fallback for local dev or managed identity
      credential = new DefaultAzureCredential()
      core.info('KeyVault auth mode: DefaultAzureCredential (fallback)')
    }

    this.client = new SecretClient(this.keyVaultUrl, credential)
    core.info(`KeyVaultStore initialized for vault: ${this.keyVaultUrl}`)
  }

  /**
   * Writes multiple secrets (key-value pairs) to Azure Key Vault
   * @param secrets - Object containing key-value pairs where keys are secret names and values are secret values
   * @returns Promise that resolves when all secrets are successfully stored
   * @throws Error if any operation fails
   */
  async setSecrets(secrets: Record<string, string>): Promise<void> {
    try {
      const secretEntries = Object.entries(secrets)
      core.info(`Setting ${secretEntries.length} secrets`)

      for (const [key] of secretEntries) {
        const convertedKey = convertKey(key, this.keyVaultProjectPrefix)
        if (
          !convertedKey.match(/^[0-9a-zA-Z-]+$/) ||
          convertedKey.length > 127
        ) {
          throw new Error(
            `Invalid secret name: ${convertedKey}. Secret names must only contain alphanumeric characters and hyphens.`
          )
        }
      }

      const setPromises = secretEntries.map(async ([key, value]) => {
        const convertedKey = convertKey(key, this.keyVaultProjectPrefix)
        try {
          core.info(`Setting secret: ${convertedKey}`)
          await this.client.setSecret(convertedKey, value)
          core.info(`Successfully set secret: ${convertedKey}`)
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error)
          core.error(`Failed to set secret ${key}: ${errorMessage}`)
          throw new Error(`Failed to set secret ${key}: ${errorMessage}`)
        }
      })

      await Promise.all(setPromises)
      core.info(`Successfully set all ${secretEntries.length} secrets`)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      core.error(`Failed to set secrets: ${errorMessage}`)
      throw new Error(`Failed to set secrets: ${errorMessage}`)
    }
  }

  /**
   * Writes a secret (key-value pair) to Azure Key Vault
   * @param key - The name of the secret (must match pattern ^[0-9a-zA-Z-]+$)
   * @param value - The value of the secret
   * @returns Promise that resolves when the secret is successfully stored
   * @throws Error if the operation fails
   */
  async setSecret(key: string, value: string): Promise<void> {
    try {
      const convertedKey = convertKey(key, this.keyVaultProjectPrefix)
      if (!convertedKey.match(/^[0-9a-zA-Z-]+$/) || convertedKey.length > 127) {
        throw new Error(
          `Invalid secret name: ${key}. Secret names must only contain alphanumeric characters and hyphens.`
        )
      }

      core.info(`Setting secret: ${convertedKey}`)
      await this.client.setSecret(convertedKey, value)
      core.info(`Successfully set secret: ${convertedKey}`)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      core.error(`Failed to set secret ${key}: ${errorMessage}`)
      throw new Error(`Failed to set secret ${key}: ${errorMessage}`)
    }
  }

  /**
   * Retrieves a secret from Azure Key Vault
   * @param key - The name of the secret to retrieve
   * @returns Promise that resolves with the secret value
   * @throws Error if the secret doesn't exist or operation fails
   */
  async getSecret(key: string): Promise<string> {
    try {
      core.info(`Getting secret: ${key}`)
      const secret = await this.client.getSecret(key)

      if (!secret.value) {
        throw new Error(`Secret ${key} exists but has no value`)
      }

      core.info(`Successfully retrieved secret: ${key}`)
      return secret.value
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      core.error(`Failed to get secret ${key}: ${errorMessage}`)
      throw new Error(`Failed to get secret ${key}: ${errorMessage}`)
    }
  }
}
