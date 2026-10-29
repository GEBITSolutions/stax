#!/usr/bin/env bash
# STAX Packer scan entrypoint. Runs on the build VM before the image is captured.
# Packer aborts the build on a non-zero exit, so Azure Gallery / Hetzner / future
# AWS publishers never see a failing image.
#
# Prefer a self-contained script (config embedded by materialize-scan) so a single
# shell provisioner `script = "${path.root}/.stax/scan/run.sh"` is enough.
set -euo pipefail

# Templates may keep the provisioner while scan is off (default false).
if [[ "${STAX_SCAN_ENABLED:-}" == "false" || "${STAX_SCAN_ENABLED:-}" == "0" ]]; then
  echo "STAX scan hooks skipped (STAX_SCAN_ENABLED=${STAX_SCAN_ENABLED})."
  exit 0
fi

SCAN_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${STAX_SCAN_WORK_DIR:-/tmp/stax-scan-$$}"
mkdir -p -- "$WORK_DIR"
trap 'rm -rf -- "$WORK_DIR"' EXIT

if ! command -v jq >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq jq ca-certificates curl >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q jq curl ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q jq curl ca-certificates
  else
    echo "jq is required to read the STAX scan config" >&2
    exit 1
  fi
fi

CONFIG_FILE="$WORK_DIR/config.json"
if [[ -n "${STAX_EMBEDDED_CONFIG:-}" ]]; then
  printf '%s\n' "$STAX_EMBEDDED_CONFIG" > "$CONFIG_FILE"
elif [[ -f "${STAX_SCAN_CONFIG:-$SCAN_DIR/config.json}" ]]; then
  cp -- "${STAX_SCAN_CONFIG:-$SCAN_DIR/config.json}" "$CONFIG_FILE"
else
  echo "STAX scan config missing (embed or $SCAN_DIR/config.json)" >&2
  exit 1
fi

if [[ -n "${STAX_EMBEDDED_GOSS_SPEC:-}" ]]; then
  printf '%s\n' "$STAX_EMBEDDED_GOSS_SPEC" > "$WORK_DIR/goss.yaml"
  CONFIG_FILE_TMP="$WORK_DIR/config.with-goss.json"
  jq --arg path "$WORK_DIR/goss.yaml" '.goss.spec_path = $path' "$CONFIG_FILE" > "$CONFIG_FILE_TMP"
  CONFIG_FILE="$CONFIG_FILE_TMP"
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) trivy_arch="64bit"; goss_arch="amd64" ;;
  aarch64|arm64) trivy_arch="ARM64"; goss_arch="arm64" ;;
  *)
    echo "Unsupported architecture for STAX image scans: $arch" >&2
    exit 1
    ;;
esac

failures=0

run_trivy() {
  local severity scanners scanner_csv version url
  severity="$(jq -r '.trivy.severity // "HIGH,CRITICAL"' "$CONFIG_FILE")"
  scanners="$(jq -c '.trivy.scanners // ["vuln"]' "$CONFIG_FILE")"
  scanner_csv="$(jq -r 'join(",")' <<< "$scanners")"
  version="0.58.2"
  url="https://github.com/aquasecurity/trivy/releases/download/v${version}/trivy_${version}_Linux-${trivy_arch}.tar.gz"
  echo "STAX trivy (${severity}; scanners=${scanner_csv})"
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error -L --output "$WORK_DIR/trivy.tgz" "$url"
  tar -xzf "$WORK_DIR/trivy.tgz" -C "$WORK_DIR" trivy
  if ! "$WORK_DIR/trivy" rootfs / \
    --scanners "$scanner_csv" \
    --severity "$severity" \
    --exit-code 1 \
    --no-progress; then
    echo "Trivy failed the configured severity threshold." >&2
    failures=$((failures + 1))
  fi
}

run_lynis() {
  local min_index report index
  min_index="$(jq -r '.lynis.min_hardening_index // 50' "$CONFIG_FILE")"
  echo "STAX lynis (min hardening index ${min_index})"
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq lynis >/dev/null || true
  fi
  if ! command -v lynis >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 --fail --silent --show-error -L \
      --output "$WORK_DIR/lynis.tgz" \
      "https://downloads.cisofy.com/lynis/lynis-3.1.4.tar.gz"
    tar -xzf "$WORK_DIR/lynis.tgz" -C "$WORK_DIR"
    LYNIS_BIN="$WORK_DIR/lynis/lynis"
  else
    LYNIS_BIN="lynis"
  fi
  report="$WORK_DIR/lynis-report.dat"
  # Lynis returns non-zero for warnings; gate on the hardening index instead.
  set +e
  "$LYNIS_BIN" audit system --quiet --no-colors --report-file "$report"
  set -e
  if [[ ! -f "$report" ]]; then
    echo "Lynis did not write a report file." >&2
    failures=$((failures + 1))
  else
    index="$(awk -F= '/^hardening_index=/ { print $2; exit }' "$report" || true)"
    if [[ ! "$index" =~ ^[0-9]+$ ]]; then
      echo "Unable to parse Lynis hardening_index from $report" >&2
      failures=$((failures + 1))
    elif (( index < min_index )); then
      echo "Lynis hardening index ${index} is below minimum ${min_index}." >&2
      failures=$((failures + 1))
    else
      echo "Lynis hardening index ${index} meets minimum ${min_index}."
    fi
  fi
}

run_goss() {
  local spec version url
  spec="$(jq -r '.goss.spec_path // .goss.spec // empty' "$CONFIG_FILE")"
  if [[ -z "$spec" || ! -f "$spec" ]]; then
    echo "Goss spec missing: ${spec:-<unset>}" >&2
    failures=$((failures + 1))
    return
  fi
  version="0.4.9"
  url="https://github.com/goss-org/goss/releases/download/v${version}/goss-linux-${goss_arch}"
  echo "STAX goss (${spec})"
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error -L --output "$WORK_DIR/goss" "$url"
  chmod +x "$WORK_DIR/goss"
  if ! "$WORK_DIR/goss" -g "$spec" validate; then
    echo "Goss validation failed." >&2
    failures=$((failures + 1))
  fi
}

if jq -e 'has("trivy")' "$CONFIG_FILE" >/dev/null; then
  run_trivy
fi
if jq -e 'has("lynis")' "$CONFIG_FILE" >/dev/null; then
  run_lynis
fi
if jq -e 'has("goss")' "$CONFIG_FILE" >/dev/null; then
  run_goss
fi

if (( failures > 0 )); then
  echo "STAX image scan failed (${failures} tool(s)). Refusing to publish this image." >&2
  exit 1
fi

echo "STAX image scan passed."
