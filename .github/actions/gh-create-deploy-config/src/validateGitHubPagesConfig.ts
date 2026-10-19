import { ITerraformConfig } from './types.js'

export function validateGitHubPagesConfig(
  configs: ITerraformConfig[],
  globalVars: Record<string, string | boolean>
): void {
  let pagesStack: ITerraformConfig | undefined

  for (const config of configs) {
    if (config.type !== 'github-pages-site-deploy') continue

    if (pagesStack !== undefined) {
      throw new Error(
        `More than one github-pages-site-deploy stack is configured: "${pagesStack.id}" and "${config.id}".`
      )
    }
    pagesStack = config

    if (config.site_source_type === undefined) {
      config.site_source_type = 'mkdocs'
    } else if (
      config.site_source_type !== 'mkdocs' &&
      config.site_source_type !== 'zensical' &&
      config.site_source_type !== 'prebuilt'
    ) {
      throw new Error(
        `GitHub Pages stack "${config.id}" has invalid site_source_type: ${JSON.stringify(config.site_source_type)}. Expected mkdocs, zensical, or prebuilt.`
      )
    }
  }

  if (
    pagesStack !== undefined &&
    (globalVars['destroy'] === true || globalVars['destroy'] === 'true')
  ) {
    throw new Error(
      `GitHub Pages stack "${pagesStack.id}" does not support destroy=true.`
    )
  }
}
