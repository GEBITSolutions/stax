import { ITerraformConfig } from './types.js';
/**
 * Stack types that deploy a directory read it from folder; the id is only an
 * identifier and never stands in for the directory.
 */
export declare function validateStackFolder(config: ITerraformConfig): void;
