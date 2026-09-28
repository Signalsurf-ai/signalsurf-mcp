export const MCP_OFFLINE_ACCESS_SCOPE = "offline_access"
export const MCP_LEGACY_READ_SCOPE = "mcp:read"
export const MCP_LEGACY_WRITE_SCOPE = "mcp:write"

/**
 * Broad OAuth grants predate the granular tool catalog. Every execution
 * boundary must expand them the same way so discovery and execution agree.
 */
export function signalSurfScopesGrantRequiredScope(
  scopes: readonly string[],
  requiredScope: string
): boolean {
  if (scopes.includes(requiredScope)) return true
  if (scopes.includes(MCP_LEGACY_WRITE_SCOPE)) return true
  return (
    scopes.includes(MCP_LEGACY_READ_SCOPE) && requiredScope.endsWith(".read")
  )
}

export const MCP_PROJECT_SCOPES = [
  "mcp:projects.read",
  "mcp:projects.write",
] as const

export const MCP_CONVERSATION_SCOPES = [
  "mcp:conversations.read",
  "mcp:conversations.control",
] as const

export const MCP_COLLABORATION_SCOPES = [
  ...MCP_PROJECT_SCOPES,
  ...MCP_CONVERSATION_SCOPES,
] as const

export type SignalSurfWebMcpScope =
  | (typeof MCP_PROJECT_SCOPES)[number]
  | (typeof MCP_CONVERSATION_SCOPES)[number]
  | "mcp:sources.read"
  | "mcp:sources.write"
  | "mcp:tables.read"
  | "mcp:objects.read"
  | "mcp:objects.write"
  | "mcp:records.read"
  | "mcp:records.write"
  | "mcp:lists.read"
  | "mcp:lists.write"

export const SIGNALSURF_WEB_MCP_TOOL_SCOPES = {
  // Workspace selection/authority is safe bootstrap context for every
  // authenticated grant, including a deliberately CRM-only connection.
  list_workspaces: [],
  list_projects: ["mcp:projects.read"],
  get_project: ["mcp:projects.read"],
  get_project_context: ["mcp:projects.read", "mcp:conversations.read"],
  list_activity: ["mcp:conversations.read"],
  list_activity_threads: ["mcp:conversations.read"],
  mark_activity_read: ["mcp:conversations.control"],
  list_threads: ["mcp:conversations.read"],
  read_thread: ["mcp:conversations.read"],
  wait_for_thread_response: ["mcp:conversations.read"],
  list_thread_decisions: ["mcp:conversations.read"],
  list_project_members: ["mcp:projects.read"],
  list_project_files: ["mcp:projects.read"],
  read_project_file: ["mcp:projects.read"],
  list_project_triggers: ["mcp:projects.read"],
  start_thread: ["mcp:conversations.control"],
  reply_in_thread: ["mcp:conversations.control"],
  publish_project_conclusion: ["mcp:conversations.control"],
  create_project: ["mcp:projects.write"],
  rename_project: ["mcp:projects.write"],
  list_objects: ["mcp:objects.read"],
  get_object: ["mcp:objects.read"],
  create_object: ["mcp:objects.write"],
  update_object_metadata: ["mcp:objects.write"],
  update_object_schema: ["mcp:objects.write"],
  describe_object_templates: ["mcp:objects.read"],
  search_object_templates: ["mcp:objects.read"],
  apply_object_template: ["mcp:objects.write"],
  list_object_import_candidates: ["mcp:objects.read", "mcp:tables.read"],
  list_records: ["mcp:objects.read", "mcp:records.read"],
  search_records: ["mcp:objects.read", "mcp:records.read"],
  get_record: ["mcp:objects.read", "mcp:records.read"],
  get_record_field_history: ["mcp:objects.read", "mcp:records.read"],
  create_record: ["mcp:objects.read", "mcp:records.write"],
  update_record: ["mcp:objects.read", "mcp:records.write"],
  archive_record: ["mcp:objects.read", "mcp:records.write"],
  list_lists: ["mcp:lists.read"],
  get_list: ["mcp:lists.read"],
  list_list_records: ["mcp:lists.read", "mcp:records.read"],
  create_list: ["mcp:objects.read", "mcp:lists.write"],
  update_dynamic_list: ["mcp:lists.write"],
  rename_list: ["mcp:lists.write"],
  add_list_entries: ["mcp:lists.write", "mcp:records.read"],
  remove_list_entry: ["mcp:lists.write"],
  restore_list_entry: ["mcp:lists.write"],
  update_list_entry: ["mcp:lists.write"],
  update_list_entry_schema: ["mcp:lists.write"],
  promote_dynamic_list_records: ["mcp:lists.write", "mcp:records.read"],
  get_list_qualification: ["mcp:lists.read"],
  configure_list_qualification: ["mcp:lists.write"],
  assess_list_person: ["mcp:lists.write", "mcp:records.read"],
  configure_list_people_source: ["mcp:lists.write", "mcp:records.write"],
  list_listenings: ["mcp:projects.read", "mcp:sources.read"],
  get_listening: ["mcp:projects.read", "mcp:sources.read"],
  create_listening: ["mcp:projects.read", "mcp:sources.write"],
  update_listening: ["mcp:projects.read", "mcp:sources.write"],
  delete_listening: ["mcp:projects.read", "mcp:sources.write"],
  list_listening_posts: ["mcp:projects.read", "mcp:sources.read"],
  get_listening_post: ["mcp:projects.read", "mcp:sources.read"],
  import_listening_post: ["mcp:projects.read", "mcp:sources.write"],
  list_listening_reply_accounts: ["mcp:projects.read", "mcp:sources.read"],
  draft_listening_reply: ["mcp:projects.read", "mcp:sources.write"],
  send_listening_reply: ["mcp:projects.read", "mcp:sources.write"],
  activate_listening: ["mcp:projects.read", "mcp:sources.write"],
  manage_listening_audience_capture: [
    "mcp:projects.read",
    "mcp:sources.write",
    "mcp:lists.write",
    "mcp:records.write",
  ],
} as const satisfies Record<string, readonly SignalSurfWebMcpScope[]>

export type SignalSurfWebMcpToolName =
  keyof typeof SIGNALSURF_WEB_MCP_TOOL_SCOPES
