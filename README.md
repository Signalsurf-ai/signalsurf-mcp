# SignalSurf MCP

Standalone MCP server for controlled agent access to SignalSurf surf points and
product tables.

This server is intentionally narrow. It gives external agents the core product
operations they need without exposing arbitrary SQL or raw service-role access.
Every request is bound to one SignalSurf product through an MCP token.
See `docs/architecture.md` for the request lifecycle, safety model, and
extension guidelines.

## External User Setup

If you are connecting an agent to SignalSurf, use the hosted MCP service. You do
not need this repository, a Supabase key, or a local server.

1. Add SignalSurf as a remote MCP server in your MCP client:
   `https://mcp.signalsurf.ai/mcp`.
2. The client opens SignalSurf's OAuth authorization page.
3. Sign in, choose the SignalSurf product, review requested scopes, and approve.
4. The MCP client receives OAuth tokens through its callback and can use
   SignalSurf tools.

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
SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL=https://app.signalsurf.ai
SIGNALSURF_MCP_HOST=0.0.0.0
SIGNALSURF_MCP_PORT=3333
SIGNALSURF_MCP_PATH=/mcp
SIGNALSURF_MCP_ALLOWED_HOSTS=mcp.signalsurf.ai
SIGNALSURF_MCP_TRUST_PROXY=true
```

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

- `list_surf_points`, `create_surf_point`, `update_surf_point`, `delete_surf_point`
- `list_databases`, `read_table`, `get_table_row`
- `create_table_row`, `update_table_row`, `delete_table_rows`
- Resources for context, surf points, databases, and database rows

All tools are scoped to one `productId` resolved from the caller's MCP token.
The server uses Supabase service-role credentials internally, so every operation
explicitly validates product ownership before touching rows. Surf point deletion
is a soft delete (`deleted_at`), matching the web app behavior.

## Architecture

```text
MCP client
  -> stdio or Streamable HTTP transport
  -> token auth resolves { productId, userId, role }
  -> MCP tool/resource handlers
  -> SignalSurf repository
  -> Supabase service-role client with explicit product-scope checks
```

Key files:

- `src/index.ts`: process entrypoint and transport selection
- `src/http.ts`: stateless Streamable HTTP transport
- `src/stdio.ts`: stdio transport for local MCP clients
- `src/auth.ts`: token hashing, bearer parsing, and role checks
- `src/repository.ts`: SignalSurf product-scope and mutation logic
- `src/server.ts`: MCP tools and resources
- `src/schemas.ts`: Zod input schemas exposed to MCP clients

The HTTP transport is stateless. Each POST resolves auth, creates a fresh MCP
server instance, handles one JSON-RPC request, and closes. This avoids shared
in-memory session state and makes bearer-token product scoping straightforward.

## Tool Semantics

Context:

- `get_context`: returns the product, optional user, role, token name, and
  read/write capability for the current connection. Agents should call this
  before writes and verify they are operating in the intended product.

Surf points:

- `list_surf_points`: returns non-deleted surf points. Use
  `includeInactive=false` to hide paused surf points.
- `create_surf_point`: creates a playbook/surf point. If the product has exactly
  one user-facing database, that database is used by default. If the product has
  multiple databases, pass `databaseIds`. Pass `databaseIds: []` only for an
  intentional action-only surf point.
- `update_surf_point`: updates metadata, prompt fields, target databases, and
  JSON config. Patch fields such as `toolConfigPatch` are shallow merges.
- `delete_surf_point`: soft-deletes surf points and cancels pending jobs.

Tables:

- `list_databases`: lists databases for the token product. System databases are
  hidden unless `includeSystem=true`.
- `read_table`: reads rows with pagination and optional JSON containment filter.
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

Roles:

- `viewer`: can read tools and resources only
- `editor`: can read and write
- `owner`: currently same MCP capability as `editor`; reserved for future policy

Resources:

- `signalsurf://context`
- `signalsurf://surf-points`
- `signalsurf://databases`
- `signalsurf://databases/{databaseId}/rows`

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
    "role": "editor"
  }
]
```

Plaintext `token` entries are supported for local development, but
`tokenSha256` is preferred for shared environments.

Each token binds exactly one MCP caller to one `productId`. `userId` is optional,
but include it when you want surf point deletion to repair that user's
`current_playbook_id`. `tokenName` appears in `get_context` and is used as the
row-update source reference.

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
