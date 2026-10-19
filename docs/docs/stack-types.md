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
- [x] **Packer** (`packer`): build machine images.

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
