import { jest } from '@jest/globals'

jest.mock('node:child_process')

import { execFileSync } from 'node:child_process'
import { analyzeCommitsSinceLastRelease } from '../src/git.js'
import { defaultPrefixes } from '../src/prefixes.js'
import { CommitType } from '../src/types.js'

const mockExec = jest.mocked(execFileSync)

/**
 * Builds a single record in the %H%x1f%B%x1e format produced by
 * `git log --pretty=%H%x1f%B%x1e`.
 */
const logEntry = (hash: string, message: string): string =>
  `${hash}\x1f${message}\x1e`

describe('analyzeCommitsSinceLastRelease', () => {
  beforeEach(() => {
    mockExec.mockReset()
  })

  // ─── latestReleaseTag (exposed as prevVersion output) ───────────────────────

  describe('latestReleaseTag / prevVersion', () => {
    it('is null when no release tags exist', () => {
      mockExec
        .mockReturnValueOnce('') // git tag --list → none
        .mockReturnValueOnce(logEntry('abc123', 'feat: initial commit')) // git log

      const result = analyzeCommitsSinceLastRelease(
        defaultPrefixes,
        'committer-time'
      )

      expect(result.latestReleaseTag).toBeNull()
      expect(result.latestReleaseCommit).toBeNull()
      expect(result.latestReleaseVersion.version).toBe('0.0.0')
    })

    it('returns the release tag when unreleased commits exist after it', () => {
      mockExec
        .mockReturnValueOnce('0.12.3') // git tag --list
        .mockReturnValueOnce('release_hash') // git rev-list -n 1 0.12.3
        .mockReturnValueOnce(
          // git log (newest first)
          logEntry('feat_hash', 'feat: new feature') +
            logEntry('release_hash', 'chore: release 0.12.3')
        )

      const result = analyzeCommitsSinceLastRelease(
        defaultPrefixes,
        'committer-time'
      )

      expect(result.latestReleaseTag).toBe('0.12.3')
      expect(result.latestReleaseCommit).toBe('release_hash')
      expect(result.latestReleaseVersion.version).toBe('0.12.3')
    })

    it('picks the first tag encountered in commit-walk order when multiple tags exist', () => {
      // Walk order: new_hash → hash_123 (0.12.3) → hash_122 (0.12.2)
      // The first tag hit is 0.12.3 — that becomes latestReleaseTag
      mockExec
        .mockReturnValueOnce('0.12.2\n0.12.3') // git tag --list
        .mockReturnValueOnce('hash_122') // git rev-list for 0.12.2
        .mockReturnValueOnce('hash_123') // git rev-list for 0.12.3
        .mockReturnValueOnce(
          // git log (newest first)
          logEntry('new_hash', 'fix: bugfix') +
            logEntry('hash_123', 'chore: release 0.12.3') +
            logEntry('hash_122', 'chore: release 0.12.2')
        )

      const result = analyzeCommitsSinceLastRelease(
        defaultPrefixes,
        'committer-time'
      )

      expect(result.latestReleaseTag).toBe('0.12.3')
      expect(result.latestReleaseCommit).toBe('hash_123')
    })

    it('returns the v-prefixed tag string as-is', () => {
      mockExec
        .mockReturnValueOnce('v0.12.3') // git tag --list
        .mockReturnValueOnce('tag_hash') // git rev-list for v0.12.3
        .mockReturnValueOnce(
          logEntry('fix_hash', 'fix: patch') +
            logEntry('tag_hash', 'chore: tagged release')
        )

      const result = analyzeCommitsSinceLastRelease(
        defaultPrefixes,
        'committer-time'
      )

      // tag string is the raw git tag, version is normalised semver
      expect(result.latestReleaseTag).toBe('v0.12.3')
      expect(result.latestReleaseVersion.version).toBe('0.12.3')
    })

    it('ignores non-semver tags and only uses the valid semver tag', () => {
      // "latest" and "stable" are not semver — only "0.1.0" should be used
      mockExec
        .mockReturnValueOnce('latest\nstable\n0.1.0') // git tag --list
        .mockReturnValueOnce('semver_hash') // git rev-list for 0.1.0 only
        .mockReturnValueOnce(
          logEntry('new_hash', 'feat: feature') +
            logEntry('semver_hash', 'chore: 0.1.0')
        )

      const result = analyzeCommitsSinceLastRelease(
        defaultPrefixes,
        'committer-time'
      )

      expect(result.latestReleaseTag).toBe('0.1.0')
    })
  })

  // ─── commits since last release ─────────────────────────────────────────────

  describe('commits since last release', () => {
    it('collects unreleased commits in walk order', () => {
      mockExec
        .mockReturnValueOnce('1.0.0')
        .mockReturnValueOnce('base_hash')
        .mockReturnValueOnce(
          logEntry('feat_hash', 'feat: add feature') +
            logEntry('fix_hash', 'fix: bugfix') +
            logEntry('base_hash', 'chore: base release')
        )

      const result = analyzeCommitsSinceLastRelease(
        defaultPrefixes,
        'committer-time'
      )

      expect(result.commits).toHaveLength(2)
      expect(result.commits[0].hash).toBe('feat_hash')
      expect(result.commits[0].type).toBe(CommitType.Feature)
      expect(result.commits[1].hash).toBe('fix_hash')
      expect(result.commits[1].type).toBe(CommitType.Fix)
    })

    it('treats all commits as unreleased when no tag exists', () => {
      mockExec
        .mockReturnValueOnce('')
        .mockReturnValueOnce(
          logEntry('hash1', 'feat: feature one') +
            logEntry('hash2', 'fix: bugfix')
        )

      const result = analyzeCommitsSinceLastRelease(
        defaultPrefixes,
        'committer-time'
      )

      expect(result.commits).toHaveLength(2)
      expect(result.latestReleaseTag).toBeNull()
      expect(result.latestReleaseVersion.version).toBe('0.0.0')
    })

    it('returns zero unreleased commits when HEAD is exactly at the release tag', () => {
      mockExec
        .mockReturnValueOnce('2.0.0')
        .mockReturnValueOnce('head_hash')
        .mockReturnValueOnce(logEntry('head_hash', 'chore: release 2.0.0'))

      const result = analyzeCommitsSinceLastRelease(
        defaultPrefixes,
        'committer-time'
      )

      expect(result.commits).toHaveLength(0)
      expect(result.latestReleaseTag).toBe('2.0.0')
    })

    it('classifies commit types correctly', () => {
      mockExec
        .mockReturnValueOnce('0.5.0')
        .mockReturnValueOnce('base_hash')
        .mockReturnValueOnce(
          logEntry('h1', 'feat!: breaking redesign') +
            logEntry('h2', 'feat: new endpoint') +
            logEntry('h3', 'fix: null pointer') +
            logEntry('h4', 'chore: update deps') +
            logEntry('base_hash', 'chore: 0.5.0')
        )

      const result = analyzeCommitsSinceLastRelease(
        defaultPrefixes,
        'committer-time'
      )

      expect(result.commits[0].type).toBe(CommitType.BreakingChange)
      expect(result.commits[1].type).toBe(CommitType.Feature)
      expect(result.commits[2].type).toBe(CommitType.Fix)
      expect(result.commits[3].type).toBe(CommitType.Chore)
    })
  })
})
