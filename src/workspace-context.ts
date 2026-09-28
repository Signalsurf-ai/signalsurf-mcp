import { SIGNALSURF_WEB_MCP_TOOL_SCOPES } from "@signalsurf/mcp-contract"
import { signalSurfScopesGrantRequiredScope } from "@signalsurf/mcp-contract/scopes"

import {
  authorizedWorkspaceIds,
  authorizedWorkspaces,
  canUseCapability,
  listContextCapabilities,
} from "./auth.js"
import type { McpCapability } from "./capabilities.js"
import type { SignalSurfRepository } from "./repository.js"
import { SIGNALSURF_MCP_TOOL_REGISTRY } from "./tool-registry.js"
import type { SignalSurfContext } from "./types.js"
import type { SignalSurfWebExecutionClient } from "./web-execution.js"
import {
  WORKSPACE_CAPABILITIES,
  projectMcpCapabilitiesForWorkspace,
} from "./workspace-capabilities.js"

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function scopeAllowed(context: SignalSurfContext, scope: string): boolean {
  return (
    context.scopes === undefined ||
    signalSurfScopesGrantRequiredScope(context.scopes, scope)
  )
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
  memberAccess?: string | null
}) {
  const { context, workspaceId, effective } = input
  const modules = workspaceModules(context, workspaceId)
  const moduleEnabled = (...names: string[]) =>
    names.some((name) => modules.includes(name as never))
  const enabledByDomain: Record<string, boolean> = {
    projects: true,
    tables: moduleEnabled("tables", "objects"),
    objects: moduleEnabled("objects"),
    records: moduleEnabled("objects"),
    workflows: moduleEnabled("workflows"),
    listening: moduleEnabled("listening"),
    campaigns: moduleEnabled("campaigns"),
    lists: moduleEnabled("lists"),
    sender_infrastructure: moduleEnabled("inbox"),
    deepline: true,
  }
  const domainNames = Object.keys(enabledByDomain)
  const accessByDomain = new Map<
    string,
    { read: boolean; write: boolean; execute: boolean; control: boolean }
  >(
    domainNames.map((domain) => [
      domain,
      { read: false, write: false, execute: false, control: false },
    ])
  )

  for (const tool of SIGNALSURF_MCP_TOOL_REGISTRY) {
    const access = accessByDomain.get(tool.domain)
    if (!access || enabledByDomain[tool.domain] !== true) continue
    if (context.role === "viewer" && !tool.annotations.readOnlyHint) continue
    if (tool.executionOwner === "signalsurf-web") {
      const isCurrentMember = ["member", "admin"].includes(
        input.memberAccess ?? ""
      )
      if (!isCurrentMember) continue
      if (
        tool.requiredWorkspaceRole === "admin" &&
        input.memberAccess !== "admin"
      )
        continue
    }
    const authorized =
      tool.executionOwner === "hosted-mcp"
        ? tool.requiredCapabilities.every((capability) =>
            effective.includes(capability as McpCapability)
          )
        : context.scopes === undefined ||
          tool.requiredScopes.every((scope) => scopeAllowed(context, scope))
    if (!authorized) continue

    if (tool.annotations.readOnlyHint) access.read = true
    else if (tool.requiredScopes.includes("mcp:conversations.control"))
      access.control = true
    else if (
      tool.requiredScopes.includes("mcp:campaigns.start") ||
      tool.requiredCapabilities.some((capability) =>
        capability.endsWith(".execute")
      )
    )
      access.execute = true
    else access.write = true
  }

  return domainNames.map((domain) => ({
    domain,
    enabled: enabledByDomain[domain] === true,
    access: accessList(accessByDomain.get(domain)!),
  }))
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
  webExecutionClient: SignalSurfWebExecutionClient
}) {
  const { context, workspaceId, webExecutionClient } = input
  if (!context.userId) {
    return {
      status: "unavailable" as const,
      reason: "member_identity_unavailable",
      memberAccess: null,
    }
  }
  try {
    const result = await webExecutionClient.run(
      "list_workspaces",
      {},
      null,
      5_000
    )
    const payload = isRecord(result) ? result : {}
    const selected = (
      Array.isArray(payload.workspaces) ? payload.workspaces : []
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
  webExecutionClient: SignalSurfWebExecutionClient
}) {
  const { context, workspaceId, webExecutionClient } = input
  if (!context.userId) {
    return {
      status: "unavailable" as const,
      reason: "member_identity_unavailable",
      activeProjects: [],
      threads: [],
    }
  }
  const requiredScopes = SIGNALSURF_WEB_MCP_TOOL_SCOPES.list_activity_threads
  if (!requiredScopes.every((scope) => scopeAllowed(context, scope))) {
    return {
      status: "not_authorized" as const,
      reason: "conversation_read_not_granted",
      activeProjects: [],
      threads: [],
    }
  }
  try {
    const result = await webExecutionClient.run(
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
  webExecutionClient: SignalSurfWebExecutionClient
  workspaceId: string
}) {
  const { context, repository, webExecutionClient, workspaceId } = input
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
  const [agents, memberAuthority, attention] = await Promise.all([
    repository.resolveAgentIdentities(workspaceIds),
    loadWorkspaceMemberAuthority({
      context,
      workspaceId,
      webExecutionClient,
    }),
    loadWorkspaceAttention({
      context,
      workspaceId,
      webExecutionClient,
    }),
  ])
  const domains = buildWorkspaceCapabilityDomains({
    context,
    workspaceId,
    effective,
    memberAccess: memberAuthority.memberAccess,
  })
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
