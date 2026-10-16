import { ITerraformConfig } from './types.js'
import * as core from '@actions/core'

export function generate_stackfilter(
  deploy_config: Array<ITerraformConfig>,
  stack_filter: string,
  global_tf_vars: Record<string, string | boolean>
): string[] {
  let final_stack_filter = stack_filter.split(',')

  if (final_stack_filter.length === 1 && final_stack_filter[0] === '') {
    final_stack_filter = []
  }

  // Stack-Groups
  const resolved_group_stack_ids: Array<string> = []
  for (let i = 0; i < final_stack_filter.length; i++) {
    if (final_stack_filter[i].startsWith('group-')) {
      const group_stacks = deploy_config.filter((config) =>
        config['stack-groups']?.includes(final_stack_filter[i])
      )
      core.debug(
        `Resolved group ${final_stack_filter[i]} to stacks ${group_stacks
          .map((config) => config.id)
          .join(',')}`
      )
      resolved_group_stack_ids.push(...group_stacks.map((config) => config.id))
    }
  }
  final_stack_filter = final_stack_filter.filter((v) => !v.startsWith('group-'))
  final_stack_filter.push(...resolved_group_stack_ids)

  // Before and after dependencies
  for (let i = 0; i < final_stack_filter.length; i++) {
    let stacks_before = false
    let stacks_after = false

    if (final_stack_filter[i].startsWith('>')) {
      final_stack_filter[i] = final_stack_filter[i].slice(1)
      stacks_before = true
    }

    if (final_stack_filter[i].endsWith('<')) {
      final_stack_filter[i] = final_stack_filter[i].slice(0, -1)
      stacks_after = true
    }

    if (stacks_before) {
      let dependencies = deploy_config
        .filter((config) => config.id === final_stack_filter[i])
        .flatMap((config) => config.depends_on || [])
      while (dependencies.length > 0) {
        final_stack_filter = final_stack_filter.concat(dependencies)
        // TODO: logging console.log(
        //   `Adding before dependencies: ${dependencies.join(",")} for stack ${
        //     final_stack_filter[i]
        //   }`
        // );
        dependencies = deploy_config
          .filter((config) => dependencies.includes(config.id))
          .flatMap((config) => config.depends_on || [])
      }
    }

    if (stacks_after) {
      const dependents = deploy_config
        .filter((config) => config.depends_on?.includes(final_stack_filter[i]))
        .map((config) => config.id)
      //   TODO: logging console.log(
      //     `Adding after dependencies: ${dependents.join(",")} for stack ${
      //       final_stack_filter[i]
      //     }`
      //   );
      final_stack_filter = final_stack_filter.concat(dependents)
    }
  }
  for (let i = 0; i < deploy_config.length; i++) {
    if (deploy_config[i].if) {
      const condition = deploy_config[i].if
        ?.replace(
          '{dns_zone_name}',
          (global_tf_vars['dns_zone_name'] || '').toString()
        )
        .replace('{stage}', (global_tf_vars['stage'] || '').toString())
        .replace(
          '{has_release_tag}',
          (global_tf_vars['has_release_tag'] || '').toString()
        )
        .replace(
          '{customer_id}',
          (global_tf_vars['customer_id'] || '').toString()
        )
        .replace(
          '{resource_group_name}',
          (global_tf_vars['resource_group_name'] || '').toString()
        )

      try {
        if (!Function(`"use strict"; return (${condition})`)()) {
          core.debug(
            `Stack condition ${condition} not met, remove stack ${deploy_config[i].id} from stack_filter`
          )
          final_stack_filter = final_stack_filter.filter(
            (v) => v !== deploy_config[i].id
          )
        }
      } catch (_e) {
        core.debug(
          `Invalid condition: ${condition}. Removing stack ${deploy_config[i].id}`
        )
        final_stack_filter = final_stack_filter.filter(
          (v) => v !== deploy_config[i].id
        )
      }
    }
  }

  final_stack_filter = final_stack_filter.reduce<string[]>(
    (acc, cur) => (acc.includes(cur) ? acc : [...acc, cur]),
    []
  )

  final_stack_filter.forEach((id) => {
    if (!deploy_config.some((config) => config.id === id)) {
      core.warning(`Stack ${id} not found in config`)
    }
  })

  return final_stack_filter
}

export function apply_stack_filter(
  deploy_config: Array<ITerraformConfig>,
  expanded_stack_filter: string[]
) {
  const selectedStacks = new Set(expanded_stack_filter)
  const configById = new Map(deploy_config.map((config) => [config.id, config]))

  const resolveSelectedAncestors = (
    dependencyId: string,
    stackId: string
  ): string[] => {
    if (dependencyId === stackId) {
      return []
    }

    const dependencyConfig = configById.get(dependencyId)
    if (!dependencyConfig) {
      return []
    }

    if (selectedStacks.has(dependencyId)) {
      return [dependencyId]
    }

    const resolvedDependencies: string[] = []
    const activePath = new Set([stackId, dependencyId])
    const frames: Array<{
      id: string
      dependencies: string[]
      nextDependencyIndex: number
    }> = [
      {
        id: dependencyId,
        dependencies: dependencyConfig.depends_on || [],
        nextDependencyIndex: 0
      }
    ]

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      if (frame.nextDependencyIndex === frame.dependencies.length) {
        activePath.delete(frame.id)
        frames.pop()
        continue
      }

      const childId = frame.dependencies[frame.nextDependencyIndex]
      frame.nextDependencyIndex += 1

      if (childId === stackId || activePath.has(childId)) {
        continue
      }

      const childConfig = configById.get(childId)
      if (!childConfig) {
        continue
      }

      if (selectedStacks.has(childId)) {
        resolvedDependencies.push(childId)
        continue
      }

      activePath.add(childId)
      frames.push({
        id: childId,
        dependencies: childConfig.depends_on || [],
        nextDependencyIndex: 0
      })
    }

    return resolvedDependencies
  }

  return deploy_config.reduce(
    (localLayerDeployments: Array<ITerraformConfig>, config) => {
      if (!selectedStacks.has(config.id)) {
        return localLayerDeployments
      }

      const depends_on = new Set<string>()
      for (const dependency of config.depends_on || []) {
        for (const resolvedDependency of resolveSelectedAncestors(
          dependency,
          config.id
        )) {
          depends_on.add(resolvedDependency)
        }
      }

      localLayerDeployments.push({ ...config, depends_on: [...depends_on] })
      return localLayerDeployments
    },
    []
  )
}

export default { generate_stackfilter, apply_stack_filter }
