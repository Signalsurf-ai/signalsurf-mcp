import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js"
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
import {
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

const CURSOR_PREFIX = "signalsurf-tools-v2:"
export const DEFAULT_TOOL_LIST_PAGE_BYTES = 64 * 1024
export const TOOL_LIST_FRAMING_RESERVE_BYTES = 512
const EMPTY_OBJECT_JSON_SCHEMA = { type: "object", properties: {} } as const
const REPEATED_WORKSPACE_GUIDANCE =
  "Pass workspaceId when this connection can access multiple workspaces."

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
  if (compact.readOnlyHint === true) {
    // MCP defines both hints as meaningful only for mutating tools.
    delete compact.destructiveHint
    delete compact.idempotentHint
  } else {
    if (compact.destructiveHint === true) delete compact.destructiveHint
    if (compact.idempotentHint === false) delete compact.idempotentHint
  }
  if (compact.openWorldHint === true) delete compact.openWorldHint
  return Object.keys(compact).length > 0 ? compact : undefined
}

const SCHEMA_MAP_KEYWORDS = new Set([
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
])
const SCHEMA_ARRAY_KEYWORDS = new Set([
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
])
const SCHEMA_VALUE_KEYWORDS = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
])

function omitSchemaUsageMetadata(schema: unknown): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return
  const record = schema as Record<string, unknown>
  delete record.description
  delete record.default

  for (const [keyword, value] of Object.entries(record)) {
    if (SCHEMA_MAP_KEYWORDS.has(keyword) && value && typeof value === "object") {
      for (const child of Object.values(value)) omitSchemaUsageMetadata(child)
    } else if (SCHEMA_ARRAY_KEYWORDS.has(keyword) && Array.isArray(value)) {
      for (const child of value) omitSchemaUsageMetadata(child)
    } else if (SCHEMA_VALUE_KEYWORDS.has(keyword)) {
      omitSchemaUsageMetadata(value)
    } else if (
      keyword === "dependencies" &&
      value &&
      typeof value === "object"
    ) {
      for (const child of Object.values(value)) {
        if (!Array.isArray(child)) omitSchemaUsageMetadata(child)
      }
    }
  }
}

function compactDescription(
  description: string | undefined,
  hasOutputSchema: boolean
): string | undefined {
  if (!description || !hasOutputSchema) return description
  return description
    .replace(` ${REPEATED_WORKSPACE_GUIDANCE}`, "")
    .replace(REPEATED_WORKSPACE_GUIDANCE, "")
    .trim()
}

function toolDefinition(name: string, tool: RegisteredTool): Tool {
  const input = normalizeObjectSchema(tool.inputSchema)
  const inputSchema = (input
    ? toJsonSchemaCompat(input, {
        strictUnions: true,
        pipeStrategy: "input",
      })
    : EMPTY_OBJECT_JSON_SCHEMA) as Tool["inputSchema"]
  const output = normalizeObjectSchema(tool.outputSchema)
  const outputSchema = output
    ? (toJsonSchemaCompat(output, {
        strictUnions: true,
        pipeStrategy: "input",
      }) as Tool["outputSchema"])
    : undefined
  // The root draft marker and schema usage prose are repeated for every tool
  // and do not alter validation. The server retains the registered schemas and
  // remains the authority for input/output validation.
  delete inputSchema.$schema
  if (outputSchema) delete outputSchema.$schema
  omitSchemaUsageMetadata(inputSchema)
  const definition: Tool = {
    name,
    title: tool.title,
    description: compactDescription(tool.description, Boolean(outputSchema)),
    inputSchema,
    outputSchema,
    annotations: compactAnnotations(tool.annotations),
    _meta: tool._meta,
  }
  return definition
}

function cursorFor(index: number, fingerprint: string): string {
  return `${CURSOR_PREFIX}${fingerprint}:${index}`
}

function parseCursor(
  cursor: string | undefined,
  length: number,
  fingerprint: string
): number {
  if (cursor === undefined) return 0
  if (!cursor.startsWith(CURSOR_PREFIX)) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid tools/list cursor")
  }
  const match = /^([a-f0-9]{64}):(\d+)$/.exec(
    cursor.slice(CURSOR_PREFIX.length)
  )
  if (!match) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid tools/list cursor")
  }
  if (match[1] !== fingerprint) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Tools catalog changed; restart tools/list without a cursor"
    )
  }
  const index = Number(match[2])
  if (!Number.isSafeInteger(index) || index <= 0 || index >= length) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid tools/list cursor")
  }
  return index
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

async function fingerprintCatalog(tools: Tool[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(tools))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
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

  server.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const tools = Object.entries(registered)
      .filter(([, tool]) => tool.enabled)
      .map(([name, tool]) => toolDefinition(name, tool))
    const fingerprint = await fingerprintCatalog(tools)
    const start = parseCursor(
      request.params?.cursor,
      tools.length,
      fingerprint
    )
    const page: Tool[] = []

    for (let index = start; index < tools.length; index += 1) {
      const candidate = [...page, tools[index]!]
      const hasMore = index + 1 < tools.length
      const result = {
        tools: candidate,
        ...(hasMore
          ? { nextCursor: cursorFor(index + 1, fingerprint) }
          : {}),
      }
      if (encodedBytes(result) + TOOL_LIST_FRAMING_RESERVE_BYTES > maxPageBytes) {
        if (page.length === 0) {
          throw new McpError(
            ErrorCode.InternalError,
            "A tool definition exceeds the discovery page limit"
          )
        }
        break
      }
      page.push(tools[index]!)
    }

    const nextIndex = start + page.length
    return {
      tools: page,
      ...(nextIndex < tools.length
        ? { nextCursor: cursorFor(nextIndex, fingerprint) }
        : {}),
    }
  })
}
