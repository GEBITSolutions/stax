import * as core from '@actions/core';
import { KeyVaultStore } from '../../gh-convert-stack-inputs/src/keyvault-store.js';
type VaultReader = Pick<KeyVaultStore, 'getSecret'>;
type VaultFactory = (prefix: string, url: string, credentials: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
}, oidcEnabled: boolean) => VaultReader;
type ActionCore = Pick<typeof core, 'setSecret' | 'exportVariable' | 'setOutput'>;
export interface ResolverInputs {
    required: string;
    credentials: string;
    secretBackend: string;
    environment: string;
    ghSecrets: string;
    keyVaultUrl: string;
    keyVaultSpClientId: string;
    keyVaultSpClientSecret: string;
    keyVaultSpTenantId: string;
    oidcEnabled: string;
    keystoreSpClientId: string;
    keystoreSpClientSecret: string;
    keystoreSpTenantId: string;
    keystoreOidcEnabled: string;
}
export declare class CredentialResolutionError extends Error {
}
export declare function resolveCredentials({ inputs, actionCore, createVault }: {
    inputs: ResolverInputs;
    actionCore?: ActionCore;
    createVault?: VaultFactory;
}): Promise<string[]>;
export {};
