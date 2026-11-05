# Passing values between stacks

Stacks rarely stand alone. A cluster needs the network it runs in, and an application needs the address of its database. STAX lets one stack hand values to another: the first stack **publishes outputs**, and the second one **reads them as inputs**.

## Inputs

A stack lists the values it needs under `input`. Each entry gives the input a name and says where its value comes from:

```yaml
stacks:
  - id: app
    type: opentofu
    folder: app
    input:
      - replicas: "2"                                             # a fixed value
      - resource_group: global.pipeline.var.resource_group_name   # a value of this deployment
      - app_name: global.config.var.app_name                      # a shared value from this config file
      - subnet_id: stack.network.var.subnet_id                    # an output of the network stack
      - global.pipeline.var.stage                                 # named after its last part: stage
```

The input name is what the stack sees: a Terraform or OpenTofu variable, or a shell variable in a script stack. When an entry is only a reference, without a name, the input takes the name of the reference's last part.

### Where values can come from

| Reference | Value |
| --- | --- |
| `global.pipeline.var.<name>` | A value of the current deployment, such as `project`, `stage`, `customer_id`, `environment`, `cloud`, `resource_group_name`, `dry_run` or `release_tag_name`. |
| `global.config.var.<name>` | A shared value from the top-level `globals` section of the same config file. |
| `stack.<id>.var.<name>` | An output of another stack. |
| `stack.<id>.secret.<name>` | An output of another stack that was stored as a secret. |
| `gh.var.<NAME>` | A variable of the GitHub Environment. |
| `gh.secret.<NAME>` | A secret of the GitHub Environment. |

Anything that is not a reference is passed on as written.

Shared values belong to the file that defines them. Use them for names or settings that several stacks of one config repeat:

```yaml
globals:
  app_name: shop

stacks:
  - id: frontend
    type: script
    script: scripts/frontend.sh
    input:
      - global.config.var.app_name
```

### When a value is missing

If a referenced value does not exist, the stack fails and the log names the missing reference. A typo therefore stops the run instead of deploying a wrong value. The only exception is a destroy run of Terraform, OpenTofu and Azure Static Web Apps stacks, where a placeholder stands in so that removal is not blocked by values that are already gone.

## Outputs

### Terraform and OpenTofu

You do not have to declare anything to make an output available to stacks in the same config. When another stack reads `stack.network.var.subnet_id`, STAX publishes the `subnet_id` output of `network` automatically:

```hcl
# network/outputs.tf
output "subnet_id" {
  value = azurerm_subnet.main.id
}
```

To publish an output that no stack in the config reads yet, for example for a separate config, list it under `output-var`, or under `output-secret` to store it as a secret:

```yaml
  - id: network
    type: opentofu
    folder: network
    output-var: [subnet_id, vnet_name]
    output-secret: [admin_password]
```

### Script stacks

A script publishes values by writing two lines to `$GITHUB_OUTPUT`: `output_vars` and `output_secrets`, each a JSON object. Each name starts with the stack id in capital letters, hyphens replaced by underscores, followed by two underscores:

```bash
# Publishes "endpoint" for the stack with id "api".
prefix="$(tr '[:lower:]-' '[:upper:]_' <<<"${stack_id}")__"
{
  echo "output_vars=$(jq -nc --arg key "${prefix}ENDPOINT" --arg value "https://api.example.com" '{($key): $value}')"
  echo "output_secrets={}"
} >>"${GITHUB_OUTPUT}"
```

Another stack then reads it as `stack.api.var.endpoint`.

## Reading a value also sets the order

When a stack reads another stack's output, it automatically depends on that stack. You do not need to repeat it under `depends_on`:

```yaml
stacks:
  - id: network
    type: opentofu
    folder: network

  - id: app
    type: opentofu
    folder: app
    input:
      - subnet_id: stack.network.var.subnet_id   # app now runs after network
```

If the referenced stack is not part of the selected config, STAX adds no dependency and logs a warning. The value is then read from what an earlier deployment stored, which is how one config can use outputs of another.

## Where outputs are stored

Outputs are stored per GitHub Environment, so `dev` and `prod` keep separate values. Configure one store per environment; STAX reads from the first one it finds in this order:

| Store | Configure with |
| --- | --- |
| AWS Systems Manager Parameter Store | Variable `REPO_KEYSTORE_SSM_PREFIX` |
| Azure Key Vault | Variable `REPO_KEYSTORE_KEY_VAULT_URL` |
| GitHub Environment (default) | A GitHub App with the variable `RELEASE_APP_CLIENT_ID` and the secret `RELEASE_APP_CLIENT_SECRET`, or a token in the secret `CI_ENV_TRANSFER_GH_TOKEN` |

With the default store, an output appears as a variable or secret of the environment, for example `NETWORK__SUBNET_ID`. The GitHub App or token needs write access to the repository's environments, variables and secrets.

Outputs are only stored by real deployments. A dry run uses the values from the last real deployment. On the first dry run of a new config, a stack that reads another stack's output therefore fails until that stack has been deployed once.
