import { InputType, ITerraformConfig } from './types.js';
export declare function convert_implicit_to_explicit_dependencies(deploy_config: readonly ITerraformConfig[]): ITerraformConfig[];
export declare function prune_external_dependencies(deploy_config: readonly ITerraformConfig[]): ITerraformConfig[];
export declare function trimArrayIndex(variable_name: string): string;
export declare function update_deploy_config(config: ITerraformConfig[], i: number, key: string, value: InputType, depth?: number): ITerraformConfig;
