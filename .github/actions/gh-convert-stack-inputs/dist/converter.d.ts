import { InputType, ghEnvironmentType, GlobalsContext, SecretReader } from './types.js';
export declare function resolveEnvValue(basePathValue: string, input: string, ghEnvironment: ghEnvironmentType, secretStore: SecretReader | null, allowNull: boolean, globalsContext?: GlobalsContext | null): Promise<{
    value: InputType;
    key: string;
}>;
export declare function createValue(basePathValue: string, input: InputType, ghEnvironment: ghEnvironmentType, secretStore: SecretReader | null, allowNull: boolean, globalsContext?: GlobalsContext | null): Promise<InputType>;
export declare function createKeyValue(basePathValue: string, input: InputType, ghEnvironment: ghEnvironmentType, secretStore: SecretReader | null, topLevel?: boolean, allowNull?: boolean, globalsContext?: GlobalsContext | null): Promise<{
    key: string;
    value: InputType;
}>;
