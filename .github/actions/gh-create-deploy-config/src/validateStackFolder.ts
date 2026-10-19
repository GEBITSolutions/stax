import { ITerraformConfig } from './types.js'

const FOLDER_TYPES = ['terraform', 'opentofu', 'function-build-deploy']

/**
 * Stack types that deploy a directory read it from folder; the id is only an
 * identifier and never stands in for the directory.
 */
export function validateStackFolder(config: ITerraformConfig): void {
  if (config.type === undefined || !FOLDER_TYPES.includes(config.type)) return
  if (typeof config.folder !== 'string' || config.folder.trim() === '') {
    throw new Error(
      `Stack "${config.id}" (${config.type}) needs folder: the stack directory, below stack_base_path for terraform/opentofu or below functions/ for function-build-deploy.`
    )
  }
}
