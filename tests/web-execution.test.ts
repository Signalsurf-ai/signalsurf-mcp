import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  SIGNALSURF_WEB_MCP_TOOL_CATALOG,
  SIGNALSURF_WEB_MCP_TOOL_SCOPES,
} from "@signalsurf/mcp-contract"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SignalSurfWebExecutionClient,
  createSignalSurfWebExecutionSurface,
  publishedSchemaToZod,
} from "../src/web-execution.js"

const workspaceId = "00000000-0000-4000-8000-000000000001"
const delegationToken = "signed-service-delegation"

let cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.map((close) => close()))
  cleanup = []
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function executionClient(fetchImpl: typeof fetch) {
  return new SignalSurfWebExecutionClient({
    baseUrl: "https://app.signalsurf.test",
    serviceToken: "internal-service-secret",
    delegationToken,
    fetch: fetchImpl,
  })
}

describe("SignalSurf Web execution boundary", () => {
  it("uses only the server credential and signed service delegation", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe("Bearer internal-service-secret")
      expect(headers.Authorization).not.toContain("ssmcp_at")
      expect(JSON.parse(String(init?.body))).toEqual({
        action: "call",
        tool: "read_thread",
        workspaceId,
        arguments: { threadId: "thread-1" },
        delegationToken,
      })
      return jsonResponse(200, { ok: true, data: { id: "thread-1" } })
    }) as unknown as typeof fetch

    await expect(
      executionClient(fetchImpl).run(
        "read_thread",
        { workspaceId, threadId: "thread-1" },
        workspaceId
      )
    ).resolves.toEqual({ id: "thread-1" })
  })

  it("preserves publisher errors instead of converting them to generic failures", async () => {
    const client = executionClient((async () =>
      jsonResponse(403, {
        ok: false,
        error: "Member access was revoked",
        code: "MEMBERSHIP_REVOKED",
      })) as unknown as typeof fetch)

    await expect(client.run("read_thread", {})).rejects.toMatchObject({
      status: 403,
      code: "MEMBERSHIP_REVOKED",
    })
  })

  it("publishes one stable Web registry and enforces scopes at execution", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" })
    const surface = createSignalSurfWebExecutionSurface({
      client: executionClient((async () =>
        jsonResponse(200, { ok: true, data: {} })) as typeof fetch),
      scopes: ["mcp:projects.read"],
      role: "editor",
    })
    surface.register(server)
    const client = new Client({ name: "test-client", version: "1.0.0" })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    cleanup.push(async () => client.close())
    cleanup.push(async () => server.close())
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "list_workspaces",
        "get_project_context",
        "start_thread",
        "publish_project_conclusion",
      ])
    )
    expect(names).not.toContain("resolve_project_context")

    const denied = await client.callTool({
      name: "start_thread",
      arguments: {
        workspaceId,
        projectId: "00000000-0000-4000-8000-000000000004",
        title: "Decision",
        body: "Keep one public registry.",
        occurrenceId: "00000000-0000-4000-8000-000000000005",
      },
    })
    expect(denied.isError).toBe(true)
    const deniedText =
      denied.content?.[0]?.type === "text" ? denied.content[0].text : "{}"
    expect(JSON.parse(deniedText)).toMatchObject({
      code: "INSUFFICIENT_SCOPE",
    })
  })

  it("requires a write-capable role as well as Project write scopes", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: true, data: {} })
    ) as unknown as typeof fetch
    const server = new McpServer({ name: "test", version: "1.0.0" })
    createSignalSurfWebExecutionSurface({
      client: executionClient(fetchImpl),
      scopes: ["mcp:projects.write", "mcp:conversations.control"],
      role: "viewer",
    }).register(server)
    const client = new Client({ name: "test-client", version: "1.0.0" })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    cleanup.push(async () => client.close())
    cleanup.push(async () => server.close())
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const denied = await client.callTool({
      name: "start_thread",
      arguments: {
        workspaceId,
        projectId: "00000000-0000-4000-8000-000000000004",
        title: "Decision",
        body: "Keep one public registry.",
        occurrenceId: "00000000-0000-4000-8000-000000000005",
      },
    })
    expect(denied.isError).toBe(true)
    const deniedText =
      denied.content?.[0]?.type === "text" ? denied.content[0].text : "{}"
    expect(JSON.parse(deniedText)).toMatchObject({ code: "FORBIDDEN" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("revalidates current Workspace Admin authority before delegated CRM writes", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tool: string }
      expect(body.tool).toBe("list_workspaces")
      return jsonResponse(200, {
        ok: true,
        data: { workspaces: [{ workspaceId, memberAccess: "member" }] },
      })
    }) as unknown as typeof fetch
    const server = new McpServer({ name: "test", version: "1.0.0" })
    createSignalSurfWebExecutionSurface({
      client: executionClient(fetchImpl),
      scopes: ["mcp:records.write"],
      role: "editor",
      tools: [
        {
          name: "admin_record_write",
          description: "Test Admin-bound Record mutation.",
          requiredScopes: ["mcp:records.write"],
          requiredWorkspaceRole: "admin",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["workspaceId"],
            properties: {
              workspaceId: { type: "string", format: "uuid" },
            },
          },
          annotations: { readOnlyHint: false },
        },
      ],
    }).register(server)
    const client = new Client({ name: "test-client", version: "1.0.0" })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    cleanup.push(async () => client.close())
    cleanup.push(async () => server.close())
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const denied = await client.callTool({
      name: "admin_record_write",
      arguments: { workspaceId },
    })
    expect(denied.isError).toBe(true)
    const deniedText =
      denied.content?.[0]?.type === "text" ? denied.content[0].text : "{}"
    expect(JSON.parse(deniedText)).toMatchObject({ code: "FORBIDDEN" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("keeps every published Web tool behind an explicit scope mapping", () => {
    expect(
      new Set(SIGNALSURF_WEB_MCP_TOOL_CATALOG.map((tool) => tool.name))
    ).toEqual(new Set(Object.keys(SIGNALSURF_WEB_MCP_TOOL_SCOPES)))
  })

  it("keeps outer workspace constraints on composed schemas", () => {
    const allOf = publishedSchemaToZod({
      type: "object",
      required: ["workspaceId"],
      properties: { workspaceId: { type: "string", format: "uuid" } },
      allOf: [
        {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string", minLength: 1 } },
        },
      ],
    })
    expect(
      allOf.safeParse({ workspaceId, projectId: "project-1" }).success
    ).toBe(true)
    expect(allOf.safeParse({ projectId: "project-1" }).success).toBe(false)

    const anyOf = publishedSchemaToZod({
      type: "object",
      required: ["workspaceId"],
      properties: { workspaceId: { type: "string", format: "uuid" } },
      anyOf: [
        {
          type: "object",
          required: ["kind"],
          properties: { kind: { const: "alpha" } },
        },
        {
          type: "object",
          required: ["kind"],
          properties: { kind: { const: "beta" } },
        },
      ],
    })
    expect(anyOf.safeParse({ workspaceId, kind: "alpha" }).success).toBe(true)
    expect(anyOf.safeParse({ kind: "alpha" }).success).toBe(false)
  })

  it("preserves the real create_list branch requirements", () => {
    const createList = SIGNALSURF_WEB_MCP_TOOL_CATALOG.find(
      (tool) => tool.name === "create_list"
    )
    expect(createList).toBeDefined()
    const schema = publishedSchemaToZod(createList!.inputSchema)
    const base = {
      workspaceId,
      objectId: "00000000-0000-4000-8000-000000000002",
      name: "CFO candidates",
      description: "Qualified CFO candidates",
    }

    expect(
      schema.safeParse({ ...base, mode: "dynamic", query: { version: 1 } })
        .success
    ).toBe(true)
    expect(schema.safeParse({ ...base, mode: "dynamic" }).success).toBe(false)
    expect(schema.safeParse({ ...base, mode: "explicit" }).success).toBe(true)
    expect(schema.safeParse({ ...base, query: { version: 1 } }).success).toBe(
      true
    )
    expect(schema.safeParse(base).success).toBe(true)
  })

  it("enforces date-time, pattern, and exclusive numeric catalog constraints", () => {
    const listActivity = SIGNALSURF_WEB_MCP_TOOL_CATALOG.find(
      (tool) => tool.name === "list_activity"
    )
    const waitForThread = SIGNALSURF_WEB_MCP_TOOL_CATALOG.find(
      (tool) => tool.name === "wait_for_thread_response"
    )
    expect(listActivity).toBeDefined()
    expect(waitForThread).toBeDefined()

    const activitySchema = publishedSchemaToZod(listActivity!.inputSchema)
    expect(
      activitySchema.safeParse({
        workspaceId,
        cursor: {
          createdAt: "not-a-date",
          itemId: "00000000-0000-4000-8000-000000000006",
        },
      }).success
    ).toBe(false)

    const waitSchema = publishedSchemaToZod(waitForThread!.inputSchema)
    expect(
      waitSchema.safeParse({
        workspaceId,
        projectId: "00000000-0000-4000-8000-000000000004",
        threadId: "00000000-0000-4000-8000-000000000005",
        inputSequence: 0,
        afterSequence: 0,
      }).success
    ).toBe(false)
  })
})
