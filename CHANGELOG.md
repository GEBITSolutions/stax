## Release 1.3.3

Merged PRs: 34

### 🐞 Bugfixes
  - Honor stack if conditions even when no stack filter is supplied, including deployments where every selected stack is excluded (issue: #28).
  - Remove inserted spaces from Terraform and OpenTofu plan artifact names (issue: #29).
  - Forward actions-repository to Terraform/OpenTofu, script and SWA stack workflows so custom framework repositories are respected (issue: #30).

### 💥 Breaking Changes
  - Deployment behavior change: unfiltered deployments now skip stacks whose if condition evaluates false. Previously those conditions were ignored without a stack filter. Review existing conditions before upgrading; if every selected stack is excluded, no stacks are deployed.
  - Plan artifact names no longer contain spaces between the provider, stack and location components. Update artifact downloads that match the previous spaced names.