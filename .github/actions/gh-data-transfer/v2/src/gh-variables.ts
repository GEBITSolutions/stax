import * as core from '@actions/core'
import { Octokit } from '@octokit/rest'
import pIteration from 'p-iteration'
import * as github from '@actions/github'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function write_variables_to_gh_env(
  octokit: Octokit,
  environment_name: string,
  variables: Record<string, string>
): Promise<void> {
  let existing_env_variables: string[] = []
  let canList = true

  try {
    let page = 1
    let hasMore = true

    while (hasMore) {
      const response = await octokit.rest.actions.listEnvironmentVariables({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        environment_name,
        per_page: 30,
        page
      })

      const vars = response.data.variables.map(
        (variable_object) => variable_object['name']
      )
      existing_env_variables = existing_env_variables.concat(vars)

      hasMore = response.data.variables.length === 30
      page++
    }

    core.info(`Existing variables: ${JSON.stringify(existing_env_variables)}`)
  } catch (error: unknown) {
    const status = (error as { status?: number }).status
    if (status === 403) {
      core.warning(
        `Cannot list environment variables (403 Forbidden). Falling back to upsert pattern (try update, then create).`
      )
      canList = false
    } else {
      throw error
    }
  }

  core.info(`Start setting variables.`)
  await pIteration.forEach(
    Object.entries(variables),
    async ([name, value]: [string, string]) => {
      value = value.replace(/^"(.+(?="$))"$/, '$1')

      if (canList) {
        // We have a list of existing variables — use it to decide create vs update
        const exists = existing_env_variables.find(
          (v) => v.toLowerCase() === name.toLowerCase()
        )
        if (exists) {
          core.info(`Updating variable ${name}...`)
          await octokit.rest.actions.updateEnvironmentVariable({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            environment_name,
            name,
            value
          })
        } else {
          core.info(`Create variable ${name}...`)
          await octokit.rest.actions.createEnvironmentVariable({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            environment_name,
            name,
            value
          })
        }
      } else {
        // Cannot list — try update first, fall back to create on 404/409
        try {
          core.info(`Upserting variable ${name} (trying update)...`)
          await octokit.rest.actions.updateEnvironmentVariable({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            environment_name,
            name,
            value
          })
        } catch (updateError: unknown) {
          const updateStatus = (updateError as { status?: number }).status
          if (updateStatus === 404) {
            core.info(`Variable ${name} does not exist, creating...`)
            await octokit.rest.actions.createEnvironmentVariable({
              owner: github.context.repo.owner,
              repo: github.context.repo.repo,
              environment_name,
              name,
              value
            })
          } else {
            throw updateError
          }
        }
      }
    }
  )
  core.info(`Finished setting variables.`)
}
