import { ITerraformConfig, ITerraformLayerConfig } from './types.js'

export function generate_layerdeployment(
  deploy_config: readonly ITerraformConfig[],
  layer: number,
  global_tf_vars: Record<string, string | boolean>,
  layer_deployments: readonly ITerraformLayerConfig[][]
): ITerraformLayerConfig[] {
  let layer_deployment: Array<ITerraformLayerConfig> = []
  if (layer === 0) {
    layer_deployment = deploy_config
      .filter(
        (config: ITerraformConfig) => (config.depends_on?.length || 0) === 0
      )
      .reduce((local_layer_deployments: ITerraformLayerConfig[], config) => {
        local_layer_deployments.push({ ...config, layer })
        return local_layer_deployments
      }, [])
  } else {
    // Check if every string of `config.depends_on` is included in layer_deployments.flat()
    layer_deployment = deploy_config
      .filter((config) => {
        // Filter out configs where:
        // 1. `depends_on` is not null
        // 2. `config.id` is not in `layer_deployments`
        // 3. All dependencies in `depends_on` are in `layer_deployments`
        return (
          config.depends_on != null &&
          !layer_deployments
            .flat()
            .map((c) => c.id)
            .includes(config.id) &&
          // stack_filter.includes(config.id) &&
          config.depends_on.every((v) =>
            layer_deployments
              .flat()
              .map((c) => c.id)
              .includes(v)
          )
        )
      })
      .reduce((local_layer_deployments: ITerraformLayerConfig[], config) => {
        // Add the config to `local_layer_deployments` with an additional `stack` property
        local_layer_deployments.push({ ...config, layer })
        return local_layer_deployments
      }, [])
      .reduce(function (a: ITerraformLayerConfig[], b: ITerraformLayerConfig) {
        // Ensure `a` contains unique elements
        if (a.indexOf(b) < 0) a.push(b)
        return a
      }, [])
  }

  return layer_deployment
}

export default { generate_layerdeployment }
