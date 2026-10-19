# stax CLI

Scaffolds and validates projects for the stax stack framework. Package `@gebitsolutions/stax-cli`, binary `stax`. Requires Node.js 24 or later.

## `stax init`

Generates a deploy wrapper and an empty deploy config in a repository:

| File | Content |
|---|---|
| `.github/workflows/deploy.yml` | Manual `Deploy` workflow calling `a-wf-setup-ci.yml` and `a-wf-deploy-levels.yml` from `GEBITSolutions/stax@main` |
| `configs/default.yaml` | `stacks: []` with commented `externalRepos`, `globals` and stack examples, plus a `yaml-language-server` line that links the deploy-config schema for editor completion |

```bash
stax init [directory] --project <name> --environment <github-environment> [--force]
```

- `--project`: lowercase letters, digits and hyphens, starting with a letter. Used for resource naming and state layout.
- `--environment`: default GitHub Environment in the deploy form.
- Missing values are prompted for on a terminal; without a terminal, a missing value is an error.
- Existing files are never overwritten unless `--force` is given. Without it, nothing is written.

Nothing is deployed until `configs/default.yaml` has at least one stack.

The generated caller includes `pages: write` and `id-token: write` for GitHub Pages stacks. Existing callers upgrading to the Pages-enabled framework must add `pages: write` to their existing workflow permissions so nested workflow validation succeeds. A Pages-only caller can use the setup workflow's `skip-azure-credentials-validation: true`; see the repository's dedicated `configs/stax-docs.yaml` and `.github/workflows/docs.yml` example.

## `stax validate config`

Checks deploy configs against the schema in [`schema/deploy-config.schema.json`](../schema/deploy-config.schema.json) and against the rules the pipeline enforces.

```bash
stax validate config                 # deploy configs directly in configs/
stax validate config -r              # ... and in its subdirectories
stax validate config configs/prod.yaml
stax validate config other-dir -r --strict
```

- `[path]` is a file or a directory; it defaults to `configs`. A named file is always validated. When scanning a directory, YAML files without `stacks`, `externalRepos` or `globals` (for example Helm values) are listed as skipped.
- Findings show `line:column`, severity and the field path, e.g. `stacks[1].type`.
- Exit code 1 when any file has errors; warnings only fail with `--strict`.

| Errors (the pipeline fails or silently skips the stack) | Warnings |
|---|---|
| Invalid YAML; wrong field types (e.g. `local_backend: "false"` instead of a boolean) | Fields the schema does not know (often typos such as `depend_on`) |
| Missing `id` or `type`; unknown `type`; more than one `github-pages-site-deploy` stack or `destroy` on it | `depends_on` or `stack.<id>.var.<key>` pointing to a stack in another config |
| Type-specific required fields: Packer `packer_directory`/`packer_version`, `s3-site-deploy` `location`, `script` `script`, `bizep` `template`, `function-build-deploy` `runtime` | `source_repo` alias not defined in this file (configs deployed together share `externalRepos`) |
| Packer paths that are absolute, contain `..`, backslashes, empty segments or control characters; non-exact `packer_version` | No stacks defined |
| Duplicate stack ids; malformed `stack.<id>.var.<key>` references | |
| Dependency cycles (including through `stack.<id>...` inputs); dependency chains deeper than 14 levels | |

## Development

```bash
cd cli
npm ci
npm run typecheck
npm test            # copies ../schema first
npm run build
npm run sync-schema && node src/cli.ts validate config ../path/to/configs   # runs from source (Node 24 type stripping)
```
