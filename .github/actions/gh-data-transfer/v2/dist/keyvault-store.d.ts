/**
 * Interface for service principal credentials
 * clientSecret is optional — when omitted, OIDC (ClientAssertionCredential) is used
 */
export interface ServicePrincipalCredentials {
    tenantId: string;
    clientId: string;
    clientSecret?: string;
}
/**
 * KeyVaultStore class for managing Azure Key Vault operations
 * Uses service principal authentication to connect to Azure Key Vault
 */
export declare class KeyVaultStore {
    private keyVaultProjectPrefix;
    private keyVaultUrl;
    private client;
    /**
     * Creates a new KeyVaultStore instance with service principal authentication
     * @param keyVaultProjectPrefix - The URL of the Azure Key Vault (e.g., https://myvault.vault.azure.net/)
     * @param keyVaultUrl - The URL of the Azure Key Vault (e.g., https://myvault.vault.azure.net/)
     * @param credentials - Service principal credentials (tenantId, clientId, clientSecret)
     */
    constructor(keyVaultProjectPrefix: string, keyVaultUrl: string, credentials?: ServicePrincipalCredentials | undefined);
    /**
     * Writes multiple secrets (key-value pairs) to Azure Key Vault
     * @param secrets - Object containing key-value pairs where keys are secret names and values are secret values
     * @returns Promise that resolves when all secrets are successfully stored
     * @throws Error if any operation fails
     */
    setSecrets(secrets: Record<string, string>): Promise<void>;
    /**
     * Writes a secret (key-value pair) to Azure Key Vault
     * @param key - The name of the secret (must match pattern ^[0-9a-zA-Z-]+$)
     * @param value - The value of the secret
     * @returns Promise that resolves when the secret is successfully stored
     * @throws Error if the operation fails
     */
    setSecret(key: string, value: string): Promise<void>;
    /**
     * Retrieves a secret from Azure Key Vault
     * @param key - The name of the secret to retrieve
     * @returns Promise that resolves with the secret value
     * @throws Error if the secret doesn't exist or operation fails
     */
    getSecret(key: string): Promise<string>;
}
//# sourceMappingURL=keyvault-store.d.ts.map