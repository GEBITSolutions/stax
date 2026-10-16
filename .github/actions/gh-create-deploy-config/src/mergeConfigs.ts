import {
  IDeployConfigDocument,
  IExternalRepos,
  ITerraformConfig
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

  for (const doc of docs) {
    const sourceFile = doc.sourceFile ?? '<unknown>'
    const docStacks = doc.stacks ?? []

    for (const stack of docStacks) {
      const existingFile = idToFile.get(stack.id)
      if (existingFile !== undefined) {
        throw new Error(
          `Duplicate stack id "${stack.id}" found in "${existingFile}" and "${sourceFile}"`
        )
      }
      idToFile.set(stack.id, sourceFile)
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

  return { stacks, externalRepos }
}
