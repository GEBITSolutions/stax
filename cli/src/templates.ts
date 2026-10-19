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
  /** Optional deployment.project in configs/default.yaml; otherwise the GitHub variable PROJECT supplies it. */
  project?: string;
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

/** Deployment values setup requires, with an example value; the GitHub variable is the uppercased field name. */
const REQUIRED_DEPLOYMENT_VALUES: Record<string, Record<string, string>> = {
  "required": {
    project: "my-project",
    customer_id: "default",
    stage: "dev",
    cloud: "azure",
    default_location: "northeurope",
    public_cloud_flag: "true",
  },
  "required for azure": {
    resource_group_name: "my-resource-group",
    dns_zone_name: "example.com",
    dns_zone_resource_group_name: "my-dns-resource-group",
    state_storage_account_name: "mystatestorage",
    state_container_name: "tfstate",
    state_resource_group_name: "my-state-resource-group",
  },
  "required for aws": {
    state_bucket_name: "my-state-bucket",
    state_region: "eu-north-1",
  },
};

/** Every line stays valid YAML when the whole block is uncommented at once. */
function renderDeploymentBlock(project: string | undefined): string {
  const rows = Object.entries(REQUIRED_DEPLOYMENT_VALUES).flatMap(([requirement, values]) =>
    Object.entries(values).map(([field, example]) => {
      const live = field === "project" && project !== undefined;
      return {
        prefix: live ? "  " : "  # ",
        entry: live ? `project: "${project}"` : `${field}: ${example}`,
        note: `${requirement}; GitHub variable ${field.toUpperCase()}`,
      };
    }),
  );
  const width = Math.max(...rows.map(({ prefix, entry }) => prefix.length + entry.length));
  const lines = rows.map(({ prefix, entry, note }) => `${(prefix + entry).padEnd(width)}  # ${note}`);
  return [project === undefined ? "# deployment:" : "deployment:", ...lines].join("\n");
}

function renderDeployConfig({ project, environment }: ProjectValues): string {
  return `# yaml-language-server: $schema=${DEPLOY_CONFIG_SCHEMA_URL}
# Deploy configuration read by the Deploy workflow (deploy-config input "default").
# Nothing is deployed until at least one stack is defined. Add one with: stax add
# Check the file with: stax validate config

# Deployment values: setup needs every value marked "required", plus those required for your cloud.
# Set each one at least as the GitHub variable named next to it, on the repository or the
# "${environment}" Environment. A value uncommented here overrides that variable for this config.
# Setup fails while a required value is missing.
${renderDeploymentBlock(project)}

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
#    folder: "network"        # stack directory below stack_base_path
#    opentofu_version: "1.8.1"
#    location: "westeurope"
#    stack_base_path: "terraform/stacks"
#    depends_on: []           # stack ids deployed before this one
#    input:
#      - global.pipeline.var.project
#      - global.pipeline.var.stage
`;
}

export function renderProject(values: ProjectValues): GeneratedFile[] {
  const { environment } = values;
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
    { path: DEPLOY_CONFIG_PATH, content: renderDeployConfig(values) },
  ];
}

