export const MCP_LEGACY_READ_SCOPE = "mcp:read"
export const MCP_LEGACY_WRITE_SCOPE = "mcp:write"
export const MCP_OFFLINE_ACCESS_SCOPE = "offline_access"

export const MCP_GRANULAR_SCOPES = [
  "mcp:products.write",
  "mcp:workflows.read",
  "mcp:workflows.write",
  "mcp:workflows.execute",
  "mcp:workflows.delete",
  "mcp:tables.read",
  "mcp:tables.write",
  "mcp:tables.delete",
  "mcp:schemas.read",
  "mcp:schemas.write",
  "mcp:sources.read",
  "mcp:sources.write",
  "mcp:creator_discovery.read",
  "mcp:deepline.read",
  "mcp:deepline.enrich",
  "mcp:deepline.execute",
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

// The old combined write scope remains accepted but is not advertised. New
// grants split paid enrichment from open-ended provider execution.
export const MCP_DEEPLINE_LEGACY_SCOPES = ["mcp:deepline.write"] as const

export const MCP_SUPPORTED_SCOPES = [
  MCP_LEGACY_READ_SCOPE,
  MCP_LEGACY_WRITE_SCOPE,
  ...MCP_GRANULAR_SCOPES,
  ...MCP_ACCOUNT_LIST_SCOPES,
  ...MCP_DEEPLINE_LEGACY_SCOPES,
  MCP_OFFLINE_ACCESS_SCOPE,
] as const

export const MCP_RESOURCE_SCOPES = [
  MCP_LEGACY_READ_SCOPE,
  MCP_LEGACY_WRITE_SCOPE,
  ...MCP_GRANULAR_SCOPES,
] as const

export const MCP_DEFAULT_RESOURCE_SCOPES = MCP_GRANULAR_SCOPES.filter(
  (scope) => scope !== "mcp:deepline.enrich" && scope !== "mcp:deepline.execute"
)

export type McpScope = (typeof MCP_SUPPORTED_SCOPES)[number]

export type McpCapability =
  | "context.read"
  | "products.write"
  | "workflows.read"
  | "workflows.write"
  | "workflows.execute"
  | "workflows.delete"
  | "campaigns.write"
  | "tables.read"
  | "tables.write"
  | "tables.delete"
  | "schemas.read"
  | "schemas.write"
  | "sources.read"
  | "sources.write"
  | "account_lists.read"
  | "account_lists.write"
  | "creator_discovery.read"
  | "deepline.read"
  | "deepline.enrich"
  | "deepline.execute"

export type PublicMcpToolName =
  | "get_context"
  | "get_brand_context"
  | "get_enrichment_context"
  | "find_capabilities"
  | "create_product"
  | "list_workflows"
  | "get_workflow"
  | "create_workflow"
  | "update_workflow"
  | "run_workflow"
  | "get_surf_job"
  | "wait_for_surf_job"
  | "list_surf_jobs"
  | "cancel_surf_job"
  | "delete_workflow"
  | "describe_node_types"
  | "edit_workflow_flows"
  | "get_node_upstream_context"
  | "create_campaign"
  | "test_workflow_node"
  | "list_tables"
  | "create_table"
  | "update_table"
  | "delete_table"
  | "list_table_views"
  | "read_table"
  | "read_table_view"
  | "get_table_row"
  | "create_table_row"
  | "update_table_rows"
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
  | "enable_enrich"
  | "disable_enrich"
  | "list_enrich"
  | "run_enrich"
  | "list_product_tools"
  | "list_workflow_tools"
  | "search_instagram_content"
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
      "Bundle everything an agent needs before filling or enriching a table column: brand/positioning context, the table schema (fields, types, options, entry key, relations), the most popular existing values per tag/array field, and SignalSurf field conventions. Call this before writing whatToDo for enable_enrich or before manual row edits. Pass productId when this connection can access multiple products; pass fieldKey to scope popular values to one column.",
    requiredCapability: "tables.read",
    surferSurface: "enrichment context",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  find_capabilities: {
    title: "Find Capabilities",
    description:
      'Search this MCP\'s tools and guided prompts by intent (e.g. "enrich a table", "find leads", "set up a Workflow") instead of scanning the whole tool list. Returns the best-matching tools and prompts (filtered to what your token can use) plus a hint on how to proceed. Start here when you are unsure which tool or prompt fits the task. Pass an empty query to see the available guided workflows.',
    requiredCapability: "context.read",
    surferSurface: "tool discovery",
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
  list_workflows: {
    title: "List Workflows",
    description:
      "List SignalSurf Workflows for an authorized product. Pass productId when this connection can access multiple products. Soft-deleted rows are never returned; pass includeInactive=false to hide paused Workflows.",
    requiredCapability: "workflows.read",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  get_workflow: {
    title: "Get Workflow",
    description:
      "Read one SignalSurf Workflow after verifying it belongs to an authorized product.",
    requiredCapability: "workflows.read",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  create_workflow: {
    title: "Create Workflow",
    description:
      "Create a Workflow in an authorized product. Pass productId when this connection can access multiple products, projectId to place it in an existing Project, and databaseIds when the product has multiple databases.",
    requiredCapability: "workflows.write",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
  update_workflow: {
    title: "Update Workflow",
    description:
      "Modify Workflow metadata, Project placement, prompt fields, target tables, and JSON config for an authorized product. To attach or detach product integration tools, set toolConfigPatch.auto_tool_ids using tool ids from list_product_tools/list_workflow_tools (shallow-merged). Pass productId when this connection can access multiple products.",
    requiredCapability: "workflows.write",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  run_workflow: {
    title: "Run Workflow",
    description:
      "Queue an authorized Workflow for execution by creating a pending SignalSurf surf job. Pass productId when this connection can access multiple products.",
    requiredCapability: "workflows.execute",
    surferSurface: "run_workflow",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
  get_surf_job: {
    title: "Get Surf Job",
    description:
      "Read one SignalSurf surf job after verifying the job belongs to a Workflow in an authorized product.",
    requiredCapability: "workflows.read",
    surferSurface: "run_workflow",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  wait_for_surf_job: {
    title: "Wait For Surf Job",
    description:
      "Poll one SignalSurf surf job until it leaves an active status or the timeout expires.",
    requiredCapability: "workflows.read",
    surferSurface: "run_workflow",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  list_surf_jobs: {
    title: "List Surf Jobs",
    description:
      "List SignalSurf surf jobs for an authorized product, optionally filtered by workflowId or status.",
    requiredCapability: "workflows.read",
    surferSurface: "run_workflow",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  cancel_surf_job: {
    title: "Cancel Surf Job",
    description:
      "Cancel a pending SignalSurf surf job after verifying it belongs to an authorized product.",
    requiredCapability: "workflows.execute",
    surferSurface: "run_workflow",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  delete_workflow: {
    title: "Delete Workflow",
    description:
      "Soft-delete one or more Workflows in an authorized product and cancel pending jobs. Pass productId when this connection can access multiple products. This does not hard-delete historical rows.",
    requiredCapability: "workflows.delete",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: DELETE_ANNOTATIONS,
  },
  describe_node_types: {
    title: "Describe Flow Node Types",
    description:
      "List the Workflow Flow V2 node types (trigger, rule, agent, action, wait, sequence), their fields, and the legal edge conditions. A Workflow is now a node graph (DAG); call this before building or editing a flow so you shape nodes and wire edges correctly. No args.",
    requiredCapability: "workflows.read",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  edit_workflow_flows: {
    title: "Edit Workflow Flows",
    description:
      "Edit the Flows inside one Workflow in a single atomic call. Input { workflowId, edits }. A disconnected Node chain becomes its own Flow; connected Nodes remain in the same Flow. edits is an ordered list of ops: {op:'add_node', ref?, node}, {op:'connect', source, target, condition?}, {op:'update_node', nodeId, patch}, {op:'remove_node', nodeId}, {op:'remove_edge', edgeId}. If any edit is invalid, the whole batch is rejected.",
    requiredCapability: "workflows.write",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  get_node_upstream_context: {
    title: "Get Node Upstream Context",
    description:
      "Resolve what data is in scope at a flow node before you configure it: the upstream node chain, upstream triggers and their sources, upstream agent write targets (databaseId + columns), this node's own target-table columns (for create_row/object_sink), and signal fields you can reference as {{signal.<field>}}. Always call this before mapping a create_row/object_sink node's fields. Input { workflowId, nodeId }.",
    requiredCapability: "workflows.read",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  create_campaign: {
    title: "Create Campaign",
    description:
      "Create a first-class draft cold-email Campaign for a Table or Object audience. Input { name, goal, description?, audienceDatabaseId, recipientField?, mailbox, steps:[{copy, delayDays?, gate?}] }. You MUST pass mailbox (a connected Unipile email account id). The Campaign is independent from Workflows and does not enroll contacts automatically.",
    requiredCapability: "campaigns.write",
    surferSurface: "manage_campaigns",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  test_workflow_node: {
    title: "Test Workflow Node",
    description:
      "Dry-run one flow node via the surf-flow-debug runner (no commit). Input { workflowId, nodeId, sampleText? }. Returns the node result (rule pass/fail + score, classify branch, or an agent's proposed writes). Requires the surf-flow-debug edge function to be reachable from this deployment.",
    requiredCapability: "workflows.read",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
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
      "Create a SignalSurf table from the canonical outbound_accounts or contacts template, or with an optional custom schema, saved-view config, and folder placement. During creation, template schemas preserve required field types while accepting additive fields.",
    requiredCapability: "schemas.write",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
  update_table: {
    title: "Update Table",
    description:
      "Update SignalSurf table metadata, custom schema, saved-view config, and folder placement after product-scope verification. Pass template to upgrade a compatible existing table to the canonical outbound_accounts or contacts baseline while preserving additive custom fields.",
    requiredCapability: "schemas.write",
    surferSurface: "manage_projects/manage_databases",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  delete_table: {
    title: "Delete Table",
    description:
      "Delete one or more user-facing SignalSurf tables after product-scope verification, then unlink the deleted table ids from active Workflows. Pass productId when this connection can access multiple products.",
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
  update_table_rows: {
    title: "Update Table Rows",
    description:
      "Modify one or more rows/items in an authorized product in a single call — always pass `edits` as an array, length 1 for a single row, N to apply distinct edits to several rows at once (e.g. after enrichment); one atomic write for the data/dataPatch part. Input { productId, edits }. Each edit is { rowId, databaseId?, data?, dataPatch?, note?, workflowId? } — use dataPatch for shallow field updates or data to replace the row's data object (exactly one of the two), note to set the row's note, workflowId to reassign its Workflow, and databaseId as an optional ownership check. rowIds must be unique. If any rowId is not found/authorized or any edit is invalid, the whole call is rejected and nothing is written.",
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
    description: "Patch one schema field in an authorized SignalSurf table.",
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
      "List safe signal metadata for an authorized Workflow. Signal config and credentials are not exposed.",
    requiredCapability: "sources.read",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  create_signal: {
    title: "Create Signal",
    description:
      "Create a SignalSurf signal for an authorized Workflow. Supports platform, custom-pull, RSS, webhook, web-monitor, GitHub, CoinGecko, Hacker News, Product Hunt, and the four exclusive internal trigger types. Webhook signals return the callable SignalSurf webhookUrl.",
    requiredCapability: "sources.write",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: CREATE_ANNOTATIONS,
  },
  update_signal: {
    title: "Update Signal",
    description:
      "Update one signal after verifying its Workflow belongs to an authorized product. Supports signal name, active state (enable/pause via isActive), typed config rebuilds, and safe pull_config/metadata/data_schema replacements or shallow patches.",
    requiredCapability: "sources.write",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  delete_signal: {
    title: "Delete Signal",
    description:
      "Hard-delete one or more signals after product-scope validation and remove non-terminal jobs for those signal ids.",
    requiredCapability: "sources.write",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: DELETE_ANNOTATIONS,
  },
  list_product_tools: {
    title: "List Product Tools",
    description:
      "List safe product tool metadata that can be attached to Workflows. Tool config secrets are not exposed.",
    requiredCapability: "workflows.read",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  list_workflow_tools: {
    title: "List Workflow Tools",
    description:
      "List tool ids attached to a Workflow through toolConfig.auto_tool_ids.",
    requiredCapability: "workflows.read",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  deepline_search_people: {
    title: "Search People via Deepline",
    description:
      "Search people through Deepline's managed Crustdata V3 search for an authorized product after consuming an exact, unexpired one-time Web approval. Pass provider-neutral nested people/company filters or the backward-compatible Apollo-shaped names (person_titles, person_seniorities, person_locations, organization_locations, organization_num_employees_ranges, contact_email_status). Apollo remains an explicit BYOC deployment override. Returns preview rows + match counts; emails require the separate enrich step.",
    requiredCapability: "deepline.read",
    surferSurface: "account_list_icp_builder",
    publicStatus: "supported",
    annotations: EXTERNAL_READ_ANNOTATIONS,
  },
  search_instagram_content: {
    title: "Search Instagram Public Content",
    description:
      "Search the broader public Instagram post corpus for an authorized product after consuming an exact, unexpired one-time Web approval. Returns post evidence plus deduplicated creator accounts. Costs three SignalSurf credits per requested page. This is a separate discovery lane and is never used as a fallback for Instagram Reels Search.",
    requiredCapability: "creator_discovery.read",
    surferSurface: "creator_discovery",
    publicStatus: "supported",
    annotations: EXTERNAL_READ_ANNOTATIONS,
  },
  deepline_search_companies: {
    title: "Search Companies via Deepline",
    description:
      "Search companies through Deepline's managed Crustdata V3 search for an authorized product after consuming an exact, unexpired one-time Web approval. Pass provider-neutral company filters or the backward-compatible Apollo-shaped names (q_organization_keyword_tags, q_organization_domains_list, organization_locations, organization_not_locations, organization_num_employees_ranges); funding_stages is also supported. Apollo remains an explicit BYOC deployment override.",
    requiredCapability: "deepline.read",
    surferSurface: "account_list_icp_builder",
    publicStatus: "supported",
    annotations: EXTERNAL_READ_ANNOTATIONS,
  },
  deepline_enrich_contact: {
    title: "Find a Contact Email via Deepline",
    description:
      "Find a verified work email for a person via Deepline (leadmagic email finder) after consuming an exact, unexpired one-time Web approval. Requires firstName + lastName and at least one of domain / companyName. Spends Deepline credits ONLY on a hit (misses are free). Requires a Deepline integration key on the product.",
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
      "Execute a selected Deepline v2 tool id with a JSON payload for an authorized product. Requires an approved, unexpired, one-time action request bound to the active OAuth grant, product, tool id, and exact payload. Use deepline_search_catalog first unless the tool id is already known. May spend Deepline credits depending on the provider and result. Requires a Deepline integration key on the product.",
    requiredCapability: "deepline.execute",
    surferSurface: "deepline",
    publicStatus: "supported",
    annotations: EXTERNAL_CREATE_ANNOTATIONS,
  },
  enable_enrich: {
    title: "Enable Enrich",
    description:
      "Enable Enrich on one table column: bind a hidden Workflow + manual-trigger source to (databaseId, fieldKey) with a 'what to do' instruction the brain uses to fill that single column from each row's context. Optionally pass auto ('on_created' to auto-fill new rows, 'off' to clear auto-fill) and runCondition for the column's 'only run if' gate. Re-enabling an off column restores it and updates the instruction. Pass productId when this connection can access multiple products.",
    requiredCapability: "sources.write",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  disable_enrich: {
    title: "Disable Enrich",
    description:
      "Turn off Enrich for a column without deleting it — the 'what to do' instruction is kept so re-enabling restores it.",
    requiredCapability: "sources.write",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: MUTATE_ANNOTATIONS,
  },
  list_enrich: {
    title: "List Enrich",
    description:
      "List the columns in a database that have Enrich enabled, each with its 'what to do' instruction and bound Workflow id.",
    requiredCapability: "sources.read",
    surferSurface: "manage_workflows",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
  run_enrich: {
    title: "Run Enrich",
    description:
      "Queue Enrich for a column. Pass exactly one mode: scope ('first10' | 'first100' | 'all', capped at 1000 rows) to backfill across rows, entryIds for a specific row subset, or entryId for a single cell. Populated cells are skipped by default and reported as skippedExisting; pass overwriteExisting=true only with explicit user consent to refresh them. Column/subset runs also apply the persisted runCondition gate. Poll returned jobs with list_surf_jobs / wait_for_surf_job. Credits are charged by the brain as each job runs.",
    requiredCapability: "workflows.execute",
    surferSurface: "manage_workflows",
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
    "workflows.read",
    "tables.read",
    "schemas.read",
    "sources.read",
    "account_lists.read",
    "creator_discovery.read",
    "deepline.read",
  ],
  [MCP_LEGACY_WRITE_SCOPE]: [
    "context.read",
    "products.write",
    "workflows.read",
    "workflows.write",
    "workflows.execute",
    "workflows.delete",
    "campaigns.write",
    "tables.read",
    "tables.write",
    "tables.delete",
    "schemas.read",
    "schemas.write",
    "sources.read",
    "sources.write",
    "account_lists.read",
    "account_lists.write",
    "creator_discovery.read",
    "deepline.read",
    "deepline.enrich",
    "deepline.execute",
  ],
  [MCP_OFFLINE_ACCESS_SCOPE]: [],
  "mcp:products.write": ["context.read", "products.write"],
  "mcp:workflows.read": ["context.read", "workflows.read"],
  "mcp:workflows.write": [
    "context.read",
    "workflows.read",
    "workflows.write",
    "campaigns.write",
  ],
  "mcp:workflows.execute": [
    "context.read",
    "workflows.read",
    "workflows.execute",
  ],
  "mcp:workflows.delete": [
    "context.read",
    "workflows.read",
    "workflows.delete",
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
  "mcp:creator_discovery.read": ["context.read", "creator_discovery.read"],
  "mcp:deepline.read": ["context.read", "deepline.read"],
  "mcp:deepline.enrich": ["context.read", "deepline.read", "deepline.enrich"],
  "mcp:deepline.execute": ["context.read", "deepline.read", "deepline.execute"],
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
  "workflows.read": ["mcp:workflows.read"],
  "workflows.write": ["mcp:workflows.write"],
  "workflows.execute": ["mcp:workflows.execute"],
  "workflows.delete": ["mcp:workflows.delete"],
  "campaigns.write": ["mcp:workflows.write"],
  "tables.read": ["mcp:tables.read"],
  "tables.write": ["mcp:tables.write"],
  "tables.delete": ["mcp:tables.delete"],
  "schemas.read": ["mcp:schemas.read"],
  "schemas.write": ["mcp:schemas.write"],
  "sources.read": ["mcp:sources.read"],
  "sources.write": ["mcp:sources.write"],
  "account_lists.read": ["mcp:account_lists.read"],
  "account_lists.write": ["mcp:account_lists.write"],
  "creator_discovery.read": ["mcp:creator_discovery.read"],
  "deepline.read": ["mcp:deepline.read"],
  "deepline.enrich": ["mcp:deepline.enrich"],
  "deepline.execute": ["mcp:deepline.execute"],
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
