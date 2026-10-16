import { describe, expect, it } from '@jest/globals'
import { validatePackerConfig } from '../src/validatePackerConfig.js'
import { ITerraformConfig } from '../src/types.js'

function validPackerConfig(
  overrides: Partial<ITerraformConfig> = {}
): ITerraformConfig {
  return {
    id: 'image-build',
    type: 'packer',
    packer_directory: 'packer/images',
    packer_version: '1.14.0',
    ...overrides
  }
}

describe('validatePackerConfig', () => {
  it('accepts a safe Packer directory with the default omitted template', () => {
    expect(() => validatePackerConfig(validPackerConfig())).not.toThrow()
  })

  it('accepts an explicit current-directory template', () => {
    expect(() =>
      validatePackerConfig(validPackerConfig({ packer_template: '.' }))
    ).not.toThrow()
  })

  it('accepts an explicit nested template relative to the Packer directory', () => {
    expect(() =>
      validatePackerConfig(
        validPackerConfig({
          packer_template: 'templates/linux/azure.pkr.hcl'
        })
      )
    ).not.toThrow()
  })

  it.each(['0.0.0', '01.002.0003', '123.456.789'])(
    'accepts exact numeric Packer version %p',
    (packer_version) => {
      expect(() =>
        validatePackerConfig(validPackerConfig({ packer_version }))
      ).not.toThrow()
    }
  )

  it.each([undefined, '', '   '])(
    'rejects a missing or empty Packer directory: %p',
    (packer_directory) => {
      const config = validPackerConfig({
        id: 'missing-directory',
        packer_directory
      })

      expect(() => validatePackerConfig(config)).toThrow(
        /invalid packer_directory/
      )
    }
  )

  it.each([
    undefined,
    '',
    '   ',
    '1.2',
    '1.2.3.4',
    'latest',
    '1.2.3-rc1',
    '^1.2.3',
    '1.2.3 '
  ])('rejects non-exact Packer version %p', (packer_version) => {
    const config = validPackerConfig({
      id: 'invalid-version',
      packer_version
    })

    expect(() => validatePackerConfig(config)).toThrow(/invalid packer_version/)
  })

  it.each([
    ['packer_directory', '/packer/images'],
    ['packer_directory', 'C:/packer/images'],
    ['packer_directory', 'packer\\images'],
    ['packer_directory', 'packer/../images'],
    ['packer_directory', 'packer//images'],
    ['packer_directory', 'packer/\u0000images'],
    ['packer_template', '/templates/image.pkr.hcl'],
    ['packer_template', 'c:templates/image.pkr.hcl'],
    ['packer_template', 'templates\\image.pkr.hcl'],
    ['packer_template', 'templates/../image.pkr.hcl'],
    ['packer_template', 'templates//image.pkr.hcl'],
    ['packer_template', 'templates/\u007fimage.pkr.hcl']
  ] as const)('rejects unsafe %s path %p', (field, value) => {
    const config = validPackerConfig({
      id: 'unsafe-path',
      [field]: value
    })

    expect(() => validatePackerConfig(config)).toThrow(
      `Packer stack "unsafe-path" has invalid ${field}:`
    )
  })

  it('does not impose Packer requirements on non-Packer stacks', () => {
    const config: ITerraformConfig = {
      id: 'terraform-stack',
      type: 'terraform',
      packer_directory: '../not-a-packer-path',
      packer_template: '/not-a-packer-template',
      packer_version: ''
    }

    expect(() => validatePackerConfig(config)).not.toThrow()
  })
})
