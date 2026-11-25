import { InputType } from './types.js';
/**
 * Writes resolved inputs as one JSON object to inputs.json in a new 0700
 * directory under runnerTemp, with file mode 0600, and returns the file path.
 * Consumers read the file (for example `ansible-playbook --extra-vars @file`),
 * so values never appear in step outputs, argv or environment variables.
 */
export declare function writePrivateInputsFile(inputs: readonly {
    key: string;
    value: InputType;
}[], runnerTemp: string | undefined): Promise<string>;
