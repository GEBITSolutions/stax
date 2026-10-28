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

Packer input conversion still comes from `GEBITSolutions/stax` at `actions-version`. The build-target helper is loaded from that same trusted checkout (`.github/scripts/packer-build-target.mjs`). Pin `actions-version` to a release that includes Hetzner support (1.6.0 or later). `dry_run` remains the default, so a Hetzner build does not create a server unless dry-run is turned off. There is no extra environment protection rule.

| `build_target` | Credentials | Publish |
|---|---|---|
| `azure` (default) | `ARM_*` and `OIDC_ENABLED`, unchanged | Compute Gallery image version. `destroy` is rejected. |
| `hetzner` | `HCLOUD_TOKEN` on the GitHub Environment | Labelled snapshot. `keep_last` (default 3) deletes older matches. `destroy: true` deletes matches beyond `keep_last`, or all of them when `keep_last` is 0. |
| `aws` | Reserved | Not implemented. `stax validate config` warns; the workflow fails. The output names will not change when an AMI executor is added. |

`azure` fields are `image_resource_group_name`, `gallery_name`, `image_definition_name`, `image_version` and `target_regions`. The same names at the top level of the stack are deprecated aliases. Configs that still pass them through `input` do not need either form.

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

#### Hetzner snapshot contract

This section is the template and stack contract for `build_target: hetzner`, as implemented by `.github/workflows/a-wf-deploy-stack-packer-hetzner.yml` and `.github/scripts/packer-build-target.mjs`.

##### Stack config

`hetzner` is required when `build_target` is `hetzner`:

| Field | Required | Default | Notes |
|---|---|---|---|
| `location` | yes | — | Hetzner location such as `fsn1` (`^[a-z]{2,4}[0-9]?$`). |
| `server_type` | yes | — | Temporary build server such as `cax11` (`cax*` is arm64). STAX does not translate architecture; the template's base image must match. |
| `snapshot_name` | no | the stack `id` | 1–63 letters, digits, `.`, `_` or `-`, starting with a letter or digit. Set it when the stack id is not a valid snapshot name. |
| `snapshot_labels` | no | `{}` | Extra labels. Keys and values follow Hetzner's 1–63 character rules. Reserved keys are overwritten by STAX (see below). |
| `keep_last` | no | `3` | Integer 0–100. After a successful build, older matching snapshots beyond this count are deleted. |

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
    output-var: [image_id, image_ref, build_target, version, labels, git_sha]
```

Reference configs and a matching template live under `examples/packer/` in this repository.

##### Credentials and dry-run

A non-dry-run build or destroy needs the `HCLOUD_TOKEN` secret on the GitHub Environment that the Packer job uses. Dry-run (the default) runs `packer fmt`, `init` and `validate` with a placeholder token and does not create a server or call the Hetzner API. There is no extra Environment approval rule beyond whatever you already attach to that Environment.

##### Required template variables

The template **must** declare these Packer variables. `assemble-vars` fails the job if any of them is missing from the template's `variable` blocks:

| Variable | Type | Source |
|---|---|---|
| `location` | `string` | `hetzner.location` |
| `server_type` | `string` | `hetzner.server_type` |
| `snapshot_name` | `string` | `hetzner.snapshot_name`, or the stack `id` |
| `snapshot_labels` | `map(string)` | Merged labels (user labels plus STAX-forced labels) |

Wire them into the `hcloud` source (`location`, `server_type`, `snapshot_name`, `snapshot_labels`). The template also **must** include a `manifest` post-processor that writes `manifest.json` in `packer_directory`. The publisher reads the last build's `artifact_id` as the numeric Hetzner snapshot id. Without that file, the apply step fails with `The template must write manifest.json with a manifest post-processor.`

##### Forced labels and retention

STAX always merges these labels onto the snapshot and **overwrites** the same keys if they appear in `hetzner.snapshot_labels`:

| Label | Value |
|---|---|
| `managed_by` | always `stax` |
| `stax_stack_id` | stack `id` |
| `stax_env` | pipeline environment name |
| `stax_git_sha` | full lowercase source commit SHA |
| `stax_build_target` | `hetzner` |

Retention matches on `managed_by=stax`, `stax_stack_id`, `stax_env` and `stax_build_target=hetzner` only. It does **not** filter on `stax_git_sha`, so `keep_last` applies across commits for the same stack and environment. That is why `managed_by=stax` is forced: without a stable selector, retention cannot tell STAX-managed snapshots apart from other labelled images in the project.

After a successful apply, STAX deletes the oldest matching snapshots beyond `keep_last`, and never deletes the snapshot just built (`keep_last: 0` on apply still keeps that new snapshot). On `destroy: true`, no image is built; the same selector deletes matches beyond `keep_last`, or every match when `keep_last` is `0`. Azure Gallery builds still reject `destroy`.

A `cax11` build is about €0.01 per hour; snapshots are about €0.017 per GB-month. The job summary prints that estimate.

##### Injected var-file

STAX writes a `.pkrvars.json` next to the template. Stack `input` values are converted first. Then the build-target helper flattens these keys into the same file:

| Key | When written |
|---|---|
| `location`, `server_type`, `snapshot_name`, `snapshot_labels` | Always for `hetzner` (required template variables). |
| `keep_last` | Only when the template also declares a `keep_last` variable. Retention still uses the stack field either way. |
| `stax_build_target`, `stax_stack_id`, `stax_env`, `stax_git_sha`, `stax_image_version` | Only when the template declares that variable. Packer rejects unknown var-file keys, so undeclared `stax_*` names are skipped. |

`stax_image_version` for Hetzner is `0.0.0+<git sha>`. An `input` value that disagrees with a build-target field fails the run. Existing Azure Gallery templates that declare none of the `stax_*` names keep validating unchanged.

##### Outputs after publish

| Output | Hetzner value |
|---|---|
| `image_id` | Numeric snapshot id from `manifest.json` |
| `image_ref` | `hcloud:snapshot:<id>` |
| `build_target` | `hetzner` |
| `version` | `0.0.0+<git sha>` |
| `labels` | JSON object of the merged `snapshot_labels` written to the var-file |
| `git_sha` | Source commit |

##### Minimal working template

```hcl
packer {
  required_plugins {
    hcloud = {
      source  = "github.com/hetznercloud/hcloud"
      version = ">= 1.6.0"
    }
  }
}

variable "location" {
  type = string
}

variable "server_type" {
  type = string
}

variable "snapshot_name" {
  type = string
}

variable "snapshot_labels" {
  type = map(string)
}

variable "stax_build_target" {
  type    = string
  default = "hetzner"
}

variable "stax_stack_id" {
  type = string
}

variable "stax_env" {
  type = string
}

variable "stax_git_sha" {
  type = string
}

variable "stax_image_version" {
  type = string
}

source "hcloud" "golden" {
  location        = var.location
  server_type     = var.server_type
  image           = "ubuntu-24.04"
  ssh_username    = "root"
  snapshot_name   = var.snapshot_name
  snapshot_labels = var.snapshot_labels
}

build {
  sources = ["source.hcloud.golden"]

  provisioner "shell" {
    inline = ["echo golden image"]
  }

  post-processor "manifest" {
    output     = "manifest.json"
    strip_path = true
  }
}
```

The four required variables above are the minimum. The optional `stax_*` declarations let the template read STAX metadata (for example in provisioner scripts); omit any you do not use. See `examples/packer/personal-assistant/image.pkr.hcl` for the same shape used by the reference stack config.

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

- [x] **Helm**: deploy Helm charts to Kubernetes clusters.

## Raw Kubernetes manifest deployments

- [x] **Kubernetes manifests**: deploy Kubernetes resources from raw YAML manifests.
