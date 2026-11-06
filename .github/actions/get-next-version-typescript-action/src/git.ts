import { execFileSync } from 'node:child_process'
import semver, { SemVer } from 'semver'
import { commitMessageToType } from './conventional.js'
import { CommitAnalysis, CommitEntry, PrefixSets } from './types.js'

export type LogOrder = 'committer-time' | 'topological'

type TagInfo = {
  version: SemVer
  precision: number
  tag: string
}

const runGit = (args: string[], cwd = process.cwd()): string => {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

const parseTagVersion = (
  tag: string
): { version: SemVer; precision: number } | null => {
  const normalized = tag.startsWith('v') ? tag.slice(1) : tag
  if (!/^\d+(?:\.\d+){0,2}$/.test(normalized)) {
    return null
  }

  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => Number.isNaN(part))) {
    return null
  }

  const precision = parts.length
  while (parts.length < 3) {
    parts.push(0)
  }

  const versionString = parts.join('.')
  const parsed = semver.parse(versionString)
  if (!parsed) {
    return null
  }

  return { version: parsed, precision }
}

const getTagInfoMap = (): Map<string, TagInfo> => {
  // Do not use `tag --merged`: its timestamp-based pruning can omit ancestors
  // when commit clocks are skewed. An unfiltered walk gives exact membership.
  const reachableCommits = new Set(runGit(['rev-list', 'HEAD']).split('\n'))
  const tagsOutput = runGit(['tag', '--list', '--sort=refname'])
  const tags = tagsOutput ? tagsOutput.split('\n').filter(Boolean) : []
  const tagInfoByCommit = new Map<string, TagInfo>()

  for (const tag of tags) {
    const parsed = parseTagVersion(tag)
    if (!parsed) {
      continue
    }

    let commitHash = ''
    try {
      commitHash = runGit([
        'rev-parse',
        '--verify',
        `refs/tags/${tag}^{commit}`
      ])
    } catch {
      continue
    }

    if (!reachableCommits.has(commitHash)) {
      continue
    }

    const existing = tagInfoByCommit.get(commitHash)
    if (existing) {
      if (!semver.eq(existing.version, parsed.version)) {
        throw new Error(
          `commit ${commitHash} has conflicting semver tags (${existing.tag}, ${tag})`
        )
      }
      if (parsed.precision > existing.precision) {
        tagInfoByCommit.set(commitHash, {
          version: parsed.version,
          precision: parsed.precision,
          tag
        })
      }
      continue
    }

    tagInfoByCommit.set(commitHash, {
      version: parsed.version,
      precision: parsed.precision,
      tag
    })
  }

  return tagInfoByCommit
}

export const buildLogArgs = (logOrder: LogOrder): string[] => {
  const logArgs = ['log', '--pretty=%H%x1f%B%x1e']
  if (logOrder === 'topological') {
    logArgs.push('--topo-order')
  } else {
    logArgs.push('--date-order')
  }

  return logArgs
}

const getCommitHistory = (
  logOrder: LogOrder,
  releasedCommits: string[]
): CommitEntry[] => {
  // A release covers its entire ancestry, not a prefix of a git log walk.
  // Exclude every reachable release so merged-back hotfixes are not counted twice.
  const args = [...buildLogArgs(logOrder), 'HEAD']
  if (releasedCommits.length > 0) {
    args.push('--not', ...releasedCommits)
  }
  args.push('--')
  const output = runGit(args)
  if (!output) {
    return []
  }

  return output
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, message] = entry.split('\x1f')
      const fullMessage = message ?? ''
      const subject = fullMessage.split('\n')[0] ?? ''
      return { hash, message: fullMessage, subject }
    })
}

export type ReleaseAnalysis = {
  latestReleaseVersion: SemVer
  latestReleaseCommit: string | null
  latestReleaseTag: string | null
  commits: CommitAnalysis[]
}

export const analyzeCommitsSinceLastRelease = (
  prefixes: PrefixSets,
  logOrder: LogOrder
): ReleaseAnalysis => {
  if (runGit(['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error(
      'release analysis requires complete history and tags; use actions/checkout with fetch-depth: 0'
    )
  }

  const tagsByCommit = getTagInfoMap()
  const commits = getCommitHistory(logOrder, [...tagsByCommit.keys()])

  let latestReleaseVersion: SemVer | null = null
  let latestReleaseCommit: string | null = null
  let latestReleaseTag: string | null = null

  for (const [commitHash, tagInfo] of tagsByCommit) {
    if (
      !latestReleaseVersion ||
      semver.gt(tagInfo.version, latestReleaseVersion)
    ) {
      latestReleaseVersion = tagInfo.version
      latestReleaseCommit = commitHash
      latestReleaseTag = tagInfo.tag
    }
  }

  if (!latestReleaseVersion) {
    latestReleaseVersion = semver.parse('0.0.0')
  }

  if (!latestReleaseVersion) {
    throw new Error('failed to resolve latest release version')
  }

  return {
    latestReleaseVersion,
    latestReleaseCommit,
    latestReleaseTag,
    commits: commits.map((commit) => ({
      ...commit,
      type: commitMessageToType(commit.message, prefixes)
    }))
  }
}
