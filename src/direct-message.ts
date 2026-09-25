import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z, type ZodTypeAny } from "zod"

import { UserFacingError } from "./errors.js"
import { jsonErrorResult, jsonResult } from "./mcp-results.js"

/**
 * SIG-2681/SIG-2815: The member's conversation lives in their own
 * client; SignalSurf keeps no second conversation and no relayed transcript.
 * The `mcp:dm` scope includes bounded member and Project capabilities
 * published by SignalSurf itself. Product scopes independently grant product
 * tools. Every call stays
 * within the approving member's authority in one granted workspace.
 */

export const DIRECT_MESSAGE_INSTRUCTIONS = `SignalSurf MCP connection.

You act with the authority of the SignalSurf member who authorized this connection, and nothing more. SignalSurf keeps no copy of this external conversation and runs no second assistant for it.

- Call list_workspaces first when the member reaches more than one workspace, and pass workspaceId on every later call.
- Read Activity to see what is new and what waits on the member; read a Thread before claiming anything happened there.
- Work happens in Projects. Start a Thread or reply in one, and that Project's Surfer does the work under its own confirmations. Read the Thread afterwards to see what it actually did.
- Before proposing or delegating work that depends on a Project's data or automation, call list_project_files and read the relevant Files. Do not guess their contents from names alone.
- When a write returns waiting_for_surfer, immediately call wait_for_thread_response with its eventSequence as both inputSequence and afterSequence. Keep inputSequence fixed; while still_working, inspect member-safe activity and call again with afterSequence advanced to latestSequence. Inspect and report the settled response. Never ask the member whether you should wait or present a delivery receipt as the result.
- When product scopes are granted, use the product-operation tools on this same connection for direct Table, Workflow, Signal, enrichment, and other supported work. Routine atomic edits do not need a Thread just for logging.
- Before your final answer, publish a durable Project-relevant conclusion when the conversation produced a decision, direction, research summary, assumption, or next step. Append it to the relevant Thread when known; otherwise create a conclusion Thread. Store only the distilled result, never the private transcript or routine tool chatter.`

export const DIRECT_MESSAGE_UNAVAILABLE = "DIRECT_MESSAGE_UNAVAILABLE"
export const DIRECT_MESSAGE_ROLE_TIMEOUT_MS = 5_000

export type DirectMessageClientOptions = {
  baseUrl?: string
  accessToken?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

type JsonRecord = Record<string, unknown>

export type DirectMessageTool = {
  name: string
  title?: string
  description: string
  inputSchema: JsonRecord
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
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

  async call(
    body: JsonRecord,
    requestTimeoutMs = this.timeoutMs
  ): Promise<JsonRecord> {
    if (!this.endpoint || !this.accessToken) {
      throw unavailable(
        "Member and Project capabilities are not configured on this hosted MCP deployment."
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
        signal: AbortSignal.timeout(requestTimeoutMs),
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
        typeof record.code === "string"
          ? record.code
          : DIRECT_MESSAGE_UNAVAILABLE
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

  async role(
    requestTimeoutMs = DIRECT_MESSAGE_ROLE_TIMEOUT_MS
  ): Promise<string | null> {
    const result = await this.call({ action: "role" }, requestTimeoutMs)
    return typeof result.role === "string" ? result.role : null
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

const WORKSPACE_ID_SCHEMA = {
  type: ["string", "null"],
  description:
    "Which granted workspace to act in (see list_workspaces). Omit only when the connection reaches one workspace.",
} as const

/**
 * Add the selector to composed object branches as well as their outer schema.
 * A strict allOf/anyOf/oneOf branch would otherwise reject workspaceId before
 * the outer constraint can validate it.
 */
function withWorkspaceId(
  schema: JsonRecord,
  inheritedProperties: JsonRecord = {}
): JsonRecord {
  const properties = {
    workspaceId: WORKSPACE_ID_SCHEMA,
    ...inheritedProperties,
    ...((schema.properties as JsonRecord | undefined) ?? {}),
  }
  const composed = Object.fromEntries(
    (["allOf", "anyOf", "oneOf"] as const).flatMap((key) => {
      const branches = schema[key]
      if (!Array.isArray(branches)) return []
      return [
        [
          key,
          branches.map((branch) =>
            branch && typeof branch === "object" && !Array.isArray(branch)
              ? withWorkspaceId(branch as JsonRecord, properties)
              : branch
          ),
        ],
      ]
    })
  )
  return {
    ...schema,
    ...composed,
    type: "object",
    properties,
    additionalProperties: false,
  }
}

export type DirectMessageSurface = {
  instructions: string
  capabilities: Array<{ name: string; title: string; description: string }>
  register: (server: McpServer, reservedToolNames?: readonly string[]) => void
}

function described(schema: ZodTypeAny, json: JsonRecord): ZodTypeAny {
  return typeof json.description === "string"
    ? schema.describe(json.description)
    : schema
}

function compositionSiblings(schema: JsonRecord): JsonRecord | null {
  const { allOf: _allOf, anyOf: _anyOf, oneOf: _oneOf, ...siblings } = schema
  // Composed object branches already carry the complete allowed property set.
  // Keep the outer object/property/required constraints without making this
  // second validator reject properties that belong to a branch.
  if (siblings.type === "object" && siblings.additionalProperties === false) {
    delete siblings.additionalProperties
  }
  const constraintKeys = Object.keys(siblings).filter(
    (key) =>
      ![
        "$schema",
        "$id",
        "$defs",
        "definitions",
        "title",
        "description",
      ].includes(key)
  )
  return constraintKeys.length > 0 ? siblings : null
}

function intersectWithCompositionSiblings(
  composed: ZodTypeAny,
  schema: JsonRecord
): ZodTypeAny {
  const siblings = compositionSiblings(schema)
  return siblings
    ? z.intersection(composed, publishedSchemaToZod(siblings))
    : composed
}

type ComposedObjectProperties = {
  definitions: Map<string, unknown[]>
  required: Set<string>
}

function collectComposedObjectProperties(
  schema: JsonRecord
): ComposedObjectProperties {
  const definitions = new Map<string, unknown[]>()
  const properties =
    schema.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? (schema.properties as JsonRecord)
      : {}
  for (const [key, definition] of Object.entries(properties)) {
    definitions.set(key, [definition])
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : []
  )

  const allOf = Array.isArray(schema.allOf) ? schema.allOf : []
  for (const branch of allOf) {
    if (!branch || typeof branch !== "object" || Array.isArray(branch)) continue
    const collected = collectComposedObjectProperties(branch as JsonRecord)
    for (const [key, values] of collected.definitions) {
      definitions.set(key, [...(definitions.get(key) ?? []), ...values])
    }
    for (const key of collected.required) required.add(key)
  }

  const alternatives = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : []
  const alternativeRequirements: Set<string>[] = []
  for (const branch of alternatives) {
    if (!branch || typeof branch !== "object" || Array.isArray(branch)) continue
    const collected = collectComposedObjectProperties(branch as JsonRecord)
    for (const [key, values] of collected.definitions) {
      definitions.set(key, [...(definitions.get(key) ?? []), ...values])
    }
    alternativeRequirements.push(collected.required)
  }
  if (alternativeRequirements.length > 0) {
    for (const key of alternativeRequirements[0]!) {
      if (alternativeRequirements.every((keys) => keys.has(key)))
        required.add(key)
    }
  }

  return { definitions, required }
}

function composedObjectToZod(schema: JsonRecord): ZodTypeAny {
  const { definitions, required } = collectComposedObjectProperties(schema)
  const shape = Object.fromEntries(
    [...definitions].map(([key, rawDefinitions]) => {
      const uniqueDefinitions = [
        ...new Map(
          rawDefinitions.map((definition) => [
            JSON.stringify(definition),
            definition,
          ])
        ).values(),
      ]
      const validators = uniqueDefinitions.map(publishedSchemaToZod)
      const property =
        validators.length === 1
          ? validators[0]!
          : z.union(
              validators as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]
            )
      return [key, required.has(key) ? property : property.optional()]
    })
  )
  return schema.additionalProperties === false
    ? z.object(shape).strict()
    : z.object(shape).passthrough()
}

/**
 * SignalSurf Web owns these input contracts and validates them again before
 * execution. Convert the JSON Schema subset emitted by Zod into an MCP SDK
 * schema so the member/Project tools can share one registry with static public
 * tools without weakening the authoritative Web-side validation.
 */
function publishedSchemaToZod(input: unknown): ZodTypeAny {
  const schema =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as JsonRecord)
      : {}

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const [first, ...rest] = schema.allOf
    const composed = rest.reduce(
      (combined, part) => z.intersection(combined, publishedSchemaToZod(part)),
      publishedSchemaToZod(first)
    )
    const authoritative = intersectWithCompositionSiblings(composed, schema)
    return described(
      schema.type === "object" || schema.properties
        ? composedObjectToZod(schema)
        : authoritative,
      schema
    )
  }
  const alternatives = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null
  if (alternatives?.length) {
    const variants = alternatives.map(publishedSchemaToZod)
    const composed =
      variants.length === 1
        ? variants[0]!
        : z.union(
            variants as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]
          )
    const authoritative = intersectWithCompositionSiblings(composed, schema)
    return described(
      schema.type === "object" || schema.properties
        ? composedObjectToZod(schema)
        : authoritative,
      schema
    )
  }
  if (Object.hasOwn(schema, "const")) {
    return described(z.literal(schema.const as any), schema)
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const variants = schema.enum.map((value) => z.literal(value as any))
    return described(
      variants.length === 1
        ? variants[0]!
        : z.union(
            variants as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]
          ),
      schema
    )
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types.length > 1) {
    const variants = types.map((type) =>
      publishedSchemaToZod({ ...schema, type })
    )
    return described(
      z.union(variants as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]),
      schema
    )
  }

  let result: ZodTypeAny
  switch (types[0]) {
    case "object": {
      const required = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter(
              (key): key is string => typeof key === "string"
            )
          : []
      )
      const properties =
        schema.properties &&
        typeof schema.properties === "object" &&
        !Array.isArray(schema.properties)
          ? (schema.properties as JsonRecord)
          : {}
      const shape = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => {
          const property = publishedSchemaToZod(value)
          return [key, required.has(key) ? property : property.optional()]
        })
      )
      const object = z.object(shape)
      result =
        schema.additionalProperties === false
          ? object.strict()
          : object.passthrough()
      break
    }
    case "array": {
      let array = z.array(publishedSchemaToZod(schema.items))
      if (typeof schema.minItems === "number")
        array = array.min(schema.minItems)
      if (typeof schema.maxItems === "number")
        array = array.max(schema.maxItems)
      result = array
      break
    }
    case "string": {
      let string = z.string()
      if (schema.format === "uuid") string = string.uuid()
      if (typeof schema.minLength === "number")
        string = string.min(schema.minLength)
      if (typeof schema.maxLength === "number")
        string = string.max(schema.maxLength)
      result = string
      break
    }
    case "integer":
    case "number": {
      let number = z.number()
      if (types[0] === "integer") number = number.int()
      if (typeof schema.minimum === "number")
        number = number.min(schema.minimum)
      if (typeof schema.maximum === "number")
        number = number.max(schema.maximum)
      result = number
      break
    }
    case "boolean":
      result = z.boolean()
      break
    case "null":
      result = z.null()
      break
    default:
      result = z.unknown()
  }
  if (Object.hasOwn(schema, "default")) result = result.default(schema.default)
  return described(result, schema)
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
    await Promise.all(
      workspaceIds.map((workspaceId) => client.catalog(workspaceId))
    )
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
    capabilities: tools.map((tool) => ({
      name: tool.name,
      title:
        tool.title ??
        tool.name
          .split("_")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" "),
      description: tool.description,
    })),
    register(server: McpServer, reservedToolNames = []) {
      const names = new Set(reservedToolNames)
      for (const tool of tools) {
        if (names.has(tool.name)) {
          throw unavailable(
            `SignalSurf published a conflicting definition for ${tool.name}.`,
            { tool: tool.name }
          )
        }
        names.add(tool.name)
        server.registerTool(
          tool.name,
          {
            title: tool.title,
            description: tool.description,
            inputSchema: publishedSchemaToZod(tool.inputSchema),
            annotations: tool.annotations,
          },
          async (args) => {
            try {
              return tool.name === LIST_WORKSPACES.name
                ? jsonResult({ workspaces: await client.workspaces() })
                : jsonResult(await client.run(tool.name, args as JsonRecord))
            } catch (error) {
              return jsonErrorResult(error)
            }
          }
        )
      }
    },
  }
}
