import {
  InputType,
  ghEnvironmentType,
  GlobalsContext,
  SecretReader
} from './types.js'
import * as core from '@actions/core'
import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'

function shouldBeComplexString(input: string): boolean {
  return (
    input.startsWith('stack.') ||
    input.startsWith('global.') ||
    input.startsWith('globals.') ||
    input.startsWith('config.') ||
    input.startsWith('gh.') ||
    input.startsWith('externalRepos.')
  )
}

async function resolveArrayIndex(
  stackname: string,
  key: string,
  type: keyof ghEnvironmentType,
  ghEnvironment: ghEnvironmentType,
  secretStore: SecretReader | null,
  allowNull: boolean
): Promise<string | undefined> {
  const arrayMatch = key.match(/(.+)\[(-?\d+)\]$/)
  if (!arrayMatch) return undefined

  const [, baseKey, indexStr] = arrayMatch

  core.info(`Array Match: ${arrayMatch}`)

  let rawValue: string | undefined

  if (secretStore == null) {
    rawValue =
      ghEnvironment[type]?.[
        `${stackname.toUpperCase().replace(/-/g, '_')}__${baseKey.toUpperCase()}`
      ]
  } else {
    try {
      rawValue = await secretStore.getSecret(`${stackname}__${baseKey}`)
    } catch (error) {
      if (!allowNull) {
        throw error
      }
      return 'dummy'
    }
  }

  if (!rawValue) {
    if (!allowNull) {
      throw new Error('Value is undefined, null, or empty')
    } else {
      return 'dummy'
    }
  }
  const values = rawValue.split(',')
  const index = Number(indexStr)

  if (index >= values.length || (index < 0 && Math.abs(index) > values.length))
    throw new Error('Array index out of bounds')

  return values.at(index)
}
export async function resolveEnvValue(
  basePathValue: string,
  input: string,
  ghEnvironment: ghEnvironmentType,
  secretStore: SecretReader | null,
  allowNull: boolean,
  globalsContext: GlobalsContext | null = null
): Promise<{ value: InputType; key: string }> {
  const split = input.split('.')
  const isComplexString = shouldBeComplexString(input)
  core.info(
    `Resolving Value for Input: ${input}, isComplexString: ${isComplexString}`
  )
  if (input === 'secret_backend' || input.startsWith('secret_backend.')) {
    if (!/^secret_backend\.secret\.[A-Za-z0-9_-]+$/.test(input)) {
      throw new Error(`Invalid secret backend reference: ${input}`)
    }

    const key = input.slice('secret_backend.secret.'.length)
    const backend = globalsContext?.secretBackend ?? 'gh'
    let value: string | undefined
    if (backend === 'vault') {
      const vaultStore = globalsContext?.vaultStore
      if (!vaultStore) {
        throw new Error(
          `Key Vault is not configured for secret_backend.secret.${key}`
        )
      }
      value = await vaultStore.getSecret(key)
    } else {
      value = ghEnvironment.secret[key.toUpperCase()]
    }

    if (!value) {
      throw new Error(`Secret ${key} is missing or empty in ${backend} backend`)
    }
    core.setSecret(value)
    core.info(`✓ Resolved secret_backend.secret.${key} from ${backend} backend`)
    return { key, value }
  }

  if (isComplexString) {
    // --- globals.* (plural) deprecation shim ---
    if (split[0] === 'globals' && split.length >= 2) {
      const legacyKey = split.slice(1).join('.')
      core.warning(
        `⚠ DEPRECATED: "globals.${legacyKey}" uses legacy syntax. ` +
          `Migrate to "global.config.var.${legacyKey}". ` +
          `The "globals.*" prefix will be removed in a future version.`
      )
      if (globalsContext?.config && legacyKey in globalsContext.config) {
        return { key: legacyKey, value: globalsContext.config[legacyKey] }
      }
      if (!allowNull) {
        throw new Error(
          `Config global not found: ${legacyKey} (via deprecated globals.* syntax)`
        )
      }
      core.warning(
        `⚠ Using dummy value for globals.${legacyKey} (not found in config globals)`
      )
      return { key: legacyKey, value: 'dummy' }
    }

    // --- global.config.var.* and global.pipeline.var.* ---
    if (split[0] === 'global' && split.length === 4) {
      const [, namespace, type, key] = split
      if (namespace === 'config' && type === 'var') {
        if (globalsContext?.config && key in globalsContext.config) {
          core.info(`✓ Resolved global.config.var.${key} from config globals`)
          return { key, value: globalsContext.config[key] }
        }
        if (!allowNull) {
          core.error(`✗ Config global not found: ${key}`)
          throw new Error(`Config global not found: ${key}`)
        }
        core.warning(
          `⚠ Using dummy value for global.config.var.${key} (not found)`
        )
        return { key, value: 'dummy' }
      }
      if (namespace === 'pipeline' && type === 'var') {
        if (globalsContext?.pipeline && key in globalsContext.pipeline) {
          const pipelineValue = globalsContext.pipeline[key]
          core.info(
            `✓ Resolved global.pipeline.var.${key} from pipeline globals`
          )
          return {
            key,
            value:
              typeof pipelineValue === 'boolean'
                ? String(pipelineValue)
                : pipelineValue
          }
        }
        if (!allowNull) {
          core.error(`✗ Pipeline global not found: ${key}`)
          throw new Error(`Pipeline global not found: ${key}`)
        }
        core.warning(
          `⚠ Using dummy value for global.pipeline.var.${key} (not found)`
        )
        return { key, value: 'dummy' }
      }
      // Fall through to existing stack/config/global resolution
    }

    if (
      ['config', 'global', 'stack'].includes(split[0]) &&
      split.length !== 4
    ) {
      throw new Error(
        'Split length must be 4 for stack, global, config prefixed input'
      )
    }
    if (['gh'].includes(split[0]) && split.length !== 3) {
      throw new Error('Split length must be 3 for gh prefixed input')
    }
    if (['externalRepos'].includes(split[0]) && split.length <= 3) {
      throw new Error(
        'Split length must be greater or equal 3 for externalRepos prefixed input'
      )
    }

    if (['config', 'global', 'stack'].includes(split[0])) {
      const [, stackname, type, key] = split
      if (type !== 'var' && type !== 'secret') {
        throw new Error(`Type must be 'var' or 'secret' for ${input}`)
      }

      const resolvedArrayValue = await resolveArrayIndex(
        stackname,
        key,
        type,
        ghEnvironment,
        secretStore,
        allowNull
      )

      let value: string | undefined
      let source = ''
      let logged = false
      const storeLabel = secretStore?.storeLabel ?? 'Environment'

      // If array value was resolved, use it
      if (resolvedArrayValue !== null && resolvedArrayValue !== undefined) {
        value = resolvedArrayValue
        source = `${storeLabel} (array)`
      } else if (secretStore !== null) {
        // Use the configured keystore for non-array values when available
        try {
          value = await secretStore.getSecret(`${stackname}__${key}`)
          source = storeLabel
          logged = true
          core.info(
            `✓ Resolved ${split[0]}.${stackname}.${type}.${key} from ${storeLabel}`
          )
        } catch (error) {
          if (!allowNull) {
            core.error(
              `✗ Failed to resolve ${split[0]}.${stackname}.${type}.${key} from ${storeLabel}`
            )
            throw error
          }
          value = 'dummy'
          source = `dummy (${storeLabel} error)`
          logged = true
          core.warning(
            `⚠ Using dummy value for ${split[0]}.${stackname}.${type}.${key} (${storeLabel} error)`
          )
        }
      } else {
        // Fall back to environment variables
        value =
          ghEnvironment[type]?.[
            `${stackname
              .toUpperCase()
              .replace(/-/g, '_')}__${key.toUpperCase()}`
          ]
        source = 'Environment'
      }

      if (!value) {
        if (!allowNull) {
          core.error(
            `✗ Value not found for ${split[0]}.${stackname}.${type}.${key}`
          )
          throw new Error('Value is undefined, null, or empty')
        } else {
          value = `dummy`
          source = 'dummy (not found)'
          logged = true
          core.warning(
            `⚠ Using dummy value for ${split[0]}.${stackname}.${type}.${key} (not found)`
          )
        }
      }

      if (!logged) {
        core.info(
          `✓ Resolved ${split[0]}.${stackname}.${type}.${key} from ${source}`
        )
      }

      return { key, value }
    } else if (['gh'].includes(split[0])) {
      const [, type, key] = split
      if (type !== 'var' && type !== 'secret') {
        throw new Error(`Type must be 'var' or 'secret' for ${input}`)
      }

      let value = ghEnvironment[type]?.[key.toUpperCase()]
      if (!value) {
        if (!allowNull) {
          core.error(`✗ GitHub ${type} not found: ${key}`)
          throw new Error('Value is undefined, null, or empty')
        } else {
          value = 'dummy'
          core.warning(`⚠ Using dummy value for gh.${type}.${key} (not found)`)
        }
      } else {
        if (type === 'secret') core.setSecret(value)
        core.info(`✓ Resolved gh.${type}.${key} from GitHub Environment`)
      }
      return { key, value }
    } else if (['externalRepos'].includes(split[0])) {
      const [, repo_name] = split

      core.info(`repo_name: ${split}`)
      const filePath = input
        .split('externalRepos.')[1]
        .replace(`${repo_name}.`, `${repo_name}/`)
      try {
        const data = fs.readFileSync(
          path.resolve(basePathValue, `externalRepos/${filePath}`),
          'utf8'
        )
        try {
          const value = parse(data.toString())
          core.info(
            `✓ Resolved externalRepos.${repo_name} from file: ${filePath}`
          )
          return { key: repo_name, value }
        } catch (parseErr) {
          core.error(
            `✗ Failed to parse YAML for externalRepos.${repo_name}: ${parseErr}`
          )
          throw new Error(`at parsing YAML: ${parseErr}`)
        }
      } catch (err) {
        core.error(`✗ Failed to read externalRepos file: ${filePath}`)
        throw new Error(`Error reading externalRepos file: ${err}`)
      }
    }
  }

  core.info(`✓ Using literal value: ${input}`)
  return { key: input, value: input } // Return as-is if no strict rule applies
}

export async function createValue(
  basePathValue: string,
  input: InputType,
  ghEnvironment: ghEnvironmentType,
  secretStore: SecretReader | null,
  allowNull: boolean,
  globalsContext: GlobalsContext | null = null
): Promise<InputType> {
  if (JSON.stringify(input) === '{}') {
    throw new Error('Input cannot be an empty object')
  }

  if (typeof input === 'string') {
    return (
      await resolveEnvValue(
        basePathValue,
        input,
        ghEnvironment,
        secretStore,
        allowNull,
        globalsContext
      )
    ).value
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    return input
  }

  if (Array.isArray(input)) {
    return (await Promise.all(
      input.map((item) =>
        createValue(
          basePathValue,
          item,
          ghEnvironment,
          secretStore,
          allowNull,
          globalsContext
        )
      )
    )) as InputType
  }

  if (typeof input === 'object' && input !== null) {
    const output: Record<string, InputType> = {}
    for (const [key, nestedValue] of Object.entries(input)) {
      output[key] = await createValue(
        basePathValue,
        nestedValue,
        ghEnvironment,
        secretStore,
        allowNull,
        globalsContext
      )
    }
    return output
  }

  throw new Error('Unsupported input type')
}

export async function createKeyValue(
  basePathValue: string,
  input: InputType,
  ghEnvironment: ghEnvironmentType,
  secretStore: SecretReader | null,
  topLevel: boolean = false,
  allowNull: boolean = false,
  globalsContext: GlobalsContext | null = null
): Promise<{ key: string; value: InputType }> {
  if (JSON.stringify(input) === '{}') {
    throw new Error('Input cannot be an empty object')
  }

  if (typeof input === 'string') {
    if (topLevel && input.startsWith('externalRepos.')) {
      throw new Error('Top-level input cannot be an externalRepos reference')
    }
    return await resolveEnvValue(
      basePathValue,
      input,
      ghEnvironment,
      secretStore,
      allowNull,
      globalsContext
    )
  }

  if (typeof input === 'object' && input !== null) {
    const key = Object.keys(input)[0]
    const value = await createValue(
      basePathValue,
      Object.values(input)[0],
      ghEnvironment,
      secretStore,
      allowNull,
      globalsContext
    )
    return { key, value }
  }

  throw new Error('Invalid input for createKeyValue')
}

// export function lowercaseKeys<T>(object: { [key: string]: T }): {
//   [key: string]: T;
// } {
//   return Object.fromEntries(
//     Object.entries(object).map(([key, value]) => [key.toLowerCase(), value])
//   );
// }
