import { Octokit } from '@octokit/rest';
/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export declare function write_variables_to_gh_env(octokit: Octokit, environment_name: string, variables: Record<string, string>): Promise<void>;
//# sourceMappingURL=gh-variables.d.ts.map