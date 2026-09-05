# SignalSurf MCP agent guide

This package exposes SignalSurf capabilities through MCP. Read `src/server.ts`, `src/capabilities.ts`, the affected tool/repository module and its tests to establish current behavior. Authentication and HTTP boundaries live in `src/auth.ts`, `src/http.ts`, and `src/config.ts`.

## Development and validation

Use Node 22 (CI; package minimum 22.13.0) and pnpm 10.0.0 from `package.json`. Run `pnpm install --frozen-lockfile`, then `pnpm check:pr` for parity registry checks, typecheck, tests and build. The parity registry in `docs/surfer-mcp-parity.json` and `scripts/check-surfer-parity.mjs` is part of the maintained contract; do not disable it to add a tool.

Preserve workspace/actor authorization, capability gates and response contracts. Validate through the public MCP tool where appropriate, including authorization failures; mocked repository tests alone do not prove live Supabase/provider behavior. Keep service credentials server-side and out of outputs or logs. Verify the actual project/environment before any live data mutation.

For upstream SignalSurf changes, locate the matching repository and inspect its current guidance/contract. Sibling paths and a green parity check alone do not establish deployment compatibility. Record missing upstream/runtime evidence in the PR.
