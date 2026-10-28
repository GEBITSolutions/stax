# Installation

Use the STAX CLI to create a deployment workflow, add stacks and validate your configuration. You run the CLI locally; GitHub Actions runs your deployments.

## Prerequisites

- [Node.js](https://nodejs.org/) **24 or later**, with npm.
- A GitHub repository with GitHub Actions enabled.

Check your local installation:

```bash
node --version
npm --version
```

You do not need cloud credentials to install the CLI or generate project files. Configure credentials and deployment settings before running a deployment.

## Choose an installation method

Use a **project-local installation** to share a locked CLI version with your team. Use a **global installation** to run `stax` across repositories without adding a dependency to each project. Prefer project-local installation when dealing with multiple projects to avoid version conflicts.

### Project-local installation

From the root of your project repository, install the CLI as a development dependency:

```bash
npm install --save-dev --save-exact @gebit/stax-cli
```

If your repository has no `package.json` yet, create one with `npm init -y` first.

npm saves the current release as an exact development dependency in your `package.json`. Add a `stax` entry to its `scripts` section, keeping your existing scripts and dependencies:

```json
{
  "scripts": {
    "stax": "stax"
  }
}
```

Check that you can run the installed CLI:

```bash
npm run stax -- --help
```

Commit `package.json` and `package-lock.json`. Add `node_modules/` to `.gitignore`. After cloning the repository, team members install the locked dependencies with:

```bash
npm ci
```

Use `npm run stax -- <command>` for this installation. npm uses the project's installed CLI; you do not need a global installation.

### Global installation

Install the CLI for use across repositories:

```bash
npm install --global @gebit/stax-cli
```

Check that the command is available:

```bash
stax --help
```

Use `stax <command>` for this installation.

## Initialize your repository

From the root of your project repository, run the command for your installation method:

| Action | Project-local | Global |
| --- | --- | --- |
| Initialize the repository | `npm run stax -- init` | `stax init` |
| Add a stack | `npm run stax -- add` | `stax add` |
| Validate configuration | `npm run stax -- validate config` | `stax validate config` |

Both installation methods use the installed CLI version when `init` writes the reusable workflow refs, `actions-version` inputs and editor schema URL. Choose a CLI release that matches the framework version you deploy. Existing workflows and configs do not update when you install a different CLI version.

The `init` command creates two files:

| File | Purpose |
| --- | --- |
| `.github/workflows/deploy.yml` | A manually triggered **Deploy** workflow that calls the STAX reusable workflows. |
| `configs/default.yaml` | An empty stack list, deployment-setting examples and a schema link for editor completion. |

If you build the CLI from source (`0.0.0-development`), pass `--framework-ref <tag-or-commit-sha>` to `init`, for example `stax init --framework-ref main`. You can name a branch, including `main`, if you want that ref. Development builds have no default framework ref; published releases reject the override and use their installed version.

You can also set a project name and preselect a GitHub Environment during initialization:

```bash
# Project-local installation
npm run stax -- init --project my-project --environment dev

# Global installation
stax init --project my-project --environment dev
```

Use lowercase letters, digits and hyphens for the project name, starting with a letter. Create the GitHub Environment in your repository settings before deploying; `--environment` only sets the workflow form's default.

STAX leaves existing files unchanged unless you pass `--force`. Review those files before replacing them.

## Check your configuration

Run the validation command for your installation method from the table above. The initial configuration contains no stacks, so the validator reports a warning.

Local validation checks the configuration structure; it does not verify cloud access or guarantee that a deployment will succeed. The CLI allows deployment fields to remain unset because GitHub variables can supply them at runtime.

`stax add` and `stax validate config` use the schema bundled with the installed CLI and work offline. They do not fetch the editor schema URL in `configs/default.yaml`.

`stax init` does not deploy anything. Before running the generated workflow, add a stack and supply the required deployment settings and credentials. See [Configuration](configuration.md) for deployment fields and their matching GitHub variables.


## Cross-organization secrets

`stax init` writes a Deploy workflow that calls `GEBITSolutions/stax`. GitHub's `secrets: inherit` only works when the caller and the reusable workflow share an organization or enterprise. Across organizations, Environment and repository secrets arrive empty unless you pass them by name.

The generated `.github/workflows/deploy.yml` maps every optional secret that `a-wf-setup-ci.yml` and `a-wf-deploy-levels.yml` declare. You only need to create the secrets your stacks use on the GitHub Environment (for example `HCLOUD_TOKEN` for Packer Hetzner, or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for OpenTofu on AWS). Unused mappings stay empty and are ignored.

Same-organization callers may replace the maps with `secrets: inherit`. Do not mix inherit on a cross-org call: GitHub accepts the keyword, but the nested jobs still see empty values.

`a-wf-setup-state.yaml` and `a-wf-deploy-state.yml` already declare the same optional `ARM_*` and `AWS_*` secrets. Cross-org state workflows must map those by name as well.

## Next step

Continue with [Your first config](your-first-config.md) to add a stack and configure your deployment.
