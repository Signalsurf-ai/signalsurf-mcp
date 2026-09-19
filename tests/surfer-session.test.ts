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

describe("Surfer session mode", () => {
  it("resolves the token mode from the hosted database row", async () => {
    const db = new FakeSupabase({
      mcp_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          product_id: productId,
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
          product_id: productId,
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

  it("registers only the four session tools in session mode and none in tool mode", async () => {
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
          product_id: productId,
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
})
