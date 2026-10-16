import { ITerraformConfig, IExternalRepos } from './types.js'

/**
 * For each stack that has `source_repo` but no `source_version`,
 * resolve the version from the matching externalRepos entry's targetRevision.
 *
 * Mutates the deploy_config array in place and returns it.
 */
export function resolveSourceVersions(
  deploy_config: ITerraformConfig[],
  external_repos: IExternalRepos
): ITerraformConfig[] {
  for (const stack of deploy_config) {
    if (stack.source_repo && !stack.source_version) {
      const repoEntries = external_repos[stack.source_repo]
      if (
        repoEntries &&
        repoEntries.length > 0 &&
        repoEntries[0].targetRevision
      ) {
        stack.source_version = repoEntries[0].targetRevision
      }
    }
  }
  return deploy_config
}

export default { resolveSourceVersions }
