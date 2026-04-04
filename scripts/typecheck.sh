#!/bin/bash
set -e

echo "Typechecking core..."
bunx tsc --noEmit -p packages/core/tsconfig.json

echo "Typechecking server..."
# Note: mcp.ts is excluded from server typecheck because @modelcontextprotocol/sdk
# types consume 4+ GB and cause Node-based tsc to OOM. The file is validated at
# runtime via Bun and covered by integration tests.
bunx tsc --noEmit -p packages/server/tsconfig.json

echo "Typechecking ui..."
bunx tsc --noEmit -p packages/ui/tsconfig.json

echo "All packages typecheck clean."
