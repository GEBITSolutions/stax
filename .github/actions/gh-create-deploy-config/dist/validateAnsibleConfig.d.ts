import { ITerraformConfig, ITerraformLayerConfig } from './types.js';
export declare function validateAnsibleConfig(config: ITerraformConfig): void;
/** A destroy run rejects the whole selection when it contains an Ansible stack. */
export declare function validateAnsibleSelection(configs: readonly ITerraformConfig[], globalVars: Record<string, string | boolean>): void;
/** Ansible stacks in one level run in parallel, so they must not share an inventory. */
export declare function validateAnsibleLayerOverlap(layers: readonly (readonly ITerraformLayerConfig[])[]): void;
