#!/usr/bin/env bash
# Shared Azure login script — OIDC-aware with client-secret fallback.
#
# Environment variable interface (zero arguments):
#   OIDC_ENABLED           - "true" to use federated identity, anything else for client secret
#   ARM_CLIENT_ID          - Azure AD application (client) ID
#   ARM_TENANT_ID          - Azure AD tenant ID
#   ARM_SUBSCRIPTION_ID    - Target subscription
#   ARM_CLIENT_SECRET      - Client secret (only needed when OIDC_ENABLED != "true")
#   ACTIONS_ID_TOKEN_REQUEST_URL   - GitHub-provided OIDC endpoint (set automatically in Actions)
#   ACTIONS_ID_TOKEN_REQUEST_TOKEN - GitHub-provided bearer token for OIDC endpoint
#
# Usage:
#   bash "${GITHUB_WORKSPACE}/.github/scripts/az-login.sh"

set -euo pipefail

###############################################################################
# OIDC login path
###############################################################################
if [ "${OIDC_ENABLED:-}" = "true" ]; then
  echo "[az-login] OIDC mode enabled"

  # --- Fetch OIDC token -------------------------------------------------------
  if [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] || [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
    echo "::error::OIDC is enabled but ACTIONS_ID_TOKEN_REQUEST_URL or ACTIONS_ID_TOKEN_REQUEST_TOKEN is not set. Ensure the workflow has 'permissions: id-token: write' and the job uses an environment."
    exit 1
  fi

  HTTP_RESPONSE=$(mktemp)
  TOKEN=$(curl -sS --fail -w "\n%{http_code}" -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=api://AzureADTokenExchange" \
    2>"${HTTP_RESPONSE}" | { head -n -1 | jq -r '.value'; } || true)
  HTTP_CODE=$(tail -n1 "${HTTP_RESPONSE}" 2>/dev/null || echo "000")
  rm -f "${HTTP_RESPONSE}"

  # Validate token before masking — masking an empty string breaks log output
  if [ -z "${TOKEN}" ] || [ "${TOKEN}" = "null" ]; then
    echo "::error::OIDC token request failed (HTTP ${HTTP_CODE}). Verify the workflow has 'permissions: id-token: write' and the job uses an environment."
    exit 1
  fi

  # Mask the token in all subsequent log output (after validation)
  echo "::add-mask::${TOKEN}"

  echo "[az-login] OIDC token acquired successfully"

  # --- Decode & log JWT claims ------------------------------------------------
  if [ "${ACTIONS_STEP_DEBUG:-}" = "true" ] || [ "${RUNNER_DEBUG:-}" = "1" ]; then
    echo "[az-login] Token claims:"
    # JWT uses base64url without padding; fix padding before decoding
    PAYLOAD=$(echo "${TOKEN}" | cut -d. -f2 | tr '_-' '/+' | awk '{while(length%4)$0=$0"=";print}')
    echo "${PAYLOAD}" | base64 -d 2>/dev/null \
      | jq '{sub, iss, aud, environment, ref, job_workflow_ref}' || true
  fi

  # --- az login with federated token -----------------------------------------
  AZ_ERR=$(mktemp)
  set +e
  az login --service-principal \
    --username "${ARM_CLIENT_ID}" \
    --tenant "${ARM_TENANT_ID}" \
    --federated-token "${TOKEN}" > /dev/null 2>"${AZ_ERR}"
  AZ_EXIT=$?
  set -e

  if [ ${AZ_EXIT} -ne 0 ]; then
    echo "::error::OIDC az login failed (exit ${AZ_EXIT}). Client: ${ARM_CLIENT_ID}, Tenant: ${ARM_TENANT_ID}"
    # Redact the token from Azure AD error output, then print
    sed "s|${TOKEN}|[REDACTED]|g" "${AZ_ERR}" >&2
    rm -f "${AZ_ERR}"
    exit ${AZ_EXIT}
  fi
  rm -f "${AZ_ERR}"

  echo "[az-login] OIDC login succeeded"

###############################################################################
# Classic client-secret login path
###############################################################################
else
  echo "[az-login] Client-secret mode"

  az login --service-principal \
    -u "${ARM_CLIENT_ID}" \
    -p "${ARM_CLIENT_SECRET}" \
    --tenant "${ARM_TENANT_ID}"

  echo "[az-login] Client-secret login succeeded"
fi

###############################################################################
# Set target subscription (both paths)
###############################################################################
az account set -s "${ARM_SUBSCRIPTION_ID}"
echo "[az-login] Subscription set to ${ARM_SUBSCRIPTION_ID}"
