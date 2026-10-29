#!/usr/bin/env bash
# Installs, upgrades or uninstalls one Helm release for a `type: helm` stack.
# Called by a-wf-deploy-stack-helm.yml; runs locally with the same environment.
#
#   CHART          oci:// chart reference
#   CHART_VERSION  exact chart version
#   RELEASE_NAME   Helm release name
#   NAMESPACE      target namespace, created when missing
#   VALUES_FILES   newline-separated values files, applied in order
#   INPUTS         JSON [{key, value}] from gh-convert-stack-inputs. cluster_host, cluster_ca_certificate,
#                  client_certificate and client_key (base64, as the RPOA aks stack outputs them) build the
#                  kubeconfig. Every other input is a Helm value that overrides the values files; a dotted
#                  key sets a nested value.
#   DRY_RUN        true (default): render with helm template, without cluster access
#   DESTROY        true: helm uninstall
set -euo pipefail

: "${CHART:?}" "${CHART_VERSION:?}" "${RELEASE_NAME:?}" "${NAMESPACE:?}"
INPUTS="${INPUTS:-[]}"
command -v helm >/dev/null || { echo "::error::helm is not installed on this runner"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

credentials='["cluster_host","cluster_ca_certificate","client_certificate","client_key"]'
jq --argjson credentials "${credentials}" '
  reduce (.[] | select(.key as $key | $credentials | index($key) | not)) as $input
    ({}; setpath($input.key | split("."); $input.value))' <<<"${INPUTS}" >"${work}/inputs.json"

chart_args=(--namespace "${NAMESPACE}" --version "${CHART_VERSION}")
while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  [[ -f "${file}" ]] || { echo "::error::values file not found: ${file}"; exit 1; }
  chart_args+=(--values "${file}")
done <<<"${VALUES_FILES:-}"
chart_args+=(--values "${work}/inputs.json")

if [[ "${DRY_RUN:-true}" == "true" ]]; then
  if [[ "${DESTROY:-false}" == "true" ]]; then
    echo "Dry run: would uninstall ${RELEASE_NAME} from namespace ${NAMESPACE}"
    exit 0
  fi
  # Rendered manifests can hold secret values, so only their kinds are printed.
  helm template "${RELEASE_NAME}" "${CHART}" "${chart_args[@]}" >"${work}/manifests.yaml"
  echo "Dry run: ${CHART} ${CHART_VERSION} renders"
  grep -E '^kind:' "${work}/manifests.yaml" | sort | uniq -c
  exit 0
fi

credential() { jq -r --arg key "$1" 'map(select(.key == $key))[0].value // empty' <<<"${INPUTS}"; }
for key in $(jq -r '.[]' <<<"${credentials}"); do
  [[ -n "$(credential "${key}")" ]] || { echo "::error::input ${key} is required to reach the cluster"; exit 1; }
done
server="$(credential cluster_host | base64 -d)"
echo "::add-mask::${server}"

export KUBECONFIG="${work}/kubeconfig"
cat >"${KUBECONFIG}" <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: target
    cluster:
      server: "${server}"
      certificate-authority-data: "$(credential cluster_ca_certificate)"
users:
  - name: stax
    user:
      client-certificate-data: "$(credential client_certificate)"
      client-key-data: "$(credential client_key)"
contexts:
  - name: target
    context: { cluster: target, user: stax }
current-context: target
EOF

if [[ "${DESTROY:-false}" == "true" ]]; then
  helm uninstall "${RELEASE_NAME}" --namespace "${NAMESPACE}" --wait --ignore-not-found
else
  helm upgrade --install "${RELEASE_NAME}" "${CHART}" "${chart_args[@]}" --create-namespace --wait
fi
