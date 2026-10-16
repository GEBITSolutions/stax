import { ITerraformConfig } from './types.js'

function invalidPackerField(
  config: ITerraformConfig,
  field: 'packer_directory' | 'packer_template' | 'packer_version',
  reason: string
): never {
  throw new Error(
    `Packer stack "${config.id}" has invalid ${field}: ${reason}.`
  )
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index)
    if (characterCode <= 0x1f || characterCode === 0x7f) return true
  }

  return false
}

function validateRelativePosixPath(
  config: ITerraformConfig,
  field: 'packer_directory' | 'packer_template',
  value: unknown
): void {
  if (typeof value !== 'string' || value.trim() === '') {
    invalidPackerField(config, field, 'must be a nonempty string')
  }
  if (/^[A-Za-z]:/.test(value)) {
    invalidPackerField(config, field, 'must be repository-relative')
  }
  if (containsAsciiControlCharacter(value)) {
    invalidPackerField(config, field, 'must not contain control characters')
  }
  if (value.startsWith('/')) {
    invalidPackerField(config, field, 'must be repository-relative')
  }
  if (value.includes('\\')) {
    invalidPackerField(config, field, 'must use POSIX separators')
  }

  const segments = value.split('/')
  if (segments.includes('..')) {
    invalidPackerField(config, field, 'must not contain a ".." segment')
  }
  if (segments.includes('')) {
    invalidPackerField(config, field, 'must not contain empty path segments')
  }
}

export function validatePackerConfig(config: ITerraformConfig): void {
  if (config.type !== 'packer') return

  validateRelativePosixPath(config, 'packer_directory', config.packer_directory)
  if (
    typeof config.packer_version !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(config.packer_version)
  ) {
    invalidPackerField(
      config,
      'packer_version',
      'must be an exact numeric Major.Minor.Patch version'
    )
  }

  if (config.packer_template !== undefined) {
    validateRelativePosixPath(config, 'packer_template', config.packer_template)
  }
}
