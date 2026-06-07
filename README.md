# SignalSurf MCP

Standalone MCP server for controlled agent access to SignalSurf surf points and
product tables.

This server is intentionally narrow. It gives external agents the core product
operations they need without exposing arbitrary SQL or raw service-role access.
Every product operation is bound to a SignalSurf product. OAuth tokens can grant
one or more products, while manual fallback tokens remain single-product scoped.
See `docs/architecture.md` for the request lifecycle and safety model, and
`docs/capabilities.md` for the public tool/scope contract.

## External User Setup

If you are connecting an agent to SignalSurf, use the hosted MCP service. You do
not need this repository, a Supabase key, or a local server.

1. Add SignalSurf as a remote MCP server in your MCP client:
   `https://mcp.signalsurf.ai/mcp`.
2. The client opens SignalSurf's OAuth authorization page.
3. Sign in, choose the SignalSurf product or products this client may access,
   review requested scopes, and approve.
4. The MCP client receives OAuth tokens through its callback and can use
   SignalSurf tools. If you approve multiple products, the agent should call
   `get_context` first, choose from the returned `products[].name` list, and
   pass that product's `productId` to product-scoped tool calls.

The hosted MCP currently supports product creation, product-scoped Surf Point
CRUD, table create/update, table schema edits, Surf Point execution, source
creation/configuration/deletion, source toggles, tool attachment, reusable
Account List / ICP profiles, and table row read/create/update/delete. It is a
safe public subset of Surfer, the agent in SignalSurf Web's right panel; it
does not expose every internal chat tool.

Example:

```json
{
  "mcpServers": {
    "signalsurf": {
      "type": "streamable-http",
      "url": "https://mcp.signalsurf.ai/mcp"
    }
  }
}
```

Manual tokens remain available in SignalSurf Web under **Settings -> Product**,
then the **MCP** section. Use them only as an advanced fallback for clients that
do not yet support remote MCP OAuth.

Example fallback bridge configuration:

```json
{
  "mcpServers": {
    "signalsurf": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.signalsurf.ai/mcp",
        "--header",
        "Authorization:${SIGNALSURF_MCP_AUTH_HEADER}"
      ],
      "env": {
        "SIGNALSURF_MCP_AUTH_HEADER": "Bearer YOUR_SIGNALSURF_MCP_TOKEN"
      }
    }
  }
}
```

## Hosted Service Deployment

Use this repository when you are operating SignalSurf's hosted MCP service or a
single-tenant internal deployment.

```bash
git clone https://github.com/Signalsurf-ai/signalsurf-mcp.git
cd signalsurf-mcp
corepack enable
corepack pnpm@10.0.0 install
cp .env.example .env
```

Minimal hosted `.env`:

```bash
SIGNALSURF_SUPABASE_URL=https://your-project-ref.supabase.co
SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SIGNALSURF_MCP_TRANSPORT=http
SIGNALSURF_MCP_AUTH_MODE=database
SIGNALSURF_MCP_RESOURCE_URL=https://mcp.signalsurf.ai/mcp
SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL=https://www.signalsurf.ai
SIGNALSURF_MCP_HOST=0.0.0.0
SIGNALSURF_MCP_PATH=/mcp
SIGNALSURF_MCP_ALLOWED_HOSTS=mcp.signalsurf.ai
SIGNALSURF_MCP_TRUST_PROXY=true
```

On Zeabur and similar platforms, do not hard-code
`SIGNALSURF_MCP_PORT=3333`. The service reads the platform-provided `PORT` and
listens on `0.0.0.0` when that variable is present.

Build and run:

```bash
corepack pnpm@10.0.0 build
corepack pnpm@10.0.0 start
```

In `database` auth mode, the server hashes bearer tokens and resolves OAuth
access tokens from SignalSurf Web's `mcp_oauth_tokens` table. Manual fallback
tokens from `mcp_tokens` are also accepted for clients that do not support
remote MCP OAuth.

## Local Development Quick Start

Use stdio first. It is the simplest and does not expose an HTTP port.

You only need these SignalSurf values:

- Supabase URL
- Supabase service-role key
- SignalSurf `productId`

1. Install and create `.env`:

```bash
git clone https://github.com/Signalsurf-ai/signalsurf-mcp.git
cd signalsurf-mcp
corepack enable
corepack pnpm@10.0.0 install
cp .env.example .env
```

2. Replace `.env` with this minimal local config:

```bash
SIGNALSURF_SUPABASE_URL=https://your-project-ref.supabase.co
SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SIGNALSURF_MCP_TRANSPORT=stdio
SIGNALSURF_MCP_AUTH_MODE=env
SIGNALSURF_MCP_TOKEN=local-dev-token
SIGNALSURF_MCP_TOKENS='[{"name":"local-agent","token":"local-dev-token","productId":"signal-surf-product-uuid","role":"editor"}]'
```

For shared or hosted use, replace `"token"` with `"tokenSha256"` later. The
plain token above is only the shortest local setup.

3. Build:

```bash
corepack pnpm@10.0.0 build
```

4. Add this MCP server to Claude Code or another stdio MCP client:

```json
{
  "mcpServers": {
    "signalsurf": {
      "command": "node",
      "args": ["/absolute/path/to/signalsurf-mcp/dist/index.js"],
      "env": {
        "SIGNALSURF_MCP_TRANSPORT": "stdio",
        "SIGNALSURF_MCP_TOKEN": "local-dev-token"
      }
    }
  }
}
```

The server automatically loads `.env` from the repo root. After the client
connects, call `get_context` first and confirm the returned `productId`.

For HTTP instead of stdio, set `SIGNALSURF_MCP_TRANSPORT=http`, remove
`SIGNALSURF_MCP_TOKEN` from the server env, set
`SIGNALSURF_MCP_AUTH_MODE=env`, start the server, and send the token as
`Authorization: Bearer <token>`.

## What It Exposes

- `create_product`
- `list_surf_points`, `get_surf_point`, `create_surf_point`, `update_surf_point`, `run_surf_point`, `get_surf_job`, `wait_for_surf_job`, `list_surf_jobs`, `cancel_surf_job`, `delete_surf_point`
- `list_databases`, `create_table`, `update_table`, `list_database_views`, `read_table`, `read_table_view`, `get_table_row`
- `create_table_row`, `update_table_row`, `delete_table_rows`
- `list_database_fields`, `add_database_field`, `update_database_field`, `remove_database_field`, `create_relation_field`
- `list_surf_point_sources`, `create_surf_point_source`, `update_surf_point_source`, `delete_surf_point_source`, `set_surf_point_source_active`
- `list_product_tools`, `list_surf_point_tools`, `attach_surf_point_tool`, `detach_surf_point_tool`
- `list_account_list_profiles`, `save_account_list_profile`, `archive_account_list_profile`
- Resources for context; single-product tokens also expose surf point, database,
  surf job, database-row, and account-list-profile resources

All product-scoped tools execute against one `productId`. A single-product token
can omit `productId`; a multi-product OAuth token must pass `productId` to every
product-scoped tool call. The server uses Supabase service-role credentials
internally, so every operation explicitly validates product ownership before
touching rows. Surf point deletion is a soft delete (`deleted_at`), matching the
web app behavior.

OAuth clients can request broad compatibility scopes (`mcp:read`, `mcp:write`)
or granular scopes. The protected resource metadata advertises the granular
SignalSurf resource scopes so the consent screen can name each capability
instead of hiding them behind broad write access:

- `mcp:products.write`
- `mcp:surf_points.read`
- `mcp:surf_points.write`
- `mcp:surf_points.execute`
- `mcp:surf_points.delete`
- `mcp:tables.read`
- `mcp:tables.write`
- `mcp:tables.delete`
- `mcp:schemas.read`
- `mcp:schemas.write`
- `mcp:sources.read`
- `mcp:sources.write`
- `mcp:account_lists.read`
- `mcp:account_lists.write`

OAuth tokens may also carry `offline_access` for refresh-token support. The MCP
resource server accepts that scope but does not advertise it as a resource
requirement, and it grants no tool capability by itself.

## Architecture

```text
MCP client
  -> stdio or Streamable HTTP transport
  -> token auth resolves { productId, productIds, products, userId, role, scopes }
  -> MCP tool/resource handlers
  -> SignalSurf repository
  -> Supabase service-role client with explicit product-scope checks
```

Key files:

- `src/index.ts`: process entrypoint and transport selection
- `src/http.ts`: stateless Streamable HTTP transport
- `src/stdio.ts`: stdio transport for local MCP clients
- `src/auth.ts`: token hashing, bearer parsing, and role checks
- `src/capabilities.ts`: public scope, capability, and tool contract
- `src/repository.ts`: SignalSurf product-scope and mutation logic
- `src/server.ts`: MCP tools and resources
- `src/schemas.ts`: Zod input schemas exposed to MCP clients

The HTTP transport is stateless. Each POST resolves auth, creates a fresh MCP
server instance, handles one JSON-RPC request, and closes. This avoids shared
in-memory session state and makes bearer-token product scoping straightforward.

## Tool Semantics

Context:

- `get_context`: returns authorized products with human-readable names,
  optional workspace names, ids, optional user, role, token name, and
  scope/capability context for the current connection. Agents should call this
  before writes. If `productIds` contains more than one id, choose the intended
  product from `products[]` and pass its `productId` to every product-scoped
  tool call.

Products:

- `create_product`: creates a new SignalSurf product through the hosted OAuth
  connection, seeds owner membership and product goals, then expands the active
  OAuth grant to include the returned `productId`. Follow-up calls should pass
  that returned `productId` explicitly.

Surf points:

- `list_surf_points`: returns non-deleted surf points. Use
  `includeInactive=false` to hide paused surf points.
- `get_surf_point`: reads one surf point after product-scope validation.
- `create_surf_point`: creates a playbook/surf point. If the product has exactly
  one user-facing database, that database is used by default. If the product has
  multiple databases, pass `databaseIds`. Pass `databaseIds: []` only for an
  intentional action-only surf point.
- `update_surf_point`: updates metadata, prompt fields, target databases, and
  JSON config. Patch fields such as `toolConfigPatch` are shallow merges.
- `run_surf_point`: queues an active surf point for asynchronous execution by
  creating one pending `extract` surf job per active pull source, matching
  SignalSurf Web's Surf Now worker contract. Existing pending/processing jobs
  are deduplicated by source by default. Pass `idempotencyKey` when an agent may
  retry the same intended run.
- `get_surf_job` / `list_surf_jobs`: reads async execution status after product
  scope validation.
- `wait_for_surf_job`: polls one surf job until it leaves an active status
  (`pending`, `queued`, `running`, `processing`, or `in_progress`) or until the
  timeout expires. It does not run a worker itself.
- `cancel_surf_job`: cancels a pending surf job. Running jobs are not forcefully
  interrupted through MCP.
- `delete_surf_point`: soft-deletes surf points and cancels pending jobs.

Tables:

- `list_databases`: lists databases for the selected product. System databases
  are hidden unless `includeSystem=true`.
- `create_table`: creates a product table with optional custom schema, saved
  view config, item type, display order, and existing table folder placement.
- `update_table`: updates table metadata, custom schema, saved view config,
  item type, display order, or folder placement.
- `read_table`: reads rows with pagination and optional JSON containment filter.
  It also supports UI-style `filters`, `filterLogic`, and data-field `sorts`.
  Advanced filters are evaluated over a bounded scan (`scanLimit`, default
  1000, max 5000) so array, date, number, text, and relation comparisons behave
  consistently across JSON fields. Results include `scannedCount` and
  `hasMoreToScan` when a wider scan may be needed.
- `list_database_views` / `read_table_view`: lists saved views from database
  `viewConfigs` and reads rows using compatible saved-view filters/sorts.
- `get_table_row`: reads one row after verifying its database belongs to the
  token product.
- `create_table_row`: inserts a row. If `playbookId` is supplied, that surf point
  must target the row's database. The server stamps `origin="mcp"` and
  `origin_ref` from the token name; callers cannot forge provenance, triggered
  state, or dedupe keys.
- `update_table_row`: updates row data with SignalSurf's
  `update_entry_with_source` RPC so changelog behavior matches the web app.
  `item_ref` fields are validated against the database schema and must point to
  rows in the same product.
- `delete_table_rows`: hard-deletes table rows after every row is product-scoped.

Schema:

- `list_database_fields`: returns schema fields and relation definitions for a
  database.
- `create_table` / `update_table`: accept a complete `schema` object or
  `schemaPatch`; `item_ref` fields and relation targets must point at databases
  in the same authorized product.
- `add_database_field` / `update_database_field` / `remove_database_field`:
  mutate database schema only. They do not backfill or delete row data.
- `create_relation_field`: adds an `item_ref` field after verifying the target
  database belongs to the same authorized product.

Sources and surf point tools:

- `list_surf_point_sources`: returns safe source metadata only:
  `sourceId`, `surfPointId`, name, database type, public `sourceType`,
  endpoint, schedule, URL, provider, event type, database id,
  `webhookSecretConfigured`, `isActive`, and timestamps. Source config,
  credentials, headers, bodies, auth settings, and provider payloads are not
  exposed through MCP.
- `create_surf_point_source`: creates a SignalSurf source/signal for a Surf
  Point. Supported `sourceType` values are `platform`, `custom-pull`, `rss`,
  `webhook`, `web-monitor`, `github`, `coingecko`, `hackernews`,
  `producthunt`, `item-created`, `item-updated`, `manual-trigger`, and
  `on-schedule`. Platform sources also write `keywords` and `trackedAccounts`
  into the product search-config tables.
- `update_surf_point_source`: updates source name, active state, typed source
  config, `pull_config`, `metadata`, or `data_schema`. Secret-bearing config
  such as headers, bodies, and auth may be written but is not returned by list
  responses.
- `delete_surf_point_source`: deletes one or more sources after product-scope
  validation and removes pending jobs for those source ids.
- Internal trigger source types (`item-created`, `item-updated`,
  `manual-trigger`, `on-schedule`) are exclusive. A Surf Point can have one
  internal trigger and no external discovery sources alongside it. Pass
  `replaceExisting=true` only when intentionally replacing existing sources.
- `set_surf_point_source_active`: enables or pauses one source after verifying
  its surf point belongs to the authorized product.
- `list_product_tools`: returns safe product tool metadata from
  `product_tools`; config secrets are not exposed.
- `list_surf_point_tools`, `attach_surf_point_tool`, and
  `detach_surf_point_tool`: manage `tool_config.auto_tool_ids` on a surf point
  idempotently. Attach/detach validates that the tool exists in the authorized
  product.

Account List / ICP profiles:

- `list_account_list_profiles`: lists reusable ICP profiles for Account List
  sourcing. Archived profiles are hidden by default.
- `save_account_list_profile`: creates or updates a profile with the structured
  `accountList` config used by SignalSurf Web: provider selection, company
  filters, people filters, live-signal filters, sample accounts, and reject
  accounts. Updating a profile increments `profile_version`.
- `archive_account_list_profile`: soft-archives one reusable profile after
  product-scope validation.

Roles:

- `viewer`: can read tools and resources only
- `editor`: can read and write
- `owner`: currently same MCP capability as `editor`; reserved for future policy

OAuth scopes can narrow those role grants. For example, an editor OAuth token
with `mcp:tables.write` can create and update rows but cannot delete rows or
create Surf Points. Product creation additionally requires hosted OAuth because
the active grant must be expanded to the new product. Manual fallback tokens
without `scopes` keep the legacy role-only behavior.

Resources:

- `signalsurf://context`
- `signalsurf://surf-points` for single-product tokens
- `signalsurf://surf-points/{surfPointId}` for single-product tokens
- `signalsurf://surf-points/{surfPointId}/sources` for single-product tokens
- `signalsurf://surf-points/{surfPointId}/tools` for single-product tokens
- `signalsurf://product-tools` for single-product tokens
- `signalsurf://account-list-profiles` for single-product tokens
- `signalsurf://surf-jobs` for single-product tokens
- `signalsurf://surf-jobs/{jobId}` for single-product tokens
- `signalsurf://databases` for single-product tokens
- `signalsurf://databases/{databaseId}/rows` for single-product tokens

For multi-product OAuth tokens, only `signalsurf://context` is listed. Read its
`products[]` list to see product names and workspace names, then use tools with
an explicit `productId` to read or modify product data.

Schema limits:

- List/read limits are capped at 200 rows per call.
- Surf point names are capped at 100 characters.
- Prompt fields are capped at 10,000 characters each.
- Table row notes are capped at 500,000 characters.

## Setup

```bash
corepack pnpm@10.0.0 install
cp .env.example .env
corepack pnpm@10.0.0 build
```

Required env:

- `SIGNALSURF_SUPABASE_URL`, `SUPABASE_URL`, or `NEXT_PUBLIC_SUPABASE_URL`
- `SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `SIGNALSURF_MCP_AUTH_MODE=database` for hosted SignalSurf Web tokens, or
  `SIGNALSURF_MCP_AUTH_MODE=env` with `SIGNALSURF_MCP_TOKENS` for static
  token config
- `SIGNALSURF_MCP_TOKEN` / direct context for local stdio
- `SIGNALSURF_MCP_ALLOWED_HOSTS` when HTTP is served behind a hostname that is
  not the configured bind host
- `SIGNALSURF_MCP_TRUST_PROXY=true` only behind a trusted proxy that overwrites
  `X-Forwarded-For`

Do not expose this service directly to the public internet without a trusted
network boundary. MCP tokens limit product scope, but the process still holds a
Supabase service-role key.

## Static Token Config

Static token config is for local development or internal single-tenant
deployments. Hosted production should use `SIGNALSURF_MCP_AUTH_MODE=database`.

Prefer hashed tokens:

```bash
printf '%s' 'ssmcp_live_xxx' | shasum -a 256
```

Then configure:

```json
[
  {
    "name": "claude-code",
    "tokenSha256": "sha256-hex",
    "productId": "product-uuid",
    "userId": "user-uuid",
    "role": "editor",
    "scopes": ["mcp:tables.read", "mcp:tables.write"]
  }
]
```

Plaintext `token` entries are supported for local development, but
`tokenSha256` is preferred for shared environments.

Each static token binds one MCP caller to one `productId`. OAuth tokens from
SignalSurf Web may grant multiple `productIds`; static env tokens intentionally
remain single-product for local and internal fallback use. `userId` is optional,
but include it when you want surf point deletion to repair that user's
`current_playbook_id`. `tokenName` appears in `get_context` and is used as the
row-update source reference.

`scopes` is optional for static tokens. When present, the server enforces both
the token role and the listed scopes. When omitted, static tokens retain the
legacy broad role behavior.

Rotate a token by:

1. Generate a new random token.
2. Add its SHA-256 hash to `SIGNALSURF_MCP_TOKENS`.
3. Restart the MCP server.
4. Update the client env.
5. Remove the old hash and restart again.

## Stdio

```bash
SIGNALSURF_MCP_TRANSPORT=stdio \
SIGNALSURF_MCP_AUTH_MODE=env \
SIGNALSURF_MCP_TOKEN=ssmcp_live_xxx \
pnpm start
```

Claude Code example:

```json
{
  "mcpServers": {
    "signalsurf": {
      "command": "node",
      "args": ["/absolute/path/to/signalsurf-mcp/dist/index.js"],
      "env": {
        "SIGNALSURF_MCP_TRANSPORT": "stdio",
        "SIGNALSURF_MCP_AUTH_MODE": "env",
        "SIGNALSURF_SUPABASE_URL": "https://your-project-ref.supabase.co",
        "SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
        "SIGNALSURF_MCP_TOKENS": "[{\"tokenSha256\":\"sha256-hex\",\"productId\":\"product-uuid\",\"userId\":\"user-uuid\",\"role\":\"editor\"}]",
        "SIGNALSURF_MCP_TOKEN": "ssmcp_live_xxx"
      }
    }
  }
}
```

For trusted local development only, stdio can skip token lookup with direct
context:

```bash
SIGNALSURF_MCP_AUTH_DISABLED=true \
SIGNALSURF_MCP_PRODUCT_ID=00000000-0000-0000-0000-000000000000 \
SIGNALSURF_MCP_USER_ID=00000000-0000-0000-0000-000000000000 \
SIGNALSURF_MCP_ROLE=editor \
pnpm start
```

`SIGNALSURF_MCP_AUTH_DISABLED=true` is rejected in HTTP mode. It bypasses token
auth for the process and is only for trusted local stdio sessions with an
explicit `SIGNALSURF_MCP_PRODUCT_ID`.

## Streamable HTTP

```bash
SIGNALSURF_MCP_TRANSPORT=http pnpm start
```

The server listens on `http://127.0.0.1:3333/mcp` by default.

HTTP mode serves stateless MCP Streamable HTTP at `POST {host}:{port}{path}`.
There is no session create/reuse/delete lifecycle. `GET` and `DELETE` return
`405` by design. Clients must send MCP JSON-RPC requests to the same
`POST /mcp` endpoint with `Authorization: Bearer <token>`.

HTTP clients must send:

```http
Authorization: Bearer ssmcp_live_xxx
```

Host headers are checked before request handling to reduce localhost
DNS-rebinding risk. By default the server accepts loopback hostnames when bound
locally. Set `SIGNALSURF_MCP_ALLOWED_HOSTS=signalsurf-mcp.example.com` for
reverse-proxy or hosted HTTP deployments.

Basic request shape:

```bash
curl -s http://127.0.0.1:3333/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer ssmcp_live_xxx' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.0"}}}'
```

## Validation

```bash
corepack pnpm@10.0.0 typecheck
corepack pnpm@10.0.0 test
corepack pnpm@10.0.0 build
git diff --check
```

## Safety Notes

- The server does not expose arbitrary SQL write tools.
- Row writes require the target database to belong to the token's product.
- Rows with no `database_id` are not accessible through MCP.
- Surf point reads and mutations filter `deleted_at IS NULL`.
- Surf points attached to row writes must target that row's database.
- Row `item_ref` values must reference entries in product-owned databases.
- Row data updates call SignalSurf's `update_entry_with_source` RPC, preserving entry changelog behavior.
- HTTP auth-disabled mode is rejected; direct context is stdio-only.
- HTTP Host headers are allowlisted through `SIGNALSURF_MCP_ALLOWED_HOSTS`.
- Do not commit `.env` or plaintext service-role keys.

## Known Limits

- This package is a standalone MCP server. It does not yet mount inside
  `SignalsurfWeb` at `src/app/api/mcp/[transport]/route.ts`.
- It exposes a curated tool surface, not every internal SignalSurf chat tool.
- `dataPatch`, `toolConfigPatch`, `variablesPatch`, and `configPatch` are shallow
  merges. Replace the full object when nested merge semantics matter.
- `delete_table_rows` hard-deletes rows. Use it only when the user explicitly
  wants row deletion, not when hiding or archiving would be more appropriate.
