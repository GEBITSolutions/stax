import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import clockSkew from '../__fixtures__/clock-skew.json'
import { analyzeCommitsSinceLastRelease, LogOrder } from '../src/git.js'
import { defaultPrefixes } from '../src/prefixes.js'
import { CommitType } from '../src/types.js'
import { calculateNextVersion } from '../src/versioning.js'

describe.each<LogOrder>(['topological', 'committer-time'])(
  'real git history (%s)',
  (order) => {
    let directory: string
    let tick: number
    let dateOverride: string | undefined

    const git = (...args: string[]): string => {
      const date =
        dateOverride ??
        new Date(Date.UTC(2025, 0, 1, 0, 0, tick++)).toISOString()
      return execFileSync('git', args, {
        cwd: directory,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: 'Release test',
          GIT_AUTHOR_EMAIL: 'release-test@example.invalid',
          GIT_COMMITTER_NAME: 'Release test',
          GIT_COMMITTER_EMAIL: 'release-test@example.invalid',
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date
        },
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim()
    }

    const commit = (message: string): string => {
      git('commit', '--allow-empty', '-m', message)
      return git('rev-parse', 'HEAD')
    }

    const analyze = () => analyzeCommitsSinceLastRelease(defaultPrefixes, order)

    beforeEach(() => {
      directory = mkdtempSync(path.join(tmpdir(), 'stax-release-history-'))
      tick = 0
      dateOverride = undefined
      git('init', '--initial-branch=main', '--template=')
      jest.spyOn(process, 'cwd').mockReturnValue(directory)
    })

    afterEach(() => {
      jest.restoreAllMocks()
      rmSync(directory, { recursive: true, force: true })
    })

    it('uses 0.0.0 and all commits when there is no release', () => {
      const feature = commit('feat: first feature')
      const fix = commit('fix: first fix')

      const result = analyze()
      expect(result.latestReleaseVersion.version).toBe('0.0.0')
      expect(result.latestReleaseCommit).toBeNull()
      expect(result.latestReleaseTag).toBeNull()
      expect(result.commits.map(({ hash }) => hash)).toEqual([fix, feature])
    })

    it('preserves linear-history ordering, types and previous version', () => {
      const base = commit('chore: release 0.12.3')
      git('tag', '0.12.3')
      const fix = commit('fix: patch')
      const feature = commit('feat: capability')
      const breaking = commit('feat!: redesign')

      const result = analyze()
      expect(result.latestReleaseVersion.version).toBe('0.12.3')
      expect(result.latestReleaseCommit).toBe(base)
      expect(result.latestReleaseTag).toBe('0.12.3')
      expect(result.commits.map(({ hash, type }) => ({ hash, type }))).toEqual([
        { hash: breaking, type: CommitType.BreakingChange },
        { hash: feature, type: CommitType.Feature },
        { hash: fix, type: CommitType.Fix }
      ])
    })

    it('has no unreleased commits at a tagged HEAD', () => {
      commit('feat: already released')
      git('tag', '2.0.0')
      expect(analyze()).toMatchObject({
        latestReleaseTag: '2.0.0',
        commits: []
      })
    })

    it('does not bump after only unreleased chores', () => {
      commit('feat: already released')
      git('tag', '1.0.0')
      const chore = commit('docs: clarify usage')
      const result = analyze()
      expect(result.commits.map(({ hash }) => hash)).toEqual([chore])
      expect(
        calculateNextVersion(
          result.latestReleaseVersion,
          result.commits.map(({ type }) => type)
        ).hasNextVersion
      ).toBe(false)
    })

    it('uses semantic version order rather than tag names or commit dates', () => {
      commit('chore: base')
      git('tag', '1.9.0')
      const highest = commit('chore: highest version')
      git('tag', '1.10.0')
      commit('chore: later lower version')
      git('tag', '1.9.1')
      const fix = commit('fix: new patch')

      const result = analyze()
      expect(result.latestReleaseTag).toBe('1.10.0')
      expect(result.latestReleaseCommit).toBe(highest)
      expect(result.commits.map(({ hash }) => hash)).toEqual([fix])
    })

    it('finds every reachable release despite skewed parent/child timestamps', () => {
      // Captured from an independently generated DAG where `tag --merged`
      // omitted genuinely reachable tags on Git 2.39.5.
      const tree = git('mktree')
      const hashes = new Map<number, string>()
      for (const { id, parents, timestamp } of clockSkew.nodes) {
        dateOverride = `${timestamp} +0000`
        hashes.set(
          id,
          git(
            'commit-tree',
            tree,
            ...parents.flatMap((parent) => ['-p', hashes.get(parent)!]),
            '-m',
            `chore: housekeeping node-${id}`
          )
        )
      }
      git('update-ref', 'refs/heads/main', hashes.get(clockSkew.head)!)
      dateOverride = '1700000000 +0000'
      for (const tag of clockSkew.tags) {
        git(
          'tag',
          ...(tag.annotated ? ['-a', '-m', 'Release'] : []),
          tag.name,
          hashes.get(tag.node)!
        )
      }
      dateOverride = undefined

      const result = analyze()
      expect(result.latestReleaseTag).toBe('v4.2.4')
      expect(result.latestReleaseVersion.version).toBe('4.2.4')
      expect(result.commits.map(({ hash }) => hash).sort()).toEqual(
        clockSkew.unreleased.map((id) => hashes.get(id)!).sort()
      )
    })

    it('ignores higher tags and conflicting tags on an unmerged branch', () => {
      commit('chore: base')
      git('tag', '1.0.0')
      git('checkout', '-b', 'unmerged')
      commit('feat!: unrelated release')
      git('tag', '8.0.0')
      git('tag', '9.0.0')
      git('checkout', 'main')
      const fix = commit('fix: main patch')

      const result = analyze()
      expect(result.latestReleaseTag).toBe('1.0.0')
      expect(result.commits.map(({ hash }) => hash)).toEqual([fix])
    })

    it('uses 0.0.0 when tags exist but none is reachable', () => {
      const root = commit('feat: first feature')
      git('checkout', '-b', 'unmerged')
      commit('chore: unrelated release')
      git('tag', '9.0.0')
      git('checkout', 'main')

      const result = analyze()
      expect(result.latestReleaseTag).toBeNull()
      expect(result.latestReleaseVersion.version).toBe('0.0.0')
      expect(result.commits.map(({ hash }) => hash)).toEqual([root])
    })

    it('does not let non-release tags hide unreleased work', () => {
      commit('chore: base')
      git('tag', '1.0.0')
      const feature = commit('feat: unreleased')
      for (const tag of ['latest', 'stable', '2.0.0-rc.1', 'release/9.0.0']) {
        git('tag', tag)
      }

      const result = analyze()
      expect(result.latestReleaseTag).toBe('1.0.0')
      expect(result.commits.map(({ hash }) => hash)).toEqual([feature])
    })

    it('peels annotated tags and preserves the raw v-prefixed tag', () => {
      const base = commit('chore: base')
      git('tag', '-a', 'v0.12.3', '-m', 'Annotated release')
      git('branch', 'v0.12.3')
      const fix = commit('fix: patch')
      git('branch', '-f', 'v0.12.3', 'HEAD')

      const result = analyze()
      expect(result.latestReleaseTag).toBe('v0.12.3')
      expect(result.latestReleaseVersion.version).toBe('0.12.3')
      expect(result.latestReleaseCommit).toBe(base)
      expect(result.commits.map(({ hash }) => hash)).toEqual([fix])
    })

    it('prefers the most precise equivalent tag on a release commit', () => {
      commit('chore: base')
      for (const tag of ['1', '1.0', 'v1.0.0']) git('tag', tag)
      expect(analyze().latestReleaseTag).toBe('v1.0.0')
    })

    it('breaks equal-precision alias ties in stable refname order', () => {
      commit('chore: base')
      git('tag', 'v1.0.0')
      git('tag', '1.0.0')
      expect(analyze().latestReleaseTag).toBe('1.0.0')
    })

    it('ignores semver-shaped tags that do not point to commits', () => {
      commit('chore: base')
      git('tag', '1.0.0')
      git('tag', '8.0.0', 'HEAD^{tree}')
      git('tag', '-a', '9.0.0', 'HEAD^{tree}', '-m', 'Not a release commit')
      const feature = commit('feat: unreleased')
      const result = analyze()
      expect(result.latestReleaseTag).toBe('1.0.0')
      expect(result.commits.map(({ hash }) => hash)).toEqual([feature])
    })

    it.each(['v2', 'v2.3', 'v02.03.0'])(
      'preserves existing numeric tag normalization for %s',
      (tag) => {
        commit('chore: base')
        git('tag', tag)
        const result = analyze()
        expect(result.latestReleaseTag).toBe(tag)
        expect(result.latestReleaseVersion.version).toBe(
          tag === 'v2' ? '2.0.0' : '2.3.0'
        )
      }
    )

    it('rejects conflicting versions on a reachable release commit', () => {
      commit('chore: base')
      git('tag', '1.0.0')
      git('tag', '2.0.0')
      expect(analyze).toThrow(/conflicting semver tags/)
    })

    it('fails explicitly instead of calculating from shallow history', () => {
      commit('chore: base')
      git('tag', '1.0.0')
      commit('fix: patch')
      const shallow = path.join(directory, 'shallow')
      git('clone', '--depth', '1', `file://${directory}`, shallow)
      jest.spyOn(process, 'cwd').mockReturnValue(shallow)
      expect(analyze).toThrow(/fetch-depth: 0/)
    })

    it('classifies multiline breaking-change footers from real git output', () => {
      commit('chore: base')
      git('tag', '0.2.3')
      commit('fix: API adjustment\n\nBREAKING CHANGE: remove legacy API')
      const result = analyze()
      expect(result.commits[0].type).toBe(CommitType.BreakingChange)
      expect(
        calculateNextVersion(
          result.latestReleaseVersion,
          result.commits.map(({ type }) => type)
        ).version.version
      ).toBe('1.0.0')
    })

    it('retains unreleased features behind a merged default-branch release', () => {
      commit('chore: initial release')
      git('tag', '1.0.0')
      git('checkout', '-b', 'feature')
      const feature = commit('feat: new capability')
      git('checkout', 'main')
      commit('chore: release 1.1.0')
      git('tag', '1.1.0')
      git('checkout', 'feature')
      git('merge', '--no-ff', 'main', '-m', 'chore: merge main')
      git('checkout', 'main')
      git('merge', '--no-ff', 'feature', '-m', 'chore: merge feature')

      const result = analyze()
      expect(result.latestReleaseTag).toBe('1.1.0')
      expect(result.commits.map(({ hash }) => hash)).toContain(feature)
      expect(
        calculateNextVersion(
          result.latestReleaseVersion,
          result.commits.map(({ type }) => type)
        ).version.version
      ).toBe('1.2.0')
    })

    it('does not count an already released hotfix when it is merged back', () => {
      commit('chore: initial release')
      git('tag', '1.0.0')
      git('branch', 'hotfix')
      commit('chore: release 1.1.0')
      git('tag', '1.1.0')
      git('checkout', 'hotfix')
      const fix = commit('fix: released hotfix')
      git('tag', '1.0.1')
      git('checkout', 'main')
      git('merge', '--no-ff', 'hotfix', '-m', 'chore: merge released hotfix')

      const result = analyze()
      expect(result.latestReleaseTag).toBe('1.1.0')
      expect(result.commits.map(({ hash }) => hash)).not.toContain(fix)
      expect(
        calculateNextVersion(
          result.latestReleaseVersion,
          result.commits.map(({ type }) => type)
        )
      ).toMatchObject({ hasNextVersion: false, version: { version: '1.1.0' } })

      const newFix = commit('fix: new unreleased fix')
      const next = analyze()
      expect(next.commits.map(({ hash }) => hash)).toContain(newFix)
      expect(
        calculateNextVersion(
          next.latestReleaseVersion,
          next.commits.map(({ type }) => type)
        )
      ).toMatchObject({ hasNextVersion: true, version: { version: '1.1.1' } })
    })
  }
)
