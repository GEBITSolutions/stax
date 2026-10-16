import { PrefixSets } from './types.js';
export declare const defaultPrefixes: PrefixSets;
export declare const parseCommaSeparatedPrefixes: (input: string) => string[];
export declare const resolvePrefixes: (inputs: {
    feature: string;
    fix: string;
    chore: string;
}) => PrefixSets;
export declare const validateVersionPrefix: (prefix: string) => void;
