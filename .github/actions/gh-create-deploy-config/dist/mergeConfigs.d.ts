import { IDeployConfigDocument, IExternalRepos, ITerraformConfig } from './types.js';
/**
 * Merge multiple deploy-config documents into a single stacks list and a single
 * externalRepos map.
 *
 * Rules:
 *  - stack ids must be unique across all documents (duplicate → throw, naming
 *    both source files).
 *  - externalRepos keys are merged; a key defined in more than one document must
 *    be deep-structurally equal, otherwise → throw.
 *  - globals are kept per-stack (each stack keeps its own `config_globals`); no
 *    global merge or validation is performed.
 *
 * The function is pure; stack order follows the input document order (externalRepos merging is order-independent when duplicate definitions are equal).
 */
export declare function mergeDeployConfigDocuments(docs: IDeployConfigDocument[]): {
    stacks: ITerraformConfig[];
    externalRepos: IExternalRepos;
};
