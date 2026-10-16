import { SecretReader } from './types.js';
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
 * Normalizes an SSM path prefix to a leading slash with no trailing slash.
 * @param prefix - The raw prefix input (e.g. `example/cicd/`)
 * @returns The normalized prefix (e.g. `/example/cicd`)
 */
export declare function normalizePrefix(prefix: string): string;
/**
 * SsmParameterStore reads pipeline variables and secrets from the AWS SSM
 * Parameter Store using the same flat key layout as the Azure Key Vault store,
 * so both keystores stay interchangeable for a given environment.
 */
export declare class SsmParameterStore implements SecretReader {
    readonly storeLabel = "SSM";
    private prefix;
    private parameterPrefix;
    private client;
    /**
     * @param prefix - Environment name used as the flat key prefix
     * @param parameterPrefix - SSM path prefix (e.g. `/example/cicd`)
     * @param credentials - AWS region and authentication material
     */
    constructor(prefix: string, parameterPrefix: string, credentials: AwsCredentials);
    /**
     * Builds and validates the fully qualified SSM parameter name for a key.
     * @param key - The original key name
     * @returns The SSM parameter name
     * @throws Error if the resulting name is not a legal SSM parameter name
     */
    parameterName(key: string): string;
    /**
     * Retrieves a parameter from the SSM Parameter Store
     * @param key - The name of the parameter to retrieve
     * @returns Promise that resolves with the decrypted parameter value
     * @throws Error if the parameter doesn't exist or operation fails
     */
    getSecret(key: string): Promise<string>;
}
