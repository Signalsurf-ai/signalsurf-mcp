# Hosted MCP Action Approval Integration

`deepline_execute_tool` depends on the SignalSurf Web migration and approval UI
for `public.mcp_action_approvals`. Deploy Web first; until the table is present,
generic Deepline execution fails closed with `APPROVAL_UNAVAILABLE` and makes no
provider request. The Web migration keeps a temporary database-side compatibility
trigger that derives `oauth_grant_id` from `oauth_token_id`, so the previous
hosted writer remains available during the migrate-before-MCP rollout.

## Required Web Contract

The hosted MCP reads or writes these Web-owned columns:

- `id uuid`
- `product_id uuid`
- `oauth_token_id uuid` referencing `mcp_oauth_tokens.id`
- `oauth_grant_id uuid` set to the token family's stable
  `refresh_token_family_id` (or the token id when no family exists)
- `tool_name text`
- `provider_tool_id text`
- `payload_sha256 text` constrained to lowercase SHA-256 hex
- `status text` supporting `pending`, `approved`, `rejected`, `executing`,
  `executed`, `failed`, `ambiguous`, and `expired`
- `expires_at timestamptz`
- `execution_started_at timestamptz null`
- `executed_at timestamptz null`
- `error text null`
- `updated_at timestamptz`

Web may additionally retain `user_id`, `client_id`, `preview`, `resolved_by`,
`resolved_at`, and `created_at` for membership checks, human review, and audit.
Service-role access must be able to perform the conditional updates below;
authenticated users should only read approvals authorized by product membership.

Hosted MCP creates or reuses requests as `pending`; it stores only a conservative
preview containing the tool ids, payload keys/count, serialized byte count, and
allowlisted human-review fields such as recipient, subject, message, and target
URL. Credential-like fields are redacted, unknown values are hidden, and URL
query values are redacted.
Identical unexpired pending requests are reused. Web resolves them with
compare-and-set to `approved` or `rejected`. A partial unique index over the
OAuth-grant/user/client/product/tool/provider/digest binding for
`status = 'pending'`
is required so simultaneous retries deduplicate at the database boundary.

The authorization server accepts
`mcp:deepline.read`, `mcp:deepline.enrich`, and `mcp:deepline.execute`; the
default grant includes only `mcp:deepline.read`.

## Hosted Claim And Finalization

For a call with `toolId` and `payload`, hosted MCP computes
`SHA-256(canonicalJson(payload))`. Canonical JSON recursively sorts object keys,
preserves array order, omits undefined object members, and emits compact JSON.

If `approvalRequestId` is omitted, hosted MCP returns `APPROVAL_REQUIRED` with
`requestId`, a ten-minute expiry, and (when
`SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL` is configured)
`<authorization-server>/approvals?mcpAction=<requestId>`. Without that env var,
the URL is null but the request id remains usable.

Before calling Deepline with an approved request, hosted MCP performs one atomic conditional update:

```text
approved -> executing
where id = approvalRequestId
  and oauth_grant_id = active OAuth grant id
  and product_id = active product id
  and tool_name = deepline_execute_tool
  and provider_tool_id = toolId
  and payload_sha256 = canonical payload digest
  and expires_at > now
```

No matching row means no provider call. The claimant then finalizes
`executing -> executed|failed|ambiguous`. An `ambiguous` result and all terminal
states require a newly approved request; hosted MCP never replays them.

The cross-repository schema fingerprints and valid/invalid inputs are pinned in
`docs/public-tool-contract.json`. SignalSurf Web CI should compute fingerprints
with the same canonicalization and require zero differences for every mapped
public MCP tool.
