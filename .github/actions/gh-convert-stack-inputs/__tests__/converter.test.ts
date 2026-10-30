import { jest } from '@jest/globals'
import fs from 'fs'
import path from 'path'
import { stringify } from 'yaml'

import {
  createValue,
  createKeyValue,
  resolveEnvValue
} from '../src/converter.js'

const basePathValue = process.cwd()

const ghEnvironment = {
  var: {
    TEST_VAR: 'test_value',
    DNS__TEST_VAR: 'test_value',
    AKS__TEST_VAR: 'aks_value',
    PLAIN_REF_CUSTOM_KEY: 'plain_ref_custom_value',
    RANDOM_STRING__RANDOM_STRING: 'random_string_value',
    TEST__ARRAY_STR_VAR: 'value1,value2'
  },
  secret: {
    DNS__SECRET_VAR: 'secret_value'
  }
}

const allowNullFalse = false

const ghEnvWithArray = {
  var: {
    TEST__ARRAY_STR_VAR: 'value1,value2'
  },
  secret: {}
}

describe('resolveEnvValue', () => {
  it('resolves value with key correctly using resolveEnvValue', async () => {
    const result = await resolveEnvValue(
      basePathValue,
      'stack.dns.var.test_var',
      ghEnvironment,
      null,
      allowNullFalse
    )
    expect(result).toStrictEqual({ key: 'test_var', value: 'test_value' })
  })
})

describe('createKeyValue', () => {
  it('throws an error for unsupported input types', async () => {
    const invalidInputs = [null, undefined, () => {}, Symbol('invalid')]

    for (const input of invalidInputs) {
      await expect(
        createKeyValue(
          basePathValue,
          input as unknown as string,
          {
            var: {},
            secret: {}
          },
          null
        )
      ).rejects.toThrow('Invalid input for createKeyValue')
    }
  })

  it('keeps cases of output objects', async () => {
    const input = { varName: 'stack.dns.var.test_var' }
    expect(
      await createKeyValue(basePathValue, input, ghEnvironment, null)
    ).toStrictEqual({
      key: 'varName',
      value: 'test_value'
    })
  })

  it('replaces - with _ in stack names', async () => {
    const input = 'stack.random-string.var.random_string'
    expect(
      await createKeyValue(basePathValue, input, ghEnvironment, null)
    ).toStrictEqual({
      key: 'random_string',
      value: 'random_string_value'
    })
  })

  it('throws an error when input is an empty object', async () => {
    await expect(
      createKeyValue(basePathValue, {}, { var: {}, secret: {} }, null)
    ).rejects.toThrow('Input cannot be an empty object')
  })

  it('throws an error when split length is not 4 for global prefixed inputs', async () => {
    await expect(
      createKeyValue(basePathValue, 'global.foo.bar', ghEnvironment, null)
    ).rejects.toThrow(
      'Split length must be 4 for stack, global, config prefixed input'
    )
  })

  it('throws an error when split length is not 3 for prefixed inputs', async () => {
    await expect(
      createKeyValue(basePathValue, 'gh.foo.bar.test', ghEnvironment, null)
    ).rejects.toThrow('Split length must be 3 for gh prefixed input')
  })

  it("throws an error when config, global, stack type is not 'var' or 'secret'", async () => {
    await expect(
      createKeyValue(basePathValue, 'stack.foo.bar', ghEnvironment, null)
    ).rejects.toThrow(
      'Split length must be 4 for stack, global, config prefixed input'
    )
  })

  it('throws an error when split length is not 4 for config prefixed inputs', async () => {
    await expect(
      createKeyValue(basePathValue, 'config.foo.bar', ghEnvironment, null)
    ).rejects.toThrow(
      'Split length must be 4 for stack, global, config prefixed input'
    )
  })

  it("throws an error when type is not 'var' or 'secret'", async () => {
    await expect(
      createKeyValue(
        basePathValue,
        'stack.foo.invalid.test',
        ghEnvironment,
        null
      )
    ).rejects.toThrow(
      "Type must be 'var' or 'secret' for stack.foo.invalid.test"
    )
  })

  it('throws an error when value is undefined, null, or empty', async () => {
    await expect(
      createKeyValue(
        basePathValue,
        'stack.dns.var.undefined_key',
        ghEnvironment,
        null
      )
    ).rejects.toThrow('Value is undefined, null, or empty')
  })

  it('returns key-value pair for gh variable key', async () => {
    expect(
      await createKeyValue(
        basePathValue,
        'gh.var.plain_ref_custom_key',
        ghEnvironment,
        null
      )
    ).toStrictEqual({
      key: 'plain_ref_custom_key',
      value: 'plain_ref_custom_value'
    })
  })

  it('returns a valid key-value pair for a var reference', async () => {
    expect(
      await createKeyValue(
        basePathValue,
        'stack.dns.var.test_var',
        ghEnvironment,
        null
      )
    ).toStrictEqual({ key: 'test_var', value: 'test_value' })
  })

  it('returns a valid key-value pair for a secret reference', async () => {
    expect(
      await createKeyValue(
        basePathValue,
        'stack.dns.secret.secret_var',
        ghEnvironment,
        null
      )
    ).toStrictEqual({ key: 'secret_var', value: 'secret_value' })
  })

  it('returns key-value pair for non-prefixed string', async () => {
    expect(
      await createKeyValue(basePathValue, 'custom_key', ghEnvironment, null)
    ).toStrictEqual({
      key: 'custom_key',
      value: 'custom_key'
    })
  })

  it('handles an object input correctly', async () => {
    const input = { var_name: 'stack.dns.var.test_var' }
    expect(
      await createKeyValue(basePathValue, input, ghEnvironment, null)
    ).toStrictEqual({
      key: 'var_name',
      value: 'test_value'
    })
  })
  it('handles an object input with gh ref correctly', async () => {
    const input = { var_name: 'gh.var.test_var' }
    expect(
      await createKeyValue(basePathValue, input, ghEnvironment, null)
    ).toStrictEqual({
      key: 'var_name',
      value: 'test_value'
    })
  })

  it('handles a numeric key-value pair', async () => {
    const input = { var_name: 123 }
    expect(
      await createKeyValue(basePathValue, input, ghEnvironment, null)
    ).toStrictEqual({
      key: 'var_name',
      value: 123
    })
  })

  it('forbids resolve external-config paths without key', async () => {
    const input = 'externalRepos.rp_solutions_mirror_dev.config/ocs-dev-v3.yaml'
    await expect(
      createKeyValue(basePathValue, input, ghEnvironment, null, true)
    ).rejects.toThrow('Top-level input cannot be an externalRepos reference')
  })

  it('throws an error for externalRepo split lenght < 3', async () => {
    const input = 'externalRepos.rp_solutions_mirror_dev'
    await expect(
      createKeyValue(basePathValue, input, ghEnvironment, null)
    ).rejects.toThrow(
      'Split length must be greater or equal 3 for externalRepos prefixed input'
    )
  })

  it('is able to resolve external-config paths to values', async () => {
    const fileName = 'ocs-dev-v3.yaml'
    const configPath = path.resolve(
      path.resolve(),
      'externalRepos/rp_solutions_mirror_dev/config'
    )

    if (!fs.existsSync(configPath)) {
      fs.mkdirSync(configPath, { recursive: true })
    }

    fs.writeFileSync(`${configPath}/${fileName}`, stringify(['test1', 'test2']))
    const input = {
      value: `externalRepos.rp_solutions_mirror_dev.config/${fileName}`
    }
    expect(
      await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        allowNullFalse
      )
    ).toStrictEqual({
      key: 'value',
      value: ['test1', 'test2']
    })
    fs.rmSync(`${configPath}/../`, { recursive: true, force: true })
  })

  it('keeps capital charackters in the key', async () => {
    const input = {
      FAIvSkiYtuepdFZy3JpK: 'FAIvSkiYtuepdFZy3JpK'
    }
    expect(
      await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        allowNullFalse
      )
    ).toStrictEqual({
      key: 'FAIvSkiYtuepdFZy3JpK',
      value: 'FAIvSkiYtuepdFZy3JpK'
    })
  })

  it('handles a object with raw and ref keys', async () => {
    const input = {
      var_name: {
        key: 'stack.dns.var.test_var',
        key2: 'test.dns.var.test_var'
      }
    }
    expect(
      await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        allowNullFalse
      )
    ).toStrictEqual({
      key: 'var_name',
      value: {
        key: 'test_value',
        key2: 'test.dns.var.test_var'
      }
    })
  })

  it('handles a list of objects with raw and ref values', async () => {
    const input = {
      var_name: [
        {
          key: 'stack.dns.var.test_var',
          key2: 'test.dns.var.test_var'
        }
      ]
    }
    expect(
      await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        allowNullFalse
      )
    ).toStrictEqual({
      key: 'var_name',
      value: [
        {
          key: 'test_value',
          key2: 'test.dns.var.test_var'
        }
      ]
    })
  })

  it('handles nested object input correctly', async () => {
    const input = { var_name: { nested_key: 'stack.dns.var.test_var' } }
    expect(
      await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        allowNullFalse
      )
    ).toStrictEqual({
      key: 'var_name',
      value: { nested_key: 'test_value' }
    })
  })
})

describe('createValue', () => {
  it('throws an error for an empty object', async () => {
    await expect(
      createValue(basePathValue, {}, ghEnvironment, null, allowNullFalse)
    ).rejects.toThrow('Input cannot be an empty object')
  })
  it('throws an error when split length is not 4 for stack prefixed inputs', async () => {
    await expect(
      createValue(
        basePathValue,
        'stack.foo.bar',
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).rejects.toThrow(
      'Split length must be 4 for stack, global, config prefixed input'
    )
  })
  it('throws an error when split length is not 4 for global prefixed inputs', async () => {
    await expect(
      createValue(
        basePathValue,
        'stack.foo.bar',
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).rejects.toThrow(
      'Split length must be 4 for stack, global, config prefixed input'
    )
  })

  it('replaces - with _ in stack names', async () => {
    const input = 'stack.random-string.var.random_string'
    expect(
      await createValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).toStrictEqual('random_string_value')
  })

  it("throws an error when type is not 'var' or 'secret'", async () => {
    await expect(
      createValue(
        basePathValue,
        'stack.foo.invalid.test',
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).rejects.toThrow(
      "Type must be 'var' or 'secret' for stack.foo.invalid.test"
    )
  })

  it('throws an error when value is undefined, null, or empty', async () => {
    await expect(
      createValue(
        basePathValue,
        'stack.dns.var.undefined_key',
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).rejects.toThrow('Value is undefined, null, or empty')
  })

  it('returns a valid value for a correct var reference', async () => {
    expect(
      await createValue(
        basePathValue,
        'stack.dns.var.test_var',
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).toBe('test_value')
  })

  it('returns a valid value for a correct secret reference', async () => {
    expect(
      await createValue(
        basePathValue,
        'stack.dns.secret.secret_var',
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).toBe('secret_value')
  })

  it('returns raw input when no enforced structure is required', async () => {
    expect(
      await createValue(
        basePathValue,
        'random_string',
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).toBe('random_string')
  })

  it('handles number input correctly', async () => {
    expect(
      await createValue(basePathValue, 42, ghEnvironment, null, allowNullFalse)
    ).toBe(42)
  })

  it('handles boolean input correctly', async () => {
    expect(
      await createValue(
        basePathValue,
        true,
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).toBe(true)
  })

  it('handles an array of inputs correctly', async () => {
    const input = ['stack.dns.var.test_var', 'stack.aks.var.test_var']
    expect(
      await createValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).toStrictEqual(['test_value', 'aks_value'])
  })

  it('handles nested objects correctly', async () => {
    const input = { nested: { var_name: 'stack.dns.var.test_var' } }
    expect(
      await createValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        allowNullFalse
      )
    ).toStrictEqual({
      nested: { var_name: 'test_value' }
    })
  })

  it('supports array index syntax in variable names', async () => {
    expect(
      await createValue(
        basePathValue,
        'stack.test.var.ARRAY_STR_VAR[0]',
        ghEnvWithArray,
        null,
        allowNullFalse
      )
    ).toBe('value1')
    expect(
      await createValue(
        basePathValue,
        'stack.test.var.ARRAY_STR_VAR[1]',
        ghEnvWithArray,
        null,
        allowNullFalse
      )
    ).toBe('value2')
  })

  it('works with reverse indexes', async () => {
    expect(
      await createValue(
        basePathValue,
        'stack.test.var.ARRAY_STR_VAR[-1]',
        ghEnvWithArray,
        null,
        allowNullFalse
      )
    ).toBe('value2')
  })

  it('throws array index out of bounds', async () => {
    await expect(
      createValue(
        basePathValue,
        'stack.test.var.ARRAY_STR_VAR[2]',
        ghEnvWithArray,
        null,
        allowNullFalse
      )
    ).rejects.toThrow('Array index out of bounds')
    await expect(
      createValue(
        basePathValue,
        'stack.test.var.ARRAY_STR_VAR[-3]',
        ghEnvWithArray,
        null,
        allowNullFalse
      )
    ).rejects.toThrow('Array index out of bounds')
  })
})

describe('allowNull = true behavior', () => {
  const allowNullTrue = true

  describe('resolveEnvValue with allowNull = true', () => {
    it('returns dummy value when variable is undefined and allowNull is true', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'stack.dns.var.undefined_key',
        ghEnvironment,
        null,
        allowNullTrue
      )
      expect(result).toStrictEqual({ key: 'undefined_key', value: 'dummy' })
    })

    it('returns dummy value when gh variable is undefined and allowNull is true', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'gh.var.undefined_key',
        ghEnvironment,
        null,
        allowNullTrue
      )
      expect(result).toStrictEqual({ key: 'undefined_key', value: 'dummy' })
    })

    it('returns dummy value when secret is undefined and allowNull is true', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'stack.dns.secret.undefined_secret',
        ghEnvironment,
        null,
        allowNullTrue
      )
      expect(result).toStrictEqual({ key: 'undefined_secret', value: 'dummy' })
    })

    it('returns dummy value when gh secret is undefined and allowNull is true', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'gh.secret.undefined_secret',
        ghEnvironment,
        null,
        allowNullTrue
      )
      expect(result).toStrictEqual({ key: 'undefined_secret', value: 'dummy' })
    })
  })

  describe('createKeyValue with allowNull = true', () => {
    it('returns dummy value when variable is undefined and allowNull is true', async () => {
      const result = await createKeyValue(
        basePathValue,
        'stack.dns.var.undefined_key',
        ghEnvironment,
        null,
        false,
        allowNullTrue
      )
      expect(result).toStrictEqual({ key: 'undefined_key', value: 'dummy' })
    })

    it('handles object input with undefined reference when allowNull is true', async () => {
      const input = { var_name: 'stack.dns.var.undefined_key' }
      const result = await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        allowNullTrue
      )
      expect(result).toStrictEqual({
        key: 'var_name',
        value: 'dummy'
      })
    })

    it('handles nested object with undefined reference when allowNull is true', async () => {
      const input = {
        var_name: {
          nested_key: 'stack.dns.var.undefined_key',
          valid_key: 'stack.dns.var.test_var'
        }
      }
      const result = await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        allowNullTrue
      )
      expect(result).toStrictEqual({
        key: 'var_name',
        value: {
          nested_key: 'dummy',
          valid_key: 'test_value'
        }
      })
    })

    it('handles array with undefined references when allowNull is true', async () => {
      const input = {
        var_name: [
          'stack.dns.var.test_var',
          'stack.dns.var.undefined_key',
          'stack.dns.var.test_var'
        ]
      }
      const result = await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        allowNullTrue
      )
      expect(result).toStrictEqual({
        key: 'var_name',
        value: ['test_value', 'dummy', 'test_value']
      })
    })
  })

  describe('createValue with allowNull = true', () => {
    it('returns dummy value when variable is undefined and allowNull is true', async () => {
      const result = await createValue(
        basePathValue,
        'stack.dns.var.undefined_key',
        ghEnvironment,
        null,
        allowNullTrue
      )
      expect(result).toBe('dummy')
    })

    it('returns dummy value when secret is undefined and allowNull is true', async () => {
      const result = await createValue(
        basePathValue,
        'stack.dns.secret.undefined_secret',
        ghEnvironment,
        null,
        allowNullTrue
      )
      expect(result).toBe('dummy')
    })

    it('handles array with mixed valid and undefined references when allowNull is true', async () => {
      const input = [
        'stack.dns.var.test_var',
        'stack.dns.var.undefined_key',
        'stack.aks.var.test_var'
      ]
      const result = await createValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        allowNullTrue
      )
      expect(result).toStrictEqual(['test_value', 'dummy', 'aks_value'])
    })

    it('handles nested objects with undefined references when allowNull is true', async () => {
      const input = {
        level1: {
          level2: {
            valid: 'stack.dns.var.test_var',
            invalid: 'stack.dns.var.undefined_key'
          }
        }
      }
      const result = await createValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        allowNullTrue
      )
      expect(result).toStrictEqual({
        level1: {
          level2: {
            valid: 'test_value',
            invalid: 'dummy'
          }
        }
      })
    })
  })

  describe('Array index resolution with allowNull = true', () => {
    it('returns dummy value when array variable is undefined and allowNull is true', async () => {
      const emptyGhEnv = { var: {}, secret: {} }
      const result = await createValue(
        basePathValue,
        'stack.test.var.UNDEFINED_ARRAY[0]',
        emptyGhEnv,
        null,
        allowNullTrue
      )
      expect(result).toBe('dummy')
    })

    it('handles resolveArrayIndex with undefined base array when allowNull is true', async () => {
      const emptyGhEnv = { var: {}, secret: {} }
      const result = await resolveEnvValue(
        basePathValue,
        'stack.test.var.UNDEFINED_ARRAY[1]',
        emptyGhEnv,
        null,
        allowNullTrue
      )
      expect(result).toStrictEqual({
        key: 'UNDEFINED_ARRAY[1]',
        value: 'dummy'
      })
    })
  })

  describe('Mixed scenarios with allowNull = true', () => {
    it('processes valid and invalid references correctly in complex object', async () => {
      const input = {
        config: {
          database: {
            host: 'stack.dns.var.test_var',
            password: 'stack.dns.secret.undefined_secret',
            ports: ['stack.dns.var.undefined_key', '3306']
          },
          cache: 'stack.dns.var.test_var'
        }
      }

      const result = await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        allowNullTrue
      )

      expect(result).toStrictEqual({
        key: 'config',
        value: {
          database: {
            host: 'test_value',
            password: 'dummy',
            ports: ['dummy', '3306']
          },
          cache: 'test_value'
        }
      })
    })
  })
})

describe('KeyVault integration tests', () => {
  // Create a dummy KeyVault store for testing
  // Note: Current implementation only uses KeyVault for array index resolution
  // Regular values still come from ghEnvironment
  class DummyKeyVaultStore {
    private secrets: Map<string, string>

    constructor(secrets: Record<string, string> = {}) {
      this.secrets = new Map(Object.entries(secrets))
    }

    async getSecret(key: string): Promise<string> {
      const secret = this.secrets.get(key)
      if (!secret) {
        throw new Error(`Secret ${key} not found`)
      }
      return secret
    }

    setSecret(key: string, value: string): void {
      this.secrets.set(key, value)
    }
  }

  describe('resolveEnvValue with KeyVault for array indices', () => {
    // Note: KeyVault is now used as the primary source when provided

    it('should use KeyVault for values when provided', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__test_var: 'keyvault_test_value'
      })

      const ghEnv = {
        var: {
          DNS__TEST_VAR: 'env_test_value'
        },
        secret: {}
      }

      const result = await resolveEnvValue(
        basePathValue,
        'stack.dns.var.test_var',
        ghEnv,
        keyVaultStore as any,
        allowNullFalse
      )

      // Should use KeyVault value when available
      expect(result).toStrictEqual({
        key: 'test_var',
        value: 'keyvault_test_value'
      })
    })

    it('should resolve array values from KeyVault store', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__array_var: 'kv_value1,kv_value2,kv_value3'
      })

      const result = await resolveEnvValue(
        basePathValue,
        'stack.dns.var.array_var[0]',
        { var: {}, secret: {} },
        keyVaultStore as any,
        allowNullFalse
      )

      expect(result).toStrictEqual({
        key: 'array_var[0]',
        value: 'kv_value1'
      })
    })

    it('should resolve array values with negative index from KeyVault', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__array_var: 'kv_value1,kv_value2,kv_value3'
      })

      const result = await resolveEnvValue(
        basePathValue,
        'stack.dns.var.array_var[-1]',
        { var: {}, secret: {} },
        keyVaultStore as any,
        allowNullFalse
      )

      expect(result).toStrictEqual({
        key: 'array_var[-1]',
        value: 'kv_value3'
      })
    })

    it('should throw error when KeyVault secret is not found and allowNull is false', async () => {
      const keyVaultStore = new DummyKeyVaultStore({})

      await expect(
        resolveEnvValue(
          basePathValue,
          'stack.dns.var.missing_var',
          { var: {}, secret: {} },
          keyVaultStore as any,
          allowNullFalse
        )
      ).rejects.toThrow()
    })

    it('should return dummy value when KeyVault secret is not found and allowNull is true', async () => {
      const keyVaultStore = new DummyKeyVaultStore({})

      const result = await resolveEnvValue(
        basePathValue,
        'stack.dns.var.missing_var',
        { var: {}, secret: {} },
        keyVaultStore as any,
        true
      )

      expect(result).toStrictEqual({
        key: 'missing_var',
        value: 'dummy'
      })
    })
  })

  describe('createKeyValue with KeyVault', () => {
    it('should resolve simple value from KeyVault', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__database_password: 'kv_secret_password'
      })

      const result = await createKeyValue(
        basePathValue,
        'stack.dns.secret.database_password',
        { var: {}, secret: {} },
        keyVaultStore as any
      )

      expect(result).toStrictEqual({
        key: 'database_password',
        value: 'kv_secret_password'
      })
    })

    it('should resolve object values from KeyVault', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__db_host: 'kv_db.example.com',
        dns__db_port: '5432'
      })

      const input = {
        database: {
          host: 'stack.dns.var.db_host',
          port: 'stack.dns.var.db_port'
        }
      }

      const result = await createKeyValue(
        basePathValue,
        input,
        { var: {}, secret: {} },
        keyVaultStore as any
      )

      expect(result).toStrictEqual({
        key: 'database',
        value: {
          host: 'kv_db.example.com',
          port: '5432'
        }
      })
    })

    it('should resolve array values from KeyVault', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__server1: 'kv_server1.example.com',
        dns__server2: 'kv_server2.example.com'
      })

      const input = {
        servers: [
          'stack.dns.var.server1',
          'stack.dns.var.server2',
          'static.example.com'
        ]
      }

      const result = await createKeyValue(
        basePathValue,
        input,
        { var: {}, secret: {} },
        keyVaultStore as any
      )

      expect(result).toStrictEqual({
        key: 'servers',
        value: [
          'kv_server1.example.com',
          'kv_server2.example.com',
          'static.example.com'
        ]
      })
    })

    it('should handle mixed KeyVault and environment variables', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__kv_var: 'from_keyvault',
        dns__env_var: 'also_from_keyvault'
      })

      const ghEnv = {
        var: {
          DNS__ENV_VAR: 'from_environment'
        },
        secret: {}
      }

      const input = {
        config: {
          kvValue: 'stack.dns.var.kv_var',
          envValue: 'stack.dns.var.env_var'
        }
      }

      const result = await createKeyValue(
        basePathValue,
        input,
        ghEnv,
        keyVaultStore as any
      )

      // When KeyVault is provided, it takes priority over environment
      expect(result).toStrictEqual({
        key: 'config',
        value: {
          kvValue: 'from_keyvault',
          envValue: 'also_from_keyvault'
        }
      })
    })

    it('should resolve nested objects with KeyVault values', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__api_key: 'kv_api_secret_123',
        dns__api_url: 'https://kv-api.example.com'
      })

      const input = {
        services: {
          api: {
            url: 'stack.dns.var.api_url',
            credentials: {
              key: 'stack.dns.secret.api_key'
            }
          }
        }
      }

      const result = await createKeyValue(
        basePathValue,
        input,
        { var: {}, secret: {} },
        keyVaultStore as any
      )

      expect(result).toStrictEqual({
        key: 'services',
        value: {
          api: {
            url: 'https://kv-api.example.com',
            credentials: {
              key: 'kv_api_secret_123'
            }
          }
        }
      })
    })

    it('should handle KeyVault with allowNull for missing secrets', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__existing_var: 'kv_exists'
      })

      const input = {
        config: {
          existing: 'stack.dns.var.existing_var',
          missing: 'stack.dns.var.missing_var'
        }
      }

      const result = await createKeyValue(
        basePathValue,
        input,
        { var: {}, secret: {} },
        keyVaultStore as any,
        false,
        true
      )

      expect(result).toStrictEqual({
        key: 'config',
        value: {
          existing: 'kv_exists',
          missing: 'dummy'
        }
      })
    })
  })

  describe('createValue with KeyVault', () => {
    it('should resolve value from KeyVault in createValue', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__connection_string: 'kv_connection_string_value'
      })

      const result = await createValue(
        basePathValue,
        'stack.dns.var.connection_string',
        { var: {}, secret: {} },
        keyVaultStore as any,
        allowNullFalse
      )

      expect(result).toBe('kv_connection_string_value')
    })

    it('should resolve array value from KeyVault in createValue', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__hosts: 'kv_host1,kv_host2,kv_host3'
      })

      const result = await createValue(
        basePathValue,
        'stack.dns.var.hosts[1]',
        { var: {}, secret: {} },
        keyVaultStore as any,
        allowNullFalse
      )

      expect(result).toBe('kv_host2')
    })

    it('should resolve complex nested structure with KeyVault', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__username: 'kv_admin',
        dns__password: 'kv_secret123'
      })

      const input = {
        credentials: {
          user: 'stack.dns.var.username',
          pass: 'stack.dns.secret.password'
        },
        timeout: 30
      }

      const result = await createValue(
        basePathValue,
        input,
        { var: {}, secret: {} },
        keyVaultStore as any,
        allowNullFalse
      )

      expect(result).toStrictEqual({
        credentials: {
          user: 'kv_admin',
          pass: 'kv_secret123'
        },
        timeout: 30
      })
    })

    it('should handle array of mixed KeyVault and static values', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__dynamic_value: 'kv_dynamic'
      })

      const input = [
        'static_value',
        'stack.dns.var.dynamic_value',
        'another_static'
      ]

      const result = await createValue(
        basePathValue,
        input,
        { var: {}, secret: {} },
        keyVaultStore as any,
        allowNullFalse
      )

      expect(result).toStrictEqual([
        'static_value',
        'kv_dynamic',
        'another_static'
      ])
    })

    it('should throw error for missing KeyVault secret when allowNull is false', async () => {
      const keyVaultStore = new DummyKeyVaultStore({})

      await expect(
        createValue(
          basePathValue,
          'stack.dns.var.missing_secret',
          { var: {}, secret: {} },
          keyVaultStore as any,
          false
        )
      ).rejects.toThrow()
    })

    it('should return dummy for missing KeyVault secret when allowNull is true', async () => {
      const keyVaultStore = new DummyKeyVaultStore({})

      const result = await createValue(
        basePathValue,
        'stack.dns.var.missing_secret',
        { var: {}, secret: {} },
        keyVaultStore as any,
        true
      )

      expect(result).toBe('dummy')
    })
  })

  describe('KeyVault with different stack names', () => {
    it('should handle stack names with hyphens', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        'my-stack__my_var': 'kv_hyphenated_stack'
      })

      const result = await resolveEnvValue(
        basePathValue,
        'stack.my-stack.var.my_var',
        { var: {}, secret: {} },
        keyVaultStore as any,
        allowNullFalse
      )

      expect(result).toStrictEqual({
        key: 'my_var',
        value: 'kv_hyphenated_stack'
      })
    })

    it('should resolve values from multiple stacks', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__dns_value: 'kv_dns_value',
        aks__aks_value: 'kv_aks_value',
        storage__storage_value: 'kv_storage_value'
      })

      const input = {
        stacks: {
          dns: 'stack.dns.var.dns_value',
          aks: 'stack.aks.var.aks_value',
          storage: 'stack.storage.var.storage_value'
        }
      }

      const result = await createKeyValue(
        basePathValue,
        input,
        { var: {}, secret: {} },
        keyVaultStore as any
      )

      expect(result).toStrictEqual({
        key: 'stacks',
        value: {
          dns: 'kv_dns_value',
          aks: 'kv_aks_value',
          storage: 'kv_storage_value'
        }
      })
    })
  })

  describe('KeyVault array index edge cases', () => {
    it('should handle array index bounds correctly with KeyVault', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__items: 'item1,item2,item3'
      })

      await expect(
        resolveEnvValue(
          basePathValue,
          'stack.dns.var.items[5]',
          { var: {}, secret: {} },
          keyVaultStore as any,
          allowNullFalse
        )
      ).rejects.toThrow('Array index out of bounds')
    })

    it('should handle negative array index bounds with KeyVault', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__items: 'item1,item2'
      })

      await expect(
        resolveEnvValue(
          basePathValue,
          'stack.dns.var.items[-5]',
          { var: {}, secret: {} },
          keyVaultStore as any,
          allowNullFalse
        )
      ).rejects.toThrow('Array index out of bounds')
    })

    it('should resolve last element with negative index from KeyVault', async () => {
      const keyVaultStore = new DummyKeyVaultStore({
        dns__colors: 'red,green,blue,yellow'
      })

      const result = await resolveEnvValue(
        basePathValue,
        'stack.dns.var.colors[-1]',
        { var: {}, secret: {} },
        keyVaultStore as any,
        allowNullFalse
      )

      expect(result).toStrictEqual({
        key: 'colors[-1]',
        value: 'yellow'
      })
    })

    it('should resolve array index with allowNull for missing KeyVault array', async () => {
      const keyVaultStore = new DummyKeyVaultStore({})

      const result = await resolveEnvValue(
        basePathValue,
        'stack.dns.var.missing_array[0]',
        { var: {}, secret: {} },
        keyVaultStore as any,
        true
      )

      expect(result).toStrictEqual({
        key: 'missing_array[0]',
        value: 'dummy'
      })
    })
  })
})

describe('GlobalsContext resolution', () => {
  const globalsContext = {
    config: {
      subdomains: ['ocs-dev-v3', 'ocs-ci-v3'],
      geocodes: ['NE', 'GWC'],
      whitelist_ips: ['62.4.69.171', '62.4.69.229']
    },
    pipeline: {
      customer_id: 'example',
      stage: 'dev',
      dry_run: 'true',
      has_release_tag: 'false'
    }
  }

  describe('global.config.var.* resolution', () => {
    it('resolves global.config.var reference to config global value', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'global.config.var.subdomains',
        ghEnvironment,
        null,
        false,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'subdomains',
        value: ['ocs-dev-v3', 'ocs-ci-v3']
      })
    })

    it('resolves global.config.var for string arrays', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'global.config.var.geocodes',
        ghEnvironment,
        null,
        false,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'geocodes',
        value: ['NE', 'GWC']
      })
    })

    it('throws when config global not found and allowNull is false', async () => {
      await expect(
        resolveEnvValue(
          basePathValue,
          'global.config.var.nonexistent',
          ghEnvironment,
          null,
          false,
          globalsContext
        )
      ).rejects.toThrow('Config global not found: nonexistent')
    })

    it('returns dummy when config global not found and allowNull is true', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'global.config.var.nonexistent',
        ghEnvironment,
        null,
        true,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'nonexistent',
        value: 'dummy'
      })
    })
  })

  describe('global.pipeline.var.* resolution', () => {
    it('resolves global.pipeline.var reference to pipeline global value', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'global.pipeline.var.customer_id',
        ghEnvironment,
        null,
        false,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'customer_id',
        value: 'example'
      })
    })

    it('resolves global.pipeline.var for stage', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'global.pipeline.var.stage',
        ghEnvironment,
        null,
        false,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'stage',
        value: 'dev'
      })
    })

    it('throws when pipeline global not found and allowNull is false', async () => {
      await expect(
        resolveEnvValue(
          basePathValue,
          'global.pipeline.var.nonexistent',
          ghEnvironment,
          null,
          false,
          globalsContext
        )
      ).rejects.toThrow('Pipeline global not found: nonexistent')
    })

    it('returns dummy when pipeline global not found and allowNull is true', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'global.pipeline.var.nonexistent',
        ghEnvironment,
        null,
        true,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'nonexistent',
        value: 'dummy'
      })
    })
  })

  describe('globals.* (deprecated plural) resolution', () => {
    it('resolves globals.subdomains via deprecation shim', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'globals.subdomains',
        ghEnvironment,
        null,
        false,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'subdomains',
        value: ['ocs-dev-v3', 'ocs-ci-v3']
      })
    })

    it('throws when deprecated globals key not found and allowNull is false', async () => {
      await expect(
        resolveEnvValue(
          basePathValue,
          'globals.nonexistent',
          ghEnvironment,
          null,
          false,
          globalsContext
        )
      ).rejects.toThrow(
        'Config global not found: nonexistent (via deprecated globals.* syntax)'
      )
    })

    it('returns dummy when deprecated globals key not found and allowNull is true', async () => {
      const result = await resolveEnvValue(
        basePathValue,
        'globals.nonexistent',
        ghEnvironment,
        null,
        true,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'nonexistent',
        value: 'dummy'
      })
    })
  })

  describe('createKeyValue with GlobalsContext', () => {
    it('resolves global.config.var in object input', async () => {
      const input = { subdomains: 'global.config.var.subdomains' }
      const result = await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        false,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'subdomains',
        value: ['ocs-dev-v3', 'ocs-ci-v3']
      })
    })

    it('resolves global.pipeline.var in object input', async () => {
      const input = { stage: 'global.pipeline.var.stage' }
      const result = await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        false,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'stage',
        value: 'dev'
      })
    })

    it('resolves mixed globals and stack refs in nested object', async () => {
      const input = {
        config: {
          geocodes: 'global.config.var.geocodes',
          test_var: 'stack.dns.var.test_var',
          stage: 'global.pipeline.var.stage'
        }
      }
      const result = await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        false,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'config',
        value: {
          geocodes: ['NE', 'GWC'],
          test_var: 'test_value',
          stage: 'dev'
        }
      })
    })

    it('resolves deprecated globals.* in object input', async () => {
      const input = { geocodes: 'globals.geocodes' }
      const result = await createKeyValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        false,
        globalsContext
      )
      expect(result).toStrictEqual({
        key: 'geocodes',
        value: ['NE', 'GWC']
      })
    })
  })

  describe('createValue with GlobalsContext', () => {
    it('resolves global.config.var string to value', async () => {
      const result = await createValue(
        basePathValue,
        'global.config.var.subdomains',
        ghEnvironment,
        null,
        false,
        globalsContext
      )
      expect(result).toStrictEqual(['ocs-dev-v3', 'ocs-ci-v3'])
    })

    it('resolves global.pipeline.var string to value', async () => {
      const result = await createValue(
        basePathValue,
        'global.pipeline.var.customer_id',
        ghEnvironment,
        null,
        false,
        globalsContext
      )
      expect(result).toBe('example')
    })

    it('resolves array with mixed global refs and stack refs', async () => {
      const input = ['global.config.var.geocodes', 'stack.dns.var.test_var']
      const result = await createValue(
        basePathValue,
        input,
        ghEnvironment,
        null,
        false,
        globalsContext
      )
      expect(result).toStrictEqual([['NE', 'GWC'], 'test_value'])
    })
  })

  describe('without GlobalsContext (null)', () => {
    it('global.config.var throws when no globals context provided', async () => {
      // Without globals context, global.config.var.X has no config data to resolve from
      await expect(
        resolveEnvValue(
          basePathValue,
          'global.config.var.subdomains',
          ghEnvironment,
          null,
          false,
          null
        )
      ).rejects.toThrow('Config global not found: subdomains')
    })
  })
})

describe('explicit secret backend references', () => {
  const environment = {
    var: {},
    secret: { HCLOUD_TOKEN: 'github-token', ONLY_GH: 'github-only' }
  }
  const vaultStore = {
    storeLabel: 'KeyVault',
    getSecret: jest.fn(async (key: string) => {
      if (key === 'hcloud_token') return 'vault-token'
      throw new Error(`Missing Key Vault secret: ${key}`)
    })
  }
  const context = (secretBackend: 'gh' | 'keyvault') => ({
    config: {},
    pipeline: {},
    secretBackend,
    vaultStore
  })

  beforeEach(() => vaultStore.getSecret.mockClear())

  it('defaults to GitHub and selects GitHub despite a configured vault', async () => {
    expect(
      await resolveEnvValue(
        basePathValue,
        'secret_backend.secret.hcloud_token',
        environment,
        null,
        false
      )
    ).toStrictEqual({
      key: 'hcloud_token',
      value: 'github-token'
    })
    expect(
      await resolveEnvValue(
        basePathValue,
        'secret_backend.secret.hcloud_token',
        environment,
        vaultStore,
        false,
        context('gh')
      )
    ).toStrictEqual({
      key: 'hcloud_token',
      value: 'github-token'
    })
    expect(vaultStore.getSecret).not.toHaveBeenCalled()
  })

  it('selects only Key Vault and passes the original key for environment-aware naming', async () => {
    expect(
      await resolveEnvValue(
        basePathValue,
        'secret_backend.secret.hcloud_token',
        environment,
        null,
        false,
        context('keyvault')
      )
    ).toStrictEqual({
      key: 'hcloud_token',
      value: 'vault-token'
    })
    expect(vaultStore.getSecret).toHaveBeenCalledWith('hcloud_token')
  })

  it.each([false, true])(
    'fails for missing or empty GitHub secrets with allowNull=%s',
    async (allowNull) => {
      for (const secret of [undefined, '']) {
        await expect(
          resolveEnvValue(
            basePathValue,
            'secret_backend.secret.missing',
            {
              var: {},
              secret: secret === undefined ? {} : { MISSING: secret }
            },
            vaultStore,
            allowNull,
            context('gh')
          )
        ).rejects.toThrow('missing or empty in gh backend')
      }
      expect(vaultStore.getSecret).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])(
    'fails for missing or empty Key Vault secrets with allowNull=%s without GitHub fallback',
    async (allowNull) => {
      await expect(
        resolveEnvValue(
          basePathValue,
          'secret_backend.secret.only_gh',
          environment,
          null,
          allowNull,
          context('keyvault')
        )
      ).rejects.toThrow('Missing Key Vault secret: only_gh')
      const emptyVaultStore = {
        storeLabel: 'KeyVault',
        getSecret: jest.fn(async () => '')
      }
      await expect(
        resolveEnvValue(
          basePathValue,
          'secret_backend.secret.only_gh',
          environment,
          null,
          allowNull,
          {
            ...context('keyvault'),
            vaultStore: emptyVaultStore
          }
        )
      ).rejects.toThrow()
      expect(emptyVaultStore.getSecret).toHaveBeenCalledWith('only_gh')
    }
  )

  it('rejects keyvault backend without configured Key Vault even when SSM exists', async () => {
    const ssmStore = {
      storeLabel: 'SSM',
      getSecret: jest.fn(async () => 'ssm-token')
    }
    await expect(
      resolveEnvValue(
        basePathValue,
        'secret_backend.secret.hcloud_token',
        environment,
        ssmStore,
        true,
        {
          config: {},
          pipeline: {},
          secretBackend: 'keyvault'
        }
      )
    ).rejects.toThrow('Key Vault is not configured')
    expect(ssmStore.getSecret).not.toHaveBeenCalled()
  })

  it('keeps gh.secret GitHub-only even with keyvault selected', async () => {
    expect(
      await resolveEnvValue(
        basePathValue,
        'gh.secret.HCLOUD_TOKEN',
        environment,
        vaultStore,
        false,
        context('keyvault')
      )
    ).toStrictEqual({
      key: 'HCLOUD_TOKEN',
      value: 'github-token'
    })
    expect(vaultStore.getSecret).not.toHaveBeenCalled()
  })

  it.each([
    'secret_backend',
    'secret_backend.var.key',
    'secret_backend.secret',
    'secret_backend.secret.',
    'secret_backend.secret.key.extra',
    'secret_backend.secret.key[0]',
    'secret_backend.secret.key/extra'
  ])('rejects malformed reference %s', async (reference) => {
    await expect(
      resolveEnvValue(
        basePathValue,
        reference,
        environment,
        null,
        true,
        context('gh')
      )
    ).rejects.toThrow('Invalid secret backend reference')
  })

  it('resolves exact references nested in objects and arrays but not embedded in strings', async () => {
    expect(
      await createKeyValue(
        basePathValue,
        {
          credentials: {
            token: 'secret_backend.secret.hcloud_token',
            variants: [
              'secret_backend.secret.hcloud_token',
              'prefix-secret_backend.secret.hcloud_token'
            ]
          }
        },
        environment,
        null,
        true,
        false,
        context('keyvault')
      )
    ).toStrictEqual({
      key: 'credentials',
      value: {
        token: 'vault-token',
        variants: ['vault-token', 'prefix-secret_backend.secret.hcloud_token']
      }
    })
    expect(vaultStore.getSecret).toHaveBeenCalledTimes(2)
  })
})
