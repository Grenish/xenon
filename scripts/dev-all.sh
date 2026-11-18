#!/usr/bin/env bash
# Runs the xenon-cms watch build and the playground (Next.js dev server) together.
# Ctrl+C stops both. If either process exits, the other is stopped too.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

DIST_MARKER="$ROOT/packages/xenon/dist/index.js"

cleanup() {
  trap - INT TERM EXIT
  # Signal every job started by this script (same process group), then wait for them.
  kill 0 2>/dev/null
  wait 2>/dev/null
}
trap cleanup INT TERM EXIT

# Drop any stale build so the wait below only passes for this run's build.
rm -f "$DIST_MARKER"

# 1. Library: builds once, then watches (`bun run dev` in packages/xenon).
bun run dev &

# 2. Playground needs the library's dist/ to exist before Next.js resolves xenon-cms.
echo "[dev-all] waiting for xenon-cms build..."
until [ -f "$DIST_MARKER" ]; do
  sleep 0.5
done
echo "[dev-all] xenon-cms built. starting playground..."

bun run playground &

# Exit (and clean up both) as soon as either process stops.
wait -n
exit $?
