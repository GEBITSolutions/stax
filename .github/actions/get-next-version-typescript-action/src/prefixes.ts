import { PrefixSets } from './types.js'

const versionPrefixCharSetValidation = /^[^/][a-zA-Z\d.\-_/]*$/
const versionPrefixConsecutiveCharValidation = /\/{2,}|\.{2,}/
const versionPrefixLastCharValidation = /\D$/

export const defaultPrefixes: PrefixSets = {
  feature: ['feat'],
  fix: ['fix'],
  chore: ['build', 'chore', 'ci', 'docs', 'style', 'refactor', 'perf', 'test']
}

export const parseCommaSeparatedPrefixes = (input: string): string[] => {
  if (!input) {
    return []
  }

  return input
    .split(',')
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix.length > 0)
}

export const resolvePrefixes = (inputs: {
  feature: string
  fix: string
  chore: string
}): PrefixSets => {
  return {
    feature: inputs.feature
      ? parseCommaSeparatedPrefixes(inputs.feature)
      : defaultPrefixes.feature,
    fix: inputs.fix
      ? parseCommaSeparatedPrefixes(inputs.fix)
      : defaultPrefixes.fix,
    chore: inputs.chore
      ? parseCommaSeparatedPrefixes(inputs.chore)
      : defaultPrefixes.chore
  }
}

export const validateVersionPrefix = (prefix: string): void => {
  if (!prefix) {
    return
  }

  if (!versionPrefixCharSetValidation.test(prefix)) {
    throw new Error(
      'version prefix must not contain invalid character(s) or begin with slash'
    )
  }
  if (versionPrefixConsecutiveCharValidation.test(prefix)) {
    throw new Error(
      'version prefix must not contain multiple consecutive slashes or dots'
    )
  }
  if (!versionPrefixLastCharValidation.test(prefix)) {
    throw new Error('version prefix must not end with a digit')
  }
}
