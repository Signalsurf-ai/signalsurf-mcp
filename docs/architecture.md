# SignalSurf MCP Architecture

This package is a standalone MCP server that exposes a narrow, workspace-scoped
SignalSurf control surface to other agents. It does not expose arbitrary SQL or
raw Supabase access.

## Request Lifecycle

```text
MCP client
  -> stdio or stateless Streamable HTTP
  -> env-token, OAuth database token, manual database token, or direct stdio context resolution
  -> MCP tool/resource handler
  -> repository workspace-scope guard
  -> Supabase service-role client
```

The server always resolves a `SignalSurfContext` before any tool runs:

- `workspaceId`: primary workspace boundary for single-workspace calls
- `workspaceIds`: optional list of all workspaces granted to the current OAuth token
- `workspaces`: authorized workspace metadata in the same order as `workspaceIds`,
  including `workspaceId`, human-readable `name`, optional `organizationId`, and
  optional `organizationName`
- `userId`: optional user context used to revalidate current Workspace access
  on every request and for user-specific cleanup
- `role`: `viewer`, `editor`, or `owner`
- `tokenName`: optional source label for MCP row mutations
- `scopes`: optional OAuth/static-token scopes that can narrow role access

`viewer` can read tools and resources. `editor` and `owner` can write. `owner`
currently has no extra MCP-only power; it is reserved for future workspace policy.
When `scopes` are present, the server enforces both role and scope. A token with
`role = editor` and `mcp:tables.write` can create and update rows but cannot
delete rows or mutate Workflows.

## Transports

`src/stdio.ts` runs one MCP server over stdio. Stdio can use either
`SIGNALSURF_MCP_TOKEN` or a direct local context. Direct context requires
`SIGNALSURF_MCP_WORKSPACE_ID` and is intended only for trusted local development.

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
  `user_id`, primary `workspace_id`, optional `workspace_ids`, scopes, expiry, and
  revocation state.
- `SIGNALSURF_MCP_AUTH_MODE=env`: local or single-tenant mode. Tokens are read
  from `SIGNALSURF_MCP_TOKENS`.

`src/auth.ts` contains bearer parsing, static-token matching, and role checks.
`src/repository.ts` owns database-token lookup because it is already the
service-role database boundary. Static-token comparison uses constant-time hash
comparison.

Each static token entry binds one caller to exactly one workspace:

```json
{
  "name": "agent-name",
  "tokenSha256": "sha256-hex",
  "workspaceId": "workspace-uuid",
  "userId": "user-uuid",
  "role": "editor"
}
```

Agents should call `get_context` first and verify `workspaces`, `role`, and
`tokenName` before making writes. If `workspaceIds` contains more than one id,
agents should choose from the human-readable workspace/organization names in
`workspaces[]` and pass the intended `workspaceId` to workspace-scoped tools.

Hosted token revocation is immediate: SignalSurf Web sets `revoked_at`, and
database auth only resolves rows where `revoked_at IS NULL`.
Database-backed hosted tokens retain `created_by` as `context.userId` so the
server can revalidate current Workspace membership on every tool and resource
call. Removing a member from a Workspace invalidates that Workspace immediately,
even for a previously established MCP connection.

OAuth access tokens are user-consented, so the resolved MCP context includes
`userId`. `mcp:read` maps to `viewer`; `mcp:write` and granular write/delete
scopes map to `editor`. Recognized SignalSurf scopes remain on the request
context and are enforced by each tool's required capability; additive OIDC or
future scopes are ignored by the resource server. OAuth tokens can authorize one
or more workspaces. Workspace-scoped tools execute against exactly one workspace; when
multiple workspaces are authorized, omitted `workspaceId` is rejected instead of
guessing. The server rejects OAuth access tokens whose stored `resource` does
not match `SIGNALSURF_MCP_RESOURCE_URL`.

The public scope and tool contract lives in `src/capabilities.ts` and is
documented in `docs/capabilities.md`. Broad legacy scopes remain for client
compatibility, while granular scopes support least-privilege access to Surf
Points, execution, table data, schemas, and safe source controls.

Every chargeable Deepline search, enrichment, or generic execution has an
additional per-action boundary. This server creates or reuses a redacted,
short-lived pending `mcp_action_approvals` row;
SignalSurf Web alone resolves it. The server later atomically claims one exact
`approved` row as `executing`, bound to the active stable OAuth grant id,
user, client, workspace, MCP tool name, provider tool id, canonical payload
SHA-256, and expiry. Only the successful claimant may call the provider. It then records
`executed`, `failed`, or `ambiguous`; no terminal or in-flight approval is
replayable. Missing table/schema support fails closed before any provider call.

## Workspace Scope Guards

`src/repository.ts` is the only layer that talks to Supabase. It must keep all
service-role access behind explicit workspace checks:

- Workflows: `workflows.workspace_id = context.workspaceId` and
  `deleted_at IS NULL`
- Workspaces: MCP may connect only to existing authorized Workspaces; it never
  creates or joins an Organization or Workspace
- Databases: `databases.workspace_id = context.workspaceId`
- Table creation/update: full custom schemas are accepted only after every
  relation target is validated against a workspace-owned database
- Rows: each row's `database_id` must resolve to a workspace-owned database
- Row attribution: supplied `workflowId` must be a non-deleted workspace Workflow
  whose `database_ids` contains the target row database
- Relation fields: `item_ref` values must point to existing rows in
  workspace-owned databases
- Sources: `sources.workflow_id` must resolve to a non-deleted workspace Workflow
  before source metadata is read or source active state is changed

Rows without `database_id` are intentionally inaccessible through MCP because
they cannot be workspace-scoped safely.

## Mutation Semantics

Workflow deletion is a soft delete. It sets `deleted_at`, cancels pending
`surf_jobs`, and repairs `user_preferences.current_workflow_id` when the token
has `userId`.

Workflow execution is asynchronous. `run_workflow` validates that the
workflow belongs to the selected workspace, rejects inactive Workflows unless
explicitly overridden, finds active pull sources, and inserts one
`surf_jobs.job_type = "extract"` row per source with the required
`workspace_id`, `user_id`, `workflow_id`, `source_id`, and worker payload fields.
That matches SignalSurf Web's Surf Now contract and lets the existing
`trigger_surf_worker_on_insert` database trigger wake `webhook-surf-worker`.
Existing pending/processing extract jobs are deduplicated by source by default.
`get_surf_job` and `list_surf_jobs` expose status after validating the job's
`workflow_id` belongs to the selected workspace. `cancel_surf_job` only updates
pending jobs; running/processing jobs are not forcefully interrupted through MCP.
`wait_for_surf_job` is a bounded polling helper for agents that need to trigger
a Workflow and then observe completion. It does not run a worker itself.

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

Table lifecycle tools mutate `databases` after workspace-scope validation.
`create_table` can also apply the canonical `outbound_accounts` or `contacts`
template before additive custom fields. Template-owned fields retain their
semantic types during creation. The Accounts template mirrors the Web
provider-first 13-field contract, keeps Fit Score visible and sorted descending,
and omits Active Jobs, Employees, Tier, review metadata, and provenance/planning
fields. Applying it to an existing Accounts table preserves additive fields and
row data, hides known legacy fields, disables legacy Tier automation, and removes
only the exact canonical legacy Tiering chart; custom saved views are preserved.
Later explicit schema tools remain available for user-directed customization.
`create_table` and `update_table` otherwise
accept a full custom schema or shallow `schemaPatch`; field definitions are validated and
`item_ref`/relation targets must belong to the same authorized workspace. `delete_table` hard-deletes
user-facing tables, refuses system tables, and removes deleted table ids from
active Workflows' `database_ids`, matching the SignalSurf Web delete flow.
Schema field tools do not backfill, rewrite, or delete existing row data.
Relation creation adds an `item_ref` schema field and validates that
`target_database_id` belongs to the same authorized workspace before writing.

Source controls expose safe reads plus workspace-scoped writes. Reads return
metadata such as `id`, `workflow_id`, name, database type, public source type,
endpoint, schedule, URL, provider, event type, watched database id,
`webhookSecretConfigured`, `is_active`, and timestamps. Public MCP tools can
create, update, delete, enable, and pause sources after validating that the
source's Workflow belongs to the authorized workspace. Write paths may persist
secret-bearing config such as headers, request bodies, and auth settings, but
read paths do not expose those values. Internal trigger source types
(`item-created`, `item-updated`, `manual-trigger`, `on-schedule`) are exclusive
with every other source on a Workflow unless the caller explicitly passes
`replaceExisting=true`. Workflow tool attachment is modeled as idempotent
updates to `tool_config.auto_tool_ids` and validates the requested id against
`workspace_tools` in the authorized workspace.

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
- `signalsurf://workflows`
- `signalsurf://workflows/{workflowId}`
- `signalsurf://workflows/{workflowId}/sources`
- `signalsurf://workflows/{workflowId}/tools`
- `signalsurf://workspace-tools`
- `signalsurf://surf-jobs`
- `signalsurf://surf-jobs/{jobId}`
- `signalsurf://databases`
- `signalsurf://databases/{databaseId}/rows`

`signalsurf://context` includes the same `workspaces[]` metadata as
`get_context`, so clients that prefer resources over tools can still show
human-readable workspace and organization names.

The database-row template expands current-workspace databases into concrete
resources so clients that only show `resources/list` can discover row resources.
For multi-workspace OAuth contexts, ambiguous workspace-level resource listings are
suppressed; agents should use tools with an explicit `workspaceId`.

## Extending The Server

When adding a tool:

1. Add a Zod schema and exhaustive registry entry in `src/schemas.ts`.
2. Add the repository method in `src/repository.ts`.
3. Validate workspace scope before every read or write.
4. Prefer existing SignalSurf RPCs/helpers when they preserve changelog,
   provenance, or side effects.
5. Add a tool entry and required capability in `src/capabilities.ts`.
6. Register the tool in `src/server.ts` with accurate MCP annotations.
7. Add tests for read/write authorization, scope rejection, workspace-boundary rejection, and any
   destructive side effects.
8. Update `README.md`, `docs/capabilities.md`,
   `docs/public-tool-contract.json`, and the Web-side Surfer
   capability matrix when the public contract changes.

Do not add a tool that accepts raw SQL, table names, arbitrary filters, or
service-role-like capabilities. Model concrete workspace operations instead.

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
- Table/column/RPC names: `pnpm check:schema-usage` against
  `schema/public-snapshot.json`. FakeSupabase answers any name, so only this
  check sees a rename (SIG-2672).
- Tool registration/resource changes: `tests/mcp-server.test.ts`
- Workspace-scope or mutation changes: `tests/repository.test.ts`
