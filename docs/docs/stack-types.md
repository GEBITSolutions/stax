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

### Docker images

`type: docker-build-push` takes `dockerfile_folder` (the build context containing the Dockerfile) and `image_name`, and pushes to GHCR or the registry given as `docker_registry_url`. `no_cache` and `registry` are optional; `input-gh-secrets` passes build secrets.

Optional `platforms` lists the container platforms to build, for example `platforms: [linux/amd64, linux/arm64]`. The workflow sets up QEMU and Buildx, so foreign architectures build through emulation; the template's base image must support them. Unset, `platforms` keeps the previous behaviour and builds only `linux/amd64`.

To use a pre-existing rootless BuildKit daemon directly, set `builder: buildkit` and `buildkit_address` to its address. The selected runner must have `buildctl` on PATH and access to the daemon. This path does not set up Docker, Buildx, QEMU or the daemon; cross-platform builds require suitable workers or emulation already available. Omit `builder` to keep the existing Docker/Buildx behavior. The job creates a temporary Docker-compatible registry authentication file for `buildctl` and removes it after the build. The same context, tags, labels, platforms, build secrets, no-cache and dry-run settings apply. On a dry run with a single platform nothing is exported, matching the Docker path's build-without-push behavior; a multi-platform dry run exports a temporary OCI archive (removed after the job) because BuildKit's default exporter is single-platform.

```yaml
stacks:
  - id: app
    type: docker-build-push
    dockerfile_folder: docker/app
    image_name: my-app
    builder: buildkit
    buildkit_address: unix:///run/buildkit/buildkitd.sock
    platforms: [linux/amd64]
    runs-on: build-runner
```

The BuildKit daemon must be trusted and protected from unauthorized clients. Rootless mode has isolation and Kubernetes security-context caveats; consult the [BuildKit rootless documentation](https://github.com/moby/buildkit/blob/master/docs/rootless.md) for the deployed version. Do not expose an unauthenticated daemon to untrusted networks. When using a remote TCP daemon, configure transport security separately; this executor does not provision TLS certificates.

```yaml
stacks:
  - id: app
    type: docker-build-push
    dockerfile_folder: docker/app
    image_name: my-app
    platforms: [linux/amd64, linux/arm64]
```

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
    packer_directory: packer/base-image
    packer_template: .
    packer_version: "1.16.1"
    build_target: hetzner
    hetzner:
      location: fsn1
      server_type: cax11
      snapshot_name: base-image-golden
      snapshot_labels:
        base-image: "true"
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

- [ ] **Helm**: planned, not supported yet.

## Raw Kubernetes manifest deployments

- [ ] **Kubernetes manifests**: planned, not supported yet.
