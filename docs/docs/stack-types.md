# Supported stack types

Combine these technologies and workflow types in your STAX Framework deployment stacks.

Checked boxes indicate support. Unchecked boxes indicate planned support, not available yet.

## Infrastructure as code

- [x] **Terraform** (`terraform`): provision cloud infrastructure.
- [x] **OpenTofu** (`opentofu`): provision cloud infrastructure.
- [x] **Bicep** (`bicep`): provision Azure infrastructure.
- [ ] **CDK**: planned, not supported yet.

## Docker and image builds

- [x] **Docker** (`docker-build-push`): build container images and push them to a registry.
- [x] **Packer** (`packer`): build machine images for Azure Compute Gallery or Hetzner Cloud. AWS AMIs are reserved and not implemented.

### Packer images

`type: packer` takes `packer_directory`, an exact `packer_version`, and an optional `packer_template` (default `.`). `build_target` selects the publisher. Omit it, or set `azure`, to keep today's Azure Compute Gallery behavior.

The template owns the source block (builder, base image, provisioners) and must declare any Packer variables it reads. STAX owns credentials, the injected var-file, `packer fmt` / `init` / `validate`, publishing, retention, and outputs. A Hetzner template must write `manifest.json` with a manifest post-processor. Gallery builds still take `image_id` from `az sig image-version show`; the manifest is optional there.

Packer input conversion still comes from `GEBITSolutions/stax` at `actions-version`. The build-target helper is loaded from that same trusted checkout (`.github/scripts/packer-build-target.mjs`). `actions-version` has to include this change. `dry_run` remains the default, so a Hetzner build does not create a server unless dry-run is turned off. There is no extra environment protection rule.

STAX injects `stax_build_target`, `stax_stack_id`, `stax_env`, `stax_git_sha` and `stax_image_version` only when the template declares that variable, so existing Gallery templates keep validating. It also flattens `azure.*` or `hetzner.*` into the same `.pkrvars.json` file as stack inputs. An input that disagrees with the build-target field fails the run.

| `build_target` | Credentials | Publish |
|---|---|---|
| `azure` (default) | `ARM_*` and `OIDC_ENABLED`, unchanged | Compute Gallery image version. `destroy` is rejected. |
| `hetzner` | `HCLOUD_TOKEN` on the GitHub Environment | Labelled snapshot. `keep_last` (default 3) deletes older matches. `destroy: true` deletes matches beyond `keep_last`, or all of them when `keep_last` is 0. |
| `aws` | Reserved | Not implemented. `stax validate config` warns; the workflow fails. The output names will not change when an AMI executor is added. |

`azure` fields are `image_resource_group_name`, `gallery_name`, `image_definition_name`, `image_version` and `target_regions`. The same names at the top level of the stack are deprecated aliases. Configs that still pass them through `input` do not need either form.

`hetzner` requires `location` and `server_type` (`cax11` is arm64; the template's base image must match, STAX does not translate architecture). Optional: `snapshot_name` (default: the stack id), `snapshot_labels`, `keep_last`. STAX merges labels with `stax_stack_id`, `stax_env`, `stax_git_sha`, `stax_build_target=hetzner` and `managed_by=stax`, and those keys win. A `cax11` build is about €0.01 per hour; snapshots are about €0.017 per GB-month. The job summary prints that estimate. `dry_run` validates the template and does not create a server or call the Hetzner API.

Downstream stacks read published values with `stack.<id>.var.<output>`:

| Output | Meaning |
|---|---|
| `image_id` | Gallery version resource ID, Hetzner snapshot id, or later an AMI id |
| `image_ref` | `azure:gallery:<resource-group>/<gallery>/<definition>/<version>` or `hcloud:snapshot:<id>` |
| `build_target` | `azure`, `hetzner`, or later `aws` |
| `version` | Gallery `image_version`, or `0.0.0+<git sha>` for Hetzner |
| `labels` | JSON object of tags or snapshot labels |
| `git_sha` | Source commit |

`output-var` lists which of those to export. A list that only contains `image_id` still exports only that value.

```yaml
stacks:
  - id: golden-hetzner
    type: packer
    packer_directory: packer/personal-assistant
    packer_template: .
    packer_version: "1.16.1"
    build_target: hetzner
    hetzner:
      location: fsn1
      server_type: cax11
      snapshot_name: personal-assistant-golden
      snapshot_labels:
        personal-assistant: "true"
        role: golden
      keep_last: 3
    output-var: [image_id, image_ref, build_target, version, labels]
```

## Packages

- [x] **RPM** (`rpmbuild`): build RPM packages.

## Deployments

- [x] **Cloud functions** (`function-build-deploy`): build and deploy cloud functions.
- [x] **Azure Static Web Apps** (`swa-site-deploy`): deploy websites.
- [x] **Azure Static Web Apps documentation** (`swa-docs-site-deploy`): deploy documentation sites.
- [x] **Amazon S3** (`s3-site-deploy`): deploy static websites.
- [x] **GitHub Pages** (`github-pages-site-deploy`): build MkDocs or Zensical documentation, or publish a prebuilt static site.

## Scripts

Use the `script` workflow type to run custom scripts:

- [x] **Bash**: run shell scripts.
- [x] **Python**: run Python scripts.

## Helm deployments

- [x] **Helm** (`helm`): install or upgrade one release of an OCI chart on a Kubernetes cluster.

`type: helm` requires `chart` (an `oci://` reference), an exact `chart_version` and `namespace`, which is created when missing. `release_name` defaults to the stack id. `values_files` are read from the source checkout (`source_repo`/`source_version`, as for other types) and applied in order.

Inputs are read by key:

- `cluster_host`, `cluster_ca_certificate`, `client_certificate` and `client_key` hold the base64 admin credentials, as the RPOA `aks` stack outputs them, and build the kubeconfig. They are no chart values.
- `values` is one values document: an object (inline, or a YAML file through `externalRepos.<alias>.<path>.yaml`) or a YAML string (for example a stack output). The key may repeat.
- Every other key is one chart parameter, like `helm --set`. A dotted key such as `githubConfigSecret.github_app_id` sets a nested value, `\.` is a literal dot (`podAnnotations.prometheus\.io/port`) and `name[0]` a list index. Unlike `--set` the value keeps the type it resolves to: YAML literals stay numbers or booleans, while `gh.var.*`, `gh.secret.*` and stack outputs stay strings. Pass a `values` document when a reference must become a number or an object.

Later sources override earlier ones, merged as Helm merges `--values` files (maps deep, lists replaced): chart defaults, then `values_files` in order, then `values` inputs in input order, then the parameters. Everything is passed as files, so multi-line secrets such as private keys stay intact and never appear on a command line.

`dry_run` renders the chart with `helm template` without contacting the cluster and prints only the rendered kinds, because manifests can contain secrets. Otherwise STAX runs `helm upgrade --install --create-namespace --wait --reset-values`: one idempotent command for the first install and every later run. `--reset-values` makes the config the whole desired state; without it Helm keeps the previous release's values whenever an upgrade passes none. `destroy` runs `helm uninstall`; the namespace stays. `helm upgrade` never updates CRDs that a chart ships in `crds/` (the ARC controller chart does); apply new CRDs separately before raising `chart_version`. The runner needs `helm` on the `PATH`; GitHub-hosted Ubuntu runners have it. A Helm stack exports no outputs.

```yaml
stacks:
  - id: arc-controller
    type: helm
    chart: oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller
    chart_version: "0.15.1"
    release_name: arc
    namespace: arc-systems
    input:
      - stack.aks.secret.cluster_host
      - stack.aks.secret.cluster_ca_certificate
      - stack.aks.secret.client_certificate
      - stack.aks.secret.client_key
```

`examples/helm/arc.yaml` adds a runner scale set authenticated by a GitHub App.

## Raw Kubernetes manifest deployments

- [x] **Kubernetes manifests**: deploy Kubernetes resources from raw YAML manifests.
