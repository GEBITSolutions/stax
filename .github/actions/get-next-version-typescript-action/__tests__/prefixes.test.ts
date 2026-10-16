import {
  defaultPrefixes,
  parseCommaSeparatedPrefixes,
  resolvePrefixes,
  validateVersionPrefix
} from '../src/prefixes.js'

describe('validateVersionPrefix', () => {
  it('allows empty prefix', () => {
    expect(() => validateVersionPrefix('')).not.toThrow()
  })

  it('rejects prefixes starting with slash', () => {
    expect(() => validateVersionPrefix('/v')).toThrow()
  })

  it('rejects prefixes ending with digit', () => {
    expect(() => validateVersionPrefix('v1')).toThrow()
  })

  it('accepts valid prefixes', () => {
    expect(() => validateVersionPrefix('v')).not.toThrow()
    expect(() => validateVersionPrefix('release/v')).not.toThrow()
  })
})

describe('parseCommaSeparatedPrefixes', () => {
  it('returns empty list for empty input', () => {
    expect(parseCommaSeparatedPrefixes('')).toEqual([])
  })

  it('trims and filters values', () => {
    expect(parseCommaSeparatedPrefixes('feat, fix , ,chore')).toEqual([
      'feat',
      'fix',
      'chore'
    ])
  })
})

describe('resolvePrefixes', () => {
  it('uses defaults when inputs are empty', () => {
    const result = resolvePrefixes({ feature: '', fix: '', chore: '' })
    expect(result).toEqual(defaultPrefixes)
  })

  it('overrides defaults when custom values are provided', () => {
    const result = resolvePrefixes({
      feature: 'enhance',
      fix: 'bug',
      chore: 'docs'
    })
    expect(result).toEqual({
      feature: ['enhance'],
      fix: ['bug'],
      chore: ['docs']
    })
  })
})
