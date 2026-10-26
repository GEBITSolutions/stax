#!/usr/bin/env bash
# E2E fixture: fails unless every input expect_<name> equals the input (or environment
# variable) <name>, e.g. expect_DRY_RUN checks the DRY_RUN flag set by the workflow.
set -euo pipefail

# Stack inputs arrive as "export key=value" lines in the first argument.
eval "${1:-}"

failed=0
checked=0
for expected_name in $(compgen -v | grep '^expect_' || true); do
  name="${expected_name#expect_}"
  actual="${!name:-}"
  expected="${!expected_name}"
  checked=$((checked + 1))
  if [[ "${actual}" == "${expected}" ]]; then
    echo "${name} = ${actual}"
  else
    echo "::error::${name} is '${actual}', expected '${expected}'"
    failed=1
  fi
done

echo "Checked ${checked} value(s)"
exit "${failed}"
