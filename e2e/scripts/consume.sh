#!/usr/bin/env bash
# E2E fixture: checks the value passed from the e2e-tofu stack and exports a derived
# value as this stack's output, so the workflow can verify the stored variable.
# shellcheck disable=SC2154 # tofu_message, expected and stack_id are stack inputs
set -euo pipefail

# Stack inputs arrive as "export key=value" lines in the first argument.
eval "${1:-}"

if [[ "${tofu_message}" != "${expected}" ]]; then
  echo "::error::Received '${tofu_message}' from e2e-tofu, expected '${expected}'"
  exit 1
fi
echo "Received ${tofu_message} from e2e-tofu"

if [[ "${DRY_RUN}" == "true" ]]; then
  exit 0
fi

prefix="$(tr '[:lower:]-' '[:upper:]_' <<<"${stack_id}")__"
{
  echo "output_vars=$(jq -nc --arg key "${prefix}DERIVED" --arg value "${tofu_message}-derived" '{($key): $value}')"
  echo "output_secrets={}"
} >>"${GITHUB_OUTPUT}"
