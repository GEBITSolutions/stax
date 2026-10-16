import * as core from '@actions/core'
import { Octokit } from '@octokit/rest'
import * as github from '@actions/github'
import * as pIteration from 'p-iteration'
import * as sodium from 'sodium-plus'

const { forEach } = pIteration
const { SodiumPlus, X25519PublicKey } = sodium

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function write_secrets_to_gh_env(
  octokit: Octokit,
  environment_name: string,
  secrets: Record<string, string>
): Promise<void> {
  core.debug(`Get Public Key for Environment ${environment_name}`)
  const pkey = await octokit.rest.actions.getEnvironmentPublicKey({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    environment_name
  })

  // Initialize sodium
  const sodium = await SodiumPlus.auto()

  // Convert the public key from base64
  const publicKeyBuffer = Buffer.from(pkey.data.key, 'base64')
  const binkey = new X25519PublicKey(publicKeyBuffer)

  core.info(`Start setting secrets.`)
  await forEach(
    Object.entries(secrets),
    async ([secret_name, value]: [string, string]) => {
      const binsec = Buffer.from(value.replace(/^"(.+(?="$))"$/, '$1'), 'utf8')

      // Encrypt the secret using sealed box
      const encBytes = await sodium.crypto_box_seal(binsec, binkey)

      // Convert the encrypted Buffer to Base64
      const encryptedB64Secret = encBytes.toString('base64')

      core.info(`Setting secret ${secret_name}...`)
      await octokit.rest.actions.createOrUpdateEnvironmentSecret({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        environment_name,
        secret_name,
        encrypted_value: encryptedB64Secret,
        key_id: pkey.data.key_id
      })
    }
  )
  core.info(`Finished setting secrets.`)
}
