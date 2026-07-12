# SignalSurf MCP Capabilities

This package exposes the public MCP contract for external agents. It is not a
raw mirror of every internal SignalSurf Web UI helper, but portable
agent-facing capabilities should have a public MCP equivalent.

`src/capabilities.ts` is the code source of truth for:

- Supported SignalSurf resource scopes advertised by the hosted MCP protected
  resource.
- Additional accepted OAuth token scopes, such as `offline_access`, that are
  not resource requirements.
- Public MCP tool names, descriptions, annotations, and required capabilities.
- Mapping from OAuth scopes to tool capabilities.
- Legacy broad-scope compatibility for existing clients.

## Scope Model

| Scope                     | Capability grant                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `mcp:read`                | `context.read`, `surf_points.read`, `tables.read`, `schemas.read`, `sources.read`, `deepline.read` |
| `mcp:write`               | All current read, write, execute, and delete capabilities                                          |
| `mcp:products.write`      | `context.read`, `products.write`                                                                   |
| `mcp:surf_points.read`    | `context.read`, `surf_points.read`                                                                 |
| `mcp:surf_points.write`   | `context.read`, `surf_points.read`, `surf_points.write`                                            |
| `mcp:surf_points.execute` | `context.read`, `surf_points.read`, `surf_points.execute`                                          |
| `mcp:surf_points.delete`  | `context.read`, `surf_points.read`, `surf_points.delete`                                           |
| `mcp:tables.read`         | `context.read`, `tables.read`                                                                      |
| `mcp:tables.write`        | `context.read`, `tables.read`, `tables.write`                                                      |
| `mcp:tables.delete`       | `context.read`, `tables.read`, `tables.delete`                                                     |
| `mcp:schemas.read`        | `context.read`, `schemas.read`                                                                     |
| `mcp:schemas.write`       | `context.read`, `schemas.read`, `schemas.write`                                                    |
| `mcp:sources.read`        | `context.read`, `sources.read`                                                                     |
| `mcp:sources.write`       | `context.read`, `sources.read`, `sources.write`                                                    |
| `mcp:deepline.read`       | `context.read`, `deepline.read`                                                                    |
| `mcp:deepline.enrich`     | `context.read`, `deepline.read`, `deepline.enrich`                                                 |
| `mcp:deepline.execute`    | `context.read`, `deepline.read`, `deepline.execute`                                                |
| `mcp:deepline.write`      | Legacy alias for both `mcp:deepline.enrich` and `mcp:deepline.execute`                             |
| `offline_access`          | No tool capability; allows OAuth refresh in SignalSurf Web                                         |

The protected resource metadata and `WWW-Authenticate` scope hints include only
SignalSurf resource scopes registered by the hosted authorization server, not
`offline_access`. The default authorization request includes
`mcp:deepline.read`, but not `mcp:deepline.enrich` or
`mcp:deepline.execute`; clients must request those higher-risk scopes explicitly.
The legacy `mcp:deepline.write` alias remains accepted but is not advertised.

Manual fallback tokens are still role-based for compatibility. If a static env
token includes a `scopes` array, both role and scopes are enforced. If it omits
`scopes`, the existing role-only behavior is preserved.

## Public Tool Contract

| Tool                        | Required capability   | Destructive | Notes                                                                                                                 |
| --------------------------- | --------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `get_context`               | `context.read`        | No          | Returns authorized product ids/names, workspace names, user, role, scopes, and per-tool access booleans               |
| `get_brand_context`         | `context.read`        | No          | Reads the active product's brand/positioning context from product goals (empty fields before brand setup)             |
| `create_product`            | `products.write`      | No          | Creates a product through hosted OAuth and expands the active grant                                                   |
| `list_surf_points`          | `surf_points.read`    | No          | Lists non-deleted Surf Points for one authorized product                                                              |
| `get_surf_point`            | `surf_points.read`    | No          | Reads one product-scoped Surf Point                                                                                   |
| `create_surf_point`         | `surf_points.write`   | No          | Creates a Surf Point in one authorized product                                                                        |
| `update_surf_point`         | `surf_points.write`   | No          | Mutates Surf Point metadata, prompts, targets, or JSON config                                                         |
| `run_surf_point`            | `surf_points.execute` | No          | Queues an active Surf Point for asynchronous execution                                                                |
| `get_surf_job`              | `surf_points.read`    | No          | Reads one product-scoped Surf Point execution job                                                                     |
| `wait_for_surf_job`         | `surf_points.read`    | No          | Polls one Surf Point execution job until terminal status or timeout                                                   |
| `list_surf_jobs`            | `surf_points.read`    | No          | Lists product-scoped Surf Point execution jobs                                                                        |
| `cancel_surf_job`           | `surf_points.execute` | No          | Cancels a pending Surf Point execution job                                                                            |
| `delete_surf_point`         | `surf_points.delete`  | Yes         | Soft-deletes Surf Points and cancels pending jobs                                                                     |
| `list_tables`               | `tables.read`         | No          | Lists product tables                                                                                                  |
| `create_table`              | `schemas.write`       | No          | Creates a product table from an outbound/contact template or custom schema, with saved-view config                     |
| `update_table`              | `schemas.write`       | No          | Updates table metadata, custom schema, and saved-view config                                                          |
| `delete_table`              | `tables.delete`       | Yes         | Deletes user-facing tables and unlinks them from active Surf Points after product-scope verification                  |
| `list_table_views`          | `tables.read`         | No          | Lists saved table views from view configuration                                                                       |
| `read_table`                | `tables.read`         | No          | Reads rows with pagination, containment filters, and UI-style filters/sorts                                           |
| `read_table_view`           | `tables.read`         | No          | Reads rows using compatible saved-view filters/sorts                                                                  |
| `get_table_row`             | `tables.read`         | No          | Reads one product-scoped row                                                                                          |
| `create_table_row`          | `tables.write`        | No          | Creates rows with server-side MCP provenance                                                                          |
| `update_table_rows`         | `tables.write`        | No          | Edits 1-100 rows (array-based, single or batch) with distinct data/note/playbookId per row, changelog-preserving RPCs |
| `delete_table_rows`         | `tables.delete`       | Yes         | Hard-deletes rows after product-scope verification                                                                    |
| `list_table_fields`         | `schemas.read`        | No          | Lists schema fields and relation definitions                                                                          |
| `add_table_field`           | `schemas.write`       | No          | Adds one schema field without backfilling row data                                                                    |
| `update_table_field`        | `schemas.write`       | No          | Patches one schema field definition                                                                                   |
| `remove_table_field`        | `schemas.write`       | No          | Removes one schema field without deleting row data                                                                    |
| `create_relation_field`     | `schemas.write`       | No          | Adds an `item_ref` relation field to a product-owned target database                                                  |
| `list_signals`              | `sources.read`        | No          | Lists safe signal metadata only; config and credentials are not exposed                                               |
| `create_signal`             | `sources.write`       | No          | Creates a signal for a Surf Point with typed config and product-scope validation                                      |
| `update_signal`             | `sources.write`       | No          | Updates signal name, active state (enable/pause), typed config, `pull_config`, `metadata`, or `data_schema`           |
| `delete_signal`             | `sources.write`       | Yes         | Deletes signals after product-scope validation and removes non-terminal jobs for those source ids                     |
| `enable_quick_surf`         | `sources.write`       | No          | Binds a hidden manual-trigger source to one table column with instruction, optional auto-fill, and optional run gate  |
| `disable_quick_surf`        | `sources.write`       | No          | Turns off a column binding while preserving its instruction and gate                                                  |
| `list_quick_surf`           | `sources.read`        | No          | Lists Quick Surf-enabled columns for a table with their instructions                                                  |
| `run_quick_surf`            | `surf_points.execute` | No          | Queues column, row-subset, or single-cell enrichment; column/subset runs apply the persisted run gate                 |
| `list_product_tools`        | `surf_points.read`    | No          | Lists safe product tool metadata; config secrets are not exposed                                                      |
| `list_surf_point_tools`     | `surf_points.read`    | No          | Lists tool ids from `tool_config.auto_tool_ids` (attach/detach via `update_surf_point` toolConfigPatch)               |
| `deepline_search_people`    | `deepline.read`       | No          | Runs a bounded managed Crustdata V3 people search after one-time Web approval; Apollo is an explicit BYOC override    |
| `deepline_search_companies` | `deepline.read`       | No          | Runs a bounded managed Crustdata V3 company search after one-time Web approval; Apollo is an explicit BYOC override   |
| `deepline_enrich_contact`   | `deepline.enrich`     | No          | Finds a work email through Deepline after one-time Web approval                                                       |
| `deepline_search_catalog`   | `deepline.read`       | No          | Searches Deepline's live v2 tool catalog for provider tool ids                                                        |
| `deepline_execute_tool`     | `deepline.execute`    | No          | Executes one selected Deepline tool only after atomically consuming an exact, unexpired Web approval                  |

OAuth tokens can authorize multiple products. Agents should call `get_context`
first; when multiple `productIds` are returned, choose from `products[]` using
the human-readable product and workspace names, then include the intended
`productId` in every product-scoped tool call. Static fallback tokens remain
single-product scoped.

`tools/list` advertises this public contract consistently. A caller whose token
lacks a required scoped capability over HTTP receives a `403` response with a
`WWW-Authenticate` `insufficient_scope` challenge. In-process tool calls also
return an `INSUFFICIENT_SCOPE` tool error payload that includes the granular
scope needed for step-up authorization.

## Adding a Tool

1. Add the schema in `src/schemas.ts` and the exhaustive
   `PUBLIC_MCP_TOOL_SCHEMAS` registry.
2. Add the repository operation in `src/repository.ts`.
3. Add the tool definition to `PUBLIC_MCP_TOOLS` in `src/capabilities.ts`.
4. Register the tool in `src/server.ts` through the capability registry helper.
5. Use the narrowest capability possible; separate delete capability from update
   capability when the operation is destructive.
6. Add tests that prove `tools/list` includes the registry entry and scoped
   tokens cannot call tools outside their scopes.
7. Update this document, the Web-side Surfer capability matrix, and
   `docs/surfer-mcp-parity.json` when the tool maps to or changes a Surfer
   capability.
8. Update `docs/public-tool-contract.json` with the emitted input-schema
   fingerprint and semantic fixtures consumed by SignalSurf Web.
9. Run `pnpm check:surfer-parity`.

## External Action Approval Contract

Every chargeable Deepline call (`deepline_search_people`,
`deepline_search_companies`, `deepline_enrich_contact`, and
`deepline_execute_tool`) is fail-closed and hosted-OAuth-only. The curated
tools build their canonical provider payload and then reuse the same approval
state machine as `deepline_execute_tool`. When
`approvalRequestId` is omitted, the server creates or reuses a short-lived,
redacted `pending` request and returns `APPROVAL_REQUIRED` with its id and the
SignalSurf Web approval URL. This request cannot approve itself. On a follow-up
call, `approvalRequestId` must identify an `mcp_action_approvals` row whose
stable `oauth_grant_id`, `user_id`, `client_id`, `product_id`, `tool_name`,
`provider_tool_id`, and `payload_sha256` match the active call and whose status
is `approved` with a future `expires_at`.

The server claims the approval with one conditional update from `approved` to
`executing` before reading credentials or making the provider request. A second
caller, an expired request, a payload mismatch, or a replay matches no row and
never calls Deepline. The known terminal states are `executed` and `failed`.
Transport failures after dispatch are recorded as `ambiguous` and are never
automatically replayed; a new action requires a new Web approval.

SignalSurf Web owns human resolution. The shared contract artifact at
`docs/public-tool-contract.json` pins the public input schemas and valid/invalid
semantic fixtures for every advertised tool so Web and this server can reject
schema or fixture-coverage drift in CI.

Do not add raw SQL, arbitrary table-name access, service-role-like operations,
or tools that bypass SignalSurf's existing provenance, changelog, job, or
preference side effects.
