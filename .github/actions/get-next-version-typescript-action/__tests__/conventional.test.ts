import { commitMessageToType } from '../src/conventional.js'
import { defaultPrefixes } from '../src/prefixes.js'
import { CommitType } from '../src/types.js'

describe('commitMessageToType', () => {
  it('detects feature commits', () => {
    const result = commitMessageToType('feat: add feature', defaultPrefixes)
    expect(result).toBe(CommitType.Feature)
  })

  it('detects fix commits', () => {
    const result = commitMessageToType('fix: bugfix', defaultPrefixes)
    expect(result).toBe(CommitType.Fix)
  })

  it('detects breaking change via exclamation', () => {
    const result = commitMessageToType('feat!: big change', defaultPrefixes)
    expect(result).toBe(CommitType.BreakingChange)
  })

  it('detects breaking change via footer', () => {
    const message = 'feat: change api\n\nBREAKING CHANGE: new api'
    const result = commitMessageToType(message, defaultPrefixes)
    expect(result).toBe(CommitType.BreakingChange)
  })

  it('treats invalid commit message as chore', () => {
    const result = commitMessageToType('random commit', defaultPrefixes)
    expect(result).toBe(CommitType.Chore)
  })

  it('supports custom prefixes', () => {
    const customPrefixes = {
      feature: ['enhance'],
      fix: ['bug'],
      chore: ['docs']
    }
    const result = commitMessageToType('bug: fix login', customPrefixes)
    expect(result).toBe(CommitType.Fix)
  })
})
