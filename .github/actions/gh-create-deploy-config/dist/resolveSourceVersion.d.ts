import { ITerraformConfig, IExternalRepos } from './types.js';
/**
 * For each stack that has `source_repo` but no `source_version`,
 * resolve the version from the matching externalRepos entry's targetRevision.
 *
 * Mutates the deploy_config array in place and returns it.
 */
export declare function resolveSourceVersions(deploy_config: ITerraformConfig[], external_repos: IExternalRepos): ITerraformConfig[];
declare const _default: {
    resolveSourceVersions: typeof resolveSourceVersions;
};
export default _default;
