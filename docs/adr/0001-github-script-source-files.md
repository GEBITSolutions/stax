# ADR 0001: Keep GitHub script implementations in source files

- Status: Accepted
- Date: 2026-10-30

## Context

Inline JavaScript in workflow YAML clutters workflows and couples implementation tests to YAML formatting. Extracting a script body from a workflow to test it also ties the test harness to step names and indentation.

## Decision

Every `actions/github-script` step, including `actions/github-script@v8`, must load its implementation from a checked-in source file. The workflow's `with.script` may contain only the loader and entry-point call. Do not put business logic, helper functions, or control flow in that inline loader.

Keep workflow scripts in `.github/scripts/`. Export an entry point and pass the GitHub script APIs it needs as arguments. Pass configuration through step-level environment variables or explicit arguments; do not interpolate untrusted GitHub expressions into JavaScript source.

For example:

```yaml
- name: Resolve deployment metadata
  uses: actions/github-script@v8
  env:
    DEPLOYMENT_ENVIRONMENT: ${{ inputs.environment }}
  with:
    script: await require(`${process.env.GITHUB_WORKSPACE}/.github/scripts/resolve-deployment-metadata.cjs`)({ github, context, core });
```

Tests must import the source file directly and exercise its behavior with controlled dependencies. Do not extract JavaScript from workflow YAML or assert source text as a substitute for behavioral tests. Wire those tests into the relevant CI workflow.

Load scripts only from a checkout with the trust level required by the job. A step that currently runs before checkout must arrange access to trusted source before loading its implementation. Do not load privileged scripts from an untrusted pull-request checkout to satisfy this rule.

## Consequences

- Workflow YAML describes orchestration, inputs, permissions, and the script entry point.
- Contributors can read, lint, and test JavaScript independently of workflow YAML.
- Jobs need the appropriate source checkout before invoking `actions/github-script`.
- Existing inline implementations require migration. This ADR records the rule; it does not perform that refactor.
