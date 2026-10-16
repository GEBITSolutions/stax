import { ITerraformConfig, ITerraformLayerConfig } from './types.js';
export declare function generate_layerdeployment(deploy_config: readonly ITerraformConfig[], layer: number, global_tf_vars: Record<string, string | boolean>, layer_deployments: readonly ITerraformLayerConfig[][]): ITerraformLayerConfig[];
declare const _default: {
    generate_layerdeployment: typeof generate_layerdeployment;
};
export default _default;
