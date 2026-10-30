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

const GALLERY_FIELDS = [
  'image_resource_group_name',
  'gallery_name',
  'image_definition_name',
  'image_version',
  'target_regions'
] as const

function buildTargetOf(config: ITerraformConfig): 'azure' | 'hetzner' | 'aws' {
  if (config.build_target === undefined) return 'azure'
  if (
    config.build_target !== 'azure' &&
    config.build_target !== 'hetzner' &&
    config.build_target !== 'aws'
  ) {
    throw new Error(
      `Packer stack "${config.id}" has invalid build_target: must be azure, hetzner, or aws.`
    )
  }
  return config.build_target
}

export function validatePackerConfig(
  config: ITerraformConfig,
  warn: (message: string) => void = () => undefined
): void {
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

  const buildTarget = buildTargetOf(config)
  if (
    buildTarget !== 'azure' &&
    (config.azure !== undefined ||
      GALLERY_FIELDS.some((field) => config[field] !== undefined))
  ) {
    throw new Error(
      `Packer stack "${config.id}" build_target ${buildTarget} does not use Azure Gallery fields.`
    )
  }
  if (buildTarget === 'aws') {
    warn(
      `Packer stack "${config.id}" uses build_target aws, which is reserved and not implemented.`
    )
  }

  for (const field of GALLERY_FIELDS) {
    if (config[field] !== undefined) {
      warn(
        `Packer stack "${config.id}" field ${field} is a deprecated alias of azure.${field}.`
      )
    }
    if (
      config.azure?.[field] !== undefined &&
      config[field] !== undefined &&
      JSON.stringify(config.azure[field]) !== JSON.stringify(config[field])
    ) {
      throw new Error(
        `Packer stack "${config.id}" azure.${field} conflicts with deprecated alias ${field}.`
      )
    }
  }

  if (buildTarget === 'hetzner') {
    if (!config.hetzner || typeof config.hetzner !== 'object') {
      throw new Error(
        `Packer stack "${config.id}" build_target hetzner requires a hetzner object.`
      )
    }
    if (!config.hetzner.location || !config.hetzner.server_type) {
      throw new Error(
        `Packer stack "${config.id}" hetzner.location and hetzner.server_type are required.`
      )
    }
    if (
      config.hetzner.token !== undefined &&
      (typeof config.hetzner.token !== 'string' ||
        !/^(secret_backend|gh)\.secret\.[A-Za-z0-9_]+$/.test(
          config.hetzner.token
        ))
    ) {
      throw new Error(
        `Packer stack "${config.id}" hetzner.token must reference secret_backend.secret.<key> or gh.secret.<key>.`
      )
    }
    if (
      config.hetzner.token !== undefined &&
      config.credentials?.HCLOUD_TOKEN !== undefined
    ) {
      throw new Error(
        `Packer stack "${config.id}" hetzner.token conflicts with credentials.HCLOUD_TOKEN.`
      )
    }
  } else if (config.hetzner !== undefined) {
    throw new Error(
      `Packer stack "${config.id}" hetzner does not apply when build_target is ${buildTarget}.`
    )
  }

  if (buildTarget !== 'aws' && config.aws !== undefined) {
    throw new Error(
      `Packer stack "${config.id}" aws does not apply when build_target is ${buildTarget}.`
    )
  }
  if (buildTarget === 'aws' && !config.aws?.regions?.length) {
    throw new Error(
      `Packer stack "${config.id}" build_target aws requires aws.regions.`
    )
  }

  if (config.scan !== undefined) {
    if (
      !config.scan ||
      typeof config.scan !== 'object' ||
      Array.isArray(config.scan)
    ) {
      throw new Error(
        `Packer stack "${config.id}" scan must be an object with trivy, lynis and/or goss.`
      )
    }
    const tools = ['trivy', 'lynis', 'goss'] as const
    const keys = Object.keys(config.scan)
    if (keys.length === 0) {
      throw new Error(
        `Packer stack "${config.id}" scan requires at least one of trivy, lynis, or goss.`
      )
    }
    for (const key of keys) {
      if (!tools.includes(key as (typeof tools)[number])) {
        throw new Error(
          `Packer stack "${config.id}" scan has unknown tool "${key}".`
        )
      }
    }
    if (config.scan.trivy !== undefined) {
      const trivy = config.scan.trivy
      if (!trivy || typeof trivy !== 'object' || Array.isArray(trivy)) {
        throw new Error(
          `Packer stack "${config.id}" scan.trivy must be an object.`
        )
      }
      if (
        trivy.severity !== undefined &&
        (typeof trivy.severity !== 'string' ||
          !/^[A-Z]+(,[A-Z]+)*$/.test(trivy.severity))
      ) {
        throw new Error(
          `Packer stack "${config.id}" scan.trivy.severity must be a comma-separated list of uppercase severities.`
        )
      }
      if (trivy.scanners !== undefined) {
        const allowed = new Set(['vuln', 'misconfig', 'secret', 'license'])
        if (
          !Array.isArray(trivy.scanners) ||
          trivy.scanners.length === 0 ||
          trivy.scanners.some((item) => !allowed.has(item))
        ) {
          throw new Error(
            `Packer stack "${config.id}" scan.trivy.scanners must be a nonempty list from vuln, misconfig, secret, license.`
          )
        }
      }
    }
    if (config.scan.lynis !== undefined) {
      const lynis = config.scan.lynis
      if (!lynis || typeof lynis !== 'object' || Array.isArray(lynis)) {
        throw new Error(
          `Packer stack "${config.id}" scan.lynis must be an object.`
        )
      }
      if (lynis.min_hardening_index !== undefined) {
        const min = lynis.min_hardening_index
        if (!Number.isInteger(min) || min < 0 || min > 100) {
          throw new Error(
            `Packer stack "${config.id}" scan.lynis.min_hardening_index must be an integer from 0 to 100.`
          )
        }
      }
    }
    if (config.scan.goss !== undefined) {
      const goss = config.scan.goss
      if (!goss || typeof goss !== 'object' || Array.isArray(goss)) {
        throw new Error(
          `Packer stack "${config.id}" scan.goss must be an object.`
        )
      }
      if (typeof goss.spec !== 'string' || goss.spec.trim() === '') {
        throw new Error(
          `Packer stack "${config.id}" scan.goss.spec must be a nonempty path relative to packer_directory.`
        )
      }
      if (
        goss.spec.startsWith('/') ||
        goss.spec.includes('\\') ||
        goss.spec.split('/').includes('..') ||
        goss.spec.split('/').includes('')
      ) {
        throw new Error(
          `Packer stack "${config.id}" scan.goss.spec must be a repository-relative POSIX path without "..".`
        )
      }
    }
  }
}
