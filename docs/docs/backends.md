# Backends

stax owns the Terraform/OpenTofu backend type: the pipeline writes an override file with an `azurerm` backend for `cloud: azure`, an `s3` backend for `cloud: aws`, or a `local` backend for stacks with `local_backend: true`. Keep an empty `backend "s3" {}` (or `backend "azurerm" {}`) block in the stack, or none at all; the bucket, key, region and flags come from the deployment context.

## AWS S3

For `cloud: aws` the state lives in `state_bucket_name` in `state_region`, one key per stack. State is locked with S3 native locking (`use_lockfile`), which needs OpenTofu 1.10 or Terraform 1.11 or later. Create the bucket with the setup-state workflow (`cloud: aws`); it enables versioning, default encryption, a public access block, a TLS-only bucket policy and managed tags. Pass `dry_run: true` to only check the bucket and list what would change.

## S3-compatible storage

The S3 backend also works with S3-compatible stores such as [Wasabi](https://wasabi.com) or [MinIO](https://min.io). Point stax at the store with the optional deployment fields (or their GitHub variables):

```yaml
deployment:
  cloud: aws
  default_location: eu-central-2
  state_region: eu-central-2
  state_bucket_name: example-tfstate
  aws_endpoint_url_s3: https://s3.eu-central-2.wasabisys.com
  aws_endpoint_url_sts: https://sts.wasabisys.com
  aws_endpoint_url_iam: https://iam.wasabisys.com
  aws_s3_compatible: true
  state_use_lockfile: false   # only until the store is known to support conditional writes
```

| Field | Effect |
|---|---|
| `aws_endpoint_url`, `aws_endpoint_url_s3`, `aws_endpoint_url_sts`, `aws_endpoint_url_iam` | Exported as `AWS_ENDPOINT_URL`, `AWS_ENDPOINT_URL_S3`, … to the init, plan, apply and output steps and the STS identity check. The S3 backend, the AWS provider and the AWS CLI read them. Other job steps, such as the SSM keystore, keep using AWS. |
| `aws_s3_compatible: true` | Sets `AWS_REQUEST_CHECKSUM_CALCULATION` and `AWS_RESPONSE_CHECKSUM_VALIDATION` to `when_required` for those steps and adds `skip_s3_checksum`, `skip_region_validation` and `skip_requesting_account_id` to the backend. |
| `aws_skip_sts_check: true` | Skips `aws sts get-caller-identity` and adds `skip_credentials_validation` to the backend. Use it for stores without an STS endpoint. |
| `state_use_lockfile: false` | Turns off S3 native locking for stores that do not support conditional writes. Nothing stops two runs of a stack from writing the state at the same time, so serialize deployments yourself. |
| `state_use_path_style: true` | Uses path-style addressing (`https://host/bucket/key`), which MinIO usually needs. |

Notes:

- Authenticate with the static `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets. GitHub OIDC exchanges its token at AWS STS, so `OIDC_ENABLED` cannot be combined with `aws_endpoint_url` or `aws_endpoint_url_sts`.
- The provider in your stack still needs settings that the backend flags do not cover, for example `skip_region_validation` and `skip_requesting_account_id` in the `aws` provider block for non-AWS regions.
- For the state bucket, call the setup-state workflow with the same endpoints and `aws_s3_compatible: "true"`. Versioning is required; public access block, default encryption, the TLS-only policy and tagging only warn when the store does not support them.
