import type { Server } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"

import { sha256Hex } from "../src/auth.js"
import { PUBLIC_MCP_TOOL_NAMES } from "../src/capabilities.js"
import type { AppConfig } from "../src/config.js"
import { DirectMessageClient } from "../src/direct-message.js"
import { createHttpApp } from "../src/http.js"
import { SignalSurfRepository } from "../src/repository.js"
import { FakeSupabase } from "./fake-supabase.js"

/**
 * The SignalSurf MCP connection gives a client the member's own Project
 * capabilities and scoped product tools. SignalSurf publishes the
 * member catalogue, so these assert the transport boundary, not a duplicate.
 */

const workspaceId = "00000000-0000-4000-8000-000000000001"
const otherWorkspaceId = "00000000-0000-4000-8000-000000000002"
const memberId = "00000000-0000-4000-8000-000000000102"
const resource = "http://127.0.0.1:3333/mcp"
const manualToken = "ssmcp_live_manual"
const combinedOAuth = "ssmcp_at_combined_grant"
const dmOnlyOAuth = "ssmcp_at_dm_only_grant"
const toolOnlyOAuth = "ssmcp_at_tool_only_grant"

const CATALOG = [
  {
    name: "start_thread",
    title: "Start Thread",
    description: "Start a Project Thread.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
    },
  },
  {
    name: "read_thread",
    title: "Read Thread",
    description: "Review delegated Project Thread work.",
    inputSchema: { type: "object", properties: {} },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "publish_project_conclusion",
    title: "Publish Project Conclusion",
    description: "Publish a durable conclusion to a Project Thread.",
    inputSchema: {
      type: "object",
      required: ["projectId", "occurrenceId", "title", "summary"],
      properties: {
        projectId: { type: "string", format: "uuid" },
        occurrenceId: { type: "string", format: "uuid" },
        title: { type: "string" },
        summary: { type: "string" },
      },
      additionalProperties: false,
    },
  },
]

let cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()))
  cleanup = []
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function readMcpJson(response: Response) {
  const body = await response.text()
  if (!body.startsWith("event:")) return JSON.parse(body)
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "))
  if (!dataLine) throw new Error(`Missing SSE data line: ${body}`)
  return JSON.parse(dataLine.slice("data: ".length))
}

function signalSurfStub() {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"))
    if (body.action === "catalog") {
      return jsonResponse(200, {
        ok: true,
        tools: CATALOG,
        role: "You act as the member who authorized this connection.",
      })
    }
    if (body.action === "workspaces") {
      return jsonResponse(200, {
        ok: true,
        workspaces: [{ workspaceId: workspaceId, available: true }],
      })
    }
    return jsonResponse(200, { ok: true, data: { echoed: body } })
  })
}

function makeConfig(): AppConfig {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role",
    transport: "http",
    authMode: "database",
    trustProxy: false,
    host: "127.0.0.1",
    port: 3333,
    path: "/mcp",
    resourceUrl: resource,
    authorizationServerUrl: "https://app.signalsurf.test",
    allowedHosts: ["127.0.0.1", "localhost", "::1"],
    authDisabled: false,
    tokenEntries: [],
  } as AppConfig
}

function oauthRow(id: string, value: string, scope: string) {
  return {
    id,
    client_id: "ssmcp_client_claude",
    user_id: memberId,
    workspace_id: workspaceId,
    workspace_ids: [workspaceId],
    scope,
    resource,
    access_token_sha256: sha256Hex(value),
    access_token_expires_at: "2999-01-01T00:00:00.000Z",
    refresh_token_family_id: null,
    revoked_at: null,
    last_used_at: null,
    last_used_ip: null,
  }
}

async function start(stub = signalSurfStub()) {
  const db = new FakeSupabase({
    workspaces: [{ id: workspaceId, organization_id: null, name: "Workspace" }],
    workspace_members: [
      { workspace_id: workspaceId, user_id: memberId, role: "member" },
    ],
    organization_members: [],
    mcp_tokens: [
      {
        id: "00000000-0000-4000-8000-000000000101",
        workspace_id: workspaceId,
        created_by: memberId,
        name: "claude",
        role: "editor",
        token_sha256: sha256Hex(manualToken),
        revoked_at: null,
        last_used_at: null,
        last_used_ip: null,
      },
    ],
    mcp_oauth_tokens: [
      oauthRow(
        "00000000-0000-4000-8000-000000000211",
        combinedOAuth,
        "mcp:dm mcp:read mcp:write offline_access"
      ),
      oauthRow(
        "00000000-0000-4000-8000-000000000212",
        dmOnlyOAuth,
        "mcp:dm offline_access"
      ),
      oauthRow(
        "00000000-0000-4000-8000-000000000213",
        toolOnlyOAuth,
        "mcp:read offline_access"
      ),
    ],
    mcp_oauth_clients: [
      {
        client_id: "ssmcp_client_claude",
        client_name: "Claude",
        revoked_at: null,
      },
    ],
  })
  const app = createHttpApp(makeConfig(), {
    createRepository: () => new SignalSurfRepository(db as any),
    directMessageFetch: stub as unknown as typeof fetch,
  })
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
  })
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve()))
  )
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("no port")
  return { base: `http://127.0.0.1:${address.port}`, stub }
}

function rpc(base: string, bearer: string | undefined, body: unknown) {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const listTools = (base: string, bearer?: string) =>
  rpc(base, bearer, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })

describe("member capability transport", () => {
  it("calls a fetch bound to globalThis, as workerd requires", async () => {
    // A bare `fetch` called as `this.fetchImpl(...)` throws Illegal invocation
    // on workerd while passing on Node (SIG-2679).
    const original = globalThis.fetch
    const receivers: unknown[] = []
    globalThis.fetch = function trackingFetch(this: unknown) {
      receivers.push(this)
      return Promise.resolve(jsonResponse(200, { ok: true, workspaces: [] }))
    } as unknown as typeof fetch
    try {
      await new DirectMessageClient({
        baseUrl: "https://app.signalsurf.test",
        accessToken: "ssmcp_at_test",
      }).workspaces()
    } finally {
      globalThis.fetch = original
    }
    expect(receivers).toHaveLength(1)
    expect(receivers[0] === globalThis || receivers[0] === undefined).toBe(true)
  })

  it("reports SignalSurf's own refusal rather than a generic failure", async () => {
    const client = new DirectMessageClient({
      baseUrl: "https://app.signalsurf.test",
      accessToken: "ssmcp_at_test",
      fetch: (async () =>
        jsonResponse(403, {
          ok: false,
          error: "Member access was revoked",
          code: "MEMBERSHIP_REVOKED",
        })) as unknown as typeof fetch,
    })
    await expect(client.run("read_thread", {})).rejects.toMatchObject({
      status: 403,
      code: "MEMBERSHIP_REVOKED",
    })
  })
})

describe("SignalSurf MCP capability composition over HTTP", () => {
  it("publishes one union of member and product-operation capabilities", async () => {
    const { base } = await start()
    const response = await listTools(base, manualToken)
    expect(response.status).toBe(200)
    const payload = await readMcpJson(response)
    const tools = payload.result.tools as Array<{
      name: string
      inputSchema: Record<string, any>
    }>
    const names = tools.map((tool) => tool.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "list_workspaces",
        "start_thread",
        "publish_project_conclusion",
      ])
    )
    expect(names).toEqual(expect.arrayContaining(PUBLIC_MCP_TOOL_NAMES))
    expect(
      tools.find((tool) => tool.name === "start_thread")?.inputSchema
    ).toMatchObject({
      type: "object",
      properties: {
        workspaceId: expect.any(Object),
        projectId: { type: "string" },
      },
    })
    expect(tools.find((tool) => tool.name === "read_thread")).toMatchObject({
      title: "Read Thread",
      annotations: { readOnlyHint: true, destructiveHint: false },
    })
  })

  it("discovers Project tools through capability search", async () => {
    const { base } = await start()
    const response = await rpc(base, combinedOAuth, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "find_capabilities",
        arguments: { query: "publish project conclusion" },
      },
    })
    expect(response.status).toBe(200)
    const payload = await readMcpJson(response)
    expect(payload.result.structuredContent.data.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "publish_project_conclusion" }),
      ])
    )
  })

  it("merges the catalogues of every available granted workspace", async () => {
    const unavailableWorkspaceId = "00000000-0000-4000-8000-000000000003"
    const stub = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.action === "workspaces") {
        return jsonResponse(200, {
          ok: true,
          workspaces: [
            { workspaceId: workspaceId, available: true },
            { workspaceId: otherWorkspaceId, available: true },
            { workspaceId: unavailableWorkspaceId, available: false },
          ],
        })
      }
      if (body.action === "catalog") {
        return jsonResponse(200, {
          ok: true,
          tools:
            body.workspaceId === otherWorkspaceId
              ? [
                  CATALOG[0],
                  {
                    name: "list_projects",
                    description: "List Projects.",
                    inputSchema: { type: "object", properties: {} },
                  },
                ]
              : CATALOG,
          role: "You act as the member who authorized this connection.",
        })
      }
      return jsonResponse(200, { ok: true, data: {} })
    })
    const { base } = await start(stub)

    const response = await listTools(base, combinedOAuth)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain("start_thread")
    expect(text).toContain("read_thread")
    expect(text).toContain("list_projects")
    expect(
      stub.mock.calls
        .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
        .filter((body) => body.action === "catalog")
        .map((body) => body.workspaceId)
        .sort()
    ).toEqual([otherWorkspaceId, workspaceId].sort())
  })

  it("fails discovery when an available workspace catalogue cannot load", async () => {
    const stub = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.action === "workspaces") {
        return jsonResponse(200, {
          ok: true,
          workspaces: [{ workspaceId: workspaceId, available: true }],
        })
      }
      return jsonResponse(503, {
        ok: false,
        error: "Catalogue unavailable",
        code: "DIRECT_MESSAGE_UNAVAILABLE",
      })
    })
    const { base } = await start(stub)

    const response = await listTools(base, combinedOAuth)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: "DIRECT_MESSAGE_UNAVAILABLE",
    })
  })

  it("runs a capability as the member in one named workspace", async () => {
    const { base, stub } = await start()
    const response = await rpc(base, manualToken, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "start_thread",
        arguments: { workspaceId: workspaceId, projectId: "p1" },
      },
    })
    expect(response.status).toBe(200)
    const call = stub.mock.calls.at(-1)
    const body = JSON.parse(String((call?.[1] as RequestInit).body))
    expect(body).toMatchObject({
      action: "call",
      tool: "start_thread",
      workspaceId: workspaceId,
      arguments: { projectId: "p1" },
    })
    expect(
      ((call?.[1] as RequestInit).headers as Record<string, string>)
        .Authorization
    ).toBe(`Bearer ${manualToken}`)
  })

  it("preserves workspace selection on composed published schemas", async () => {
    const composedTools = [
      {
        name: "all_of_tool",
        description: "Use an allOf input.",
        inputSchema: {
          allOf: [
            {
              type: "object",
              required: ["projectId"],
              properties: { projectId: { type: "string" } },
              additionalProperties: false,
            },
            {
              type: "object",
              required: ["projectId"],
              properties: { projectId: { type: "string", minLength: 1 } },
              additionalProperties: false,
            },
          ],
        },
      },
      {
        name: "any_of_tool",
        description: "Use an anyOf input.",
        inputSchema: {
          anyOf: [
            {
              type: "object",
              required: ["kind"],
              properties: { kind: { const: "alpha" } },
              additionalProperties: false,
            },
            {
              type: "object",
              required: ["kind"],
              properties: { kind: { const: "beta" } },
              additionalProperties: false,
            },
          ],
        },
      },
    ]
    const stub = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.action === "workspaces") {
        return jsonResponse(200, {
          ok: true,
          workspaces: [{ workspaceId, available: true }],
        })
      }
      if (body.action === "catalog") {
        return jsonResponse(200, {
          ok: true,
          tools: composedTools,
          role: "member",
        })
      }
      return jsonResponse(200, { ok: true, data: { echoed: body } })
    })
    const { base } = await start(stub)

    const listed = await readMcpJson(await listTools(base, combinedOAuth))
    const schemas = Object.fromEntries(
      listed.result.tools
        .filter((tool: { name: string }) =>
          composedTools.some((published) => published.name === tool.name)
        )
        .map((tool: { name: string; inputSchema: Record<string, unknown> }) => [
          tool.name,
          tool.inputSchema,
        ])
    )
    expect(JSON.stringify(schemas.all_of_tool)).toContain("workspaceId")
    expect(JSON.stringify(schemas.any_of_tool)).toContain("workspaceId")

    for (const [name, arguments_] of [
      ["all_of_tool", { workspaceId, projectId: "project-1" }],
      ["any_of_tool", { workspaceId, kind: "alpha" }],
    ] as const) {
      const result = await readMcpJson(
        await rpc(base, combinedOAuth, {
          jsonrpc: "2.0",
          id: name,
          method: "tools/call",
          params: { name, arguments: arguments_ },
        })
      )
      expect(result.result.isError).toBeFalsy()
    }

    const calls = stub.mock.calls
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
      .filter((body) => body.action === "call")
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "all_of_tool",
          workspaceId,
          arguments: { projectId: "project-1" },
        }),
        expect.objectContaining({
          tool: "any_of_tool",
          workspaceId,
          arguments: { kind: "alpha" },
        }),
      ])
    )
  })

  it("composes collaboration and product tools directly from scopes", async () => {
    const { base } = await start()
    const collaboration = await readMcpJson(await listTools(base, dmOnlyOAuth))
    const collaborationNames = collaboration.result.tools.map(
      (tool: { name: string }) => tool.name
    )
    expect(collaborationNames).toContain("start_thread")
    expect(collaborationNames).toContain("list_workflows")
    const deniedProductCall = await rpc(base, dmOnlyOAuth, {
      jsonrpc: "2.0",
      id: "denied-product-call",
      method: "tools/call",
      params: { name: "list_workflows", arguments: {} },
    })
    expect(deniedProductCall.status).toBe(403)

    const product = await readMcpJson(await listTools(base, toolOnlyOAuth))
    const productNames = product.result.tools.map(
      (tool: { name: string }) => tool.name
    )
    expect(productNames).toContain("list_workflows")
    expect(productNames).not.toContain("start_thread")
  })

  it("fails closed when a published member tool collides with a product tool", async () => {
    const stub = signalSurfStub()
    stub.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.action === "workspaces") {
        return jsonResponse(200, {
          ok: true,
          workspaces: [{ workspaceId, available: true }],
        })
      }
      if (body.action === "catalog") {
        return jsonResponse(200, {
          ok: true,
          tools: [{ ...CATALOG[0], name: "get_context" }],
          role: "member",
        })
      }
      return jsonResponse(200, { ok: true, data: {} })
    })
    const { base } = await start(stub)
    const response = await listTools(base, combinedOAuth)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: "DIRECT_MESSAGE_UNAVAILABLE",
    })
  })

  it("states the role the client acts in", async () => {
    const { base } = await start()
    const response = await rpc(base, manualToken, {
      jsonrpc: "2.0",
      id: 9,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    })
    const text = await response.text()
    expect(text).toContain("act with the authority of the SignalSurf member")
    expect(text).toContain("authorized this connection")
    expect(text).toContain("publish a durable Project-relevant conclusion")
  })

  it("advertises member capabilities first in its OAuth metadata", async () => {
    const { base } = await start()
    const metadata = await (
      await fetch(`${base}/.well-known/oauth-protected-resource`)
    ).json()
    expect(metadata.scopes_supported[0]).toBe("mcp:dm")
    const challenge = await listTools(base)
    expect(challenge.status).toBe(401)
    expect(challenge.headers.get("www-authenticate")).toContain(
      'scope="mcp:dm '
    )
  })
})
