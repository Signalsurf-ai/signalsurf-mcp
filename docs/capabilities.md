# SignalSurf MCP Capabilities

This package exposes the public MCP contract for external agents. It is not a
mirror of every internal Surfer tool in SignalSurf Web.

`src/capabilities.ts` is the code source of truth for:

- Supported SignalSurf resource scopes advertised by the hosted MCP protected
  resource.
- Additional accepted OAuth token scopes, such as `offline_access`, that are
  not resource requirements.
- Public MCP tool names, descriptions, annotations, and required capabilities.
- Mapping from OAuth scopes to tool capabilities.
- Legacy broad-scope compatibility for existing clients.

## Scope Model

| Scope                    | Capability grant                                           |
| ------------------------ | ---------------------------------------------------------- |
| `mcp:read`               | `context.read`, `surf_points.read`, `tables.read`, `schemas.read`, `sources.read` |
| `mcp:write`              | All current read, write, execute, and delete capabilities  |
| `mcp:surf_points.read`   | `context.read`, `surf_points.read`                         |
| `mcp:surf_points.write`  | `context.read`, `surf_points.read`, `surf_points.write`    |
| `mcp:surf_points.execute` | `context.read`, `surf_points.read`, `surf_points.execute` |
| `mcp:surf_points.delete` | `context.read`, `surf_points.read`, `surf_points.delete`   |
| `mcp:tables.read`        | `context.read`, `tables.read`                              |
| `mcp:tables.write`       | `context.read`, `tables.read`, `tables.write`              |
| `mcp:tables.delete`      | `context.read`, `tables.read`, `tables.delete`             |
| `mcp:schemas.read`       | `context.read`, `schemas.read`                             |
| `mcp:schemas.write`      | `context.read`, `schemas.read`, `schemas.write`            |
| `mcp:sources.read`       | `context.read`, `sources.read`                             |
| `mcp:sources.write`      | `context.read`, `sources.read`, `sources.write`            |
| `offline_access`         | No tool capability; allows OAuth refresh in SignalSurf Web |

The protected resource metadata and `WWW-Authenticate` scope hints include only
SignalSurf resource scopes, not `offline_access`.

Manual fallback tokens are still role-based for compatibility. If a static env
token includes a `scopes` array, both role and scopes are enforced. If it omits
`scopes`, the existing role-only behavior is preserved.

## Public Tool Contract

| Tool                | Required capability  | Destructive | Notes                                                                            |
| ------------------- | -------------------- | ----------- | -------------------------------------------------------------------------------- |
| `get_context`       | `context.read`       | No          | Returns authorized product ids/names, workspace names, user, role, scopes, and per-tool access booleans |
| `list_surf_points`  | `surf_points.read`   | No          | Lists non-deleted Surf Points for one authorized product                         |
| `get_surf_point`    | `surf_points.read`   | No          | Reads one product-scoped Surf Point                                             |
| `create_surf_point` | `surf_points.write`  | No          | Creates a Surf Point in one authorized product                                   |
| `update_surf_point` | `surf_points.write`  | No          | Mutates Surf Point metadata, prompts, targets, or JSON config                    |
| `run_surf_point`    | `surf_points.execute` | No         | Queues an active Surf Point for asynchronous execution                           |
| `get_surf_job`      | `surf_points.read`   | No          | Reads one product-scoped Surf Point execution job                                |
| `wait_for_surf_job` | `surf_points.read`   | No          | Polls one Surf Point execution job until terminal status or timeout              |
| `list_surf_jobs`    | `surf_points.read`   | No          | Lists product-scoped Surf Point execution jobs                                   |
| `cancel_surf_job`   | `surf_points.execute` | No         | Cancels a pending Surf Point execution job                                       |
| `delete_surf_point` | `surf_points.delete` | Yes         | Soft-deletes Surf Points and cancels pending jobs                                |
| `list_databases`    | `tables.read`        | No          | Lists product tables/databases                                                   |
| `list_database_views` | `tables.read`      | No          | Lists saved database views from view configuration                               |
| `read_table`        | `tables.read`        | No          | Reads rows with pagination, containment filters, and UI-style filters/sorts      |
| `read_table_view`   | `tables.read`        | No          | Reads rows using compatible saved-view filters/sorts                             |
| `get_table_row`     | `tables.read`        | No          | Reads one product-scoped row                                                     |
| `create_table_row`  | `tables.write`       | No          | Creates rows with server-side MCP provenance                                     |
| `update_table_row`  | `tables.write`       | No          | Uses changelog-preserving row update RPCs                                        |
| `delete_table_rows` | `tables.delete`      | Yes         | Hard-deletes rows after product-scope verification                               |
| `list_database_fields` | `schemas.read`    | No          | Lists schema fields and relation definitions                                     |
| `add_database_field` | `schemas.write`     | No          | Adds one schema field without backfilling row data                               |
| `update_database_field` | `schemas.write`  | No          | Patches one schema field definition                                             |
| `remove_database_field` | `schemas.write`  | No          | Removes one schema field without deleting row data                              |
| `create_relation_field` | `schemas.write`  | No          | Adds an `item_ref` relation field to a product-owned target database             |
| `list_surf_point_sources` | `sources.read` | No          | Lists safe source metadata only; config and credentials are not exposed          |
| `set_surf_point_source_active` | `sources.write` | No    | Enables or pauses a source after product-scope validation                        |
| `list_product_tools` | `surf_points.read` | No        | Lists safe product tool metadata; config secrets are not exposed                 |
| `list_surf_point_tools` | `surf_points.read` | No       | Lists tool ids from `tool_config.auto_tool_ids`                                  |
| `attach_surf_point_tool` | `surf_points.write` | No     | Adds one tool id to `tool_config.auto_tool_ids` idempotently                     |
| `detach_surf_point_tool` | `surf_points.write` | No     | Removes one tool id from `tool_config.auto_tool_ids` idempotently                |

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
7. Update this document and the Web-side Surfer capability matrix.

Do not add raw SQL, arbitrary table-name access, service-role-like operations,
or tools that bypass SignalSurf's existing provenance, changelog, job, or
preference side effects.
