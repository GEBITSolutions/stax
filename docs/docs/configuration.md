# Configuration

## Deployment context

Put deployment values under the top-level `deployment` mapping in `configs/<name>.yaml`. The setup workflow reads this mapping to build the deployment environment. `stax init --project shop` writes `deployment.project: shop` in `configs/default.yaml`; it does not pass `project` as a reusable-workflow input.

```yaml
# configs/default.yaml
deployment:
  project: shop
  customer_id: default
  stage: dev
  cloud: azure
  default_location: northeurope
  public_cloud_flag: true
  resource_group_name: rg-shop-dev
  dns_zone_name: example.com
  dns_zone_resource_group_name: rg-dns
  state_storage_account_name: shopstate
  state_container_name: shop-tfstate
  state_resource_group_name: rg-state
stacks: []
```

```yaml
# configs/prod.yaml
deployment:
  stage: prod
  resource_group_name: rg-shop-prod
  state_container_name: shop-prod-tfstate
stacks: []
```

Selecting `configs/prod.yaml` uses its `stage`, resource group and state container. Supply the remaining required values through GitHub variables or add them to that selected YAML. Add a stack to the selected file before deploying; setup rejects an empty stack list.

The setup workflow reads only the files you select. `configs/default.yaml` is a normal config file: it contributes no values when you select `prod`. The same rule applies to external configuration repositories.

For multiple configs, pass `release_config_filepath: configs/prod.yaml,configs/region.yaml` to the setup reusable workflow. Later selected files override earlier values in the shared run context. The generated Deploy form selects one config by name.

Precedence per field is selected YAML → GitHub variable. An empty string or `null` falls through to the GitHub variable if no other selected file supplies the field; `false` remains an explicit value.

### Supported fields and GitHub variable fallback

| YAML `deployment` field | GitHub variable | Requirement |
|---|---|---|
| `project` | `PROJECT` (`vars.project` also works) | Required |
| `customer_id` | `CUSTOMER_ID` | Required |
| `stage` | `STAGE` | Required |
| `cloud` | `CLOUD` | Required; `azure` or `aws` |
| `default_location` | `DEFAULT_LOCATION` | Required |
| `public_cloud_flag` | `PUBLIC_CLOUD_FLAG` | Required; boolean `true`/`false` or their string forms |
| `resource_group_name` | `RESOURCE_GROUP_NAME` | Required for Azure |
| `dns_zone_name` | `DNS_ZONE_NAME` | Required for Azure |
| `dns_zone_resource_group_name` | `DNS_ZONE_RESOURCE_GROUP_NAME` | Required for Azure |
| `state_storage_account_name` | `STATE_STORAGE_ACCOUNT_NAME` | Required for Azure |
| `state_container_name` | `STATE_CONTAINER_NAME` | Required for Azure |
| `state_resource_group_name` | `STATE_RESOURCE_GROUP_NAME` | Required for Azure |
| `state_bucket_name` | `STATE_BUCKET_NAME` | Required for AWS |
| `state_region` | `STATE_REGION` | Required for AWS |

The setup workflow exports these values under the uppercase names in the table. You must supply required fields in YAML or the corresponding GitHub variable; setup identifies a missing field and variable instead of deriving a default. `stax init` writes starter defaults for the six common fields. It leaves cloud-specific values for you to provide. Missing cloud-specific fields that are not required export as empty strings. Setup rejects unknown deployment keys or non-string values except the boolean flag.

For a Pages-only deployment that does not need cloud infrastructure, set `skip-azure-credentials-validation: true` on the setup reusable-workflow call. Setup still requires the six common fields and validates `cloud`, but skips the Azure/AWS-specific requirements. See `.github/workflows/docs.yml` and `configs/stax-docs.yaml` for a Pages caller.

Keep credentials and tokens in GitHub secrets, not in `deployment`. The existing GitHub variables `CONFIG_LOCAL`, `CONFIG_REPO` and `CONFIG_VERSION` still choose the config source and version; deployment resolution does not change them.

Existing callers must remove the setup workflow's old `project` input and move its value into `deployment.project` or the GitHub `PROJECT` variable. The previous implicit defaults and derived DNS/state names no longer apply: declare those values in YAML or GitHub variables. Azure state storage account names still normalize to lowercase letters and digits and must contain 3–24 characters after normalization.
