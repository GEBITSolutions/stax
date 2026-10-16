import { SecretReader } from './types.js';
/**
 * Interface for service principal credentials
 */
export interface ServicePrincipalCredentials {
    tenantId: string;
    clientId: string;
    clientSecret: string;
}
/**
 * KeyVaultStore class for managing Azure Key Vault operations
 * Uses service principal authentication to connect to Azure Key Vault
 */
export declare class KeyVaultStore implements SecretReader {
    readonly storeLabel = "KeyVault";
    private keyVaultProjectPrefix;
    private keyVaultUrl;
    private client;
    /**
     * Creates a new KeyVaultStore instance
     * @param keyVaultProjectPrefix - Prefix for key vault secret names
     * @param keyVaultUrl - The URL of the Azure Key Vault (e.g., https://myvault.vault.azure.net/)
     * @param credentials - Service principal credentials (tenantId, clientId, clientSecret)
     * @param oidcEnabled - When true, use GitHub Actions OIDC federated token instead of client secret
     */
    constructor(keyVaultProjectPrefix: string, keyVaultUrl: string, credentials?: ServicePrincipalCredentials | undefined, oidcEnabled?: boolean);
    /**
     * Retrieves a secret from Azure Key Vault
     * @param key - The name of the secret to retrieve
     * @returns Promise that resolves with the secret value
     * @throws Error if the secret doesn't exist or operation fails
     */
    getSecret(key: string): Promise<string>;
}
