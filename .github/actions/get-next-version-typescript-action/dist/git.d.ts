import { SemVer } from 'semver';
import { CommitAnalysis, PrefixSets } from './types.js';
export type LogOrder = 'committer-time' | 'topological';
export declare const buildLogArgs: (logOrder: LogOrder) => string[];
export type ReleaseAnalysis = {
    latestReleaseVersion: SemVer;
    latestReleaseCommit: string | null;
    latestReleaseTag: string | null;
    commits: CommitAnalysis[];
};
export declare const analyzeCommitsSinceLastRelease: (prefixes: PrefixSets, logOrder: LogOrder) => ReleaseAnalysis;
