import type { Server } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"

import { sha256Hex } from "../src/auth.js"
import type { AppConfig } from "../src/config.js"
import { DirectMessageClient } from "../src/direct-message.js"
import { createHttpApp } from "../src/http.js"
import { SignalSurfRepository } from "../src/repository.js"
import { FakeSupabase } from "./fake-supabase.js"

/**
 * SIG-2681: Direct Message mode gives an MCP client the member's own Surfer
 * Direct Message capabilities. SignalSurf publishes that catalogue, so these
 * assert the transport and the mode boundary, not a list restated here.
 */

const productId = "00000000-0000-4000-8000-000000000001"
const otherProductId = "00000000-0000-4000-8000-000000000002"
const memberId = "00000000-0000-4000-8000-000000000102"
const resource = "http://127.0.0.1:3333/mcp"
const manualDm = "ssmcp_session_token"
const manualTools = "ssmcp_live_manual_tools"
const dmOAuth = "ssmcp_at_dm_grant"
const toolOAuth = "ssmcp_at_tool_grant"

const CATALOG = [
  {
    name: "start_thread",
    description: "Start a Project Thread.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
    },
  },
  {
    name: "read_thread",
    description: "Review delegated Project Thread work.",
    inputSchema: { type: "object", properties: {} },
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
        workspaces: [{ workspaceId: productId, available: true }],
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
    workspace_id: productId,
    workspace_ids: [productId],
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
    products: [{ id: productId, organization_id: null, name: "Workspace" }],
    product_members: [
      { workspace_id: productId, user_id: memberId, role: "member" },
    ],
    organization_members: [],
    mcp_tokens: [
      {
        id: "00000000-0000-4000-8000-000000000101",
        workspace_id: productId,
        created_by: memberId,
        name: "claude-dm",
        role: "editor",
        mode: "surfer_session",
        token_sha256: sha256Hex(manualDm),
        revoked_at: null,
        last_used_at: null,
        last_used_ip: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000111",
        workspace_id: productId,
        created_by: memberId,
        name: "tools",
        role: "editor",
        mode: "tools",
        token_sha256: sha256Hex(manualTools),
        revoked_at: null,
        last_used_at: null,
        last_used_ip: null,
      },
    ],
    mcp_oauth_tokens: [
      oauthRow(
        "00000000-0000-4000-8000-000000000211",
        dmOAuth,
        "mcp:dm offline_access"
      ),
      oauthRow(
        "00000000-0000-4000-8000-000000000212",
        toolOAuth,
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

describe("Direct Message mode transport", () => {
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

describe("Direct Message mode over HTTP", () => {
  it("publishes the member's capabilities, never the tool catalogue", async () => {
    const { base } = await start()
    const response = await listTools(base, manualDm)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain("list_workspaces")
    for (const tool of CATALOG) expect(text).toContain(tool.name)
    // Tool mode's product operations are a different, separately approved mode.
    expect(text).not.toContain("get_context")
    expect(text).not.toContain("create_database")
  })

  it("merges the catalogues of every available granted workspace", async () => {
    const unavailableWorkspaceId = "00000000-0000-4000-8000-000000000003"
    const stub = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.action === "workspaces") {
        return jsonResponse(200, {
          ok: true,
          workspaces: [
            { workspaceId: productId, available: true },
            { workspaceId: otherProductId, available: true },
            { workspaceId: unavailableWorkspaceId, available: false },
          ],
        })
      }
      if (body.action === "catalog") {
        return jsonResponse(200, {
          ok: true,
          tools:
            body.workspaceId === otherProductId
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

    const response = await listTools(base, dmOAuth)
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
    ).toEqual([otherProductId, productId].sort())
  })

  it("fails discovery when an available workspace catalogue cannot load", async () => {
    const stub = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.action === "workspaces") {
        return jsonResponse(200, {
          ok: true,
          workspaces: [{ workspaceId: productId, available: true }],
        })
      }
      return jsonResponse(503, {
        ok: false,
        error: "Catalogue unavailable",
        code: "DIRECT_MESSAGE_UNAVAILABLE",
      })
    })
    const { base } = await start(stub)

    const response = await listTools(base, dmOAuth)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: "DIRECT_MESSAGE_UNAVAILABLE",
    })
  })

  it("runs a capability as the member in one named workspace", async () => {
    const { base, stub } = await start()
    const response = await rpc(base, manualDm, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "start_thread",
        arguments: { workspaceId: productId, projectId: "p1" },
      },
    })
    expect(response.status).toBe(200)
    const call = stub.mock.calls.at(-1)
    const body = JSON.parse(String((call?.[1] as RequestInit).body))
    expect(body).toMatchObject({
      action: "call",
      tool: "start_thread",
      workspaceId: productId,
      arguments: { projectId: "p1" },
    })
    expect(
      ((call?.[1] as RequestInit).headers as Record<string, string>)
        .Authorization
    ).toBe(`Bearer ${manualDm}`)
  })

  it("serves Direct Message mode to an mcp:dm grant and tool mode to the others", async () => {
    const { base } = await start()
    const dm = await (await listTools(base, dmOAuth)).text()
    expect(dm).toContain("read_thread")
    expect(dm).not.toContain("get_context")

    const tools = await (await listTools(base, toolOAuth)).text()
    expect(tools).toContain("get_context")
    expect(tools).not.toContain("read_thread")
  })

  it("states the role the client acts in", async () => {
    const { base } = await start()
    const response = await rpc(base, manualDm, {
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
    expect(text).toContain("act as the SignalSurf member")
    expect(text).toContain("authorized this connection")
  })

  it("advertises Direct Message mode first in its OAuth metadata", async () => {
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
