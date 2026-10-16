export interface IInput {
    [key: string]: string | string[] | boolean | boolean[] | number | number[] | IInput[] | IInput;
}
export type InputType = string | string[] | boolean | boolean[] | number | number[] | IInput[] | IInput;
export interface ITerraformConfig {
    id: string;
    name?: string;
    folder?: string;
    globals?: Record<string, InputType>;
    config_globals?: Record<string, InputType>;
    type?: string;
    if?: string;
    input?: InputType[];
    'tf-vars'?: Record<string, string>;
    depends_on?: string[];
    'stack-groups'?: string[];
    'output-var'?: string[];
    'output-secret'?: string[];
    'runs-on'?: string;
    upload_plan_artifact?: boolean;
    source_repo?: string;
    source_version?: string;
    docs_path?: string;
    packer_directory?: string;
    packer_template?: string;
    packer_version?: string;
}
export interface IExternalRepoEntry {
    repoURL: string;
    targetRevision: string;
    token: string;
    use_app_token?: boolean;
}
export type IExternalRepos = Record<string, IExternalRepoEntry[]>;
export interface IDeployConfigDocument {
    stacks: ITerraformConfig[];
    externalRepos?: IExternalRepos;
    sourceFile?: string;
}
export interface ITerraformLayerConfig extends ITerraformConfig {
    layer: number;
}
