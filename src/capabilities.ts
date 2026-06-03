export const MCP_LEGACY_READ_SCOPE = "mcp:read"
export const MCP_LEGACY_WRITE_SCOPE = "mcp:write"
export const MCP_OFFLINE_ACCESS_SCOPE = "offline_access"

export const MCP_GRANULAR_SCOPES = [
  "mcp:surf_points.read",
  "mcp:surf_points.write",
  "mcp:surf_points.delete",
  "mcp:tables.read",
  "mcp:tables.write",
  "mcp:tables.delete",
] as const

export const MCP_SUPPORTED_SCOPES = [
  MCP_LEGACY_READ_SCOPE,
  MCP_LEGACY_WRITE_SCOPE,
  ...MCP_GRANULAR_SCOPES,
  MCP_OFFLINE_ACCESS_SCOPE,
] as const

export const MCP_RESOURCE_SCOPES = [
  MCP_LEGACY_READ_SCOPE,
  MCP_LEGACY_WRITE_SCOPE,
  ...MCP_GRANULAR_SCOPES,
] as const

export const MCP_DEFAULT_RESOURCE_SCOPES = [
  "mcp:surf_points.read",
  "mcp:surf_points.write",
  "mcp:surf_points.delete",
  "mcp:tables.read",
  "mcp:tables.write",
  "mcp:tables.delete",
] as const

export type McpScope = (typeof MCP_SUPPORTED_SCOPES)[number]

export type McpCapability =
  | "context.read"
  | "surf_points.read"
  | "surf_points.write"
  | "surf_points.delete"
  | "tables.read"
  | "tables.write"
  | "tables.delete"

export type PublicMcpToolName =
  | "get_context"
  | "list_surf_points"
  | "create_surf_point"
  | "update_surf_point"
  | "delete_surf_point"
  | "list_databases"
  | "read_table"
  | "get_table_row"
  | "create_table_row"
  | "update_table_row"
  | "delete_table_rows"

type PublicMcpToolDefinition = {
  title: string
  description: string
  requiredCapability: McpCapability
  surferSurface: string
  publicStatus: "supported"
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const CREATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

const MUTATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

const DELETE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const

export const PUBLIC_MCP_TOOLS = {
  get_context: {
    title: "Get SignalSurf MCP Context",
    description:
      "Return authorized product ids and names, user, role, scopes, and capability context bound to this MCP connection.",
    requiredCapability: "context.read",
    surferSurface: "connection context",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  list_surf_points: {
    title: "List Surf Points",
    description:
      "List SignalSurf surf points for an authorized product. Pass productId when this connection can access multiple products. Soft-deleted rows are never returned; pass includeInactive=false to hide paused surf points.",
    requiredCapability: "surf_points.read",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  create_surf_point: {
    title: "Create Surf Point",
    description:
      "Create a surf point/playbook in an authorized product. Pass productId when this connection can access multiple products, and pass databaseIds when the product has multiple databases.",
    requiredCapability: "surf_points.write",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
  update_surf_point: {
    title: "Update Surf Point",
    description:
      "Modify surf point metadata, prompt fields, target databases, and JSON config for an authorized product. Pass productId when this connection can access multiple products.",
    requiredCapability: "surf_points.write",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  delete_surf_point: {
    title: "Delete Surf Point",
    description:
      "Soft-delete one or more surf points in an authorized product and cancel pending jobs. Pass productId when this connection can access multiple products. This does not hard-delete historical rows.",
    requiredCapability: "surf_points.delete",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: DELETE_ANNOTATIONS,
  },
  list_databases: {
    title: "List Databases",
    description:
      "List databases/tables available in an authorized product. Pass productId when this connection can access multiple products. System databases are hidden unless includeSystem is true.",
    requiredCapability: "tables.read",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  read_table: {
    title: "Read Table",
    description:
      "Read rows from a SignalSurf database/table in an authorized product. Pass productId when this connection can access multiple products. Supports pagination and exact JSON containment filters.",
    requiredCapability: "tables.read",
    surferSurface: "manage_data",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  get_table_row: {
    title: "Get Table Row",
    description:
      "Read one table row by rowId after verifying product scope. Pass productId when this connection can access multiple products.",
    requiredCapability: "tables.read",
    surferSurface: "manage_data",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  create_table_row: {
    title: "Create Table Row",
    description:
      "Create a row/item in a SignalSurf database/table after verifying it belongs to an authorized product. Pass productId when this connection can access multiple products.",
    requiredCapability: "tables.write",
    surferSurface: "manage_data",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
  update_table_row: {
    title: "Update Table Row",
    description:
      "Modify a row/item in an authorized product. Pass productId when this connection can access multiple products. Use dataPatch for shallow field updates or data to replace the row data object.",
    requiredCapability: "tables.write",
    surferSurface: "manage_data",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  delete_table_rows: {
    title: "Delete Table Rows",
    description:
      "Delete one or more table rows/items after verifying every row belongs to an authorized product. Pass productId when this connection can access multiple products.",
    requiredCapability: "tables.delete",
    surferSurface: "manage_data",
    publicStatus: "supported",
    annotations: DELETE_ANNOTATIONS,
  },
} as const satisfies Record<PublicMcpToolName, PublicMcpToolDefinition>

export const PUBLIC_MCP_TOOL_NAMES = Object.keys(
  PUBLIC_MCP_TOOLS
) as PublicMcpToolName[]

const SCOPE_GRANTS: Record<McpScope, readonly McpCapability[]> = {
  [MCP_LEGACY_READ_SCOPE]: ["context.read", "surf_points.read", "tables.read"],
  [MCP_LEGACY_WRITE_SCOPE]: [
    "context.read",
    "surf_points.read",
    "surf_points.write",
    "surf_points.delete",
    "tables.read",
    "tables.write",
    "tables.delete",
  ],
  [MCP_OFFLINE_ACCESS_SCOPE]: [],
  "mcp:surf_points.read": ["context.read", "surf_points.read"],
  "mcp:surf_points.write": [
    "context.read",
    "surf_points.read",
    "surf_points.write",
  ],
  "mcp:surf_points.delete": [
    "context.read",
    "surf_points.read",
    "surf_points.delete",
  ],
  "mcp:tables.read": ["context.read", "tables.read"],
  "mcp:tables.write": ["context.read", "tables.read", "tables.write"],
  "mcp:tables.delete": ["context.read", "tables.read", "tables.delete"],
}

const CAPABILITY_SCOPE_HINTS: Record<McpCapability, readonly string[]> = {
  "context.read": [MCP_LEGACY_READ_SCOPE],
  "surf_points.read": ["mcp:surf_points.read"],
  "surf_points.write": ["mcp:surf_points.write"],
  "surf_points.delete": ["mcp:surf_points.delete"],
  "tables.read": ["mcp:tables.read"],
  "tables.write": ["mcp:tables.write"],
  "tables.delete": ["mcp:tables.delete"],
}

export function parseStoredScopes(scope: string | undefined | null): string[] {
  return scope?.trim() ? scope.trim().split(/\s+/) : []
}

export function isSupportedMcpScope(scope: string): scope is McpScope {
  return (MCP_SUPPORTED_SCOPES as readonly string[]).includes(scope)
}

export function grantedCapabilitiesForScopes(
  scopes: readonly string[]
): McpCapability[] {
  const capabilities = new Set<McpCapability>()
  for (const scope of scopes) {
    if (!isSupportedMcpScope(scope)) continue
    for (const capability of SCOPE_GRANTS[scope]) {
      capabilities.add(capability)
    }
  }
  return [...capabilities]
}

export function scopesGrantCapability(
  scopes: readonly string[],
  capability: McpCapability
): boolean {
  return grantedCapabilitiesForScopes(scopes).includes(capability)
}

export function requiredScopesForCapability(
  capability: McpCapability
): readonly string[] {
  return CAPABILITY_SCOPE_HINTS[capability]
}

export function scopeImpliesWriteAccess(scope: string): boolean {
  if (!isSupportedMcpScope(scope)) return false
  return SCOPE_GRANTS[scope].some((capability) => !capability.endsWith(".read"))
}

export function scopesImplyWriteAccess(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scopeImpliesWriteAccess(scope))
}
