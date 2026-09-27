import { PROJECT_MCP_TOOL_SCOPES } from "@signalsurf/mcp-contract"

import {
  authorizedWorkspaceIds,
  authorizedWorkspaces,
  canUseCapability,
  listContextCapabilities,
} from "./auth.js"
import type { McpCapability } from "./capabilities.js"
import type { ProjectExecutionClient } from "./project-execution.js"
import type { SignalSurfRepository } from "./repository.js"
import type { SignalSurfContext } from "./types.js"
import {
  WORKSPACE_CAPABILITIES,
  projectMcpCapabilitiesForWorkspace,
} from "./workspace-capabilities.js"

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function scopeAllowed(context: SignalSurfContext, scope: string): boolean {
  return context.scopes?.includes(scope) === true
}

function capabilityAllowed(
  capabilities: readonly McpCapability[],
  capability: McpCapability
): boolean {
  return capabilities.includes(capability)
}

function accessList(input: {
  read?: boolean
  write?: boolean
  execute?: boolean
  control?: boolean
}) {
  return (["read", "write", "execute", "control"] as const).filter(
    (access) => input[access] === true
  )
}

function workspaceModules(
  context: SignalSurfContext,
  workspaceId: string
): readonly string[] {
  return (
    context.workspaceCapabilitiesByWorkspaceId?.[workspaceId] ??
    WORKSPACE_CAPABILITIES
  )
}

export function buildWorkspaceCapabilityDomains(input: {
  context: SignalSurfContext
  workspaceId: string
  effective: readonly McpCapability[]
}) {
  const { context, workspaceId, effective } = input
  const modules = workspaceModules(context, workspaceId)
  const moduleEnabled = (...names: string[]) =>
    names.some((name) => modules.includes(name as never))
  return [
    {
      domain: "projects",
      enabled: scopeAllowed(context, "mcp:projects.read"),
      access: accessList({
        read: scopeAllowed(context, "mcp:projects.read"),
        write: scopeAllowed(context, "mcp:projects.write"),
        control: scopeAllowed(context, "mcp:conversations.control"),
      }),
    },
    {
      domain: "tables",
      enabled: moduleEnabled("tables", "objects"),
      access: accessList({
        read: capabilityAllowed(effective, "tables.read"),
        write: capabilityAllowed(effective, "tables.write"),
      }),
    },
    {
      domain: "workflows",
      enabled: moduleEnabled("workflows"),
      access: accessList({
        read: capabilityAllowed(effective, "workflows.read"),
        write: capabilityAllowed(effective, "workflows.write"),
        execute: capabilityAllowed(effective, "workflows.execute"),
      }),
    },
    {
      domain: "listening",
      enabled: moduleEnabled("listening"),
      access: accessList({
        read:
          capabilityAllowed(effective, "sources.read") ||
          capabilityAllowed(effective, "workflows.read"),
        write:
          capabilityAllowed(effective, "sources.write") ||
          capabilityAllowed(effective, "workflows.write"),
        execute: capabilityAllowed(effective, "workflows.execute"),
      }),
    },
    {
      domain: "campaigns",
      enabled: moduleEnabled("campaigns"),
      access: accessList({
        read: scopeAllowed(context, "mcp:campaigns.read"),
        write: capabilityAllowed(effective, "campaigns.write"),
        execute: scopeAllowed(context, "mcp:campaigns.start"),
      }),
    },
    {
      domain: "lists",
      enabled: moduleEnabled("lists"),
      access: accessList({
        read: capabilityAllowed(effective, "account_lists.read"),
        write: capabilityAllowed(effective, "account_lists.write"),
      }),
    },
    {
      domain: "sender_infrastructure",
      enabled: moduleEnabled("inbox"),
      access: accessList({
        read: capabilityAllowed(effective, "sender_infrastructure.read"),
      }),
    },
    {
      domain: "deepline",
      enabled: true,
      access: accessList({
        read: capabilityAllowed(effective, "deepline.read"),
        write: capabilityAllowed(effective, "deepline.enrich"),
        execute: capabilityAllowed(effective, "deepline.execute"),
      }),
    },
  ]
}

function boundedAttentionThread(value: unknown) {
  if (!isRecord(value)) return null
  const projectId = typeof value.projectId === "string" ? value.projectId : null
  const threadId = typeof value.threadId === "string" ? value.threadId : null
  if (!projectId || !threadId) return null
  return {
    projectId,
    projectName:
      typeof value.projectName === "string" ? value.projectName : projectId,
    threadId,
    title: typeof value.title === "string" ? value.title : "Untitled",
    preview:
      typeof value.preview === "string" ? value.preview.slice(0, 500) : "",
    lastActivityAt:
      typeof value.lastActivityAt === "string" ? value.lastActivityAt : null,
    taskState:
      value.taskState === "waiting" || value.taskState === "completed"
        ? value.taskState
        : "active",
    unread: value.unread === true,
    waitingOnMe: value.waitingOnMe === true,
    mentioned: value.mentioned === true,
    participating: value.participating === true,
  }
}

async function loadWorkspaceMemberAuthority(input: {
  context: SignalSurfContext
  workspaceId: string
  projectExecutionClient: ProjectExecutionClient
}) {
  const { context, workspaceId, projectExecutionClient } = input
  if (!context.userId) {
    return {
      status: "unavailable" as const,
      reason: "member_identity_unavailable",
      memberAccess: null,
    }
  }
  if (!scopeAllowed(context, "mcp:projects.read")) {
    return {
      status: "not_authorized" as const,
      reason: "project_read_not_granted",
      memberAccess: null,
    }
  }
  try {
    const result = await projectExecutionClient.run(
      "list_workspaces",
      {},
      null,
      5_000
    )
    const payload = isRecord(result) ? result : {}
    const selected = (Array.isArray(payload.workspaces)
      ? payload.workspaces
      : []
    ).find(
      (workspace) =>
        isRecord(workspace) && workspace.workspaceId === workspaceId
    )
    return {
      status: selected ? ("available" as const) : ("unavailable" as const),
      reason: selected ? undefined : "workspace_membership_not_returned",
      memberAccess:
        isRecord(selected) && typeof selected.memberAccess === "string"
          ? selected.memberAccess
          : null,
    }
  } catch {
    return {
      status: "unavailable" as const,
      reason: "workspace_authority_unavailable",
      memberAccess: null,
    }
  }
}

async function loadWorkspaceAttention(input: {
  context: SignalSurfContext
  workspaceId: string
  projectExecutionClient: ProjectExecutionClient
}) {
  const { context, workspaceId, projectExecutionClient } = input
  if (!context.userId) {
    return {
      status: "unavailable" as const,
      reason: "member_identity_unavailable",
      activeProjects: [],
      threads: [],
    }
  }
  const requiredScopes = PROJECT_MCP_TOOL_SCOPES.list_activity_threads
  if (!requiredScopes.every((scope) => scopeAllowed(context, scope))) {
    return {
      status: "not_authorized" as const,
      reason: "conversation_read_not_granted",
      activeProjects: [],
      threads: [],
    }
  }
  try {
    const result = await projectExecutionClient.run(
      "list_activity_threads",
      {
        cursor: null,
        limit: 10,
        unreadOnly: false,
        relevance: [],
        taskStates: ["active", "waiting"],
      },
      workspaceId,
      5_000
    )
    const payload = isRecord(result) ? result : {}
    const threads = (Array.isArray(payload.threads) ? payload.threads : [])
      .map(boundedAttentionThread)
      .filter((thread): thread is NonNullable<typeof thread> => thread !== null)
      .slice(0, 10)
    const projects = new Map<
      string,
      {
        projectId: string
        name: string
        latestActivityAt: string | null
        unread: boolean
        waitingOnMe: boolean
        activeThreadCount: number
      }
    >()
    for (const thread of threads) {
      const current = projects.get(thread.projectId)
      projects.set(thread.projectId, {
        projectId: thread.projectId,
        name: thread.projectName,
        latestActivityAt:
          current?.latestActivityAt ?? thread.lastActivityAt ?? null,
        unread: (current?.unread ?? false) || thread.unread,
        waitingOnMe: (current?.waitingOnMe ?? false) || thread.waitingOnMe,
        activeThreadCount: (current?.activeThreadCount ?? 0) + 1,
      })
    }
    return {
      status: "available" as const,
      activeProjects: [...projects.values()],
      threads,
      hasMore: payload.nextCursor != null,
    }
  } catch {
    return {
      status: "unavailable" as const,
      reason: "project_attention_unavailable",
      activeProjects: [],
      threads: [],
    }
  }
}

export async function buildWorkspaceContext(input: {
  context: SignalSurfContext
  repository: SignalSurfRepository
  projectExecutionClient: ProjectExecutionClient
  workspaceId: string
}) {
  const { context, repository, projectExecutionClient, workspaceId } = input
  const workspaceIds = authorizedWorkspaceIds(context)
  const workspaces = authorizedWorkspaces(context)
  const selectedCapabilityContext: SignalSurfContext = {
    ...context,
    workspaceId,
    workspaceIds: [workspaceId],
  }
  const effective = projectMcpCapabilitiesForWorkspace(
    selectedCapabilityContext,
    listContextCapabilities(context)
  )
  const domains = buildWorkspaceCapabilityDomains({
    context,
    workspaceId,
    effective,
  })
  const [agents, memberAuthority, attention] = await Promise.all([
    repository.resolveAgentIdentities(workspaceIds),
    loadWorkspaceMemberAuthority({
      context,
      workspaceId,
      projectExecutionClient,
    }),
    loadWorkspaceAttention({
      context,
      workspaceId,
      projectExecutionClient,
    }),
  ])
  return {
    workspaceId,
    workspaceIds,
    workspaces,
    userId: context.userId ?? null,
    role: context.role,
    tokenName: context.tokenName ?? null,
    scopes: context.scopes ?? null,
    agent: {
      identityByWorkspaceId: agents,
      runtime: "external",
      authorship: "canonical_agent",
    },
    memberAuthority: {
      userId: context.userId ?? null,
      grantRole: context.role,
      ...memberAuthority,
    },
    grants: context.scopes ?? [],
    capabilities: {
      effective,
      domains,
      discoveryTool: "find_capabilities",
      read: canUseCapability(context, "context.read"),
      execute: domains.some((domain) => domain.access.includes("execute")),
      write: domains.some(
        (domain) =>
          domain.access.includes("write") || domain.access.includes("control")
      ),
    },
    attention,
    contextVersion: {
      schema: 2,
      resolvedAt: new Date().toISOString(),
    },
  }
}
