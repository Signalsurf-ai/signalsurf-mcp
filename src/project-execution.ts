import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  PROJECT_MCP_TOOL_CATALOG,
  PROJECT_MCP_TOOL_SCOPES,
  SIGNALSURF_MCP_INSTRUCTIONS,
  type ProjectMcpToolName,
} from "@signalsurf/mcp-contract"
import { z, type ZodTypeAny } from "zod"

import { UserFacingError } from "./errors.js"
import { jsonErrorResult, jsonResult } from "./mcp-results.js"
import type { AccessRole } from "./types.js"

export const PROJECT_EXECUTION_UNAVAILABLE = "PROJECT_EXECUTION_UNAVAILABLE"

export type ProjectExecutionClientOptions = {
  baseUrl?: string
  serviceToken?: string
  delegationToken?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

type JsonRecord = Record<string, unknown>

export type ProjectExecutionTool = {
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

function unavailable(message: string, details?: JsonRecord): UserFacingError {
  return new UserFacingError(message, {
    code: PROJECT_EXECUTION_UNAVAILABLE,
    status: 503,
    details,
  })
}

export class ProjectExecutionClient {
  private readonly baseUrl: string | undefined
  private readonly serviceToken: string | undefined
  private readonly delegationToken: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: ProjectExecutionClientOptions) {
    this.baseUrl = options.baseUrl?.trim().replace(/\/+$/, "") || undefined
    this.serviceToken = options.serviceToken?.trim() || undefined
    this.delegationToken = options.delegationToken?.trim() || undefined
    // workerd rejects a bare `fetch` invoked as a method (SIG-2679).
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? 65_000
  }

  get endpoint(): string | null {
    return this.baseUrl ? `${this.baseUrl}/api/mcp/execute` : null
  }

  async call(
    body: JsonRecord,
    requestTimeoutMs = this.timeoutMs
  ): Promise<JsonRecord> {
    if (!this.endpoint || !this.serviceToken || !this.delegationToken) {
      throw unavailable(
        "Project execution is not configured on this hosted MCP deployment."
      )
    }
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.serviceToken}`,
        },
        body: JSON.stringify({
          ...body,
          delegationToken: this.delegationToken,
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
    } catch (error) {
      console.error("Project execution request failed", {
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
          : PROJECT_EXECUTION_UNAVAILABLE
      throw new UserFacingError(message, {
        code,
        status: response.status,
        details: { action: body.action },
      })
    }
    return record
  }

  async run(
    tool: string,
    args: JsonRecord,
    workspaceId?: string | null,
    requestTimeoutMs = this.timeoutMs
  ): Promise<unknown> {
    const { workspaceId: _omit, ...rest } = args
    const result = await this.call(
      {
        action: "call",
        tool,
        arguments: rest,
        workspaceId: (workspaceId ?? args.workspaceId ?? null) as string | null,
      },
      requestTimeoutMs
    )
    return result.data
  }
}

export type ProjectExecutionSurface = {
  instructions: string
  capabilities: Array<{
    name: string
    title: string
    description: string
    requiredScopes: readonly string[]
    readOnly: boolean
  }>
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
export function publishedSchemaToZod(input: unknown): ZodTypeAny {
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
      if (schema.format === "date-time") string = string.datetime({ offset: true })
      if (typeof schema.pattern === "string")
        string = string.regex(new RegExp(schema.pattern))
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
      if (typeof schema.exclusiveMinimum === "number")
        number = number.gt(schema.exclusiveMinimum)
      if (typeof schema.exclusiveMaximum === "number")
        number = number.lt(schema.exclusiveMaximum)
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

function requiredScopes(toolName: string): readonly string[] {
  const scopes = PROJECT_MCP_TOOL_SCOPES[toolName as ProjectMcpToolName]
  if (!scopes) {
    throw unavailable(
      `SignalSurf published ${toolName} without an authorization mapping.`,
      { tool: toolName }
    )
  }
  return scopes
}

export function createProjectExecutionSurface(input: {
  client: ProjectExecutionClient
  scopes: readonly string[]
  role: AccessRole
}): ProjectExecutionSurface {
  const tools = PROJECT_MCP_TOOL_CATALOG as readonly ProjectExecutionTool[]
  for (const tool of tools) requiredScopes(tool.name)

  return {
    instructions: SIGNALSURF_MCP_INSTRUCTIONS,
    capabilities: tools.map((tool) => ({
      name: tool.name,
      title:
        tool.title ??
        tool.name
          .split("_")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" "),
      description: tool.description,
      requiredScopes: requiredScopes(tool.name),
      readOnly: tool.annotations?.readOnlyHint === true,
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
              if (
                tool.annotations?.readOnlyHint !== true &&
                input.role === "viewer"
              ) {
                throw new UserFacingError(
                  `Viewer role does not allow SignalSurf MCP tool: ${tool.name}`,
                  { code: "FORBIDDEN", status: 403 }
                )
              }
              const missing = requiredScopes(tool.name).filter(
                (scope) => !input.scopes.includes(scope)
              )
              if (missing.length > 0) {
                throw new UserFacingError(
                  `Token scope does not allow SignalSurf MCP tool: ${tool.name}`,
                  {
                    code: "INSUFFICIENT_SCOPE",
                    status: 403,
                    details: { requiredScopes: missing, toolName: tool.name },
                  }
                )
              }
              return jsonResult(
                await input.client.run(tool.name, args as JsonRecord)
              )
            } catch (error) {
              return jsonErrorResult(error)
            }
          }
        )
      }
    },
  }
}
