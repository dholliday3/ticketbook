/**
 * Current version of @ticketbook/core. Source of truth for:
 *   - `ticketbook upgrade` staleness check (see ./upgrade.ts)
 *   - MCP server handshake version (see packages/server/src/mcp.ts)
 *
 * **Bumped at release time.** Must stay in lockstep with
 * `packages/core/package.json` → `"version"`. A test in
 * ./upgrade.test.ts fires if they drift.
 *
 * Why a plain TS constant (and not `with { type: "json" }` importing
 * package.json): core's tsconfig targets `module: ES2022`, which
 * predates ES2023 import attributes. Bumping the module target would
 * ripple through downstream packages. A single-line constant in a
 * dedicated file is the smallest portable answer, and the version
 * sync test catches the "forgot to bump one of the two" footgun.
 */

export const VERSION = "0.2.0";
