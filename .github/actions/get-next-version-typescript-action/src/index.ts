import * as core from '@actions/core'
import { analyzeCommitsSinceLastRelease, LogOrder } from './git.js'
import { resolvePrefixes, validateVersionPrefix } from './prefixes.js'
import { CommitAnalysis, CommitType } from './types.js'
import { calculateNextVersion } from './versioning.js'

const resolveLogOrder = (input: string): LogOrder => {
  const normalized = input.trim().toLowerCase()
  if (
    normalized === '' ||
    normalized === 'committer-time' ||
    normalized === 'committer'
  ) {
    return 'committer-time'
  }
  if (
    normalized === 'topological' ||
    normalized === 'topological-order' ||
    normalized === 'topo'
  ) {
    return 'topological'
  }

  throw new Error(
    `invalid log order '${input}' (supported: committer-time, topological)`
  )
}

const commitTypeLabel = (type: CommitType): string => {
  switch (type) {
    case CommitType.BreakingChange:
      return 'breaking'
    case CommitType.Feature:
      return 'feature'
    case CommitType.Fix:
      return 'fix'
    case CommitType.Chore:
      return 'chore'
    default:
      return 'unknown'
  }
}

const findHighestImpactCommit = (
  commits: CommitAnalysis[]
): { highestType: CommitType; reasonCommit: CommitAnalysis | null } => {
  let highestType = CommitType.Chore
  let reasonCommit: CommitAnalysis | null = null

  for (const commit of commits) {
    if (commit.type > highestType) {
      highestType = commit.type
      reasonCommit = commit
    }
    if (highestType === CommitType.BreakingChange) {
      break
    }
  }

  return { highestType, reasonCommit }
}

const run = (): void => {
  const prefix = core.getInput('prefix')
  const featurePrefixes = core.getInput('feature_prefixes')
  const fixPrefixes = core.getInput('fix_prefixes')
  const chorePrefixes = core.getInput('chore_prefixes')
  const logOrderInput = core.getInput('log_order')

  validateVersionPrefix(prefix)

  const prefixes = resolvePrefixes({
    feature: featurePrefixes,
    fix: fixPrefixes,
    chore: chorePrefixes
  })

  const logOrder = resolveLogOrder(logOrderInput)
  core.info(`Log order: ${logOrder}`)
  core.info(`Version prefix: ${prefix || '(none)'}`)
  core.info(`Feature prefixes: ${prefixes.feature.join(', ') || '(none)'}`)
  core.info(`Fix prefixes: ${prefixes.fix.join(', ') || '(none)'}`)
  core.info(`Chore prefixes: ${prefixes.chore.join(', ') || '(none)'}`)

  const analysis = analyzeCommitsSinceLastRelease(prefixes, logOrder)

  if (analysis.latestReleaseTag) {
    core.info(
      `Latest release: ${analysis.latestReleaseTag} (${analysis.latestReleaseVersion.version}) at ${analysis.latestReleaseCommit?.slice(0, 7)}`
    )
  } else {
    core.info('No release tag found. Using base version 0.0.0')
  }

  core.info(`Commits since last release: ${analysis.commits.length}`)
  for (const commit of analysis.commits) {
    core.info(
      `- ${commitTypeLabel(commit.type)} ${commit.hash.slice(0, 7)} ${commit.subject}`
    )
  }

  const { highestType, reasonCommit } = findHighestImpactCommit(
    analysis.commits
  )
  if (highestType === CommitType.Chore) {
    core.info(
      'No version bump required (only chore commits since last release).'
    )
  } else {
    const bumpType =
      highestType === CommitType.Fix
        ? 'patch'
        : highestType === CommitType.Feature
          ? 'minor'
          : 'major'
    if (reasonCommit) {
      core.info(
        `Version bump: ${bumpType} (due to ${commitTypeLabel(highestType)} ${reasonCommit.hash.slice(0, 7)} ${reasonCommit.subject})`
      )
    } else {
      core.info(`Version bump: ${bumpType}`)
    }
  }

  const commitTypes = analysis.commits.map((commit) => commit.type)
  const { version, hasNextVersion } = calculateNextVersion(
    analysis.latestReleaseVersion,
    commitTypes
  )
  const versionOutput = `${prefix}${version.version}`

  const prevVersionOutput = analysis.latestReleaseTag ?? ''

  core.info(`Next version: ${versionOutput} (hasNextVersion=${hasNextVersion})`)
  core.info(`Previous version: ${prevVersionOutput || '(none)'}`)
  core.setOutput('version', versionOutput)
  core.setOutput('hasNextVersion', hasNextVersion)
  core.setOutput('prevVersion', prevVersionOutput)
}

try {
  run()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  core.setFailed(message)
}
