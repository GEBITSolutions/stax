import { createKeyValue } from './converter.js'
import * as core from '@actions/core'
import { InputType, GlobalsContext, SecretReader } from './types.js'
import { KeyVaultStore } from './keyvault-store.js'
import { SsmParameterStore } from './ssm-store.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const environment_name = core.getInput('environment-name') || 'default'
    core.info(`Using Environment: ${environment_name}`)

    const allowNull: string = core.getInput('allowNull', {
      required: false
    })
    const variablesJson: string = core.getInput('variables', {
      required: false
    })
    const secretsJson: string = core.getInput('secrets', {
      required: false
    })
    const excludedSecretsJson: string = core.getInput('excluded-secrets', {
      required: false
    })
    const listInputsJson: string = core.getInput('convertInputs', {
      required: false
    })
    const additionalInputJson: string = core.getInput('additionalInputs', {
      required: false
    })
    const configGlobalsJson: string = core.getInput('config-globals', {
      required: false
    })
    const pipelineGlobalsJson: string = core.getInput('pipeline-globals', {
      required: false
    })
    const basePath: string = core.getInput('basePath', {
      required: false
    })
    const key_vault_url = core.getInput('key-vault-url')
    const key_vault_sp_client_id = core.getInput('key-vault-sp-client-id')
    const key_vault_sp_client_secret = core.getInput(
      'key-vault-sp-client-secret'
    )
    const key_vault_sp_tenant_id = core.getInput('key-vault-sp-tenant-id')
    const oidc_enabled = core.getInput('oidc-enabled') === 'true'
    const ssm_parameter_prefix = core.getInput('ssm-parameter-prefix')
    const aws_region = core.getInput('aws-region')
    const aws_role_arn = core.getInput('aws-role-arn')
    const aws_access_key_id = core.getInput('aws-access-key-id')
    const aws_secret_access_key = core.getInput('aws-secret-access-key')
    const aws_session_token = core.getInput('aws-session-token')
    const secretBackend = core.getInput('secret-backend') || 'gh'
    if (secretBackend !== 'gh' && secretBackend !== 'keyvault') {
      throw new Error(
        `Invalid secret-backend: ${secretBackend}. Expected gh or keyvault.`
      )
    }
    if (secretBackend === 'keyvault' && !key_vault_url) {
      throw new Error('Key Vault URL is required for secret-backend: keyvault')
    }

    if (ssm_parameter_prefix && key_vault_url) {
      throw new Error(
        'ssm-parameter-prefix and key-vault-url are mutually exclusive. Configure exactly one keystore backend.'
      )
    }

    let variables: Record<string, string>
    let secrets: Record<string, string>
    let excludedSecrets: string[]
    let listInputs: InputType
    let additionalInputs: Record<string, string>
    let basePathValue: string | undefined = undefined

    if (basePath) {
      //   basePathValue = basePath.endsWith("/") ? basePath : `${basePath}`;
      basePathValue = basePath
    } else {
      basePathValue = process.env.GITHUB_WORKSPACE || process.cwd()
    }

    core.info(
      `Finding external-repositories in: ${basePathValue}/externalRepos`
    )
    try {
      variables = JSON.parse(variablesJson || '{}')
      if (!(typeof variables === 'object' && variables !== null))
        throw new Error('Not a valid json Object')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      throw new Error(`Cannot parse JSON variables.
    Make sure you add the following to this action:

    with:
          variables: \${{ toJSON(variables) }}
    `)
    }
    try {
      secrets = JSON.parse(secretsJson || '{}')
      if (!(typeof secrets === 'object' && secrets !== null))
        throw new Error('Not a valid json Object')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      throw new Error(`Cannot parse JSON secrets.
    Make sure you add the following to this action:

    with:
          secrets: \${{ toJSON(secrets) }}
    `)
    }
    try {
      const parsedExcludedSecrets: unknown = JSON.parse(
        excludedSecretsJson || '[]'
      )
      if (
        !Array.isArray(parsedExcludedSecrets) ||
        parsedExcludedSecrets.some(
          (secret) => typeof secret !== 'string' || secret.trim().length === 0
        )
      ) {
        throw new Error('Not a valid JSON array of nonempty strings')
      }
      excludedSecrets = parsedExcludedSecrets as string[]
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      throw new Error(
        'Cannot parse JSON excluded-secrets. Expected a JSON array of nonempty strings.'
      )
    }
    try {
      listInputs = JSON.parse(listInputsJson || '[]')
      if (!Array.isArray(listInputs)) throw new Error('Not a valid json Object')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      throw new Error(`Cannot parse JSON list of inputs.
    Make sure you add the following to this action:

    with:
          listInputs: \${{ toJSON(input-list) }}
    `)
    }
    try {
      additionalInputs = JSON.parse(additionalInputJson || '{}')
      if (!(typeof additionalInputs === 'object' && additionalInputs !== null))
        throw new Error('Not a valid json Object')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      throw new Error(`Cannot parse JSON additionalInputs.
    Make sure you add the following to this action:

    with:
          additionalInputs: \${{ toJSON(additionalInputs) }}
    `)
    }

    // Parse globals context (config globals from deploy-config, pipeline globals from CI env)
    let configGlobals: Record<string, InputType> = {}
    let pipelineGlobals: Record<string, string | boolean> = {}

    try {
      configGlobals = JSON.parse(configGlobalsJson || '{}')
      if (configGlobals === null || configGlobals === undefined)
        configGlobals = {}
      if (!(typeof configGlobals === 'object' && configGlobals !== null))
        throw new Error('Not a valid json Object')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      throw new Error(`Cannot parse JSON config-globals.
    Make sure you add the following to this action:

    with:
          config-globals: \${{ toJSON(config-globals) }}
    `)
    }

    try {
      pipelineGlobals = JSON.parse(pipelineGlobalsJson || '{}')
      if (pipelineGlobals === null || pipelineGlobals === undefined)
        pipelineGlobals = {}
      if (!(typeof pipelineGlobals === 'object' && pipelineGlobals !== null))
        throw new Error('Not a valid json Object')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      throw new Error(`Cannot parse JSON pipeline-globals.
    Make sure you add the following to this action:

    with:
          pipeline-globals: \${{ toJSON(pipeline-globals) }}
    `)
    }

    const globalsContext: GlobalsContext = {
      config: configGlobals,
      pipeline: pipelineGlobals,
      secretBackend,
      vaultStore: null
    }

    const hasGlobals =
      Object.keys(configGlobals).length > 0 ||
      Object.keys(pipelineGlobals).length > 0

    if (hasGlobals) {
      core.info(
        `Globals context: config keys=[${Object.keys(configGlobals).join(', ')}], ` +
          `pipeline keys=[${Object.keys(pipelineGlobals).join(', ')}]`
      )
    }

    const excludedSecretNames = new Set(
      excludedSecrets.map((secret) => secret.toUpperCase())
    )
    const filteredSecrets = Object.fromEntries(
      Object.entries(secrets).filter(
        ([name]) => !excludedSecretNames.has(name.toUpperCase())
      )
    )

    const tf_input = []
    const ghEnvironment = {
      var: variables,
      secret: filteredSecrets
    }

    let secretStore: SecretReader | null = null

    if (ssm_parameter_prefix) {
      core.info(`Using SSM Parameter Store: ${ssm_parameter_prefix}`)

      secretStore = new SsmParameterStore(
        environment_name,
        ssm_parameter_prefix,
        {
          region: aws_region,
          roleArn: aws_role_arn || undefined,
          accessKeyId: aws_access_key_id || undefined,
          secretAccessKey: aws_secret_access_key || undefined,
          sessionToken: aws_session_token || undefined
        }
      )
    } else if (key_vault_url) {
      core.info(`Using KeyVault: ${key_vault_url}`)

      secretStore = new KeyVaultStore(
        environment_name,
        key_vault_url,
        {
          clientId: key_vault_sp_client_id,
          clientSecret: key_vault_sp_client_secret,
          tenantId: key_vault_sp_tenant_id
        },
        oidc_enabled
      )
      globalsContext.vaultStore = secretStore
    }

    for (let i = 0; i < listInputs.length; i++) {
      tf_input.push(
        await createKeyValue(
          basePathValue,
          listInputs[i],
          ghEnvironment,
          secretStore,
          true,
          allowNull == 'true',
          globalsContext
        )
      )
    }

    for (const [key, value] of Object.entries(additionalInputs)) {
      tf_input.push({ key, value })
    }

    core.setOutput('tf-vars-map', JSON.stringify(tf_input))
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
