/**
 * Reusable workflows the generated wrapper calls. Unpinned until stax publishes releases.
 */
export const WORKFLOW_REPOSITORY = "GEBITSolutions/stax";
export const WORKFLOW_REF = "main";

export const DEPLOY_WORKFLOW_PATH = ".github/workflows/deploy.yml";
export const DEPLOY_CONFIG_PATH = "configs/default.yaml";
export const DEPLOY_CONFIG_SCHEMA_URL =
  "https://raw.githubusercontent.com/GEBITSolutions/stax/main/schema/deploy-config.schema.json";

export interface ProjectValues {
  /** Project name passed to setup-ci; used for resource naming and state layout. */
  project: string;
  /** Default GitHub Environment offered by the deploy dispatch form. */
  environment: string;
}

export interface GeneratedFile {
  /** POSIX path relative to the target repository root. */
  path: string;
  content: string;
}

const PROJECT_PATTERN = /^[a-z][a-z0-9-]*$/;
const ENVIRONMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Returns an error message, or undefined when the project name is valid. */
export function validateProject(value: string): string | undefined {
  if (PROJECT_PATTERN.test(value)) return undefined;
  return `invalid project "${value}": use lowercase letters, digits and hyphens, starting with a letter`;
}

/** Returns an error message, or undefined when the environment name is valid. */
export function validateEnvironment(value: string): string | undefined {
  if (ENVIRONMENT_PATTERN.test(value)) return undefined;
  return `invalid environment "${value}": use letters, digits, ".", "_" and "-"`;
}

const DEPLOY_CONFIG = `# yaml-language-server: $schema=${DEPLOY_CONFIG_SCHEMA_URL}
# Deploy configuration read by the Deploy workflow (deploy-config input "default").
# Nothing is deployed until at least one stack is defined. Check it with: stax validate config

# Optional: repositories providing stack sources or config files.
# externalRepos:
#   shared:
#     - repoURL: "github.com/<org>/<repo>.git"
#       targetRevision: main
#       token: <SECRET_NAME>  # GitHub secret holding a read token

# Optional: values readable by stacks as global.config.var.<key>.
# globals:
#   owner: platform-team

stacks: []
# Example OpenTofu stack in terraform/stacks/network:
#  - id: "network"
#    name: "Network"
#    type: "opentofu"
#    opentofu_version: "1.8.1"
#    location: "westeurope"
#    stack_base_path: "terraform/stacks"
#    depends_on: []           # stack ids deployed before this one
#    input:
#      - global.pipeline.var.project
#      - global.pipeline.var.stage
`;

export function renderProject({ project, environment }: ProjectValues): GeneratedFile[] {
  const workflowPrefix = `${WORKFLOW_REPOSITORY}/.github/workflows`;
  const deployWorkflow = `name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        description: GitHub Environment to deploy to
        type: environment
        required: true
        default: "${environment}"
      stack-filter:
        description: One or more stack ids, comma separated; empty selects all stacks
        type: string
        required: false
        default: ""
      deploy-config:
        description: Deploy config in configs/ (file name without .yaml)
        type: string
        required: false
        default: default
      dry-run:
        description: Dry run (plan only, no apply)
        type: boolean
        default: true
      destroy:
        description: Destroy infrastructure
        type: boolean
        default: false

permissions:
  actions: read
  contents: read
  id-token: write
  packages: write
  pages: write

concurrency:
  group: \${{ github.workflow }}-\${{ inputs.dry-run && github.sha || inputs.environment }}
  cancel-in-progress: false

jobs:
  setup:
    name: Setup CI/CD
    uses: ${workflowPrefix}/a-wf-setup-ci.yml@${WORKFLOW_REF}
    secrets: inherit
    with:
      project: "${project}"
      environment: \${{ inputs.environment }}
      stack_filter: \${{ inputs.stack-filter }}
      dry-run: \${{ inputs.dry-run }}
      destroy: \${{ inputs.destroy }}
      runs-on: \${{ vars.RUNNER || 'ubuntu-latest' }}
      release_config_filepath: configs/\${{ inputs.deploy-config }}.yaml

  deploy-levels:
    name: Deploy Levels
    needs: setup
    uses: ${workflowPrefix}/a-wf-deploy-levels.yml@${WORKFLOW_REF}
    secrets: inherit
    with:
      ci_config: \${{ needs.setup.outputs.ci-config }}
      env: \${{ needs.setup.outputs.env }}
      default_location: \${{ needs.setup.outputs.default-location }}
      external_repos: \${{ needs.setup.outputs.external-repos }}
`;

  return [
    { path: DEPLOY_WORKFLOW_PATH, content: deployWorkflow },
    { path: DEPLOY_CONFIG_PATH, content: DEPLOY_CONFIG },
  ];
}

