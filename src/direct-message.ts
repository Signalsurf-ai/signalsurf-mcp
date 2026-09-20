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

You act as the SignalSurf member, with the capabilities their own private Surfer Direct Message has. There is no separate SignalSurf-side assistant and no stored copy of this conversation: what you do lands in Projects, where the member and their colleagues see it.

- Call list_workspaces first when the member reaches more than one workspace, and pass workspaceId on every later call.
- Work happens in Projects: start or continue a Project Thread rather than answering as if SignalSurf saw this conversation.
- Nothing here can change workspace data directly; that is Tools mode, which the member approves separately.`

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

  async workspaces(): Promise<JsonRecord> {
    return this.call({ action: "workspaces" })
  }

  async catalog(workspaceId?: string | null): Promise<DirectMessageTool[]> {
    const result = await this.call({ action: "catalog", workspaceId })
    return Array.isArray(result.tools) ? (result.tools as DirectMessageTool[]) : []
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

export async function registerDirectMessageTools(
  server: Server,
  client: DirectMessageClient
): Promise<void> {
  let catalog: DirectMessageTool[] = []
  try {
    catalog = await client.catalog()
  } catch (error) {
    console.error("Direct Message capability catalogue unavailable", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : error,
    })
  }
  const tools = [
    LIST_WORKSPACES,
    ...catalog.map((tool) => ({
      ...tool,
      inputSchema: withWorkspaceId(tool.inputSchema ?? {}),
    })),
  ]

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
        const result = await client.workspaces()
        return jsonResult({ workspaces: result.workspaces })
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
}
