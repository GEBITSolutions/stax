import { SemVer } from 'semver';
import { CommitType } from './types.js';
export declare const calculateNextVersion: (currentVersion: SemVer, commitTypes: CommitType[]) => {
    version: SemVer;
    hasNextVersion: boolean;
};
