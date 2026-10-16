import {
  SSMClient,
  PutParameterCommand,
  GetParameterCommand,
  DescribeParametersCommand,
  ParameterType
} from '@aws-sdk/client-ssm'
import type { SSMClientConfig } from '@aws-sdk/client-ssm'
import {
  fromWebToken,
  fromNodeProviderChain
} from '@aws-sdk/credential-providers'
import * as core from '@actions/core'

/**
 * Interface for AWS credentials used to reach the SSM Parameter Store.
 * Exactly one authentication mode is selected, in this order of precedence:
 * static keys -> OIDC role assumption -> ambient provider chain.
 */
export interface AwsCredentials {
  region: string
  roleArn?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
}

/**
 * AWS caps a parameter name at 1011 characters *including* the ARN prefix
 * (`arn:aws:ssm:<region>:<account-id>:parameter`), which never exceeds 64
 * characters. Budget the worst case so validation fails locally rather than
 * as an opaque API error.
 */
const MAX_PARAMETER_NAME_LENGTH = 1011 - 64

/** Standard tier value ceiling. Larger values require the paid Advanced tier. */
const MAX_STANDARD_TIER_VALUE_BYTES = 4096

/** Bound in-flight PutParameter calls; Parameter Store throughput is rate limited. */
const MAX_CONCURRENT_WRITES = 5

/** KeyId DescribeParameters reports for SecureStrings put without an explicit KeyId. */
const DEFAULT_SSM_KMS_KEY = 'alias/aws/ssm'

/**
 * Converts a key to the flat keystore format shared with Azure Key Vault.
 * - Prefixes with the environment name separated by `---`
 * - Converts to lowercase
 * - Replaces underscores and dots with hyphens
 * @param key - The original key name
 * @param prefix - The environment prefix
 * @returns The converted key name
 */
export function convertKey(key: string, prefix: string): string {
  const convertedKey = prefix + '---' + key
  return convertedKey.toLowerCase().replace(/_/g, '-').replace(/\./g, '-')
}

/**
 * Normalizes an SSM path prefix to a leading slash with no trailing slash.
 * @param prefix - The raw prefix input (e.g. `example/cicd/`)
 * @returns The normalized prefix (e.g. `/example/cicd`)
 */
export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('SSM parameter prefix must not be empty')
  }
  return `/${trimmed}`
}

/**
 * Builds the AWS credential provider mirroring the Key Vault credential
 * selection: static keys, then GitHub OIDC federation, then the ambient chain.
 */
function buildCredentials(
  credentials: AwsCredentials
): SSMClientConfig['credentials'] {
  if (credentials.accessKeyId && credentials.secretAccessKey) {
    core.info('SSM auth mode: static access keys')
    const resolved = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken
        ? { sessionToken: credentials.sessionToken }
        : {})
    }
    return async () => resolved
  }

  if (credentials.roleArn) {
    core.info('SSM auth mode: OIDC (assume role with web identity)')
    // Resolve a fresh ID token on every credential refresh.
    return async () => {
      const token = await core.getIDToken('sts.amazonaws.com')
      return fromWebToken({
        roleArn: credentials.roleArn as string,
        webIdentityToken: token,
        roleSessionName: `gh-data-transfer-${process.env.GITHUB_RUN_ID ?? 'local'}`,
        clientConfig: { region: credentials.region }
      })()
    }
  }

  core.info('SSM auth mode: default provider chain (fallback)')
  return fromNodeProviderChain()
}

/**
 * Runs `task` over `items` with a bounded number of concurrent executions.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++
        await task(items[index])
      }
    }
  )
  await Promise.all(workers)
}

/**
 * SsmParameterStore writes pipeline variables and secrets to the AWS SSM
 * Parameter Store using the same flat key layout as the Azure Key Vault store,
 * so both keystores stay interchangeable for a given environment.
 * Every value is a SecureString: SSM cannot change an existing parameter's type.
 */
export class SsmParameterStore {
  private prefix: string
  private parameterPrefix: string
  private kmsKeyId?: string
  private client: SSMClient

  /**
   * @param prefix - Environment name used as the flat key prefix
   * @param parameterPrefix - SSM path prefix (e.g. `/example/cicd`)
   * @param credentials - AWS region and authentication material
   * @param kmsKeyId - Optional KMS key for SecureString parameters
   */
  constructor(
    prefix: string,
    parameterPrefix: string,
    credentials: AwsCredentials,
    kmsKeyId?: string
  ) {
    if (!credentials.region) {
      throw new Error('AWS region is required to use the SSM Parameter Store')
    }

    this.prefix = prefix
    this.parameterPrefix = normalizePrefix(parameterPrefix)
    this.kmsKeyId = kmsKeyId

    this.client = new SSMClient({
      region: credentials.region,
      credentials: buildCredentials(credentials),
      maxAttempts: 5
    })

    core.info(
      `SsmParameterStore initialized for prefix: ${this.parameterPrefix}`
    )
  }

  /**
   * Builds and validates the fully qualified SSM parameter name for a key.
   * @param key - The original key name
   * @returns The SSM parameter name
   * @throws Error if the resulting name is not a legal SSM parameter name
   */
  parameterName(key: string): string {
    const name = `${this.parameterPrefix}/${convertKey(key, this.prefix)}`

    if (!name.match(/^\/[a-zA-Z0-9_.\-/]+$/)) {
      throw new Error(
        `Invalid parameter name: ${name}. Parameter names must only contain alphanumeric characters, hyphens, underscores, dots and slashes.`
      )
    }
    if (name.length > MAX_PARAMETER_NAME_LENGTH) {
      throw new Error(
        `Invalid parameter name: ${name}. Parameter names must not exceed ${MAX_PARAMETER_NAME_LENGTH} characters.`
      )
    }
    return name
  }

  /**
   * Reads the current value of a parameter.
   * @param key - The original key name
   * @returns Promise resolving with the decrypted parameter value
   * @throws Error if the parameter does not exist or the operation fails
   */
  async getSecret(key: string): Promise<string> {
    const name = this.parameterName(key)
    try {
      core.info(`Getting parameter: ${name}`)
      const response = await this.client.send(
        new GetParameterCommand({ Name: name, WithDecryption: true })
      )

      const value = response.Parameter?.Value
      if (!value) {
        throw new Error(`Parameter ${name} exists but has no value`)
      }

      core.setSecret(value)
      core.info(`Successfully retrieved parameter: ${name}`)
      return value
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      core.error(`Failed to get parameter ${key}: ${errorMessage}`)
      throw new Error(`Failed to get parameter ${key}: ${errorMessage}`)
    }
  }

  /**
   * Writes key-value pairs as encrypted `SecureString` parameters.
   * Validates every entry up front, then writes them with bounded concurrency.
   * Unchanged values are skipped so repeated pipeline runs do not exhaust the
   * 100-version-per-parameter history.
   * @param secrets - Key-value pairs to store
   */
  async setSecrets(secrets: Record<string, string>): Promise<void> {
    const parameterEntries = Object.entries(secrets)
    if (parameterEntries.length === 0) {
      return
    }

    try {
      core.info(`Setting ${parameterEntries.length} SecureString parameters`)

      for (const [key, value] of parameterEntries) {
        this.parameterName(key)
        const size = Buffer.byteLength(value, 'utf8')
        if (size > MAX_STANDARD_TIER_VALUE_BYTES) {
          throw new Error(
            `Value for ${key} is ${size} bytes, exceeding the ${MAX_STANDARD_TIER_VALUE_BYTES} byte standard tier limit. Split the value or provision it as an advanced tier parameter.`
          )
        }
      }

      await mapWithConcurrency(
        parameterEntries,
        MAX_CONCURRENT_WRITES,
        async ([key, value]) => {
          await this.put(key, value)
        }
      )

      core.info(
        `Successfully set all ${parameterEntries.length} SecureString parameters`
      )
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      core.error(`Failed to set parameters: ${errorMessage}`)
      throw new Error(`Failed to set parameters: ${errorMessage}`)
    }
  }

  /**
   * Writes a single parameter, skipping the call when the stored value already
   * matches.
   */
  private async put(key: string, value: string): Promise<void> {
    const name = this.parameterName(key)

    if (await this.isUnchanged(name, value)) {
      core.info(`Skipping unchanged parameter: ${name}`)
      return
    }

    try {
      core.info(`Setting parameter: ${name}`)
      await this.client.send(
        new PutParameterCommand({
          Name: name,
          Value: value,
          Type: ParameterType.SECURE_STRING,
          Overwrite: true,
          ...(this.kmsKeyId ? { KeyId: this.kmsKeyId } : {})
        })
      )
      core.info(`Successfully set parameter: ${name}`)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      core.error(`Failed to set parameter ${key}: ${errorMessage}`)
      throw new Error(`Failed to set parameter ${key}: ${errorMessage}`)
    }
  }

  /**
   * Reports whether the stored parameter already holds `value` as a
   * SecureString under the configured KMS key. Any read failure resolves to
   * `false` so the write still proceeds.
   */
  private async isUnchanged(name: string, value: string): Promise<boolean> {
    try {
      const response = await this.client.send(
        new GetParameterCommand({ Name: name, WithDecryption: true })
      )
      // A stored String must not be skipped: the put surfaces AWS's HierarchyTypeMismatchException.
      if (
        response.Parameter?.Value !== value ||
        response.Parameter?.Type !== ParameterType.SECURE_STRING
      ) {
        return false
      }

      // GetParameter omits KeyId; a format mismatch (ARN vs alias) only costs an extra write.
      const described = await this.client.send(
        new DescribeParametersCommand({
          ParameterFilters: [{ Key: 'Name', Option: 'Equals', Values: [name] }]
        })
      )
      return (
        described.Parameters?.[0]?.KeyId ===
        (this.kmsKeyId || DEFAULT_SSM_KMS_KEY)
      )
    } catch {
      return false
    }
  }
}
