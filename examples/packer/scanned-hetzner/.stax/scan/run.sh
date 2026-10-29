#!/usr/bin/env bash
# Placeholder so `packer validate` succeeds offline. When scan is configured,
# STAX overwrites this file with an embedded config before validate/build.
set -euo pipefail
echo "STAX scan placeholder; enable stack.scan to materialize the real hooks."
exit 0
