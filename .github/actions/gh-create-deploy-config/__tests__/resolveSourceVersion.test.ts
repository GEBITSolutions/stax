import { resolveSourceVersions } from '../src/resolveSourceVersion.js'
import { ITerraformConfig, IExternalRepos } from '../src/types.js'

describe('resolveSourceVersions', () => {
  const externalRepos: IExternalRepos = {
    shared_code: [
      {
        repoURL: 'github.com/GEBITSolutions/stax.git',
        targetRevision: 'main',
        token: 'CI_GITHUB_TOKEN_SHARED_CODE'
      }
    ],
    another_repo: [
      {
        repoURL: 'github.com/example-org/another-repo.git',
        targetRevision: 'v2.0.0',
        token: 'ANOTHER_TOKEN'
      }
    ]
  }

  it('should inject targetRevision as source_version when source_repo is set but source_version is missing', () => {
    const config: ITerraformConfig[] = [
      {
        id: 'keyvault',
        source_repo: 'shared_code'
      }
    ]

    const result = resolveSourceVersions(config, externalRepos)

    expect(result[0].source_version).toBe('main')
  })

  it('should not override explicit source_version', () => {
    const config: ITerraformConfig[] = [
      {
        id: 'keyvault',
        source_repo: 'shared_code',
        source_version: 'feature/custom-branch'
      }
    ]

    const result = resolveSourceVersions(config, externalRepos)

    expect(result[0].source_version).toBe('feature/custom-branch')
  })

  it('should preserve SWA docs_path while resolving source_version', () => {
    const config: ITerraformConfig[] = [
      {
        id: 'swa-docs-deploy',
        type: 'swa-site-deploy',
        source_repo: 'shared_code',
        docs_path: 'mkdocs'
      }
    ]

    const result = resolveSourceVersions(config, externalRepos)

    expect(result[0].source_version).toBe('main')
    expect(result[0].docs_path).toBe('mkdocs')
  })

  it('should not modify stacks without source_repo (local stacks)', () => {
    const config: ITerraformConfig[] = [
      {
        id: 'local-stack'
      }
    ]

    const result = resolveSourceVersions(config, externalRepos)

    expect(result[0].source_version).toBeUndefined()
  })

  it('should handle multiple stacks with different external repos', () => {
    const config: ITerraformConfig[] = [
      {
        id: 'stack-a',
        source_repo: 'shared_code'
      },
      {
        id: 'stack-b',
        source_repo: 'another_repo'
      },
      {
        id: 'stack-c'
        // no source_repo — local stack
      }
    ]

    const result = resolveSourceVersions(config, externalRepos)

    expect(result[0].source_version).toBe('main')
    expect(result[1].source_version).toBe('v2.0.0')
    expect(result[2].source_version).toBeUndefined()
  })

  it('should not set source_version when source_repo key is not found in externalRepos', () => {
    const config: ITerraformConfig[] = [
      {
        id: 'orphan-stack',
        source_repo: 'nonexistent_repo'
      }
    ]

    const result = resolveSourceVersions(config, externalRepos)

    expect(result[0].source_version).toBeUndefined()
  })

  it('should handle empty externalRepos gracefully', () => {
    const config: ITerraformConfig[] = [
      {
        id: 'keyvault',
        source_repo: 'shared_code'
      }
    ]

    const result = resolveSourceVersions(config, {})

    expect(result[0].source_version).toBeUndefined()
  })

  it('should handle externalRepos entry with empty array', () => {
    const config: ITerraformConfig[] = [
      {
        id: 'keyvault',
        source_repo: 'empty_repo'
      }
    ]

    const emptyRepos: IExternalRepos = {
      empty_repo: []
    }

    const result = resolveSourceVersions(config, emptyRepos)

    expect(result[0].source_version).toBeUndefined()
  })
})
