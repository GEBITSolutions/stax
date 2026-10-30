import {
  CredentialMappings,
  CredentialName,
  IDeployConfigDocument,
  IExternalRepos,
  ITerraformConfig,
  SecretBackend
} from './types.js'

/**
 * Deterministic stringify with sorted object keys so that two structurally
 * equal values always produce the same string regardless of key order.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function validateSecretBackend(
  value: unknown,
  source: string
): asserts value is SecretBackend {
  if (value !== 'keyvault' && value !== 'gh') {
    throw new Error(`${source} must be 'keyvault' or 'gh'`)
  }
}

const credentialNames = new Set<CredentialName>([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'HCLOUD_TOKEN',
  'INFRACOST_API_KEY',
  'CI_GITHUB_PAT',
  'CI_GITHUB_TOKEN_TERRAFORM',
  'TF_PROVIDER_GH_OWNER'
])

function validateCredentials(value: unknown, source: string): void {
  if (value === undefined) return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must be a mapping of credential references`)
  }
  for (const [name, reference] of Object.entries(value)) {
    if (
      !/^[A-Z][A-Z0-9_]*$/.test(name) ||
      !credentialNames.has(name as CredentialName)
    ) {
      throw new Error(`${source}: credential name ${name} is not allowed`)
    }
    if (
      typeof reference !== 'string' ||
      !/^(secret_backend|gh)\.secret\.[A-Za-z0-9_]+$/.test(reference)
    ) {
      throw new Error(
        `${source}.${name} must reference secret_backend.secret.<key> or gh.secret.<key>`
      )
    }
  }
}

/**
 * Merge multiple deploy-config documents into a single stacks list and a single
 * externalRepos map.
 *
 * Rules:
 *  - stack ids must be unique across all documents (duplicate → throw, naming
 *    both source files).
 *  - externalRepos keys are merged; a key defined in more than one document must
 *    be deep-structurally equal, otherwise → throw.
 *  - globals are kept per-stack (each stack keeps its own `config_globals`); no
 *    global merge or validation is performed.
 *
 * The function is pure; stack order follows the input document order (externalRepos merging is order-independent when duplicate definitions are equal).
 */
export function mergeDeployConfigDocuments(docs: IDeployConfigDocument[]): {
  stacks: ITerraformConfig[]
  externalRepos: IExternalRepos
} {
  const stacks: ITerraformConfig[] = []
  const idToFile = new Map<string, string>()

  const externalRepos: IExternalRepos = {}
  const externalReposSource = new Map<string, string>()
  let deploymentBackend: SecretBackend = 'gh'
  const deploymentCredentials: CredentialMappings = {}

  for (const doc of docs) {
    const sourceFile = doc.sourceFile ?? '<unknown>'
    const docStacks = doc.stacks ?? []
    if (doc.deployment?.secret_backend !== undefined) {
      validateSecretBackend(
        doc.deployment.secret_backend,
        `${sourceFile}: deployment.secret_backend`
      )
      deploymentBackend = doc.deployment.secret_backend
    }
    validateCredentials(
      doc.deployment?.credentials,
      `${sourceFile}: deployment.credentials`
    )
    Object.assign(deploymentCredentials, doc.deployment?.credentials)

    for (const stack of docStacks) {
      const existingFile = idToFile.get(stack.id)
      if (existingFile !== undefined) {
        throw new Error(
          `Duplicate stack id "${stack.id}" found in "${existingFile}" and "${sourceFile}"`
        )
      }
      idToFile.set(stack.id, sourceFile)
      if (stack.secret_backend !== undefined) {
        validateSecretBackend(
          stack.secret_backend,
          `${sourceFile}: stack "${stack.id}" secret_backend`
        )
      }
      validateCredentials(
        stack.credentials,
        `${sourceFile}: stack "${stack.id}" credentials`
      )
      stacks.push(stack)
    }

    const docExternalRepos = (doc.externalRepos ?? {}) as IExternalRepos
    for (const [key, entries] of Object.entries(docExternalRepos)) {
      if (Object.prototype.hasOwnProperty.call(externalRepos, key)) {
        if (stableStringify(externalRepos[key]) !== stableStringify(entries)) {
          const previousFile = externalReposSource.get(key) ?? '<unknown>'
          throw new Error(
            `Conflicting externalRepos definition for key "${key}" between ` +
              `"${previousFile}" and "${sourceFile}"`
          )
        }
      } else {
        externalRepos[key] = entries
        externalReposSource.set(key, sourceFile)
      }
    }
  }

  return {
    stacks: stacks.map((stack) => {
      const { credentials: stackCredentials, ...stackFields } = stack
      const credentials = { ...deploymentCredentials, ...stackCredentials }
      return {
        ...stackFields,
        secret_backend: stack.secret_backend ?? deploymentBackend,
        ...(Object.keys(credentials).length > 0 ? { credentials } : {})
      }
    }),
    externalRepos
  }
}
