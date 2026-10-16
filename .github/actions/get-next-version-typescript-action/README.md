---
title: 'get-next-version (TypeScript action)'
---

# get-next-version (TypeScript action)

Calculates the next semantic version based on conventional commits and git tags.

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

## Usage

```yaml
- name: Get next version
  id: next_version
  uses: ./.github/actions/get-next-version
  with:
    log_order: topological

- run: |
    echo "${{ steps.next_version.outputs.version }}"
    echo "${{ steps.next_version.outputs.hasNextVersion }}"
```
