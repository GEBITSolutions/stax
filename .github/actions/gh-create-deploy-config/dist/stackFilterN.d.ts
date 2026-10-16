import { ITerraformConfig } from './types.js';
export declare function generate_stackfilter(deploy_config: Array<ITerraformConfig>, stack_filter: string, global_tf_vars: Record<string, string | boolean>): string[];
export declare function apply_stack_filter(deploy_config: Array<ITerraformConfig>, expanded_stack_filter: string[]): ITerraformConfig[];
declare const _default: {
    generate_stackfilter: typeof generate_stackfilter;
    apply_stack_filter: typeof apply_stack_filter;
};
export default _default;
