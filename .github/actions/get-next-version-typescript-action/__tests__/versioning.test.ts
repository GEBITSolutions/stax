import semver from 'semver'
import { calculateNextVersion } from '../src/versioning.js'
import { CommitType } from '../src/types.js'

describe('calculateNextVersion', () => {
  const base = semver.parse('1.2.3')!

  it('returns same version when only chores', () => {
    const result = calculateNextVersion(base, [CommitType.Chore])
    expect(result.version.version).toBe('1.2.3')
    expect(result.hasNextVersion).toBe(false)
  })

  it('bumps patch for fix', () => {
    const result = calculateNextVersion(base, [CommitType.Fix])
    expect(result.version.version).toBe('1.2.4')
    expect(result.hasNextVersion).toBe(true)
  })

  it('bumps minor for feature', () => {
    const result = calculateNextVersion(base, [CommitType.Feature])
    expect(result.version.version).toBe('1.3.0')
  })

  it('bumps major for breaking change', () => {
    const result = calculateNextVersion(base, [CommitType.BreakingChange])
    expect(result.version.version).toBe('2.0.0')
  })

  it('uses highest-impact commit type', () => {
    const result = calculateNextVersion(base, [
      CommitType.Chore,
      CommitType.Fix,
      CommitType.Feature
    ])
    expect(result.version.version).toBe('1.3.0')
  })
})
