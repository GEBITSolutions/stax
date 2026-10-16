import { CommitType, PrefixSets } from './types.js'

const breakingFooterTokens = ['BREAKING CHANGE', 'BREAKING-CHANGE']
const footerTokenSeparators = [': ', ' #']

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const splitCommitMessage = (
  message: string
): { body: string; footers: string[] } => {
  const segments = message.split('\n')
  const bodySegments: string[] = []
  let lastBodyIndex = 0

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    lastBodyIndex = index
    if (segment === '') {
      break
    }
    bodySegments.push(segment)
  }

  const body = bodySegments.join('\n')

  const footers: string[] = []
  let currentFooterSegments: string[] = []
  for (const segment of segments.slice(lastBodyIndex + 1)) {
    if (segment === '') {
      footers.push(currentFooterSegments.join('\n'))
      currentFooterSegments = []
      continue
    }
    currentFooterSegments.push(segment)
  }
  footers.push(currentFooterSegments.join('\n'))

  return { body, footers }
}

const hasBreakingFooter = (footers: string[]): boolean => {
  const breakingFooterPrefixes: string[] = []
  for (const token of breakingFooterTokens) {
    for (const separator of footerTokenSeparators) {
      breakingFooterPrefixes.push(`${token}${separator}`)
    }
  }

  return footers.some((footer) =>
    breakingFooterPrefixes.some((prefix) => footer.startsWith(prefix))
  )
}

const buildBodyRegex = (prefixes: PrefixSets): RegExp => {
  const allTypes = [...prefixes.feature, ...prefixes.fix, ...prefixes.chore]
  const typesRegex = allTypes.map(escapeRegex).join('|')
  return new RegExp(`^(?<type>${typesRegex})(\\(.*\\))?(?<breaking>!)?:.*`, 'i')
}

export const commitMessageToType = (
  message: string,
  prefixes: PrefixSets
): CommitType => {
  const { body, footers } = splitCommitMessage(message)

  if (hasBreakingFooter(footers)) {
    return CommitType.BreakingChange
  }

  const bodyRegex = buildBodyRegex(prefixes)
  const match = bodyRegex.exec(body)
  if (!match || !match.groups) {
    return CommitType.Chore
  }

  if (match.groups.breaking === '!') {
    return CommitType.BreakingChange
  }

  const normalizedType = match.groups.type.toLowerCase()
  if (prefixes.feature.map((p) => p.toLowerCase()).includes(normalizedType)) {
    return CommitType.Feature
  }
  if (prefixes.fix.map((p) => p.toLowerCase()).includes(normalizedType)) {
    return CommitType.Fix
  }

  return CommitType.Chore
}
