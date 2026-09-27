export const MCP_OFFLINE_ACCESS_SCOPE = "offline_access"

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

export type ProjectMcpScope =
  (typeof MCP_PROJECT_SCOPES)[number] | (typeof MCP_CONVERSATION_SCOPES)[number]

export const PROJECT_MCP_TOOL_SCOPES = {
  list_workspaces: ["mcp:projects.read"],
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
} as const satisfies Record<string, readonly ProjectMcpScope[]>

export type ProjectMcpToolName = keyof typeof PROJECT_MCP_TOOL_SCOPES
