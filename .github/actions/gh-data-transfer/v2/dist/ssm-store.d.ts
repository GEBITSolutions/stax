/**
 * Interface for AWS credentials used to reach the SSM Parameter Store.
 * Exactly one authentication mode is selected, in this order of precedence:
 * static keys -> OIDC role assumption -> ambient provider chain.
 */
export interface AwsCredentials {
    region: string;
    roleArn?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
}
/**
 * Converts a key to the flat keystore format shared with Azure Key Vault.
 * - Prefixes with the environment name separated by `---`
 * - Converts to lowercase
 * - Replaces underscores and dots with hyphens
 * @param key - The original key name
 * @param prefix - The environment prefix
 * @returns The converted key name
 */
export declare function convertKey(key: string, prefix: string): string;
/**
 * Normalizes an SSM path prefix to a leading slash with no trailing slash.
 * @param prefix - The raw prefix input (e.g. `example/cicd/`)
 * @returns The normalized prefix (e.g. `/example/cicd`)
 */
export declare function normalizePrefix(prefix: string): string;
/**
 * SsmParameterStore writes pipeline variables and secrets to the AWS SSM
 * Parameter Store using the same flat key layout as the Azure Key Vault store,
 * so both keystores stay interchangeable for a given environment.
 * Every value is a SecureString: SSM cannot change an existing parameter's type.
 */
export declare class SsmParameterStore {
    private prefix;
    private parameterPrefix;
    private kmsKeyId?;
    private client;
    /**
     * @param prefix - Environment name used as the flat key prefix
     * @param parameterPrefix - SSM path prefix (e.g. `/example/cicd`)
     * @param credentials - AWS region and authentication material
     * @param kmsKeyId - Optional KMS key for SecureString parameters
     */
    constructor(prefix: string, parameterPrefix: string, credentials: AwsCredentials, kmsKeyId?: string);
    /**
     * Builds and validates the fully qualified SSM parameter name for a key.
     * @param key - The original key name
     * @returns The SSM parameter name
     * @throws Error if the resulting name is not a legal SSM parameter name
     */
    parameterName(key: string): string;
    /**
     * Reads the current value of a parameter.
     * @param key - The original key name
     * @returns Promise resolving with the decrypted parameter value
     * @throws Error if the parameter does not exist or the operation fails
     */
    getSecret(key: string): Promise<string>;
    /**
     * Writes key-value pairs as encrypted `SecureString` parameters.
     * Validates every entry up front, then writes them with bounded concurrency.
     * Unchanged values are skipped so repeated pipeline runs do not exhaust the
     * 100-version-per-parameter history.
     * @param secrets - Key-value pairs to store
     */
    setSecrets(secrets: Record<string, string>): Promise<void>;
    /**
     * Writes a single parameter, skipping the call when the stored value already
     * matches.
     */
    private put;
    /**
     * Reports whether the stored parameter already holds `value` as a
     * SecureString under the configured KMS key. Any read failure resolves to
     * `false` so the write still proceeds.
     */
    private isUnchanged;
}
//# sourceMappingURL=ssm-store.d.ts.map