# SignalSurf MCP Architecture

This package is a standalone MCP server that exposes a narrow, product-scoped
SignalSurf control surface to other agents. It does not expose arbitrary SQL or
raw Supabase access.

## Request Lifecycle

```text
MCP client
  -> stdio or stateless Streamable HTTP
  -> env-token, OAuth database token, manual database token, or direct stdio context resolution
  -> MCP tool/resource handler
  -> repository product-scope guard
  -> Supabase service-role client
```

The server always resolves a `SignalSurfContext` before any tool runs:

- `productId`: primary product boundary for single-product calls
- `productIds`: optional list of all products granted to the current OAuth token
- `products`: authorized product metadata in the same order as `productIds`,
  including `productId`, human-readable `name`, optional `organizationId`, and
  optional `organizationName`
- `userId`: optional user context, currently used for surf point delete cleanup
- `role`: `viewer`, `editor`, or `owner`
- `tokenName`: optional source label for MCP row mutations
- `scopes`: optional OAuth/static-token scopes that can narrow role access

`viewer` can read tools and resources. `editor` and `owner` can write. `owner`
currently has no extra MCP-only power; it is reserved for future product policy.
When `scopes` are present, the server enforces both role and scope. A token with
`role = editor` and `mcp:tables.write` can create and update rows but cannot
delete rows or mutate Surf Points.

## Transports

`src/stdio.ts` runs one MCP server over stdio. Stdio can use either
`SIGNALSURF_MCP_TOKEN` or a direct local context. Direct context requires
`SIGNALSURF_MCP_PRODUCT_ID` and is intended only for trusted local development.

`src/http.ts` runs stateless Streamable HTTP. Every `POST /mcp` request creates a
fresh MCP server instance, resolves bearer auth, handles one JSON-RPC request,
and closes. There is no session lifecycle. `GET` and `DELETE` return `405`.

When `SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL` is configured, HTTP 401
responses include a `WWW-Authenticate` `resource_metadata` pointer. The server
also serves OAuth Protected Resource Metadata at
`/.well-known/oauth-protected-resource`, pointing clients to the SignalSurf Web
authorization server.

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
  token is SHA-256 hashed and first looked up as a manual fallback token in
  SignalSurf Web's `mcp_tokens` table, then as an OAuth access token in
  `mcp_oauth_tokens`. OAuth access tokens are bound to `resource`, `client_id`,
  `user_id`, primary `product_id`, optional `product_ids`, scopes, expiry, and
  revocation state.
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

Agents should call `get_context` first and verify `products`, `role`, and
`tokenName` before making writes. If `productIds` contains more than one id,
agents should choose from the human-readable product/workspace names in
`products[]` and pass the intended `productId` to product-scoped tools.

Hosted token revocation is immediate: SignalSurf Web sets `revoked_at`, and
database auth only resolves rows where `revoked_at IS NULL`.
Database-backed hosted tokens are product-scoped service credentials, so
`created_by` is not exposed as `context.userId` to MCP tools. User-specific
cleanup, such as repairing `user_preferences.current_playbook_id`, runs only
when the resolved context includes `userId`; OAuth contexts include it, while
manual hosted fallback tokens do not.

OAuth access tokens are user-consented, so the resolved MCP context includes
`userId`. `mcp:read` maps to `viewer`; `mcp:write` and granular write/delete
scopes map to `editor`. Recognized SignalSurf scopes remain on the request
context and are enforced by each tool's required capability; additive OIDC or
future scopes are ignored by the resource server. OAuth tokens can authorize one
or more products. Product-scoped tools execute against exactly one product; when
multiple products are authorized, omitted `productId` is rejected instead of
guessing. The server rejects OAuth access tokens whose stored `resource` does
not match `SIGNALSURF_MCP_RESOURCE_URL`.

The public scope and tool contract lives in `src/capabilities.ts` and is
documented in `docs/capabilities.md`. Broad legacy scopes remain for client
compatibility, while granular scopes support least-privilege access to Surf
Points, execution, table data, schemas, and safe source controls.

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
- Sources: `sources.playbook_id` must resolve to a non-deleted product surf point
  before source metadata is read or source active state is changed

Rows without `database_id` are intentionally inaccessible through MCP because
they cannot be product-scoped safely.

## Mutation Semantics

Surf point deletion is a soft delete. It sets `deleted_at`, cancels pending
`surf_jobs`, and repairs `user_preferences.current_playbook_id` when the token
has `userId`.

Surf point execution is asynchronous. `run_surf_point` validates that the
playbook belongs to the selected product, rejects inactive surf points unless
explicitly overridden, finds active pull sources, and inserts one
`surf_jobs.job_type = "extract"` row per source with the required
`product_id`, `user_id`, `playbook_id`, `source_id`, and worker payload fields.
That matches SignalSurf Web's Surf Now contract and lets the existing
`trigger_surf_worker_on_insert` database trigger wake `webhook-surf-worker`.
Existing pending/processing extract jobs are deduplicated by source by default.
`get_surf_job` and `list_surf_jobs` expose status after validating the job's
`playbook_id` belongs to the selected product. `cancel_surf_job` only updates
pending jobs; running/processing jobs are not forcefully interrupted through MCP.
`wait_for_surf_job` is a bounded polling helper for agents that need to trigger
a surf point and then observe completion. It does not run a worker itself.

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

Schema mutation tools update `databases.schema` after product-scope validation.
They do not backfill, rewrite, or delete existing row data. Relation creation
adds an `item_ref` schema field and validates that `target_database_id` belongs
to the same authorized product before writing.

Source controls intentionally expose only safe metadata (`id`, `playbook_id`,
name, type, endpoint, schedule, URL, provider, `is_active`, timestamps). Public
MCP tools do not expose source config secrets, credentials, headers, request
bodies, auth settings, or arbitrary source creation. Surf point tool attachment
is modeled as idempotent updates to `tool_config.auto_tool_ids` and validates
the requested id against `product_tools` in the authorized product.

Basic `read_table` calls use database-side pagination and JSON containment.
When callers pass UI-style `filters` or data-field `sorts`, the repository reads
a bounded page of source rows (`scanLimit`, default 1000, max 5000) and evaluates
operators in the MCP process. This keeps JSON number, date, array, text, and
relation comparisons predictable. Responses include `sourceTotalCount`,
`scannedCount`, and `hasMoreToScan` so agents can raise `scanLimit` or narrow
filters when needed.

`dataPatch`, `toolConfigPatch`, `variablesPatch`, and `configPatch` are shallow
merges. Clients that need nested merge semantics should read the current object
and send a full replacement.

Tool calls return backwards-compatible text JSON and MCP `structuredContent`.
The public tool registry advertises a shared output envelope `{ ok, data }` so
newer clients can consume structured output without parsing text.

## Resources

Resources are read-only JSON context surfaces:

- `signalsurf://context`
- `signalsurf://surf-points`
- `signalsurf://surf-points/{surfPointId}`
- `signalsurf://surf-points/{surfPointId}/sources`
- `signalsurf://surf-points/{surfPointId}/tools`
- `signalsurf://product-tools`
- `signalsurf://surf-jobs`
- `signalsurf://surf-jobs/{jobId}`
- `signalsurf://databases`
- `signalsurf://databases/{databaseId}/rows`

`signalsurf://context` includes the same `products[]` metadata as
`get_context`, so clients that prefer resources over tools can still show
human-readable product and workspace names.

The database-row template expands current-product databases into concrete
resources so clients that only show `resources/list` can discover row resources.
For multi-product OAuth contexts, ambiguous product-level resource listings are
suppressed; agents should use tools with an explicit `productId`.

## Extending The Server

When adding a tool:

1. Add a Zod schema in `src/schemas.ts`.
2. Add the repository method in `src/repository.ts`.
3. Validate product scope before every read or write.
4. Prefer existing SignalSurf RPCs/helpers when they preserve changelog,
   provenance, or side effects.
5. Add a tool entry and required capability in `src/capabilities.ts`.
6. Register the tool in `src/server.ts` with accurate MCP annotations.
7. Add tests for read/write authorization, scope rejection, product-boundary rejection, and any
   destructive side effects.
8. Update `README.md`, `docs/capabilities.md`, and the Web-side Surfer
   capability matrix when the public contract changes.

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
