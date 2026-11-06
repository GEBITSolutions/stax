---
title: 'get-next-version (TypeScript action)'
---

# get-next-version (TypeScript action)

Calculates the next semantic version based on conventional commits and git tags.

A TypeScript port of
[thenativeweb/get-next-version](https://github.com/thenativeweb/get-next-version)
(Go). Like the original, it is licensed under the [MIT License](LICENSE).

## Release history

The checkout must contain the complete history and release tags. For
`actions/checkout`, use `fetch-depth: 0`. Shallow repositories are rejected
rather than silently calculating an incorrect version. Missing tags in an
otherwise complete checkout cannot be detected automatically.

- The base version is the **highest semantic version reachable from `HEAD`**,
  independent of commit timestamps or log traversal order. Without a reachable
  release tag, the base is `0.0.0`.
- Reachability uses an explicit ancestor walk, not `git tag --merged`, which can
  omit reachable tags with skewed commit timestamps on some Git versions.
- Recognized tags are numeric `N`, `N.N` or `N.N.N`, optionally prefixed with
  `v`. Partial versions are padded with zeroes. Prerelease tags, build metadata
  and other tag prefixes are not recognized as releases.
- A commit is unreleased only when it is reachable from `HEAD` but **not
  included in any reachable release tag's ancestry**. This retains older work
  brought in by merges without counting an already released hotfix a second
  time.
- For example, merging a hotfix tagged `1.0.1` into a branch already released as
  `1.1.0` does not itself require `1.1.1`. A new unreleased `fix` does. This is
  release-global coverage, not a separate release policy for each maintenance
  line.
- Equivalent tags on one commit prefer the most precise form; differing versions
  on the same reachable commit are rejected as conflicting.
- `log_order` changes display order only, not the release boundary or version.

Coverage is based on commit identity, not patch equivalence or net tree changes:
cherry-picks can count again, and reverting a feature does not cancel its bump.
The `prefix` input changes the output only; it does not change tag recognition.

## Inputs

- `prefix`: Optional version prefix (e.g. `v`).
- `feature_prefixes`: Comma-separated feature prefixes (default: `feat`).
- `fix_prefixes`: Comma-separated fix prefixes (default: `fix`).
- `chore_prefixes`: Comma-separated chore prefixes (default:
  `build,chore,ci,docs,style,refactor,perf,test`).
- `log_order`: `committer-time` or `topological` (default: `committer-time`).

## Outputs

- `version`: The calculated next version (including prefix).
- `hasNextVersion`: `true` if a version bump is required.
- `prevVersion`: The raw tag of the highest reachable release, or an empty
  string if none exists.

## Usage

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0

- name: Get next version
  id: next_version
  uses: ./.github/actions/get-next-version-typescript-action
  with:
    log_order: topological

- run: |
    echo "${{ steps.next_version.outputs.version }}"
    echo "${{ steps.next_version.outputs.hasNextVersion }}"
```

## Development

Use Node.js 24 and npm 11:

```sh
npm ci
npm run format:check
npm run lint
npx tsc --noEmit
npm test -- --runInBand
npm run package
node --test scripts/action.test.mjs
git diff --exit-code -- dist/
```

The history tests create real temporary repositories. The bundled-action tests
execute `dist/index.js`, including the action inputs and GitHub output protocol.
Regenerate the tracked `dist/` files whenever the source changes. The final diff
check is clean once those regenerated files are included in the proposed change.
