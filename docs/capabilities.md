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

| Scope                     | Capability grant                                                                  |
| ------------------------- | --------------------------------------------------------------------------------- |
| `mcp:read`                | `context.read`, `surf_points.read`, `tables.read`, `schemas.read`, `sources.read`, `account_lists.read`, `deepline.read` |
| `mcp:write`               | All current read, write, execute, and delete capabilities                         |
| `mcp:products.write`      | `context.read`, `products.write`                                                  |
| `mcp:surf_points.read`    | `context.read`, `surf_points.read`                                                |
| `mcp:surf_points.write`   | `context.read`, `surf_points.read`, `surf_points.write`                           |
| `mcp:surf_points.execute` | `context.read`, `surf_points.read`, `surf_points.execute`                         |
| `mcp:surf_points.delete`  | `context.read`, `surf_points.read`, `surf_points.delete`                          |
| `mcp:tables.read`         | `context.read`, `tables.read`                                                     |
| `mcp:tables.write`        | `context.read`, `tables.read`, `tables.write`                                     |
| `mcp:tables.delete`       | `context.read`, `tables.read`, `tables.delete`                                    |
| `mcp:schemas.read`        | `context.read`, `schemas.read`                                                    |
| `mcp:schemas.write`       | `context.read`, `schemas.read`, `schemas.write`                                   |
| `mcp:sources.read`        | `context.read`, `sources.read`                                                    |
| `mcp:sources.write`       | `context.read`, `sources.read`, `sources.write`                                   |
| `mcp:account_lists.read`  | `context.read`, `account_lists.read`                                              |
| `mcp:account_lists.write` | `context.read`, `account_lists.read`, `account_lists.write`                       |
| `mcp:deepline.read`       | `context.read`, `deepline.read`                                                   |
| `mcp:deepline.write`      | `context.read`, `deepline.read`, `deepline.enrich`, `deepline.execute`            |
| `offline_access`          | No tool capability; allows OAuth refresh in SignalSurf Web                        |

The protected resource metadata and `WWW-Authenticate` scope hints include only
SignalSurf resource scopes registered by the hosted authorization server, not
`offline_access`. `account_lists` and `deepline` scopes are accepted and
enforced by this MCP server, but are not advertised by default until the hosted
authorization server registers them.

Manual fallback tokens are still role-based for compatibility. If a static env
token includes a `scopes` array, both role and scopes are enforced. If it omits
`scopes`, the existing role-only behavior is preserved.

## Public Tool Contract

| Tool                           | Required capability   | Destructive | Notes                                                                                                   |
| ------------------------------ | --------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `get_context`                  | `context.read`        | No          | Returns authorized product ids/names, workspace names, user, role, scopes, and per-tool access booleans |
| `create_product`               | `products.write`      | No          | Creates a product through hosted OAuth and expands the active grant                                     |
| `list_surf_points`             | `surf_points.read`    | No          | Lists non-deleted Surf Points for one authorized product                                                |
| `get_surf_point`               | `surf_points.read`    | No          | Reads one product-scoped Surf Point                                                                     |
| `create_surf_point`            | `surf_points.write`   | No          | Creates a Surf Point in one authorized product                                                          |
| `update_surf_point`            | `surf_points.write`   | No          | Mutates Surf Point metadata, prompts, targets, or JSON config                                           |
| `run_surf_point`               | `surf_points.execute` | No          | Queues an active Surf Point for asynchronous execution                                                  |
| `get_surf_job`                 | `surf_points.read`    | No          | Reads one product-scoped Surf Point execution job                                                       |
| `wait_for_surf_job`            | `surf_points.read`    | No          | Polls one Surf Point execution job until terminal status or timeout                                     |
| `list_surf_jobs`               | `surf_points.read`    | No          | Lists product-scoped Surf Point execution jobs                                                          |
| `cancel_surf_job`              | `surf_points.execute` | No          | Cancels a pending Surf Point execution job                                                              |
| `delete_surf_point`            | `surf_points.delete`  | Yes         | Soft-deletes Surf Points and cancels pending jobs                                                       |
| `list_databases`               | `tables.read`         | No          | Lists product tables/databases                                                                          |
| `create_table`                 | `schemas.write`       | No          | Creates a product table with custom schema and saved-view config                                        |
| `update_table`                 | `schemas.write`       | No          | Updates table metadata, custom schema, and saved-view config                                            |
| `delete_table`                 | `tables.delete`       | Yes         | Deletes user-facing tables and unlinks them from active Surf Points after product-scope verification    |
| `list_database_views`          | `tables.read`         | No          | Lists saved database views from view configuration                                                      |
| `read_table`                   | `tables.read`         | No          | Reads rows with pagination, containment filters, and UI-style filters/sorts                             |
| `read_table_view`              | `tables.read`         | No          | Reads rows using compatible saved-view filters/sorts                                                    |
| `get_table_row`                | `tables.read`         | No          | Reads one product-scoped row                                                                            |
| `create_table_row`             | `tables.write`        | No          | Creates rows with server-side MCP provenance                                                            |
| `update_table_row`             | `tables.write`        | No          | Uses changelog-preserving row update RPCs                                                               |
| `delete_table_rows`            | `tables.delete`       | Yes         | Hard-deletes rows after product-scope verification                                                      |
| `list_database_fields`         | `schemas.read`        | No          | Lists schema fields and relation definitions                                                            |
| `add_database_field`           | `schemas.write`       | No          | Adds one schema field without backfilling row data                                                      |
| `update_database_field`        | `schemas.write`       | No          | Patches one schema field definition                                                                     |
| `remove_database_field`        | `schemas.write`       | No          | Removes one schema field without deleting row data                                                      |
| `create_relation_field`        | `schemas.write`       | No          | Adds an `item_ref` relation field to a product-owned target database                                    |
| `list_surf_point_sources`      | `sources.read`        | No          | Lists safe source metadata only; config and credentials are not exposed                                 |
| `create_surf_point_source`     | `sources.write`       | No          | Creates a source/signal for a Surf Point with typed config and product-scope validation                 |
| `update_surf_point_source`     | `sources.write`       | No          | Updates source name, active state, typed config, `pull_config`, `metadata`, or `data_schema`            |
| `delete_surf_point_source`     | `sources.write`       | Yes         | Deletes sources after product-scope validation and removes non-terminal jobs for those source ids       |
| `set_surf_point_source_active` | `sources.write`       | No          | Enables or pauses a source after product-scope validation                                               |
| `list_product_tools`           | `surf_points.read`    | No          | Lists safe product tool metadata; config secrets are not exposed                                        |
| `list_surf_point_tools`        | `surf_points.read`    | No          | Lists tool ids from `tool_config.auto_tool_ids`                                                         |
| `attach_surf_point_tool`       | `surf_points.write`   | No          | Adds one tool id to `tool_config.auto_tool_ids` idempotently                                            |
| `detach_surf_point_tool`       | `surf_points.write`   | No          | Removes one tool id from `tool_config.auto_tool_ids` idempotently                                       |
| `list_account_list_profiles`   | `account_lists.read`  | No          | Lists reusable Account List / ICP Builder profiles                                                      |
| `save_account_list_profile`    | `account_lists.write` | No          | Creates or updates a structured Account List / ICP Builder profile                                      |
| `archive_account_list_profile` | `account_lists.write` | No          | Soft-archives a reusable Account List / ICP Builder profile                                             |
| `deepline_search_people`       | `deepline.read`       | No          | Runs the curated Apollo-backed people search through Deepline                                           |
| `deepline_search_companies`    | `deepline.read`       | No          | Runs the curated Apollo-backed company search through Deepline                                          |
| `deepline_enrich_contact`      | `deepline.enrich`     | No          | Finds a work email through Deepline's configured email finder                                           |
| `deepline_search_catalog`      | `deepline.read`       | No          | Searches Deepline's live v2 tool catalog for provider tool ids                                          |
| `deepline_execute_tool`        | `deepline.execute`    | No          | Executes a selected Deepline v2 tool id with a JSON payload                                             |

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

1. Add the schema in `src/schemas.ts`.
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
8. Run `pnpm check:surfer-parity`.

Do not add raw SQL, arbitrary table-name access, service-role-like operations,
or tools that bypass SignalSurf's existing provenance, changelog, job, or
preference side effects.
