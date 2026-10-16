export enum CommitType {
  Chore = 0,
  Fix = 1,
  Feature = 2,
  BreakingChange = 3
}

export type PrefixSets = {
  feature: string[]
  fix: string[]
  chore: string[]
}

export type CommitEntry = {
  hash: string
  message: string
  subject: string
}

export type CommitAnalysis = CommitEntry & {
  type: CommitType
}
