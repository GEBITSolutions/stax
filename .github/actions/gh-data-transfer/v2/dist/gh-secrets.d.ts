import { Octokit } from '@octokit/rest';
/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export declare function write_secrets_to_gh_env(octokit: Octokit, environment_name: string, secrets: Record<string, string>): Promise<void>;
//# sourceMappingURL=gh-secrets.d.ts.map