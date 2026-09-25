import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js"
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
import {
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

const CURSOR_PREFIX = "signalsurf-tools-v1:"
export const DEFAULT_TOOL_LIST_PAGE_BYTES = 64 * 1024
const EMPTY_OBJECT_JSON_SCHEMA = { type: "object", properties: {} } as const

type RegisteredTool = {
  enabled: boolean
  title?: string
  description?: string
  inputSchema?: Parameters<typeof normalizeObjectSchema>[0]
  outputSchema?: Parameters<typeof normalizeObjectSchema>[0]
  annotations?: Tool["annotations"]
  execution?: Tool["execution"]
  _meta?: Tool["_meta"]
}

function compactAnnotations(
  annotations: Tool["annotations"]
): Tool["annotations"] {
  if (!annotations) return undefined
  const compact = { ...annotations }
  // These are the protocol defaults. Leaving them implicit preserves the same
  // client semantics without repeating four booleans across every definition.
  if (compact.readOnlyHint === false) delete compact.readOnlyHint
  if (compact.destructiveHint === true) delete compact.destructiveHint
  if (compact.idempotentHint === false) delete compact.idempotentHint
  if (compact.openWorldHint === true) delete compact.openWorldHint
  return Object.keys(compact).length > 0 ? compact : undefined
}

function toolDefinition(name: string, tool: RegisteredTool): Tool {
  const input = normalizeObjectSchema(tool.inputSchema)
  const inputSchema = (input
    ? toJsonSchemaCompat(input, {
        strictUnions: true,
        pipeStrategy: "input",
      })
    : EMPTY_OBJECT_JSON_SCHEMA) as Tool["inputSchema"]
  // The root draft marker is repeated for every tool and is optional in MCP's
  // Tool contract. The server still owns input/output validation; omitting the
  // generic output schema and default taskSupport metadata only compacts the
  // discovery wire representation.
  delete inputSchema.$schema
  const definition: Tool = {
    name,
    title: tool.title,
    description: tool.description,
    inputSchema,
    annotations: compactAnnotations(tool.annotations),
    _meta: tool._meta,
  }
  return definition
}

function parseCursor(cursor: string | undefined, length: number): number {
  if (cursor === undefined) return 0
  if (!cursor.startsWith(CURSOR_PREFIX)) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid tools/list cursor")
  }
  const index = Number(cursor.slice(CURSOR_PREFIX.length))
  if (!Number.isSafeInteger(index) || index <= 0 || index >= length) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid tools/list cursor")
  }
  return index
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/**
 * The v1 SDK's high-level McpServer returns every registered tool in one page.
 * Override only its public tools/list handler so large combined capability
 * catalogs use the protocol's cursor contract; tools/call remains SDK-owned.
 */
export function installPaginatedToolList(
  server: McpServer,
  maxPageBytes = DEFAULT_TOOL_LIST_PAGE_BYTES
): void {
  if (!Number.isSafeInteger(maxPageBytes) || maxPageBytes < 1024) {
    throw new Error("maxPageBytes must be an integer of at least 1024 bytes")
  }
  const registered = (
    server as unknown as { _registeredTools: Record<string, RegisteredTool> }
  )._registeredTools
  if (!registered || typeof registered !== "object") {
    throw new Error("MCP SDK tool registry is unavailable")
  }

  server.server.setRequestHandler(ListToolsRequestSchema, (request) => {
    const tools = Object.entries(registered)
      .filter(([, tool]) => tool.enabled)
      .map(([name, tool]) => toolDefinition(name, tool))
    const start = parseCursor(request.params?.cursor, tools.length)
    const page: Tool[] = []

    for (let index = start; index < tools.length; index += 1) {
      const candidate = [...page, tools[index]!]
      const hasMore = index + 1 < tools.length
      const result = {
        tools: candidate,
        ...(hasMore
          ? { nextCursor: `${CURSOR_PREFIX}${index + 1}` }
          : {}),
      }
      if (page.length > 0 && encodedBytes(result) > maxPageBytes) break
      page.push(tools[index]!)
    }

    const nextIndex = start + page.length
    return {
      tools: page,
      ...(nextIndex < tools.length
        ? { nextCursor: `${CURSOR_PREFIX}${nextIndex}` }
        : {}),
    }
  })
}
