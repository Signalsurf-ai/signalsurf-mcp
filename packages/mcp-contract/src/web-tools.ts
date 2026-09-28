import projectToolCatalog from "./web-tool-catalog.json" with { type: "json" }

/** Web-canonical tools composed into SignalSurf's single public MCP registry. */
export type SignalSurfWebMcpTool = {
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
  /** How Web prepares a durable one-time approval before execution. */
  approval?: "operation" | "always"
  /** This operation can reach a third-party provider or commit recurring spend. */
  openWorld?: boolean
  /** MCP behavior hints; reads keep their safe defaults when omitted. */
  destructive?: boolean
  idempotent?: boolean
  /** Workspace module whose entitlement gates this product operation. */
  workspaceCapability?: "objects" | "lists" | "listening"
  /** Workspace membership required before finer Project/resource checks. */
  requiredWorkspaceRole?: "member" | "admin"
}

export type SignalSurfWebMcpToolDefinition = {
  name: string
  title: string
  description: string
  domain:
    "workspace" | "projects" | "objects" | "records" | "lists" | "listening"
  executionOwner: "signalsurf-web"
  requiredScopes: readonly string[]
  approval?: "operation" | "always"
  inputSchema: Record<string, unknown>
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
  workspaceCapability?: "objects" | "lists" | "listening"
  requiredWorkspaceRole: "member" | "admin"
}

export const SIGNALSURF_WEB_MCP_TOOL_CATALOG =
  projectToolCatalog as readonly SignalSurfWebMcpToolDefinition[]

const CRM_MCP_TOOLS = [
  [
    "list_objects",
    "read",
    "objects",
    "List first-class CRM Records collections in this Workspace.",
  ],
  [
    "get_object",
    "read",
    "objects",
    "Read one CRM Records collection and its typed identity-aware schema.",
  ],
  [
    "create_object",
    "write",
    "objects",
    "Create a first-class CRM Records collection.",
  ],
  [
    "update_object_metadata",
    "write",
    "objects",
    "Update CRM Records collection metadata.",
  ],
  [
    "update_object_schema",
    "write",
    "objects",
    "Update a CRM Records collection schema while preserving identity rules.",
  ],
  [
    "describe_object_templates",
    "read",
    "objects",
    "Describe maintained CRM Records collection templates.",
  ],
  [
    "search_object_templates",
    "read",
    "objects",
    "Search maintained CRM Records collection templates.",
  ],
  [
    "apply_object_template",
    "write",
    "objects",
    "Apply a maintained template to a CRM Records collection.",
  ],
  [
    "list_object_import_candidates",
    "read",
    "objects",
    "Inspect bounded Table sources that can be imported through the Record Resolver.",
  ],
  [
    "list_records",
    "read",
    "objects",
    "List live identity-resolved Records in a CRM Records collection.",
  ],
  [
    "search_records",
    "read",
    "objects",
    "Search live identity-resolved CRM Records.",
  ],
  [
    "get_record",
    "read",
    "objects",
    "Read one live CRM Record with its typed values and provenance-safe identity.",
  ],
  [
    "get_record_field_history",
    "read",
    "objects",
    "Read bounded change history for one CRM Record field when audit detail is needed.",
  ],
  [
    "create_record",
    "write",
    "objects",
    "Create or converge CRM Records through the canonical Record Resolver; never blind-insert duplicates.",
  ],
  [
    "update_record",
    "write",
    "objects",
    "Patch one or more CRM Records through canonical provenance and identity guards.",
  ],
  [
    "archive_record",
    "write",
    "objects",
    "Archive CRM Records reversibly so they leave live reads and Lists.",
  ],
  [
    "list_lists",
    "read",
    "lists",
    "List saved CRM audiences and their backing Records collections.",
  ],
  [
    "get_list",
    "read",
    "lists",
    "Read one saved CRM audience and its membership mode.",
  ],
  [
    "list_list_records",
    "read",
    "lists",
    "Read bounded live members of one CRM List.",
  ],
  [
    "create_list",
    "write",
    "lists",
    "Create an Explicit or Dynamic CRM List over one Records collection.",
  ],
  [
    "update_dynamic_list",
    "write",
    "lists",
    "Update a Dynamic List's saved live query.",
  ],
  ["rename_list", "write", "lists", "Rename a CRM List."],
  [
    "add_list_entries",
    "write",
    "lists",
    "Add existing Records to an Explicit CRM List.",
  ],
  [
    "remove_list_entry",
    "write",
    "lists",
    "Remove one active membership from an Explicit CRM List.",
  ],
  [
    "restore_list_entry",
    "write",
    "lists",
    "Restore one previously removed Explicit List membership.",
  ],
  [
    "update_list_entry",
    "write",
    "lists",
    "Update one List-owned membership field without changing the underlying CRM Record.",
  ],
  [
    "update_list_entry_schema",
    "write",
    "lists",
    "Update the List-owned membership field schema.",
  ],
  [
    "promote_dynamic_list_records",
    "write",
    "lists",
    "Copy selected Dynamic List Records into an Explicit List without materializing the Dynamic List.",
  ],
  [
    "get_list_qualification",
    "read",
    "lists",
    "Read the List-owned ICP qualification rubric and revision.",
  ],
  [
    "configure_list_qualification",
    "write",
    "lists",
    "Update one Explicit People List's shared ICP qualification rubric with revision checks.",
  ],
  [
    "assess_list_person",
    "write",
    "lists",
    "Assess one active People List member using the saved rubric without paid lookup.",
  ],
  [
    "configure_list_people_source",
    "write",
    "lists",
    "Configure or pause a guarded Warmly or RB2B source for an Explicit People List.",
  ],
] as const

const CRM_WEB_MCP_TOOLS: readonly SignalSurfWebMcpTool[] = CRM_MCP_TOOLS.map(
  ([name, kind, workspaceCapability, description]) => ({
    name,
    procedure: null,
    operation: name,
    kind,
    workspaceCapability,
    requiredWorkspaceRole: kind === "write" ? "admin" : "member",
    description,
  })
)

export const SIGNALSURF_WEB_MCP_TOOLS: readonly SignalSurfWebMcpTool[] = [
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
  ...CRM_WEB_MCP_TOOLS,
  {
    name: "list_listenings",
    procedure: null,
    operation: "list_listenings",
    kind: "read",
    workspaceCapability: "listening",
    description:
      "List first-class Listenings across readable Projects, or within one projectId. Returns Listening ids, names, Project placement, status, platforms, and reply-strategy readiness; no implementation Table discovery is required.",
  },
  {
    name: "get_listening",
    procedure: null,
    operation: "get_listening",
    kind: "read",
    workspaceCapability: "listening",
    description:
      "Read one authorized Listening's complete editable settings, sources, filters, tags, reply strategies, defaults, and optional collection readiness. Missing readiness evidence is unknown, never proof that an account is disconnected.",
  },
  {
    name: "create_listening",
    procedure: null,
    operation: "create_listening",
    kind: "write",
    workspaceCapability: "listening",
    description:
      "Create a first-class Listening inside an authorized Project using SignalSurf's native source, filtering, tagging, and reply-strategy contract. Sources begin paused; enable free sources with update_listening and paid recurring collection with activate_listening.",
  },
  {
    name: "update_listening",
    procedure: null,
    operation: "update_listening",
    kind: "write",
    workspaceCapability: "listening",
    description:
      "Update an authorized Listening after get_listening. Complete-set fields replace their saved set, stale revisions fail closed, and account selection never authorizes a public reply.",
  },
  {
    name: "delete_listening",
    procedure: null,
    operation: "delete_listening",
    kind: "write",
    workspaceCapability: "listening",
    approval: "operation",
    destructive: true,
    description:
      "Delete one authorized Listening after exact one-time approval. Its collected Table remains available as an ordinary File.",
  },
  {
    name: "list_listening_posts",
    procedure: null,
    operation: "list_listening_posts",
    kind: "read",
    workspaceCapability: "listening",
    description:
      "Read bounded posts and activity totals collected by one authorized Listening. Filter by platform, publication time, text, or saved tags without discovering or reading an implementation Table.",
  },
  {
    name: "get_listening_post",
    procedure: null,
    operation: "get_listening_post",
    kind: "read",
    workspaceCapability: "listening",
    description:
      "Read one authorized Listening post, its saved draft and reply history. This public read never refreshes provider metrics and never posts.",
  },
  {
    name: "import_listening_post",
    procedure: null,
    operation: "import_listening_post",
    kind: "write",
    workspaceCapability: "listening",
    approval: "always",
    openWorld: true,
    description:
      "Import one explicitly selected LinkedIn post URL into an authorized Listening after exact one-time approval. This reads provider metadata once and never creates a recurring watcher.",
  },
  {
    name: "list_listening_reply_accounts",
    procedure: null,
    operation: "list_listening_reply_accounts",
    kind: "read",
    workspaceCapability: "listening",
    description:
      "Read authoritative workspace social-account readiness for Threads, LinkedIn, or X, plus a Listening's saved defaults. A failed or unavailable read is unknown—not disconnected—and must not be guessed.",
  },
  {
    name: "draft_listening_reply",
    procedure: null,
    operation: "draft_listening_reply",
    kind: "write",
    workspaceCapability: "listening",
    description:
      "Generate and save shared drafts for one post or one bounded page of authorized Listening posts. Drafting never publishes a reply.",
  },
  {
    name: "send_listening_reply",
    procedure: null,
    operation: "send_listening_reply",
    kind: "write",
    workspaceCapability: "listening",
    approval: "operation",
    openWorld: true,
    description:
      "Publish one exact reply to an authorized Threads or LinkedIn Listening post. The first call prepares a one-time SignalSurf approval bound to target, sender, and body; after Web approval, repeat the same call with approvalRequestId. Ambiguous outcomes are never blindly retried.",
  },
  {
    name: "activate_listening",
    procedure: null,
    operation: "activate_listening",
    kind: "write",
    workspaceCapability: "listening",
    approval: "operation",
    openWorld: true,
    description:
      "Activate an authorized Listening's saved paid recurring collection scope. The first call prepares a one-time SignalSurf approval bound to current inputs, schedule, and credit ceiling; after Web approval, repeat the same call with approvalRequestId.",
  },
  {
    name: "manage_listening_audience_capture",
    procedure: null,
    operation: "manage_listening_audience_capture",
    kind: "write",
    workspaceCapability: "listening",
    approval: "operation",
    openWorld: true,
    destructive: true,
    description:
      "Inspect or manage the Listening's Engagers capture rule and destination People List. Enabling recurring capture and deleting a rule prepare exact one-time approvals bound to the current saved state.",
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

export function signalSurfWebMcpTool(
  name: string
): SignalSurfWebMcpTool | undefined {
  return SIGNALSURF_WEB_MCP_TOOLS.find((capability) => capability.name === name)
}
