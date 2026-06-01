# SignalSurf MCP Architecture

This package is a standalone MCP server that exposes a narrow, product-scoped
SignalSurf control surface to other agents. It does not expose arbitrary SQL or
raw Supabase access.

## Request Lifecycle

```text
MCP client
  -> stdio or stateless Streamable HTTP
  -> env-token, database-token, or direct stdio context resolution
  -> MCP tool/resource handler
  -> repository product-scope guard
  -> Supabase service-role client
```

The server always resolves a `SignalSurfContext` before any tool runs:

- `productId`: mandatory product boundary for every request
- `userId`: optional user context, currently used for surf point delete cleanup
- `role`: `viewer`, `editor`, or `owner`
- `tokenName`: optional source label for MCP row mutations

`viewer` can read tools and resources. `editor` and `owner` can write. `owner`
currently has no extra MCP-only power; it is reserved for future product policy.

## Transports

`src/stdio.ts` runs one MCP server over stdio. Stdio can use either
`SIGNALSURF_MCP_TOKEN` or a direct local context. Direct context requires
`SIGNALSURF_MCP_PRODUCT_ID` and is intended only for trusted local development.

`src/http.ts` runs stateless Streamable HTTP. Every `POST /mcp` request creates a
fresh MCP server instance, resolves bearer auth, handles one JSON-RPC request,
and closes. There is no session lifecycle. `GET` and `DELETE` return `405`.

HTTP mode rejects `SIGNALSURF_MCP_AUTH_DISABLED=true`. It also checks the
request Host header against `SIGNALSURF_MCP_ALLOWED_HOSTS` to reduce localhost
DNS-rebinding risk.

`SIGNALSURF_MCP_TRUST_PROXY=false` is the default. In that mode, token usage
audit metadata stores the direct socket IP only. Set
`SIGNALSURF_MCP_TRUST_PROXY=true` only behind a trusted reverse proxy that
overwrites `X-Forwarded-For`; the stored IP is validated before writing.

## Auth Model

The server has two token auth modes:

- `SIGNALSURF_MCP_AUTH_MODE=database`: hosted production mode. The HTTP bearer
  token is SHA-256 hashed and looked up in SignalSurf Web's `mcp_tokens` table.
  The table stores product id, creator id, role, prefix, revocation state, and
  last-used metadata; it never stores plaintext tokens.
- `SIGNALSURF_MCP_AUTH_MODE=env`: local or single-tenant mode. Tokens are read
  from `SIGNALSURF_MCP_TOKENS`.

`src/auth.ts` contains bearer parsing, static-token matching, and role checks.
`src/repository.ts` owns database-token lookup because it is already the
service-role database boundary. Static-token comparison uses constant-time hash
comparison.

Each static token entry binds one caller to exactly one product:

```json
{
  "name": "agent-name",
  "tokenSha256": "sha256-hex",
  "productId": "product-uuid",
  "userId": "user-uuid",
  "role": "editor"
}
```

Agents should call `get_context` first and verify `productId`, `role`, and
`tokenName` before making writes.

Hosted token revocation is immediate: SignalSurf Web sets `revoked_at`, and
database auth only resolves rows where `revoked_at IS NULL`.
Database-backed hosted tokens are product-scoped service credentials, so
`created_by` is not exposed as `context.userId` to MCP tools. User-specific
cleanup, such as repairing `user_preferences.current_playbook_id`, only runs
for local/static contexts that explicitly configure a user id.

## Product Scope Guards

`src/repository.ts` is the only layer that talks to Supabase. It must keep all
service-role access behind explicit product checks:

- Surf points: `playbooks.product_id = context.productId` and
  `deleted_at IS NULL`
- Databases: `databases.product_id = context.productId`
- Rows: each row's `database_id` must resolve to a product-owned database
- Row attribution: supplied `playbookId` must be a non-deleted product surf point
  whose `database_ids` contains the target row database
- Relation fields: `item_ref` values must point to existing rows in
  product-owned databases

Rows without `database_id` are intentionally inaccessible through MCP because
they cannot be product-scoped safely.

## Mutation Semantics

Surf point deletion is a soft delete. It sets `deleted_at`, cancels pending
`surf_jobs`, and repairs `user_preferences.current_playbook_id` when the token
has `userId`.

Row creation stamps provenance server-side:

- `origin = "mcp"`
- `origin_ref = context.tokenName ?? null`
- `triggered = false`

Public MCP row tools do not accept `origin`, `originRef`, `entryKeyHash`, or
`triggered`. Keep those fields out of the public schema unless there is a
separate internal-only tool with a clear operational need.

Row data updates call `update_entry_with_source`; note updates call
`update_entry_note_with_source`. Direct table updates are limited to metadata
that cannot be handled by those RPCs.

`dataPatch`, `toolConfigPatch`, `variablesPatch`, and `configPatch` are shallow
merges. Clients that need nested merge semantics should read the current object
and send a full replacement.

## Resources

Resources are read-only JSON context surfaces:

- `signalsurf://context`
- `signalsurf://surf-points`
- `signalsurf://databases`
- `signalsurf://databases/{databaseId}/rows`

The database-row template expands current-product databases into concrete
resources so clients that only show `resources/list` can discover row resources.

## Extending The Server

When adding a tool:

1. Add a Zod schema in `src/schemas.ts`.
2. Add the repository method in `src/repository.ts`.
3. Validate product scope before every read or write.
4. Prefer existing SignalSurf RPCs/helpers when they preserve changelog,
   provenance, or side effects.
5. Register the tool in `src/server.ts` with accurate MCP annotations.
6. Add tests for read/write authorization, product-boundary rejection, and any
   destructive side effects.
7. Update `README.md` and this document when the public contract changes.

Do not add a tool that accepts raw SQL, table names, arbitrary filters, or
service-role-like capabilities. Model concrete product operations instead.

## Validation Matrix

Run these before handoff:

```bash
corepack pnpm@10.0.0 test
corepack pnpm@10.0.0 typecheck
corepack pnpm@10.0.0 build
git diff --check
```

High-risk changes should also include targeted tests:

- Auth/transport changes: `tests/auth.test.ts`, `tests/http.test.ts`
- Tool registration/resource changes: `tests/mcp-server.test.ts`
- Product-scope or mutation changes: `tests/repository.test.ts`
