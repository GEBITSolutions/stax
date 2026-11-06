# Release notes

STAX can write a plain-English release note for every pull request and keep it in the pull-request description, where authors can read and edit it. The reusable workflow `a-wf-release-notes.yml` runs on each push to a same-repository pull request and maintains a `Release notes` section at the end of the description:

- a first line `**Breaking change:** No` or `**Breaking change:** Yes. <what stops working or changes>. <what users must do>.`;
- one to seven short bullets, one line each, stating what changed for users (related changes grouped);
- links back to the pull request and the issues it closes.

The section is replaced on every push. To keep a hand-edited version, put `<!-- release-notes:keep -->` on a line of its own inside the section.

## Add it to a repository

```yaml
name: Release notes

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  issues: read
  pull-requests: write

concurrency:
  group: release-notes-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  release-notes:
    uses: GEBITSolutions/stax/.github/workflows/a-wf-release-notes.yml@<version>
    with:
      model: my-model
      actions-version: <version>
    secrets:
      llm-base-url: ${{ secrets.LLM_BASE_URL }}
      llm-api-key: ${{ secrets.LLM_API_KEY }}
```

| Input or secret | Required | Purpose |
| --- | --- | --- |
| `model` | yes | Model or deployment name served by the endpoint. |
| `llm-base-url` (secret) | yes | OpenAI Responses-compatible base URL ending in `/v1`, for example `https://api.openai.com/v1`. It is a secret so the endpoint stays out of public logs. |
| `llm-api-key` (secret) | yes | Key for the endpoint, sent as a bearer token. |
| `instructions-path` | no | Custom instructions on the caller's base branch. The default is [`.github/release-notes/instructions.md`](https://github.com/GEBITSolutions/stax/blob/main/.github/release-notes/instructions.md). |
| `release-app-client-id`, `release-app-private-key` (secret) | no | GitHub App that edits the description; it needs the repository permission **Pull requests: Read and write**. Without it, the job token edits it as `github-actions[bot]`. |
| `environment` | no | GitHub environment of the job (default `release-notes`); each run is listed under Deployments with a link to the pull request. Protection rules on it would hold the job. |
| `max-diff-chars` | no | Diff characters passed to the agent (default 120000); longer diffs are truncated. |

Fork and Dependabot pull requests are skipped because they receive no secrets; drafts are skipped until they are ready for review.

## In releases

When `a-wf-release.yml` or `a-wf-release-prepare.yml` prepares a release, it asks GitHub which pull request each first-parent commit since the previous release tag merged, and writes their sections into a `## Release <version>` entry of `CHANGELOG.md` and into the release body: breaking changes first, then the changes, then pull requests merged without a note. The pre-release shows this draft, so it can be checked before the release is approved.

During the transition from JSON release notes, the next release also includes `release-ready/release-notes/pr-*.json` files and a hand-written `## Unreleased` section of `CHANGELOG.md`.

## Migrating from the Copilot workflow

`a-wf-copilot-generate-release-notes.yml` is deprecated and will be removed in the next major release. Replace its caller with the workflow shown above: drop the `pr_number`, `branch` and `base_ref` inputs and the `COPILOT_USER_TOKEN` secret, and pass `model`, `llm-base-url` and `llm-api-key`. Pending `release-ready/release-notes/*.json` files are still collected by the next release.

## How the agent is isolated

The note is written by [Letta Code](https://github.com/letta-ai/letta-code) in a pinned container image, on the local backend and `--ephemeral`: no agent, memory or account is kept, and telemetry and auto-update are off. The agent receives the title, description, commits, diff and closed issues in its prompt and may additionally read the checkout. The workflow:

- mounts the pull-request checkout read-only and deletes symlinks from it first;
- allows only `Read`, `Glob` and `Grep` below the checkout, in strict permission mode, so every other tool call is denied;
- starts the agent outside the checkout, so settings or skills in the pull request cannot widen its permissions;
- runs the agent on an internal Docker network without DNS. Its only peer is a relay (pinned nginx) that forwards the endpoint's `/v1/` route over verified TLS and adds the real key. The agent only holds a dummy key, and the job fails if the agent container can reach anything else.

Instructions, the relay configuration and scripts come from the STAX checkout selected by `actions-repository` and `actions-version`, not from the pull request. Custom instructions are read from the base branch.
