import semver, { SemVer } from 'semver'
import { CommitType } from './types.js'

export const calculateNextVersion = (
  currentVersion: SemVer,
  commitTypes: CommitType[]
): { version: SemVer; hasNextVersion: boolean } => {
  let highestType = CommitType.Chore
  for (const commitType of commitTypes) {
    if (commitType > highestType) {
      highestType = commitType
    }
    if (highestType === CommitType.BreakingChange) {
      break
    }
  }

  if (highestType === CommitType.Chore) {
    return { version: currentVersion, hasNextVersion: false }
  }

  const bumpType =
    highestType === CommitType.Fix
      ? 'patch'
      : highestType === CommitType.Feature
        ? 'minor'
        : 'major'

  const bumped = semver.inc(currentVersion, bumpType)
  if (!bumped) {
    throw new Error(
      `failed to bump version ${currentVersion.version} using ${bumpType}`
    )
  }

  const parsed = semver.parse(bumped)
  if (!parsed) {
    throw new Error(`failed to parse bumped version ${bumped}`)
  }

  return { version: parsed, hasNextVersion: true }
}
