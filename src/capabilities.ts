export const MCP_LEGACY_READ_SCOPE = "mcp:read"
export const MCP_LEGACY_WRITE_SCOPE = "mcp:write"
export const MCP_OFFLINE_ACCESS_SCOPE = "offline_access"

export const MCP_GRANULAR_SCOPES = [
  "mcp:products.write",
  "mcp:surf_points.read",
  "mcp:surf_points.write",
  "mcp:surf_points.execute",
  "mcp:surf_points.delete",
  "mcp:tables.read",
  "mcp:tables.write",
  "mcp:tables.delete",
  "mcp:schemas.read",
  "mcp:schemas.write",
  "mcp:sources.read",
  "mcp:sources.write",
] as const

// account_lists scopes are understood and enforced by this MCP server, but the
// authorization server (www.signalsurf.ai) does not yet register them, so it rejects
// them at the /authorize step ("Unsupported scope") and breaks the whole OAuth flow.
// Keep them in the supported set so existing grants and the mcp:write fallback still
// work, but do NOT advertise or request them by default. Fold these back into
// MCP_RESOURCE_SCOPES and MCP_DEFAULT_RESOURCE_SCOPES once the authorization server
// registers them.
export const MCP_ACCOUNT_LIST_SCOPES = [
  "mcp:account_lists.read",
  "mcp:account_lists.write",
] as const

// deepline scopes follow the same "enforced but NOT advertised" pattern as
// account_lists above: the authorization server does not register them yet, so
// requesting them at /authorize would break OAuth. Keep them supported (so the
// mcp:write fallback grants them) but exclude from the advertised resource
// scopes until the auth server registers them. deepline.read = catalog and
// curated people/company search; deepline.enrich = contact enrichment;
// deepline.execute = arbitrary selected catalog tool execution.
export const MCP_DEEPLINE_SCOPES = [
  "mcp:deepline.read",
  "mcp:deepline.write",
] as const

export const MCP_SUPPORTED_SCOPES = [
  MCP_LEGACY_READ_SCOPE,
  MCP_LEGACY_WRITE_SCOPE,
  ...MCP_GRANULAR_SCOPES,
  ...MCP_ACCOUNT_LIST_SCOPES,
  ...MCP_DEEPLINE_SCOPES,
  MCP_OFFLINE_ACCESS_SCOPE,
] as const

export const MCP_RESOURCE_SCOPES = [
  MCP_LEGACY_READ_SCOPE,
  MCP_LEGACY_WRITE_SCOPE,
  ...MCP_GRANULAR_SCOPES,
] as const

export const MCP_DEFAULT_RESOURCE_SCOPES = [...MCP_GRANULAR_SCOPES] as const

export type McpScope = (typeof MCP_SUPPORTED_SCOPES)[number]

export type McpCapability =
  | "context.read"
  | "products.write"
  | "surf_points.read"
  | "surf_points.write"
  | "surf_points.execute"
  | "surf_points.delete"
  | "tables.read"
  | "tables.write"
  | "tables.delete"
  | "schemas.read"
  | "schemas.write"
  | "sources.read"
  | "sources.write"
  | "account_lists.read"
  | "account_lists.write"
  | "deepline.read"
  | "deepline.enrich"
  | "deepline.execute"

export type PublicMcpToolName =
  | "get_context"
  | "get_brand_context"
  | "get_enrichment_context"
  | "create_product"
  | "list_surf_points"
  | "get_surf_point"
  | "create_surf_point"
  | "update_surf_point"
  | "run_surf_point"
  | "get_surf_job"
  | "wait_for_surf_job"
  | "list_surf_jobs"
  | "cancel_surf_job"
  | "delete_surf_point"
  | "list_tables"
  | "create_table"
  | "update_table"
  | "delete_table"
  | "list_table_views"
  | "read_table"
  | "read_table_view"
  | "get_table_row"
  | "create_table_row"
  | "update_table_row"
  | "delete_table_rows"
  | "list_table_fields"
  | "add_table_field"
  | "update_table_field"
  | "remove_table_field"
  | "create_relation_field"
  | "list_signals"
  | "create_signal"
  | "update_signal"
  | "delete_signal"
  | "enable_quick_surf"
  | "disable_quick_surf"
  | "list_quick_surf"
  | "run_quick_surf"
  | "list_product_tools"
  | "list_surf_point_tools"
  | "deepline_search_people"
  | "deepline_search_companies"
  | "deepline_enrich_contact"
  | "deepline_search_catalog"
  | "deepline_execute_tool"

type PublicMcpToolDefinition = {
  title: string
  description: string
  requiredCapability: McpCapability
  requiredCapabilities?: readonly McpCapability[]
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

const EXTERNAL_READ_ANNOTATIONS = {
  ...READ_ANNOTATIONS,
  openWorldHint: true,
} as const

const EXTERNAL_CREATE_ANNOTATIONS = {
  ...CREATE_ANNOTATIONS,
  openWorldHint: true,
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
  get_brand_context: {
    title: "Get Brand Context",
    description:
      "Read the active product's brand and positioning context: brand name, brand description, product description, product categories, selling points, target audience, competitors, and official website. Pass productId when this connection can access multiple products. Returns empty fields when the product has not completed brand setup.",
    requiredCapability: "context.read",
    surferSurface: "connection context",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  get_enrichment_context: {
    title: "Get Enrichment Context",
    description:
      "Bundle everything an agent needs before filling or enriching a table column: brand/positioning context, the table schema (fields, types, options, entry key, relations), the most popular existing values per tag/array field, and SignalSurf field conventions. Call this before writing whatToDo for enable_quick_surf or before manual row edits. Pass productId when this connection can access multiple products; pass fieldKey to scope popular values to one column.",
    requiredCapability: "tables.read",
    surferSurface: "enrichment context",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  create_product: {
    title: "Create Product",
    description:
      "Create a new SignalSurf product for the authenticated user and expand the active hosted OAuth grant so the product can be used by follow-up MCP tool calls.",
    requiredCapability: "products.write",
    surferSurface: "product setup",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
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
  get_surf_point: {
    title: "Get Surf Point",
    description:
      "Read one SignalSurf surf point after verifying it belongs to an authorized product.",
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
      "Modify surf point metadata, prompt fields, target tables, and JSON config for an authorized product. To attach or detach product integration tools, set toolConfigPatch.auto_tool_ids using tool ids from list_product_tools/list_surf_point_tools (shallow-merged). Pass productId when this connection can access multiple products.",
    requiredCapability: "surf_points.write",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  run_surf_point: {
    title: "Run Surf Point",
    description:
      "Queue an authorized surf point for execution by creating a pending SignalSurf surf job. Pass productId when this connection can access multiple products.",
    requiredCapability: "surf_points.execute",
    surferSurface: "run_surf_point",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
  get_surf_job: {
    title: "Get Surf Job",
    description:
      "Read one SignalSurf surf job after verifying the job belongs to a surf point in an authorized product.",
    requiredCapability: "surf_points.read",
    surferSurface: "run_surf_point",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  wait_for_surf_job: {
    title: "Wait For Surf Job",
    description:
      "Poll one SignalSurf surf job until it leaves an active status or the timeout expires.",
    requiredCapability: "surf_points.read",
    surferSurface: "run_surf_point",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  list_surf_jobs: {
    title: "List Surf Jobs",
    description:
      "List SignalSurf surf jobs for an authorized product, optionally filtered by surfPointId or status.",
    requiredCapability: "surf_points.read",
    surferSurface: "run_surf_point",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  cancel_surf_job: {
    title: "Cancel Surf Job",
    description:
      "Cancel a pending SignalSurf surf job after verifying it belongs to an authorized product.",
    requiredCapability: "surf_points.execute",
    surferSurface: "run_surf_point",
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
  list_tables: {
    title: "List Tables",
    description:
      "List tables available in an authorized product. Pass productId when this connection can access multiple products. System tables are hidden unless includeSystem is true.",
    requiredCapability: "tables.read",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  create_table: {
    title: "Create Table",
    description:
      "Create a SignalSurf table with optional custom schema, saved-view config, and folder placement in an authorized product.",
    requiredCapability: "schemas.write",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
  update_table: {
    title: "Update Table",
    description:
      "Update SignalSurf table metadata, custom schema, saved-view config, and folder placement after product-scope verification.",
    requiredCapability: "schemas.write",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  delete_table: {
    title: "Delete Table",
    description:
      "Delete one or more user-facing SignalSurf tables after product-scope verification, then unlink the deleted table ids from active Surf Points. Pass productId when this connection can access multiple products.",
    requiredCapability: "tables.delete",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: DELETE_ANNOTATIONS,
  },
  list_table_views: {
    title: "List Table Views",
    description:
      "List saved views configured for a SignalSurf table in an authorized product.",
    requiredCapability: "tables.read",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  read_table: {
    title: "Read Table",
    description:
      "Read rows from a SignalSurf table in an authorized product. Pass productId when this connection can access multiple products. Supports pagination, JSON containment filters, and UI-style data filters/sorts.",
    requiredCapability: "tables.read",
    surferSurface: "manage_data",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  read_table_view: {
    title: "Read Table View",
    description:
      "Read rows using a table saved view, with optional additional filters and sorts.",
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
      "Create a row/item in a SignalSurf table after verifying it belongs to an authorized product. Pass productId when this connection can access multiple products.",
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
  list_table_fields: {
    title: "List Table Fields",
    description:
      "List schema fields and relation definitions for an authorized SignalSurf table.",
    requiredCapability: "schemas.read",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  add_table_field: {
    title: "Add Table Field",
    description:
      "Add one schema field to an authorized SignalSurf table. This changes schema only; existing row data is not backfilled.",
    requiredCapability: "schemas.write",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  update_table_field: {
    title: "Update Table Field",
    description:
      "Patch one schema field in an authorized SignalSurf table.",
    requiredCapability: "schemas.write",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  remove_table_field: {
    title: "Remove Table Field",
    description:
      "Remove one schema field from an authorized SignalSurf table. This changes schema only and does not delete row data.",
    requiredCapability: "schemas.write",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  create_relation_field: {
    title: "Create Relation Field",
    description:
      "Create an item_ref relation field from one authorized table to another product-owned table.",
    requiredCapability: "schemas.write",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  list_signals: {
    title: "List Signals",
    description:
      "List safe signal metadata for an authorized surf point. Signal config and credentials are not exposed.",
    requiredCapability: "sources.read",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  create_signal: {
    title: "Create Signal",
    description:
      "Create a SignalSurf signal for an authorized surf point. Supports platform, custom-pull, RSS, webhook, web-monitor, GitHub, CoinGecko, Hacker News, Product Hunt, and the four exclusive internal trigger types. Webhook signals return the callable SignalSurf webhookUrl.",
    requiredCapability: "sources.write",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
  update_signal: {
    title: "Update Signal",
    description:
      "Update one signal after verifying its surf point belongs to an authorized product. Supports signal name, active state (enable/pause via isActive), typed config rebuilds, and safe pull_config/metadata/data_schema replacements or shallow patches.",
    requiredCapability: "sources.write",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  delete_signal: {
    title: "Delete Signal",
    description:
      "Hard-delete one or more signals after product-scope validation and remove non-terminal jobs for those signal ids.",
    requiredCapability: "sources.write",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: DELETE_ANNOTATIONS,
  },
  list_product_tools: {
    title: "List Product Tools",
    description:
      "List safe product tool metadata that can be attached to surf points. Tool config secrets are not exposed.",
    requiredCapability: "surf_points.read",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  list_surf_point_tools: {
    title: "List Surf Point Tools",
    description:
      "List tool ids attached to a surf point through toolConfig.auto_tool_ids.",
    requiredCapability: "surf_points.read",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  deepline_search_people: {
    title: "Search People via Deepline",
    description:
      "Search people through Deepline's Apollo people search for an authorized product. Pass `filters` using Apollo's accepted fields (person_titles, include_similar_titles, person_seniorities, person_locations, organization_locations, organization_num_employees_ranges as ['11,50'], q_keywords, contact_email_status) plus optional limit. Returns preview rows + match counts; emails require the separate enrich step. Requires a Deepline integration key on the product.",
    requiredCapability: "deepline.read",
    surferSurface: "account_list_icp_builder",
    publicStatus: "supported",
    annotations: EXTERNAL_READ_ANNOTATIONS,
  },
  deepline_search_companies: {
    title: "Search Companies via Deepline",
    description:
      "Search companies through Deepline's Apollo company search for an authorized product. Pass `filters` using Apollo's accepted fields (q_organization_keyword_tags, q_organization_name, q_organization_domains_list, organization_locations, organization_not_locations, organization_num_employees_ranges as ['11,50']) plus optional limit. Requires a Deepline integration key on the product.",
    requiredCapability: "deepline.read",
    surferSurface: "account_list_icp_builder",
    publicStatus: "supported",
    annotations: EXTERNAL_READ_ANNOTATIONS,
  },
  deepline_enrich_contact: {
    title: "Find a Contact Email via Deepline",
    description:
      "Find a verified work email for a person via Deepline (leadmagic email finder). Requires firstName + lastName and at least one of domain / companyName. Spends Deepline credits ONLY on a hit (misses are free). Requires a Deepline integration key on the product.",
    requiredCapability: "deepline.enrich",
    surferSurface: "account_list_icp_builder",
    publicStatus: "supported",
    annotations: EXTERNAL_CREATE_ANNOTATIONS,
  },
  deepline_search_catalog: {
    title: "Search Deepline Tool Catalog",
    description:
      "Search Deepline's live v2 tool catalog for an authorized product to discover provider tool ids before execution. An empty query returns the first tools in the catalog. Requires a Deepline integration key on the product.",
    requiredCapability: "deepline.read",
    surferSurface: "deepline",
    publicStatus: "supported",
    annotations: EXTERNAL_READ_ANNOTATIONS,
  },
  deepline_execute_tool: {
    title: "Execute Deepline Tool",
    description:
      "Execute a selected Deepline v2 tool id with a JSON payload for an authorized product. Use deepline_search_catalog first unless the tool id is already known. May spend Deepline credits depending on the provider and result. Requires a Deepline integration key on the product.",
    requiredCapability: "deepline.execute",
    surferSurface: "deepline",
    publicStatus: "supported",
    annotations: EXTERNAL_CREATE_ANNOTATIONS,
  },
  enable_quick_surf: {
    title: "Enable Quick Surf",
    description:
      "Enable Quick Surf on one table column: bind a hidden surf point + manual-trigger source to (databaseId, fieldKey) with a 'what to do' instruction the brain uses to fill that single column from each row's context. Optionally pass auto ('on_created' to auto-fill new rows, 'off' to clear auto-fill) and runCondition for the column's 'only run if' gate. Re-enabling an off column restores it and updates the instruction. Pass productId when this connection can access multiple products.",
    requiredCapability: "sources.write",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  disable_quick_surf: {
    title: "Disable Quick Surf",
    description:
      "Turn off Quick Surf for a column without deleting it — the 'what to do' instruction is kept so re-enabling restores it.",
    requiredCapability: "sources.write",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  list_quick_surf: {
    title: "List Quick Surf",
    description:
      "List the columns in a database that have Quick Surf enabled, each with its 'what to do' instruction and bound surf point id.",
    requiredCapability: "sources.read",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  run_quick_surf: {
    title: "Run Quick Surf",
    description:
      "Queue Quick Surf enrichment for a column. Pass exactly one mode: scope ('first10' | 'first100' | 'all', capped at 1000 rows) to backfill across rows, entryIds for a specific row subset, or entryId for a single cell. Column/subset runs apply the persisted runCondition gate before queueing and return queued, skipped, rawSignalIds, jobs, and touched entryIds. Poll with list_surf_jobs / wait_for_surf_job. Credits are charged by the brain as each job runs.",
    requiredCapability: "surf_points.execute",
    surferSurface: "manage_surf_points",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
} as const satisfies Record<PublicMcpToolName, PublicMcpToolDefinition>

export const PUBLIC_MCP_TOOL_NAMES = Object.keys(
  PUBLIC_MCP_TOOLS
) as PublicMcpToolName[]

export function requiredCapabilitiesForTool(
  toolName: PublicMcpToolName
): readonly McpCapability[] {
  const definition: PublicMcpToolDefinition = PUBLIC_MCP_TOOLS[toolName]
  return definition.requiredCapabilities ?? [definition.requiredCapability]
}

const SCOPE_GRANTS: Record<McpScope, readonly McpCapability[]> = {
  [MCP_LEGACY_READ_SCOPE]: [
    "context.read",
    "surf_points.read",
    "tables.read",
    "schemas.read",
    "sources.read",
    "account_lists.read",
    "deepline.read",
  ],
  [MCP_LEGACY_WRITE_SCOPE]: [
    "context.read",
    "products.write",
    "surf_points.read",
    "surf_points.write",
    "surf_points.execute",
    "surf_points.delete",
    "tables.read",
    "tables.write",
    "tables.delete",
    "schemas.read",
    "schemas.write",
    "sources.read",
    "sources.write",
    "account_lists.read",
    "account_lists.write",
    "deepline.read",
    "deepline.enrich",
    "deepline.execute",
  ],
  [MCP_OFFLINE_ACCESS_SCOPE]: [],
  "mcp:products.write": ["context.read", "products.write"],
  "mcp:surf_points.read": ["context.read", "surf_points.read"],
  "mcp:surf_points.write": [
    "context.read",
    "surf_points.read",
    "surf_points.write",
  ],
  "mcp:surf_points.execute": [
    "context.read",
    "surf_points.read",
    "surf_points.execute",
  ],
  "mcp:surf_points.delete": [
    "context.read",
    "surf_points.read",
    "surf_points.delete",
  ],
  "mcp:tables.read": ["context.read", "tables.read"],
  "mcp:tables.write": ["context.read", "tables.read", "tables.write"],
  "mcp:tables.delete": ["context.read", "tables.read", "tables.delete"],
  "mcp:schemas.read": ["context.read", "schemas.read"],
  "mcp:schemas.write": ["context.read", "schemas.read", "schemas.write"],
  "mcp:sources.read": ["context.read", "sources.read"],
  "mcp:sources.write": ["context.read", "sources.read", "sources.write"],
  "mcp:account_lists.read": ["context.read", "account_lists.read"],
  "mcp:account_lists.write": [
    "context.read",
    "account_lists.read",
    "account_lists.write",
  ],
  "mcp:deepline.read": ["context.read", "deepline.read"],
  "mcp:deepline.write": [
    "context.read",
    "deepline.read",
    "deepline.enrich",
    "deepline.execute",
  ],
}

const CAPABILITY_SCOPE_HINTS: Record<McpCapability, readonly string[]> = {
  "context.read": [MCP_LEGACY_READ_SCOPE],
  "products.write": ["mcp:products.write"],
  "surf_points.read": ["mcp:surf_points.read"],
  "surf_points.write": ["mcp:surf_points.write"],
  "surf_points.execute": ["mcp:surf_points.execute"],
  "surf_points.delete": ["mcp:surf_points.delete"],
  "tables.read": ["mcp:tables.read"],
  "tables.write": ["mcp:tables.write"],
  "tables.delete": ["mcp:tables.delete"],
  "schemas.read": ["mcp:schemas.read"],
  "schemas.write": ["mcp:schemas.write"],
  "sources.read": ["mcp:sources.read"],
  "sources.write": ["mcp:sources.write"],
  "account_lists.read": ["mcp:account_lists.read"],
  "account_lists.write": ["mcp:account_lists.write"],
  "deepline.read": ["mcp:deepline.read"],
  "deepline.enrich": ["mcp:deepline.write"],
  "deepline.execute": ["mcp:deepline.write"],
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
