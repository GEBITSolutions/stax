import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import type { SSMClientConfig } from '@aws-sdk/client-ssm'
import {
  fromWebToken,
  fromNodeProviderChain
} from '@aws-sdk/credential-providers'
import * as core from '@actions/core'
import { SecretReader } from './types.js'
import { convertKey } from './keystore-key.js'

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
        roleSessionName: `gh-convert-stack-inputs-${process.env.GITHUB_RUN_ID ?? 'local'}`,
        clientConfig: { region: credentials.region }
      })()
    }
  }

  core.info('SSM auth mode: default provider chain (fallback)')
  return fromNodeProviderChain()
}

/**
 * SsmParameterStore reads pipeline variables and secrets from the AWS SSM
 * Parameter Store using the same flat key layout as the Azure Key Vault store,
 * so both keystores stay interchangeable for a given environment.
 */
export class SsmParameterStore implements SecretReader {
  readonly storeLabel = 'SSM'
  private prefix: string
  private parameterPrefix: string
  private client: SSMClient

  /**
   * @param prefix - Environment name used as the flat key prefix
   * @param parameterPrefix - SSM path prefix (e.g. `/example/cicd`)
   * @param credentials - AWS region and authentication material
   */
  constructor(
    prefix: string,
    parameterPrefix: string,
    credentials: AwsCredentials
  ) {
    if (!credentials.region) {
      throw new Error('AWS region is required to use the SSM Parameter Store')
    }

    this.prefix = prefix
    this.parameterPrefix = normalizePrefix(parameterPrefix)

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
   * Retrieves a parameter from the SSM Parameter Store
   * @param key - The name of the parameter to retrieve
   * @returns Promise that resolves with the decrypted parameter value
   * @throws Error if the parameter doesn't exist or operation fails
   */
  async getSecret(key: string): Promise<string> {
    try {
      const name = this.parameterName(key)
      core.info(`Getting parameter: ${name}`)
      const response = await this.client.send(
        new GetParameterCommand({ Name: name, WithDecryption: true })
      )

      const value = response.Parameter?.Value
      if (!value) {
        throw new Error(`Parameter ${name} exists but has no value`)
      }

      core.info(`Successfully retrieved parameter: ${name}`)
      core.setSecret(value)

      return value
    } catch (error) {
      // SDK service errors carry the code (e.g. ParameterNotFound) in `name`;
      // `message` is often just "UnknownError".
      const errorMessage =
        error instanceof Error
          ? error.name === 'Error'
            ? error.message
            : `${error.name}: ${error.message}`
          : String(error)
      core.error(`Failed to get parameter ${key}: ${errorMessage}`)
      throw new Error(`Failed to get parameter ${key}: ${errorMessage}`)
    }
  }
}
