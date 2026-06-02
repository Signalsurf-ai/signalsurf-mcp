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
| `mcp:read`               | `context.read`, `surf_points.read`, `tables.read`          |
| `mcp:write`              | All current read, write, and delete capabilities           |
| `mcp:surf_points.read`   | `context.read`, `surf_points.read`                         |
| `mcp:surf_points.write`  | `context.read`, `surf_points.read`, `surf_points.write`    |
| `mcp:surf_points.delete` | `context.read`, `surf_points.read`, `surf_points.delete`   |
| `mcp:tables.read`        | `context.read`, `tables.read`                              |
| `mcp:tables.write`       | `context.read`, `tables.read`, `tables.write`              |
| `mcp:tables.delete`      | `context.read`, `tables.read`, `tables.delete`             |
| `offline_access`         | No tool capability; allows OAuth refresh in SignalSurf Web |

The protected resource metadata and `WWW-Authenticate` scope hints include only
SignalSurf resource scopes, not `offline_access`.

Manual fallback tokens are still role-based for compatibility. If a static env
token includes a `scopes` array, both role and scopes are enforced. If it omits
`scopes`, the existing role-only behavior is preserved.

## Public Tool Contract

| Tool                | Required capability  | Destructive | Notes                                                                            |
| ------------------- | -------------------- | ----------- | -------------------------------------------------------------------------------- |
| `get_context`       | `context.read`       | No          | Returns authorized product ids, user, role, scopes, and per-tool access booleans |
| `list_surf_points`  | `surf_points.read`   | No          | Lists non-deleted Surf Points for one authorized product                         |
| `create_surf_point` | `surf_points.write`  | No          | Creates a Surf Point in one authorized product                                   |
| `update_surf_point` | `surf_points.write`  | No          | Mutates Surf Point metadata, prompts, targets, or JSON config                    |
| `delete_surf_point` | `surf_points.delete` | Yes         | Soft-deletes Surf Points and cancels pending jobs                                |
| `list_databases`    | `tables.read`        | No          | Lists product tables/databases                                                   |
| `read_table`        | `tables.read`        | No          | Reads rows with pagination and containment filters                               |
| `get_table_row`     | `tables.read`        | No          | Reads one product-scoped row                                                     |
| `create_table_row`  | `tables.write`       | No          | Creates rows with server-side MCP provenance                                     |
| `update_table_row`  | `tables.write`       | No          | Uses changelog-preserving row update RPCs                                        |
| `delete_table_rows` | `tables.delete`      | Yes         | Hard-deletes rows after product-scope verification                               |

OAuth tokens can authorize multiple products. Agents should call `get_context`
first; when multiple `productIds` are returned, every product-scoped tool call
must include the intended `productId`. Static fallback tokens remain
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
