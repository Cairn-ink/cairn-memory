#!/usr/bin/env bash
# Offline ClawHub gate for a general definePluginEntry plugin, outside node --test.
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo 'Usage: bash testing/validate-package.sh <offline-clawhub-bin> <offline-openclaw-root>' >&2
  exit 2
fi
validator=$(realpath "$1")
host_root=$(realpath "$2")
package_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/openclaw-package-validate.XXXXXX")
mkdir -p "$scratch/home" "$scratch/home/"{cfg,cache,data,state,runtime,config-dirs,data-dirs,openclaw,tmp}
cd "$scratch"
set +e
env -i PATH="$PATH" LANG=C.UTF-8 TZ=UTC CI=1 NO_COLOR=1 \
  HOME="$scratch/home" XDG_CONFIG_HOME="$scratch/home/cfg" XDG_CACHE_HOME="$scratch/home/cache" \
  XDG_DATA_HOME="$scratch/home/data" XDG_STATE_HOME="$scratch/home/state" \
  XDG_RUNTIME_DIR="$scratch/home/runtime" XDG_CONFIG_DIRS="$scratch/home/config-dirs" \
  XDG_DATA_DIRS="$scratch/home/data-dirs" TMPDIR="$scratch/home/tmp" \
  OPENCLAW_HOME="$scratch/home/openclaw" OPENCLAW_STATE_DIR="$scratch/home/openclaw" \
  OPENCLAW_CONFIG_DIR="$scratch/home/cfg" OPENCLAW_CONFIG_PATH="$scratch/home/cfg/openclaw.json" \
  OPENCLAW_CACHE_DIR="$scratch/home/cache" \
  NODE_OPTIONS="--import=$package_root/testing/loopback-only.mjs" \
  timeout --kill-after=30s 300 "$validator" package validate "$package_root" \
    --openclaw "$host_root" --out "$scratch/reports" > "$scratch/validate.out" 2>&1
rc=$?
set -e
cat "$scratch/validate.out"
printf 'CLAWHUB_VALIDATE_RC=%s\nReports: %s\n' "$rc" "$scratch"
exit "$rc"
