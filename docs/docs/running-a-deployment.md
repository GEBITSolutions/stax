# Running a deployment

Every deployment starts from the **Deploy** workflow that `stax init` created. This page explains the choices on its form, what happens during a run, and how to read the result.

## The Deploy form

Open **Actions → Deploy → Run workflow**. The form has five fields:

| Field | What it does |
| --- | --- |
| **Environment** | The GitHub Environment to deploy to. Its variables, secrets and protection rules apply to the whole run. |
| **Stack filter** | Which stacks to deploy. Leave it empty to deploy every stack in the config. See [Choosing stacks](#choosing-stacks). |
| **Deploy config** | The file in `configs/` to use, without `.yaml`. The default is `default`. |
| **Dry run** | On by default. Every stack plans or checks its changes without applying them. |
| **Destroy** | Removes what the selected stacks created instead of deploying them. |

Start with a dry run whenever you change a config, and switch it off once the plan looks right.

## What happens during a run

A run has two parts.

**Setup CI/CD** prepares the deployment:

1. It reads the selected config file.
2. It combines the `deployment` values with the GitHub variables of the environment. Values in the config win.
3. It checks that every required value and the cloud sign-in details are present, and stops with a clear message if something is missing.
4. It works out the order of the stacks and writes an overview to the run summary.

**Deploy Levels** then deploys the stacks in that order.

## How STAX orders stacks

STAX groups your stacks into **layers**. A stack goes into a later layer than every stack it depends on. A stack depends on another one when it lists it under `depends_on`, or when it reads one of its values, as described in [Passing values between stacks](passing-values.md).

```yaml
stacks:
  - id: network
    type: opentofu
    folder: network

  - id: cluster
    type: opentofu
    folder: cluster
    depends_on: [network]

  - id: dns
    type: opentofu
    folder: dns
```

Here `network` and `dns` form the first layer and run side by side. `cluster` waits for `network` and runs in the second layer.

Some rules to keep in mind:

- Stacks in the same layer run in parallel. If one of them fails, the others still finish, but no later layer starts.
- A config can have at most 14 layers.
- A destroy run walks the layers backwards, so dependent stacks are removed before the stacks they rely on.
- A stack whose `if` condition is false is left out, for example `if: "'{stage}' === 'prod'"` for a production-only stack. If every selected stack is left out, the run deploys nothing.

## Choosing stacks

The **Stack filter** field takes one or more entries, separated by commas:

| Entry | Selects |
| --- | --- |
| `cluster` | Only the stack with that id. |
| `>cluster` | The stack and everything it depends on, all the way down. |
| `network<` | The stack and the stacks that depend on it directly. |
| `group-core` | Every stack that lists `group-core` under `stack-groups`. |

Group names must start with `group-`:

```yaml
stacks:
  - id: network
    type: opentofu
    folder: network
    stack-groups: [group-core]
```

Filtering by id alone deploys only that stack. It does not deploy what the stack depends on, so make sure those stacks are already in place, or use `>`.

## Dry runs

A dry run goes through the same steps as a real deployment, up to the point where something would change:

- Terraform and OpenTofu stacks create a plan and stop.
- Script stacks still run, with `DRY_RUN=true`, so each script decides what to skip.
- No stack stores its output values. A stack that reads another stack's value gets whatever the last real deployment stored.

Runs queue instead of overlapping: dry runs of the same commit share one queue, and real deployments to the same environment share another. A new run waits for the one in progress instead of cancelling it. If several runs are waiting in the same queue, GitHub keeps only the newest.

## Approvals and protection

Every stack runs as its own job in the chosen GitHub Environment. Protection rules on that environment, such as required reviewers or allowed branches, therefore apply to the run. Protect production environments, and keep dry runs in mind: they use the same environment and its credentials.

## Reading the result

- The **run summary** shows the stacks of this run, their layers and how they depend on each other, together with the config file and the commit it was read from.
- Each stack appears as its own job, named after the stack's `name`. Open it to see the plan, the script output or the error.
- Failed setup steps name the missing value, variable or secret. Add it to the config or the environment and run again.
