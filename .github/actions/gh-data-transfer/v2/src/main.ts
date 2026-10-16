import * as core from '@actions/core'
import { existsSync, readFileSync } from 'fs'
import { Octokit } from '@octokit/rest'
import { write_secrets_to_gh_env } from './gh-secrets.js'
import { write_variables_to_gh_env } from './gh-variables.js'
import { KeyVaultStore } from './keyvault-store.js'
import { SsmParameterStore } from './ssm-store.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    core.info('Starting action')

    const token = core.getInput('github-token')
    const key_vault_url = core.getInput('key-vault-url')
    const key_vault_sp_client_id = core.getInput('key-vault-sp-client-id')
    const key_vault_sp_client_secret = core.getInput(
      'key-vault-sp-client-secret'
    )
    const key_vault_sp_tenant_id = core.getInput('key-vault-sp-tenant-id')
    const ssm_parameter_prefix = core.getInput('ssm-parameter-prefix')
    const ssm_kms_key_id = core.getInput('ssm-kms-key-id')
    const aws_region = core.getInput('aws-region')
    const aws_role_arn = core.getInput('aws-role-arn')
    const aws_access_key_id = core.getInput('aws-access-key-id')
    const aws_secret_access_key = core.getInput('aws-secret-access-key')
    const aws_session_token = core.getInput('aws-session-token')

    if (
      !token &&
      !ssm_parameter_prefix &&
      !(key_vault_url && key_vault_sp_client_id && key_vault_sp_tenant_id)
    ) {
      core.setFailed(
        'GitHub Token, SSM Parameter Prefix or KeyVault Url and Credentials (url + client-id + tenant-id) is required'
      )
      return
    }

    const secretsJson: string = core.getInput('secrets', {
      required: false
    })

    const variablesJson: string = core.getInput('variables', {
      required: false
    })

    const secretsFile: string = core.getInput('secretsFile', {
      required: false
    })

    const variablesFile: string = core.getInput('variablesFile', {
      required: false
    })

    const inputKeyValueSecretJson: Record<string, string> = {}
    const inputKeyValuevariablesJson: Record<string, string> = {}
    try {
      if (existsSync(secretsFile)) {
        const content = readFileSync(secretsFile)
        const lines = content.toString().split('\n')
        for (let line = 0; line < lines.length; line++) {
          const currentline = lines[line].split('=')
          inputKeyValueSecretJson[currentline[0].trim().replace(/["]/g, '')] =
            currentline[1].trim().replace(/["]/g, '')
        }
      }
    } catch (_e) {
      throw new Error(`Cannot parse Secrets File.
  Make sure the key value file has the format
  key1=value1
  key2="value2"

  and you add the following to this action:

  with:
  secretsFile: \<path_to_key_value_secret_file\>
  `)
    }
    try {
      if (existsSync(variablesFile)) {
        const content = readFileSync(variablesFile)
        const lines = content.toString().split('\n')
        for (let line = 0; line < lines.length; line++) {
          const currentline = lines[line].split('=')
          inputKeyValuevariablesJson[
            currentline[0].trim().replace(/["]/g, '')
          ] = currentline[1].trim().replace(/["]/g, '')
        }
      }
    } catch (_e) {
      throw new Error(`Cannot parse Secrets File.
  Make sure the key value file has the format
  key1=value1
  key2="value2"

  and you add the following to this action:

  with:
  variablesFile: <path_to_key_value_variables_file>
  `)
    }

    let secrets: Record<string, string>
    let variables: Record<string, string>

    try {
      secrets = JSON.parse(secretsJson)
      if (!(typeof secrets === 'object' && secrets !== null))
        throw new Error('Not a valid json Object')
    } catch (_e) {
      throw new Error(`Cannot parse JSON secrets.
  Make sure you add the following to this action:

  with:
  secrets: \${{ toJSON(secrets) }}
  `)
    }
    try {
      variables = JSON.parse(variablesJson)
      if (!(typeof variables === 'object' && variables !== null))
        throw new Error('Not a valid json Object')
    } catch (_e) {
      throw new Error(`Cannot parse JSON variables.
    Make sure you add the following to this action:

    with:
          variables: \${{ toJSON(variables) }}
    `)
    }

    const environment_name = core.getInput('environment-name')

    core.info(`Using Environment: ${environment_name}`)
    // Merge File and JSON Variable inputs and make sure all values are strings
    const merged_variables: Record<string, string> = Object.fromEntries(
      Object.entries({
        ...variables,
        ...inputKeyValuevariablesJson
      }).map(([key, value]) => [key, String(value)])
    )

    // Merge File and JSON Secret inputs and make sure all values are strings
    const merged_secrets: Record<string, string> = Object.fromEntries(
      Object.entries({
        ...secrets,
        ...inputKeyValueSecretJson
      }).map(([key, value]) => [key, String(value)])
    )

    for (const key of Object.keys(merged_secrets)) {
      core.info(`Exporting Secret: ${key}`)
    }

    for (const key of Object.keys(merged_variables)) {
      core.info(`Exporting Variable: ${key}`)
    }

    if (token) {
      core.info(`Using Github Environment: ${environment_name}`)
      const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com'

      core.info(`Using GitHub API URL: ${apiUrl}`)

      const octokit: Octokit = new Octokit({
        auth: token,
        baseUrl: apiUrl
      })
      await write_secrets_to_gh_env(octokit, environment_name, merged_secrets)
      await write_variables_to_gh_env(
        octokit,
        environment_name,
        merged_variables
      )
    }

    if (key_vault_url) {
      core.info(`Using KeyVault: ${key_vault_url}`)

      const keyVaultStore = new KeyVaultStore(environment_name, key_vault_url, {
        clientId: key_vault_sp_client_id,
        clientSecret: key_vault_sp_client_secret || undefined,
        tenantId: key_vault_sp_tenant_id
      })

      await keyVaultStore.setSecrets({ ...merged_secrets, ...merged_variables })
    }

    if (ssm_parameter_prefix) {
      core.info(`Using SSM Parameter Store: ${ssm_parameter_prefix}`)

      const ssmStore = new SsmParameterStore(
        environment_name,
        ssm_parameter_prefix,
        {
          region: aws_region,
          roleArn: aws_role_arn || undefined,
          accessKeyId: aws_access_key_id || undefined,
          secretAccessKey: aws_secret_access_key || undefined,
          sessionToken: aws_session_token || undefined
        },
        ssm_kms_key_id || undefined
      )

      await ssmStore.setSecrets({ ...merged_secrets, ...merged_variables })
    }

    // Set outputs for other workflow steps to use
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
