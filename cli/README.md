# stax CLI

Scaffolds projects for the stax stack framework. Package `@gebitsolutions/stax-cli`, binary `stax`. Requires Node.js 24 or later.

## `stax init`

Generates a deploy wrapper and an empty deploy config in a repository:

| File | Content |
|---|---|
| `.github/workflows/deploy.yml` | Manual `Deploy` workflow calling `a-wf-setup-ci.yml` and `a-wf-deploy-levels.yml` from `GEBITSolutions/stax@main` |
| `configs/default.yaml` | `stacks: []` with commented `externalRepos`, `globals` and stack examples |

```bash
stax init [directory] --project <name> --environment <github-environment> [--force]
```

- `--project`: lowercase letters, digits and hyphens, starting with a letter. Used for resource naming and state layout.
- `--environment`: default GitHub Environment in the deploy form.
- Missing values are prompted for on a terminal; without a terminal, a missing value is an error.
- Existing files are never overwritten unless `--force` is given. Without it, nothing is written.

The Deploy workflow's setup step fails with "No stacks found" until `configs/default.yaml` has at least one stack.

The generated caller includes `pages: write` and `id-token: write` for GitHub Pages stacks. Existing callers upgrading to the Pages-enabled framework must add `pages: write` to their existing workflow permissions so nested workflow validation succeeds. A Pages-only caller can use the setup workflow's `skip-azure-credentials-validation: true`; see the repository's dedicated `configs/stax-docs.yaml` and `.github/workflows/docs.yml` example.

## Development

```bash
cd cli
npm ci
npm run typecheck
npm test
npm run build
node src/cli.ts init /tmp/demo   # runs from source (Node 24 type stripping)
```
