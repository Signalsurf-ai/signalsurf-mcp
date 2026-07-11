# Hosted MCP Action Approval Integration

`deepline_execute_tool` depends on the SignalSurf Web migration and approval UI
for `public.mcp_action_approvals`. Deploy Web first; until the table is present,
generic Deepline execution fails closed with `APPROVAL_UNAVAILABLE` and makes no
provider request.

## Required Web Contract

The hosted MCP reads or writes these Web-owned columns:

- `id uuid`
- `product_id uuid`
- `oauth_token_id uuid` referencing `mcp_oauth_tokens.id`
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

Web creates requests as `pending` and resolves them with compare-and-set to
`approved` or `rejected`. The authorization server accepts
`mcp:deepline.read`, `mcp:deepline.enrich`, and `mcp:deepline.execute`; the
default grant includes only `mcp:deepline.read`.

## Hosted Claim And Finalization

For a call with `toolId` and `payload`, hosted MCP computes
`SHA-256(canonicalJson(payload))`. Canonical JSON recursively sorts object keys,
preserves array order, omits undefined object members, and emits compact JSON.

Before calling Deepline, hosted MCP performs one atomic conditional update:

```text
approved -> executing
where id = approvalRequestId
  and oauth_token_id = active OAuth token id
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
