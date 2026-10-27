## Release 1.4.0

Merged PRs: 36

### 🚀 New Features
  - Support custom AWS endpoints and S3-compatible storage such as Wasabi or MinIO for Terraform/OpenTofu stacks with the optional deployment fields aws_endpoint_url, aws_endpoint_url_s3, aws_endpoint_url_sts, aws_endpoint_url_iam, aws_s3_compatible, aws_skip_sts_check, state_use_lockfile and state_use_path_style (or the matching GitHub variables). The endpoints apply only to the Terraform steps of the action.
  - Validate the new fields in the schema and with stax validate config: endpoints must be https URLs without credentials, booleans must be true or false, and non-default values are rejected for clouds other than aws.
  - Add S3-compatible mode and a read-only dry_run input to the setup-state workflow for cloud: aws.

### 🐞 Bugfixes
  - Disable state locking for plans when no-lock is true. The plan step passed a bare -lock (meaning -lock=true), so dry-run plans still acquired the state lock.
  - Skip Infracost setup, breakdown and report uploads when INFRACOST_API_KEY is unset, so plans no longer log a fake Error: INFRACOST_API_KEY is not set.
  - Wait for final Jobs API conclusions in E2E job assertions instead of failing when completed dependency jobs are briefly still reported as running.

### 📝 Documentation
  - Document S3-compatible backends (Wasabi, MinIO), the OIDC limitation and the lockfile caveat.

## Release 1.3.3

Merged PRs: 34

### 🐞 Bugfixes
  - Honor stack if conditions even when no stack filter is supplied, including deployments where every selected stack is excluded (issue: #28).
  - Remove inserted spaces from Terraform and OpenTofu plan artifact names (issue: #29).
  - Forward actions-repository to Terraform/OpenTofu, script and SWA stack workflows so custom framework repositories are respected (issue: #30).

### 💥 Breaking Changes
  - Deployment behavior change: unfiltered deployments now skip stacks whose if condition evaluates false. Previously those conditions were ignored without a stack filter. Review existing conditions before upgrading; if every selected stack is excluded, no stacks are deployed.
  - Plan artifact names no longer contain spaces between the provider, stack and location components. Update artifact downloads that match the previous spaced names.