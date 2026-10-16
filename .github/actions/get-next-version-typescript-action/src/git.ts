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
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
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
  const tagsOutput = runGit(['tag', '--list'])
  const tags = tagsOutput ? tagsOutput.split('\n').filter(Boolean) : []
  const tagInfoByCommit = new Map<string, TagInfo>()

  for (const tag of tags) {
    const parsed = parseTagVersion(tag)
    if (!parsed) {
      continue
    }

    let commitHash = ''
    try {
      commitHash = runGit(['rev-list', '-n', '1', tag])
    } catch {
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
    logArgs.push('--committer-date-order')
  }

  return logArgs
}

const getCommitHistory = (logOrder: LogOrder): CommitEntry[] => {
  const output = runGit(buildLogArgs(logOrder))
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
  const tagsByCommit = getTagInfoMap()
  const commits = getCommitHistory(logOrder)

  const analyzedCommits: CommitAnalysis[] = []
  let latestReleaseVersion: SemVer | null = null
  let latestReleaseCommit: string | null = null
  let latestReleaseTag: string | null = null

  for (const commit of commits) {
    const tagInfo = tagsByCommit.get(commit.hash)
    if (tagInfo) {
      latestReleaseVersion = tagInfo.version
      latestReleaseCommit = commit.hash
      latestReleaseTag = tagInfo.tag
      break
    }

    const commitType = commitMessageToType(commit.message, prefixes)
    analyzedCommits.push({ ...commit, type: commitType })
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
    commits: analyzedCommits
  }
}
