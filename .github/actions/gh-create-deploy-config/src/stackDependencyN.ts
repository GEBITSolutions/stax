import { InputType, ITerraformConfig } from './types.js'
import * as core from '@actions/core'

export function convert_implicit_to_explicit_dependencies(
  deploy_config: readonly ITerraformConfig[]
): ITerraformConfig[] {
  const updated_deploy_config = [...deploy_config]

  for (let i = 0; i < deploy_config.length; i++) {
    updated_deploy_config[i]['input'] = deploy_config[i]['input'] || []
    updated_deploy_config[i]['depends_on'] =
      deploy_config[i]['depends_on'] || []
    updated_deploy_config[i]['stack-groups'] =
      deploy_config[i]['stack-groups'] || []
    if (updated_deploy_config[i].input) {
      for (const [key, value] of Object.entries(
        updated_deploy_config[i].input || {}
      )) {
        updated_deploy_config[i] = update_deploy_config(
          updated_deploy_config,
          i,
          key,
          value
        )
      }
    }
  }
  return updated_deploy_config
}

export function prune_external_dependencies(
  deploy_config: readonly ITerraformConfig[]
): ITerraformConfig[] {
  const known_ids = new Set(deploy_config.map((stack) => stack.id))

  return deploy_config.map((stack) => {
    const original_depends_on = stack.depends_on || []
    const kept: string[] = []

    for (const dependency of original_depends_on) {
      if (known_ids.has(dependency)) {
        kept.push(dependency)
      } else {
        core.warning(
          `Dependency ${dependency} of stack ${stack.id} not found in config; ` +
            `treating as external cross-config dependency and ignoring it for layering`
        )
      }
    }

    return { ...stack, depends_on: kept }
  })
}

export function trimArrayIndex(variable_name: string) {
  const arrayMatch = variable_name.match(/(.+)\[(-?\d+)\]$/)
  if (!arrayMatch) {
    return variable_name
  } else {
    return arrayMatch[1]
  }
}

export function update_deploy_config(
  config: ITerraformConfig[],
  i: number,
  key: string,
  value: InputType,
  depth = 0
) {
  if (typeof value === 'string' && value.startsWith('stack.')) {
    const split = value.split('.')
    if (split.length !== 4) {
      throw new Error(
        `Invalid split length (${split.length}) for value: ${value}`
      )
    }
    const [, stackname, type, variable_name] = split
    if (type !== 'var' && type !== 'secret') {
      throw new Error(`Type must be 'var' or 'secret' for ${value}`)
    }

    const depends_on_stack_index = config.findIndex(
      (stack) => stack.id === stackname
    )

    if (depends_on_stack_index !== -1) {
      // Only add dependency if the stack exists in the current config
      if (!config[i].depends_on?.includes(stackname)) {
        core.info(
          `Adding implicit dependency [${type}] from ${stackname} to ${config[i].id}`
        )
        config[i].depends_on = config[i].depends_on || []
        config[i].depends_on.push(stackname)
      }

      core.info(
        `Adding output-${type} ${variable_name} from ${stackname} to ${config[i].id}`
      )
      if (type === 'var' || type === 'secret') {
        if (!config[depends_on_stack_index][`output-${type}`]) {
          config[depends_on_stack_index][`output-${type}`] = []
        }
        if (
          !config[depends_on_stack_index][`output-${type}`]?.includes(
            variable_name
          )
        ) {
          config[depends_on_stack_index][`output-${type}`]?.push(
            trimArrayIndex(variable_name)
          )
        }
      }
    } else {
      // Stack not in config - this is a cross-config reference
      // Values will be resolved from GitHub secrets/KeyVault at runtime
      core.warning(`Stack ${stackname} not found in config`)
    }
    return config[i]
  } else if (Array.isArray(value)) {
    for (let j = 0; j < value.length; j++) {
      config[i] = update_deploy_config(config, i, key, value[j], depth + 1)
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, nestedValue] of Object.entries(value)) {
      config[i] = update_deploy_config(config, i, key, nestedValue, depth + 1)
    }
  }
  return config[i]
}
