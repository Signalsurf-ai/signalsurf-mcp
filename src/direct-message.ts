import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"

import { UserFacingError } from "./errors.js"
import { jsonErrorResult, jsonResult } from "./mcp-results.js"

/**
 * SIG-2681: Direct Message mode. The member's conversation lives in their own
 * client; SignalSurf keeps no second conversation and no relayed transcript.
 * This mode exposes the capability set the member's in-product Surfer Direct
 * Message has — published by SignalSurf itself, so the two never diverge — and
 * every call executes as that member, in one granted workspace.
 */

export const DIRECT_MESSAGE_INSTRUCTIONS = `SignalSurf MCP — Direct Message mode.

You act as the SignalSurf member who authorized this connection, with their workspace role and nothing more. Everything you post, answer, or create is recorded as that member, exactly as if they had done it in SignalSurf themselves. SignalSurf keeps no copy of this conversation and runs no assistant of its own for it.

- Call list_workspaces first when the member reaches more than one workspace, and pass workspaceId on every later call.
- Read Activity to see what is new and what waits on the member; read a Thread before claiming anything happened there.
- Work happens in Projects. Start a Thread or reply in one, and that Project's Surfer does the work under its own confirmations. Read the Thread afterwards to see what it actually did.
- You cannot change workspace data directly — no Tables, rows, Workflow runs, or sending. Ask for it in a Thread instead. Direct product operations are Tools mode, which the member approves separately.`

export const DIRECT_MESSAGE_UNAVAILABLE = "DIRECT_MESSAGE_UNAVAILABLE"

export type DirectMessageClientOptions = {
  baseUrl?: string
  accessToken?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

type JsonRecord = Record<string, unknown>

export type DirectMessageTool = {
  name: string
  description: string
  inputSchema: JsonRecord
}

type DirectMessageWorkspace = JsonRecord & {
  workspaceId: string
  available?: boolean
}

function unavailable(message: string, details?: JsonRecord): UserFacingError {
  return new UserFacingError(message, {
    code: DIRECT_MESSAGE_UNAVAILABLE,
    status: 503,
    details,
  })
}

export class DirectMessageClient {
  private readonly baseUrl: string | undefined
  private readonly accessToken: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: DirectMessageClientOptions) {
    this.baseUrl = options.baseUrl?.trim().replace(/\/+$/, "") || undefined
    this.accessToken = options.accessToken?.trim() || undefined
    // workerd rejects a bare `fetch` invoked as a method (SIG-2679).
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? 65_000
  }

  get endpoint(): string | null {
    return this.baseUrl ? `${this.baseUrl}/api/mcp/direct-message` : null
  }

  async call(body: JsonRecord): Promise<JsonRecord> {
    if (!this.endpoint || !this.accessToken) {
      throw unavailable(
        "Direct Message mode is not configured on this hosted MCP deployment."
      )
    }
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      console.error("Direct Message request failed", {
        action: body.action,
        endpoint: this.endpoint,
        error:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      })
      throw unavailable("SignalSurf could not be reached.", {
        action: body.action,
      })
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }
    const record = (payload ?? {}) as JsonRecord
    if (!response.ok || record.ok !== true) {
      const message =
        typeof record.error === "string"
          ? record.error
          : `SignalSurf rejected this request (${response.status}).`
      const code =
        typeof record.code === "string" ? record.code : DIRECT_MESSAGE_UNAVAILABLE
      throw new UserFacingError(message, {
        code,
        status: response.status,
        details: { action: body.action },
      })
    }
    return record
  }

  async workspaces(): Promise<DirectMessageWorkspace[]> {
    const result = await this.call({ action: "workspaces" })
    if (!Array.isArray(result.workspaces)) return []
    return result.workspaces.filter(
      (workspace): workspace is DirectMessageWorkspace =>
        !!workspace &&
        typeof workspace === "object" &&
        !Array.isArray(workspace) &&
        typeof (workspace as JsonRecord).workspaceId === "string"
    )
  }

  async catalog(
    workspaceId?: string | null
  ): Promise<{ tools: DirectMessageTool[]; role: string | null }> {
    const result = await this.call({ action: "catalog", workspaceId })
    return {
      tools: Array.isArray(result.tools)
        ? (result.tools as DirectMessageTool[])
        : [],
      role: typeof result.role === "string" ? result.role : null,
    }
  }

  async run(
    tool: string,
    args: JsonRecord,
    workspaceId?: string | null
  ): Promise<unknown> {
    const { workspaceId: _omit, ...rest } = args
    const result = await this.call({
      action: "call",
      tool,
      arguments: rest,
      workspaceId: (workspaceId ?? args.workspaceId ?? null) as string | null,
    })
    return result.data
  }
}

const LIST_WORKSPACES: DirectMessageTool = {
  name: "list_workspaces",
  description:
    "List the SignalSurf workspaces this connection may act in, with the member's access, the workspace's Surfer name, and its open conversation count. Call this first when the member reaches more than one workspace, then pass workspaceId on every later call.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}

/** Each capability acts in exactly one granted workspace. */
function withWorkspaceId(schema: JsonRecord): JsonRecord {
  const properties = {
    workspaceId: {
      type: ["string", "null"],
      description:
        "Which granted workspace to act in (see list_workspaces). Omit only when the connection reaches one workspace.",
    },
    ...((schema.properties as JsonRecord | undefined) ?? {}),
  }
  return { ...schema, type: "object", properties, additionalProperties: false }
}

export type DirectMessageSurface = {
  instructions: string
  register: (server: Server) => void
}

function mergePublishedTools(
  catalogs: Array<{ tools: DirectMessageTool[]; role: string | null }>
): { tools: DirectMessageTool[]; roles: string[] } {
  const tools = new Map<string, DirectMessageTool>()
  const roles = new Set<string>()
  for (const catalog of catalogs) {
    if (catalog.role) roles.add(catalog.role)
    for (const tool of catalog.tools) {
      const existing = tools.get(tool.name)
      if (
        existing &&
        (existing.description !== tool.description ||
          JSON.stringify(existing.inputSchema) !==
            JSON.stringify(tool.inputSchema))
      ) {
        throw unavailable(
          `SignalSurf published conflicting definitions for ${tool.name}.`,
          { tool: tool.name }
        )
      }
      tools.set(tool.name, tool)
    }
  }
  return { tools: [...tools.values()], roles: [...roles] }
}

/**
 * SignalSurf publishes the member's capabilities and the role they act in, so
 * the connection states both rather than restating a list here.
 */
export async function loadDirectMessageSurface(
  client: DirectMessageClient
): Promise<DirectMessageSurface> {
  const workspaces = await client.workspaces()
  const workspaceIds = workspaces
    .filter((workspace) => workspace.available !== false)
    .map((workspace) => workspace.workspaceId)
  const { tools: published, roles } = mergePublishedTools(
    await Promise.all(workspaceIds.map((workspaceId) => client.catalog(workspaceId)))
  )
  const tools = [
    LIST_WORKSPACES,
    ...published.map((tool) => ({
      ...tool,
      inputSchema: withWorkspaceId(tool.inputSchema ?? {}),
    })),
  ]

  return {
    instructions: roles.length
      ? `${DIRECT_MESSAGE_INSTRUCTIONS}\n\n${roles.join("\n\n")}`
      : DIRECT_MESSAGE_INSTRUCTIONS,
    register(server: Server) {
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      }))

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const name = request.params.name
        const args = (request.params.arguments ?? {}) as JsonRecord
        try {
          if (name === LIST_WORKSPACES.name) {
            return jsonResult({ workspaces: await client.workspaces() })
          }
          if (!tools.some((tool) => tool.name === name)) {
            throw new UserFacingError(`Unknown tool: ${name}`, {
              code: "UNKNOWN_TOOL",
              status: 404,
            })
          }
          return jsonResult(await client.run(name, args))
        } catch (error) {
          return jsonErrorResult(error)
        }
      })
    },
  }
}
