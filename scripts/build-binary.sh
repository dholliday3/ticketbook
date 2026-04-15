#!/usr/bin/env bash
#
# Build a standalone relay binary via `bun build --compile`.
#
# Pipeline:
#   1. Build the UI (vite) into packages/ui/dist/
#   2. Generate packages/server/src/embedded-ui.gen.ts with one
#      `with { type: "file" }` import per file under dist/
#   3. Run `bun build --compile` against bin/relay.ts, which pulls in
#      the generated imports + the SKILL.md import attribute and emits a
#      single binary to dist/relay-<target>
#   4. Reset embedded-ui.gen.ts back to an empty stub so dev mode falls
#      through to the real filesystem again (the `trap` ensures this runs
#      whether the build succeeded or failed)
#
# Usage:
#   bun run build:binary                       # build for current host
#   RELAY_TARGET=bun-linux-x64 \
#       bun run build:binary                   # cross-compile for Linux x64
#
# The target defaults to bun-darwin-arm64 (current host) but can be
# overridden via $RELAY_TARGET. CI will override it for the
# cross-compile matrix (see PLAN-005 Phase 2).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="${RELAY_TARGET:-bun-darwin-arm64}"
OUTFILE="dist/relay-${TARGET#bun-}"

# Reset the generated file back to an empty stub on exit, no matter what.
# Keeps the repo clean between builds so dev mode never picks up a stale
# populated map. Running the reset script itself never fails.
trap 'bun run scripts/generate-embedded-ui.ts --empty' EXIT

echo "==> Building UI bundle..."
bun --filter @relay/ui build

echo "==> Generating embedded-ui.gen.ts..."
bun run scripts/generate-embedded-ui.ts

echo "==> Compiling binary (target: $TARGET, outfile: $OUTFILE)..."
mkdir -p "$(dirname "$OUTFILE")"
bun build bin/relay.ts \
    --compile \
    --target="$TARGET" \
    --outfile "$OUTFILE"

echo "==> Built $OUTFILE"
ls -lh "$OUTFILE"
