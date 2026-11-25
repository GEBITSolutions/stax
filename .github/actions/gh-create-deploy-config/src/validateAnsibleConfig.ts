import { ITerraformConfig, ITerraformLayerConfig } from './types.js'
import { containsAsciiControlCharacter } from './validatePackerConfig.js'

/** Variables Ansible sets itself; stack inputs must not override them. */
const RESERVED_VARIABLES = new Set([
  'inventory_hostname',
  'inventory_hostname_short',
  'inventory_file',
  'inventory_dir',
  'playbook_dir',
  'group_names',
  'groups',
  'hostvars',
  'omit',
  'environment'
])

function invalid(
  config: ITerraformConfig,
  field: string,
  reason: string
): never {
  throw new Error(
    `Ansible stack "${config.id}" has invalid ${field}: ${reason}.`
  )
}

/** Returns the repository-relative YAML path without "." segments. */
function ansiblePath(
  config: ITerraformConfig,
  field: 'ansible_inventory' | 'ansible_playbook'
): string {
  const value: unknown = config[field]
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(config, field, 'must be a nonempty YAML file path')
  }
  if (/^[A-Za-z]:/.test(value) || value.startsWith('/')) {
    invalid(config, field, 'must be repository-relative')
  }
  if (value.includes('\\')) invalid(config, field, 'must use POSIX separators')
  if (containsAsciiControlCharacter(value)) {
    invalid(config, field, 'must not contain control characters')
  }
  const segments = value.split('/')
  if (segments.includes('..') || segments.includes('')) {
    invalid(config, field, 'must not contain parent or empty path segments')
  }
  if (!/\.ya?ml$/.test(value)) {
    invalid(config, field, 'must name a .yml or .yaml file')
  }
  return segments.filter((segment) => segment !== '.').join('/')
}

export function validateAnsibleConfig(config: ITerraformConfig): void {
  if (config.type !== 'ansible') return

  if (!/^[A-Za-z0-9_-]+$/.test(config.id)) {
    invalid(
      config,
      'id',
      'must contain only letters, digits, underscores or hyphens'
    )
  }
  ansiblePath(config, 'ansible_inventory')
  ansiblePath(config, 'ansible_playbook')
  const runner = config['runs-on']
  if (
    typeof runner !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runner)
  ) {
    invalid(config, 'runs-on', 'must be one runner label')
  }

  if (config.input !== undefined) {
    if (!Array.isArray(config.input)) {
      invalid(config, 'input', 'must be a list of single-key mappings')
    }
    const destinations = new Set<string>()
    for (const entry of config.input as unknown[]) {
      if (
        entry === null ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.keys(entry).length !== 1
      ) {
        invalid(config, 'input', 'each entry must be a single-key mapping')
      }
      const destination = Object.keys(entry)[0]
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(destination)) {
        invalid(
          config,
          'input',
          `"${destination}" is not a valid variable name`
        )
      }
      if (
        /^ansible_/i.test(destination) ||
        RESERVED_VARIABLES.has(destination.toLowerCase())
      ) {
        invalid(config, 'input', `"${destination}" is reserved for Ansible`)
      }
      if (destinations.has(destination)) {
        invalid(config, 'input', `"${destination}" is declared twice`)
      }
      destinations.add(destination)
    }
  }

  for (const field of ['source_repo', 'source_version'] as const) {
    if (config[field])
      invalid(config, field, 'external sources are not supported')
  }
  for (const field of ['output-var', 'output-secret'] as const) {
    if (config[field]?.length)
      invalid(config, field, 'outputs are not supported')
  }
  if (config.destroy === true || config.destroy === 'true') {
    invalid(config, 'destroy', 'destroy is not supported')
  }
}

/** A destroy run rejects the whole selection when it contains an Ansible stack. */
export function validateAnsibleSelection(
  configs: readonly ITerraformConfig[],
  globalVars: Record<string, string | boolean>
): void {
  const ansible = configs.find((config) => config.type === 'ansible')
  if (
    ansible !== undefined &&
    (globalVars['destroy'] === true || globalVars['destroy'] === 'true')
  ) {
    throw new Error(
      `Ansible stack "${ansible.id}" does not support destroy=true.`
    )
  }
}

/** Ansible stacks in one level run in parallel, so they must not share an inventory. */
export function validateAnsibleLayerOverlap(
  layers: readonly (readonly ITerraformLayerConfig[])[]
): void {
  for (const layer of layers) {
    const inventories = new Map<string, string>()
    for (const config of layer) {
      if (config.type !== 'ansible') continue
      const inventory = ansiblePath(config, 'ansible_inventory')
      const previous = inventories.get(inventory)
      if (previous !== undefined) {
        throw new Error(
          `Ansible stacks "${previous}" and "${config.id}" share inventory "${inventory}" in one level; add depends_on between them.`
        )
      }
      inventories.set(inventory, config.id)
    }
  }
}
