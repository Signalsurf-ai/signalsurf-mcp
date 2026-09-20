import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { sha256Hex } from "../src/auth.js"
import { PUBLIC_MCP_TOOL_NAMES } from "../src/capabilities.js"
import { createHttpApp } from "../src/http.js"
import { SignalSurfRepository } from "../src/repository.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import {
  SURFER_SESSION_TOOL_NAMES,
  SurferSessionClient,
} from "../src/surfer-session.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"
import type { AppConfig } from "../src/config.js"
import type { Server } from "node:http"

const productId = "00000000-0000-4000-8000-000000000001"
const memberId = "00000000-0000-4000-8000-000000000102"
const sessionId = "00000000-0000-4000-8000-000000000301"
const token = "ssmcp_session_token"

let cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()))
  cleanup = []
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function connect(context: SignalSurfContext, fetchImpl?: typeof fetch) {
  const repository = new SignalSurfRepository(new FakeSupabase({}) as any)
  const server = await createSignalSurfMcpServer({
    context,
    repository,
    surferSession: {
      baseUrl: "https://app.signalsurf.test/",
      accessToken: token,
      fetch: fetchImpl,
    },
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "session-test", version: "0.0.0" })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  cleanup.push(async () => {
    await client.close()
    await server.close()
  })
  return client
}

describe("Surfer session relay transport", () => {
  it("calls a fetch bound to globalThis, as workerd requires", async () => {
    // A bare `fetch` stored on the client and called as `this.fetchImpl(...)`
    // throws "Illegal invocation" on workerd while passing on Node, so the
    // receiver is asserted here instead of in production (SIG-2676).
    const original = globalThis.fetch
    const receivers: unknown[] = []
    globalThis.fetch = function trackingFetch(this: unknown) {
      receivers.push(this)
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, workspaces: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    } as unknown as typeof fetch
    try {
      const client = new SurferSessionClient({
        baseUrl: "https://app.signalsurf.test",
        accessToken: "ssmcp_at_test",
      })
      await client.call("workspaces", {})
    } finally {
      globalThis.fetch = original
    }
    expect(receivers).toHaveLength(1)
    expect(receivers[0] === globalThis || receivers[0] === undefined).toBe(true)
  })
})

describe("Surfer session mode", () => {
  it("resolves the token mode from the hosted database row", async () => {
    const db = new FakeSupabase({
      mcp_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          workspace_id: productId,
          created_by: memberId,
          name: "claude-session",
          role: "editor",
          mode: "surfer_session",
          token_sha256: sha256Hex(token),
          revoked_at: null,
          last_used_at: null,
          last_used_ip: null,
        },
        {
          id: "00000000-0000-4000-8000-000000000103",
          workspace_id: productId,
          created_by: memberId,
          name: "tools",
          role: "viewer",
          mode: "tools",
          token_sha256: sha256Hex("ssmcp_tools"),
          revoked_at: null,
          last_used_at: null,
          last_used_ip: null,
        },
      ],
    })
    const repository = new SignalSurfRepository(db as any)
    const session = await repository.resolveMcpToken(token)
    expect(session?.mode).toBe("surfer_session")
    expect(session?.authKind).toBe("manual")
    const tools = await repository.resolveMcpToken("ssmcp_tools")
    expect(tools?.mode).toBe("tools")
  })

  it("registers only the session tools in session mode and none in tool mode", async () => {
    const sessionClient = await connect({
      productId,
      role: "editor",
      mode: "surfer_session",
    })
    const sessionTools = (await sessionClient.listTools()).tools
      .map((tool) => tool.name)
      .sort()
    expect(sessionTools).toEqual([...SURFER_SESSION_TOOL_NAMES].sort())
    expect(sessionTools).not.toContain("get_context")

    const toolClient = await connect({ productId, role: "editor", mode: "tools" })
    const toolNames = (await toolClient.listTools()).tools.map((t) => t.name)
    for (const name of SURFER_SESSION_TOOL_NAMES) {
      expect(toolNames).not.toContain(name)
      expect(PUBLIC_MCP_TOOL_NAMES).not.toContain(name)
    }
    expect(toolNames).toContain("get_context")
  })

  it("relays message_surfer with the bearer token, echoes the occurrence id, and reuses it on retry", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      return jsonResponse(200, {
        ok: true,
        session: { id: sessionId, workspaceId: productId, closedAt: null },
        message: { eventId: "e1", sequence: 7, deduplicated: calls.length > 1 },
        reply: { status: "pending", deliveryPending: true, activeRunId: null },
        pending: { confirmations: [], decisions: [] },
      })
    })
    const client = await connect(
      { productId, role: "editor", mode: "surfer_session" },
      fetchImpl as unknown as typeof fetch
    )
    const first = await client.callTool({
      name: "message_surfer",
      arguments: { message: "Find 20 fintech CFOs in Project Alpha" },
    })
    const firstPayload = JSON.parse((first.content as any)[0].text)
    expect(calls[0].url).toBe(
      "https://app.signalsurf.test/api/mcp/surfer-session"
    )
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${token}`
    )
    const sentBody = JSON.parse(String(calls[0].init.body))
    expect(sentBody).toMatchObject({
      action: "message",
      sessionId: null,
      message: "Find 20 fintech CFOs in Project Alpha",
      waitSeconds: 25,
    })
    expect(sentBody.occurrenceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(firstPayload.occurrenceId).toBe(sentBody.occurrenceId)
    expect(firstPayload.nextStep).toContain("afterSequence = 7")

    await client.callTool({
      name: "message_surfer",
      arguments: {
        sessionId,
        message: "Find 20 fintech CFOs in Project Alpha",
        occurrenceId: sentBody.occurrenceId,
      },
    })
    const retryBody = JSON.parse(String(calls[1].init.body))
    expect(retryBody.occurrenceId).toBe(sentBody.occurrenceId)
    expect(retryBody.sessionId).toBe(sessionId)
  })

  it("lists granted workspaces and forwards workspaceId on every session action (SIG-2669)", async () => {
    const otherWorkspace = "00000000-0000-4000-8000-000000000002"
    const bodies: any[] = []
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      if (body.action === "workspaces") {
        return jsonResponse(200, {
          ok: true,
          workspaces: [
            { workspaceId: productId, name: "Alpha", home: true, available: true, openSessions: 1 },
            { workspaceId: otherWorkspace, name: "Beta", home: false, available: true, openSessions: 0 },
          ],
        })
      }
      return jsonResponse(200, {
        ok: true,
        session: { id: sessionId, workspaceId: otherWorkspace, closedAt: null },
        message: { eventId: "e1", sequence: 1, deduplicated: false },
        reply: { status: "replied", eventId: "e2", sequence: 2, text: "ok" },
        pending: { confirmations: [], decisions: [] },
      })
    })
    const client = await connect(
      { productId, role: "editor", mode: "surfer_session" },
      fetchImpl as unknown as typeof fetch
    )
    const listed = await client.callTool({
      name: "list_surfer_workspaces",
      arguments: {},
    })
    expect(JSON.parse((listed.content as any)[0].text).workspaces).toHaveLength(2)
    await client.callTool({
      name: "message_surfer",
      arguments: { workspaceId: otherWorkspace, message: "Status in Beta?" },
    })
    await client.callTool({
      name: "read_surfer_session",
      arguments: { workspaceId: otherWorkspace, sessionId },
    })
    await client.callTool({
      name: "close_surfer_session",
      arguments: { sessionId },
    })
    expect(bodies.map((body) => body.action)).toEqual([
      "workspaces",
      "message",
      "read",
      "close",
    ])
    expect(bodies[0]).toEqual({ action: "workspaces" })
    expect(bodies[1].workspaceId).toBe(otherWorkspace)
    expect(bodies[2].workspaceId).toBe(otherWorkspace)
    // Omitted workspaceId is sent as null so the web relay decides from the
    // grant or the session; the MCP never guesses a workspace.
    expect(bodies[3].workspaceId).toBeNull()
  })

  it("preserves web relay error codes and statuses", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(403, {
        ok: false,
        error: "Session token member is no longer a workspace member",
        code: "MEMBERSHIP_REVOKED",
      })
    )
    const client = new SurferSessionClient({
      baseUrl: "https://app.signalsurf.test",
      accessToken: token,
      fetch: fetchImpl as unknown as typeof fetch,
    })
    await expect(client.read({ sessionId, limit: 50 })).rejects.toMatchObject({
      status: 403,
      code: "MEMBERSHIP_REVOKED",
    })
    const down = new SurferSessionClient({
      baseUrl: "https://app.signalsurf.test",
      accessToken: token,
      fetch: (async () => jsonResponse(502, {})) as unknown as typeof fetch,
    })
    await expect(down.close({ sessionId })).rejects.toMatchObject({
      status: 503,
      code: "SURFER_SESSION_UNAVAILABLE",
    })
  })

  it("requires exactly one of decision or answer when answering a confirmation", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, result: {} }))
    const client = new SurferSessionClient({
      baseUrl: "https://app.signalsurf.test",
      accessToken: token,
      fetch: fetchImpl as unknown as typeof fetch,
    })
    await expect(
      client.answerConfirmation({ sessionId, confirmationId: "op:x" })
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      client.answerConfirmation({
        sessionId,
        confirmationId: "op:x",
        decision: "approve",
        answer: { choice: "a" },
      })
    ).rejects.toMatchObject({ status: 422 })
    const ok = await client.answerConfirmation({
      sessionId,
      confirmationId: "decision:y",
      answer: { choice: "a" },
    })
    expect(ok.occurrenceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("serves session-mode tools over HTTP for a database session token", async () => {
    const db = new FakeSupabase({
      mcp_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          workspace_id: productId,
          created_by: memberId,
          name: "claude-session",
          role: "editor",
          mode: "surfer_session",
          token_sha256: sha256Hex(token),
          revoked_at: null,
          last_used_at: null,
          last_used_ip: null,
        },
      ],
    })
    const config: AppConfig = {
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role",
      transport: "http",
      authMode: "database",
      trustProxy: false,
      host: "127.0.0.1",
      port: 3333,
      path: "/mcp",
      resourceUrl: "http://127.0.0.1:3333/mcp",
      authorizationServerUrl: "https://app.signalsurf.test",
      allowedHosts: ["127.0.0.1", "localhost", "::1"],
      authDisabled: false,
      tokenEntries: [],
    } as AppConfig
    const relayFetch = vi.fn(async () =>
      jsonResponse(200, { ok: true, sessions: [] })
    )
    const app = createHttpApp(config, {
      createRepository: () => new SignalSurfRepository(db as any),
      surferSessionFetch: relayFetch as unknown as typeof fetch,
    })
    const server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
    })
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve()))
    )
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("no port")
    const url = `http://127.0.0.1:${address.port}/mcp`
    const headers = {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }
    const list = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    })
    expect(list.status).toBe(200)
    const listText = await list.text()
    for (const name of SURFER_SESSION_TOOL_NAMES) expect(listText).toContain(name)
    expect(listText).not.toContain("get_context")

    const read = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "read_surfer_session", arguments: {} },
      }),
    })
    expect(read.status).toBe(200)
    expect(relayFetch).toHaveBeenCalledTimes(1)
    const relayInit = relayFetch.mock.calls[0][1] as RequestInit
    expect((relayInit.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${token}`
    )
  })

  describe("OAuth Direct Message mode (SIG-2673)", () => {
    const resource = "http://127.0.0.1:3333/mcp"
    const sessionOAuth = "ssmcp_at_session_grant"
    const toolOAuth = "ssmcp_at_tool_grant"
    const manualTools = "ssmcp_live_manual_tools"

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

    async function start() {
      const db = new FakeSupabase({
        mcp_tokens: [
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
            sessionOAuth,
            "mcp:dm offline_access"
          ),
          oauthRow(
            "00000000-0000-4000-8000-000000000212",
            toolOAuth,
            "mcp:read offline_access"
          ),
        ],
        mcp_oauth_clients: [
          { client_id: "ssmcp_client_claude", client_name: "Claude", revoked_at: null },
        ],
      })
      const config = {
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
      const app = createHttpApp(config, {
        createRepository: () => new SignalSurfRepository(db as any),
        surferSessionFetch: vi.fn(async () =>
          jsonResponse(200, { ok: true, sessions: [] })
        ) as unknown as typeof fetch,
      })
      const server = await new Promise<Server>((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
      })
      cleanup.push(
        () => new Promise<void>((resolve) => server.close(() => resolve()))
      )
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("no port")
      return `http://127.0.0.1:${address.port}`
    }

    function listTools(base: string, bearer?: string) {
      return fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      })
    }

    it("advertises Direct Message mode alongside the tool scopes", async () => {
      const base = await start()
      const metadata = await (
        await fetch(`${base}/.well-known/oauth-protected-resource`)
      ).json()
      expect(metadata.resource).toBe(resource)
      expect(metadata.scopes_supported[0]).toBe("mcp:dm")
      expect(metadata.scopes_supported).toContain("mcp:read")

      const challenge = await listTools(base)
      expect(challenge.status).toBe(401)
      expect(challenge.headers.get("www-authenticate")).toContain(
        'scope="mcp:dm '
      )
    })

    it("serves only the Surfer relay tools to a Direct Message grant", async () => {
      const base = await start()
      const response = await listTools(base, sessionOAuth)
      expect(response.status).toBe(200)
      const text = await response.text()
      for (const name of SURFER_SESSION_TOOL_NAMES) expect(text).toContain(name)
      expect(text).not.toContain("get_context")
    })

    it("keeps serving product tools to a Tools mode grant", async () => {
      const base = await start()
      const response = await listTools(base, toolOAuth)
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toContain("get_context")
      for (const name of SURFER_SESSION_TOOL_NAMES) {
        expect(text).not.toContain(name)
      }
    })
  })
})
