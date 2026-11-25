import { ITerraformConfig } from './types.js';
export declare function containsAsciiControlCharacter(value: string): boolean;
export declare function validatePackerConfig(config: ITerraformConfig, warn?: (message: string) => void): void;
