import projectToolCatalog from "./project-tool-catalog.json" with { type: "json" }

/** Project and Thread tools in SignalSurf's single public MCP registry. */
export type ProjectMcpTool = {
  name: string
  /** Existing `router.procedure` contract reused by this capability. */
  procedure: string | null
  kind: "read" | "write"
  description: string
  /**
   * Some procedures read through the member's browser session and return
   * nothing without one. Those run as the member through the workspace's own
   * service-layer operation instead, named here.
   */
  operation?: string
}

export type ProjectMcpToolDefinition = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

export const PROJECT_MCP_TOOL_CATALOG =
  projectToolCatalog as readonly ProjectMcpToolDefinition[]

export const PROJECT_MCP_TOOLS: readonly ProjectMcpTool[] = [
  {
    name: "list_workspaces",
    procedure: null,
    operation: "list_workspaces",
    kind: "read",
    description:
      "List the Workspaces this Agent connection may act in, with current member access and each Workspace's Agent identity.",
  },
  {
    name: "list_projects",
    procedure: "project.discover",
    kind: "read",
    description:
      "List or search the Projects in this Workspace, including visibility and the authorizing member's effective access.",
  },
  {
    name: "get_project",
    procedure: "project.details",
    kind: "read",
    description: "Read one Project's title, overview, and current state.",
  },
  {
    name: "get_project_context",
    procedure: null,
    operation: "get_project_context",
    kind: "read",
    description:
      "Load one bounded Project context when entering, switching, or resuming a Project or Thread: brief, member authority, relevant memory, domain-aware File summaries, recent Threads, decisions, Triggers, available actions, and revision/provenance metadata. Pass threadId when focusing a Thread; read the relevant File separately for complete resource data.",
  },
  {
    name: "list_activity",
    procedure: "project.inboxItems",
    kind: "read",
    description:
      "Read the authorizing member's Activity: the newest Project messages and Threads waiting on them across the Workspace.",
  },
  {
    name: "list_activity_threads",
    procedure: "project.inboxThreads",
    kind: "read",
    description:
      "Read Activity grouped by Thread, so a reply can continue the right conversation.",
  },
  {
    name: "mark_activity_read",
    procedure: "project.openThread",
    kind: "write",
    description:
      "Mark one Project Thread from Activity as read for the authorizing member.",
  },
  {
    name: "list_threads",
    procedure: "project.threads",
    kind: "read",
    description:
      "List a Project's Threads with their task state and recent activity, newest first.",
  },
  {
    name: "read_thread",
    procedure: "project.threadSnapshot",
    kind: "read",
    description:
      "Read one Thread: its messages, working state, delegated work, and anything waiting on a decision.",
  },
  {
    name: "wait_for_thread_response",
    procedure: "project.threadSnapshot",
    kind: "read",
    description:
      "Poll a Project Thread that already has internal Agent work in progress. This tool does not schedule work: external start_thread and reply_in_thread calls are durable Agent-authored context writes and normally settle immediately. Keep inputSequence fixed for the internal input being followed and advance only afterSequence to the returned latestSequence.",
  },
  {
    name: "list_thread_decisions",
    procedure: "project.decisionCards",
    kind: "read",
    description:
      "List the questions, confirmations, and operation approvals a Thread is waiting on.",
  },
  {
    name: "list_project_members",
    procedure: "project.channelMembers",
    kind: "read",
    description: "List who belongs to a Project and the role each one holds.",
  },
  {
    name: "list_project_files",
    procedure: "project.workingFiles",
    kind: "read",
    description:
      "List the Tables, Lists, Workflows, Listenings, and Campaigns in a Project's File catalog. Use read_project_file with one returned kind and id before reasoning about that File's contents.",
  },
  {
    name: "read_project_file",
    procedure: "project.workingFiles",
    kind: "read",
    description:
      "Read one bounded snapshot of a File returned by list_project_files. Tables and Lists include one paginated data page; Workflows, Listenings, and Campaigns return their current configuration. This never changes the File.",
  },
  {
    name: "list_project_triggers",
    procedure: "project.triggers",
    operation: "list_project_triggers",
    kind: "read",
    description:
      "List a Project's Triggers: the conditions and schedules that return the Agent to it.",
  },
  {
    name: "start_thread",
    procedure: "project.createThread",
    kind: "write",
    description:
      "Commit an Agent-authored message to an existing Project by starting a durable Thread. Use this for useful work or context that belongs in SignalSurf; do not copy the host's private transcript.",
  },
  {
    name: "reply_in_thread",
    procedure: "project.replyThread",
    kind: "write",
    description:
      "Commit an Agent-authored reply to an existing Project Thread. Use it to add a useful result, decision, question, or evidence; do not mirror routine host chatter.",
  },
  {
    name: "publish_project_conclusion",
    procedure: null,
    kind: "write",
    description:
      "Write the distilled conclusion of a project-relevant external conversation back to a Project Thread. Call this before your final answer when the discussion produced a durable decision, direction, research summary, assumption, or next step. Append to the relevant thread when known; otherwise create a new conclusion thread. Save only the useful conclusion and evidence, never the private transcript or routine tool chatter.",
  },
  {
    name: "create_project",
    procedure: "project.create",
    operation: "create_project",
    kind: "write",
    description:
      "Create a Project directly: a new area of work with its own Channel. Configure it with the other Project settings; posting a message is not how a Project is made here.",
  },
  {
    name: "rename_project",
    procedure: "project.rename",
    operation: "update_project",
    kind: "write",
    description: "Rename a Project when its overall goal changes.",
  },
] as const

export const SIGNALSURF_MCP_INSTRUCTIONS = `You are an external runtime for the user's SignalSurf Agent, whose display name may be customized. Claude, Codex, ChatGPT, and other hosts are runtimes, not separate Project members or message authors.

- Call get_workspace_context at session start. It returns the Agent identity, authorized Workspaces, grants, member authority, and current effective access. There are no DM, tool, or unified modes.
- When entering or switching a Project, call get_project_context. Pass threadId when entering or switching a Thread. Reuse that bounded context on ordinary turns; refresh it when scope changes or after relevant writes.
- The one stable registry contains Project, Thread, File, CRM, Table, Workflow, Campaign, and other product tools. Workspace-wide work does not require a Project. Project permissions and File authority apply whenever work is Project-scoped.
- Project messages committed through these tools are authored by the canonical Agent. Client, connection, authorizing member, and scheduler identity are audit provenance, not a second displayed role.
- Raw host transcripts stay in the host. Commit only useful messages, conclusions, evidence, and actions. A routine File or CRM edit does not need a Thread merely for logging.
- Before the final answer, call publish_project_conclusion when the conversation produced a durable Project-relevant conclusion. Append to the relevant Thread when known; otherwise create a conclusion Thread.
- Tools remain bounded by granted scopes, current membership, Project privacy, File access, Working File authority, and existing confirmation rules.`

export function projectMcpTool(name: string): ProjectMcpTool | undefined {
  return PROJECT_MCP_TOOLS.find((capability) => capability.name === name)
}
