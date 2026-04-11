/**
 * Current version of @ticketbook/core. Source of truth for:
 *   - `ticketbook upgrade` staleness check (see ./upgrade.ts)
 *   - MCP server handshake version (future — currently hardcoded)
 *
 * Bumped at release time. Keeping it as a plain TS constant (rather
 * than reading package.json at runtime, or importing it via
 * `with { type: "json" }` which would require bumping core's tsconfig
 * module target past ES2022) means `upgrade.ts` stays portable to any
 * TS config and any runtime that supports ES2022 — no Bun APIs, no
 * ES2023 import attributes.
 */

export const VERSION = "0.1.0";
