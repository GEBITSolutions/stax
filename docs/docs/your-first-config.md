# Your first config

This guide takes you from an empty repository to a first deployment. You add one small script stack, try it with a dry run, then deploy it for real. A script stack is the simplest stack type, so you can see how STAX works before you add infrastructure.

You need a repository initialized with `stax init`, as described in [Installation](installation.md). The examples use the global `stax` command; with a project-local installation, run `npm run stax -- <command>` instead.

## What `stax init` gave you

`stax init` created two files:

- `.github/workflows/deploy.yml`: the **Deploy** workflow you start from the GitHub Actions tab.
- `configs/default.yaml`: your deploy config. It starts with an empty stack list and a commented `deployment` block that lists every value STAX needs.

A deploy config describes two things: the **deployment** (which project, stage and cloud you deploy to) and the **stacks** (the parts you deploy, in which order, and with which values).

## Add a stack

Create a small script in your repository:

```bash
#!/usr/bin/env bash
# scripts/hello.sh
set -euo pipefail

# STAX passes the stack inputs as "export name=value" lines in the first argument.
eval "${1:-}"

echo "Hello from ${stack_id}: ${greeting}, stage ${stage}"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Dry run: nothing changed"
  exit 0
fi

echo "This is where a real deployment would change something"
```

Then describe it as a stack in `configs/default.yaml`:

```yaml
stacks:
  - id: hello
    name: Hello
    type: script
    script: scripts/hello.sh
    input:
      - greeting: hello
      - global.pipeline.var.stage
```

What each line means:

- `id` identifies the stack. Other stacks use it to depend on this one or to read its values. Stick to lowercase letters, digits and hyphens: the id also becomes part of the names under which the stack's values are stored.
- `name` is the label shown in the GitHub Actions run.
- `type: script` runs a Bash script. The path in `script` is relative to your repository root.
- `input` lists the values the stack receives. `greeting: hello` is a fixed value. `global.pipeline.var.stage` takes the stage of the current deployment, and the script receives it as `stage`.

STAX also gives every script its own stack id as `stack_id` and the `DRY_RUN` flag. Your script decides what a dry run means: STAX runs it either way.

Keep input values free of spaces and quotes for script stacks; they are passed to the script unquoted.

You can also add a stack interactively with `stax add`, which asks for the type and the required fields.

## Fill in the deployment

Before any stack runs, STAX checks the deployment values and your cloud sign-in details, even for a stack that never touches the cloud. Uncomment the `deployment` block in `configs/default.yaml` and fill it in, or set the same values as GitHub variables. A complete Azure example:

```yaml
deployment:
  project: hello-stax
  customer_id: default
  stage: dev
  cloud: azure
  default_location: westeurope
  public_cloud_flag: true
  resource_group_name: rg-hello-dev
  dns_zone_name: example.com
  dns_zone_resource_group_name: rg-dns
  state_storage_account_name: sthellodevstate
  state_container_name: tfstate
  state_resource_group_name: rg-hello-state
```

[Configuration](configuration.md) lists every field, its GitHub variable, and which fields AWS needs instead.

## Prepare the GitHub Environment

Each deployment runs in a GitHub Environment, for example `dev`. Create it under **Settings → Environments** and add the sign-in details for your cloud:

| Cloud | Variables | Secrets |
| --- | --- | --- |
| Azure | `ARM_CLIENT_ID`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID` | `ARM_CLIENT_SECRET`, unless you sign in with OIDC (`OIDC_ENABLED=true`) |
| AWS | | `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, or `AWS_ROLE_ARN` with OIDC (`OIDC_ENABLED=true`) |

Values you prefer not to commit, such as the subscription or account details, can live here as variables instead of in the config.

Check the config locally before you push:

```bash
stax validate config
```

Validation checks the structure of your config. It cannot check your cloud access or the contents of the GitHub Environment; the first run does that.

## Run a dry run

Commit and push the config and the script. Then open **Actions → Deploy → Run workflow** and choose:

- **Environment**: `dev`
- **Deploy config**: `default`
- **Dry run**: on (the default)

The run has two parts. **Setup CI/CD** reads your config, checks the deployment values and sign-in details, and works out the order of the stacks. **Deploy Levels** then runs the stacks. In the log of the Hello job you will see the greeting and "Dry run: nothing changed".

If setup fails, its message names the missing value or variable. Add it to the config or the GitHub Environment and run again.

## Deploy

Run the workflow again with **Dry run** switched off. The script now runs with `DRY_RUN=false`.

That is the whole loop: describe a stack, try it with a dry run, then deploy. A real project replaces the script with infrastructure, image builds or sites; see [Supported stack types](stack-types.md).

## Next steps

- [Running a deployment](running-a-deployment.md) explains the Deploy form and how STAX orders and runs your stacks.
- [Passing values between stacks](passing-values.md) shows how one stack uses what another one created.
