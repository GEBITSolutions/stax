import { describe, expect, it } from '@jest/globals'
import { validateStackFolder } from '../src/validateStackFolder.js'

describe('validateStackFolder', () => {
  it.each(['terraform', 'opentofu', 'function-build-deploy'])(
    'rejects a %s stack without folder instead of using the id',
    (type) => {
      expect(() => validateStackFolder({ id: 'network', type })).toThrow(
        `Stack "network" (${type}) needs folder`
      )
    }
  )

  it('rejects a blank folder', () => {
    expect(() =>
      validateStackFolder({ id: 'network', type: 'opentofu', folder: ' ' })
    ).toThrow('needs folder')
  })

  it('accepts a folder that differs from the id', () => {
    expect(() =>
      validateStackFolder({
        id: 'network-482913',
        type: 'opentofu',
        folder: 'network'
      })
    ).not.toThrow()
  })

  it('ignores types that do not deploy a stack directory', () => {
    expect(() =>
      validateStackFolder({ id: 'docs', type: 'github-pages-site-deploy' })
    ).not.toThrow()
  })
})
