import http, { type Server } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"

import { sha256Hex } from "../src/auth.js"
import {
  MCP_DEFAULT_RESOURCE_SCOPES,
  MCP_OFFLINE_ACCESS_SCOPE,
  MCP_RESOURCE_SCOPES,
} from "../src/capabilities.js"
import { loadConfig, type AppConfig } from "../src/config.js"
import { createHttpApp } from "../src/http.js"
import { SignalSurfRepository } from "../src/repository.js"
import { FakeSupabase } from "./fake-supabase.js"

const workspaceId = "00000000-0000-4000-8000-000000000001"
const token = "ssmcp_test_token"

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role",
    transport: "http",
    authMode: "env",
    trustProxy: false,
    host: "127.0.0.1",
    port: 3333,
    path: "/mcp",
    resourceUrl: "http://127.0.0.1:3333/mcp",
    authorizationServerUrl: "https://app.signalsurf.test",
    allowedHosts: ["127.0.0.1", "localhost", "::1"],
    authDisabled: false,
    tokenEntries: [
      {
        name: "test-token",
        tokenSha256: sha256Hex(token),
        workspaceId,
        role: "editor",
      },
    ],
    ...overrides,
  }
}

function makeRepository() {
  return new SignalSurfRepository(
    new FakeSupabase({
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    }) as any
  )
}

async function listen(
  config = makeConfig(),
  createRepository = makeRepository
): Promise<{
  server: Server
  url: string
}> {
  const app = createHttpApp(config, {
    createRepository,
    directMessageFetch: (async () =>
      new Response(JSON.stringify({ ok: true, workspaces: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
  })
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP listener")
  }
  return { server, url: `http://127.0.0.1:${address.port}${config.path}` }
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function initializeBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "http-test", version: "0.0.0" },
    },
  })
}

function callToolBody(name: string, args: Record<string, unknown> = {}) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  })
}

function parseMcpText(text: string) {
  if (!text.startsWith("event:")) return JSON.parse(text)
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "))
  if (!dataLine) throw new Error(`Missing SSE data line: ${text}`)
  return JSON.parse(dataLine.slice("data: ".length))
}

async function readMcpJson(response: Response) {
  return parseMcpText(await response.text())
}

function requestWithHost(
  url: string,
  host: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "POST",
        headers: {
          Host: host,
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
      },
      (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          body += chunk
        })
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body })
        })
      }
    )
    req.on("error", reject)
    req.end(initializeBody())
  })
}

function getWithHeaders(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "GET",
        headers,
      },
      (res) => {
        res.resume()
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
          })
        })
      }
    )
    req.on("error", reject)
    req.end()
  })
}

let listeners: Server[] = []

afterEach(async () => {
  const toClose = listeners
  listeners = []
  await Promise.all(toClose.map(close))
})

describe("HTTP transport", () => {
  it("serves stateless MCP initialize requests with bearer auth", async () => {
    const { server, url } = await listen()
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("x-signalsurf-request-id")).toMatch(
      /^[0-9a-f-]{36}$/
    )
    const body = await readMcpJson(response)
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "signalsurf-mcp",
          title: "SignalSurf",
          icons: [
            {
              src: "https://app.signalsurf.test/apple-touch-icon.png",
              mimeType: "image/png",
              sizes: ["180x180"],
            },
          ],
        },
      },
    })
  })

  it("passes the existing MCP grant to the provider-neutral Web control plane", async () => {
    const createRepository = vi.fn(() => makeRepository())
    const { server, url } = await listen(
      makeConfig({ authorizationServerUrl: "https://app.signalsurf.ai" }),
      createRepository
    )
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(200)
    expect(createRepository).toHaveBeenCalledWith({
      authorizationServerUrl: "https://app.signalsurf.ai",
      accessToken: token,
    })
  })

  it("resolves hosted database tokens for HTTP auth", async () => {
    const userId = "00000000-0000-4000-8000-000000000102"
    const db = new FakeSupabase({
      workspaces: [{ id: workspaceId, organization_id: null }],
      workspace_members: [
        { workspace_id: workspaceId, user_id: userId, role: "member" },
      ],
      organization_members: [],
      mcp_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          workspace_id: workspaceId,
          created_by: userId,
          name: "hosted-agent",
          role: "editor",
          token_sha256: sha256Hex(token),
          revoked_at: null,
          last_used_at: null,
          last_used_ip: null,
        },
      ],
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const { server, url } = await listen(
      makeConfig({ authMode: "database", tokenEntries: [] }),
      () => new SignalSurfRepository(db as any)
    )
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(200)
    expect(db.tables.mcp_tokens[0].last_used_at).toEqual(expect.any(String))
    expect(db.tables.mcp_tokens[0].last_used_ip).toEqual(expect.any(String))
  })

  it("rejects revoked hosted database tokens", async () => {
    const db = new FakeSupabase({
      mcp_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          workspace_id: workspaceId,
          created_by: "00000000-0000-4000-8000-000000000102",
          name: "hosted-agent",
          role: "editor",
          token_sha256: sha256Hex(token),
          revoked_at: "2026-06-01T00:00:00Z",
        },
      ],
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const { server, url } = await listen(
      makeConfig({ authMode: "database", tokenEntries: [] }),
      () => new SignalSurfRepository(db as any)
    )
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(401)
  })

  it("does not trust spoofed forwarded IPs unless proxy trust is enabled", async () => {
    const userId = "00000000-0000-4000-8000-000000000102"
    const db = new FakeSupabase({
      workspaces: [{ id: workspaceId, organization_id: null }],
      workspace_members: [
        { workspace_id: workspaceId, user_id: userId, role: "member" },
      ],
      organization_members: [],
      mcp_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          workspace_id: workspaceId,
          created_by: userId,
          name: "hosted-agent",
          role: "editor",
          token_sha256: sha256Hex(token),
          revoked_at: null,
          last_used_ip: null,
        },
      ],
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const { server, url } = await listen(
      makeConfig({ authMode: "database", tokenEntries: [] }),
      () => new SignalSurfRepository(db as any)
    )
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.9",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(200)
    expect(db.tables.mcp_tokens[0].last_used_ip).not.toBe("203.0.113.9")
  })

  it("rejects missing and invalid bearer tokens", async () => {
    const { server, url } = await listen()
    listeners.push(server)

    const missing = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })
    expect(missing.status).toBe(401)
    expect(missing.headers.get("www-authenticate")).toContain("Bearer")

    const invalid = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer wrong",
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })
    expect(invalid.status).toBe(401)
    expect(await invalid.json()).toMatchObject({
      ok: false,
      code: "UNAUTHORIZED",
    })
  })

  it("advertises OAuth discovery metadata on database-auth 401 responses", async () => {
    const { server, url } = await listen(
      makeConfig({
        authMode: "database",
        authorizationServerUrl: "https://app.example.com",
        resourceUrl: "https://mcp.example.com/mcp",
        tokenEntries: [],
      })
    )
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"'
    )
    expect(response.headers.get("www-authenticate")).toContain(
      `scope="${["mcp:dm", ...MCP_DEFAULT_RESOURCE_SCOPES].join(" ")}"`
    )
    expect(response.headers.get("www-authenticate")).not.toContain(
      MCP_OFFLINE_ACCESS_SCOPE
    )
    expect(MCP_DEFAULT_RESOURCE_SCOPES).toContain("mcp:deepline.read")
    expect(MCP_DEFAULT_RESOURCE_SCOPES).toContain(
      "mcp:sender_infrastructure.read"
    )
    expect(MCP_DEFAULT_RESOURCE_SCOPES).not.toContain("mcp:deepline.enrich")
    expect(MCP_DEFAULT_RESOURCE_SCOPES).not.toContain("mcp:deepline.execute")
  })

  it("serves OAuth protected resource metadata", async () => {
    const { server, url } = await listen(
      makeConfig({
        authMode: "database",
        authorizationServerUrl: "https://app.example.com",
        resourceUrl: "https://mcp.example.com/mcp",
        tokenEntries: [],
      })
    )
    listeners.push(server)

    const response = await fetch(
      new URL("/.well-known/oauth-protected-resource", url)
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      resource: "https://mcp.example.com/mcp",
      authorization_servers: ["https://app.example.com"],
      scopes_supported: ["mcp:dm", ...MCP_RESOURCE_SCOPES],
    })
    expect(body.scopes_supported).not.toContain(MCP_OFFLINE_ACCESS_SCOPE)
    expect(body.scopes_supported).toEqual(
      expect.arrayContaining([
        "mcp:deepline.read",
        "mcp:deepline.enrich",
        "mcp:deepline.execute",
      ])
    )
    expect(body.scopes_supported).not.toContain("mcp:deepline.write")
  })

  it("resolves OAuth access tokens with harmless additive scopes", async () => {
    const resourceUrl = "https://mcp.example.com/mcp"
    const userId = "00000000-0000-4000-8000-000000000202"
    const db = new FakeSupabase({
      workspaces: [{ id: workspaceId, organization_id: null }],
      workspace_members: [
        { workspace_id: workspaceId, user_id: userId, role: "member" },
      ],
      organization_members: [],
      mcp_tokens: [],
      mcp_oauth_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000201",
          client_id: "ssmcp_client_test",
          user_id: userId,
          workspace_id: workspaceId,
          scope: "mcp:dm mcp:read mcp:write offline_access openid profile",
          resource: resourceUrl,
          access_token_sha256: sha256Hex(token),
          access_token_expires_at: "2999-01-01T00:00:00.000Z",
          revoked_at: null,
          last_used_at: null,
          last_used_ip: null,
        },
      ],
      mcp_oauth_clients: [
        {
          client_id: "ssmcp_client_test",
          client_name: "Claude",
          revoked_at: null,
        },
      ],
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const { server, url } = await listen(
      makeConfig({
        authMode: "database",
        resourceUrl,
        tokenEntries: [],
      }),
      () => new SignalSurfRepository(db as any)
    )
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(200)
    expect(db.tables.mcp_oauth_tokens[0].last_used_at).toEqual(
      expect.any(String)
    )
  })

  it("returns an OAuth insufficient-scope challenge for scoped HTTP tool calls", async () => {
    const resourceUrl = "https://mcp.example.com/mcp"
    const userId = "00000000-0000-4000-8000-000000000202"
    const db = new FakeSupabase({
      workspaces: [{ id: workspaceId, organization_id: null }],
      workspace_members: [
        { workspace_id: workspaceId, user_id: userId, role: "member" },
      ],
      organization_members: [],
      mcp_tokens: [],
      mcp_oauth_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000201",
          client_id: "ssmcp_client_test",
          user_id: userId,
          workspace_id: workspaceId,
          scope: "mcp:dm mcp:tables.read mcp:tables.write",
          resource: resourceUrl,
          access_token_sha256: sha256Hex(token),
          access_token_expires_at: "2999-01-01T00:00:00.000Z",
          revoked_at: null,
        },
      ],
      mcp_oauth_clients: [
        {
          client_id: "ssmcp_client_test",
          client_name: "Claude",
          revoked_at: null,
        },
      ],
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const { server, url } = await listen(
      makeConfig({
        authMode: "database",
        authorizationServerUrl: "https://app.example.com",
        resourceUrl,
        tokenEntries: [],
      }),
      () => new SignalSurfRepository(db as any)
    )
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: callToolBody("create_workflow", { name: "Denied" }),
    })

    expect(response.status).toBe(403)
    expect(response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"'
    )
    expect(response.headers.get("www-authenticate")).toContain(
      'scope="mcp:workflows.write"'
    )
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"'
    )
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_SCOPE",
      details: {
        oauthError: "insufficient_scope",
        requiredScopes: ["mcp:workflows.write"],
        toolName: "create_workflow",
      },
    })
    expect(db.tables.workflows).toHaveLength(0)
  })

  it("requires explicit workspaceId for multi-workspace OAuth HTTP tool calls", async () => {
    const resourceUrl = "https://mcp.example.com/mcp"
    const secondWorkspaceId = "00000000-0000-4000-8000-000000000002"
    const userId = "00000000-0000-4000-8000-000000000202"
    const db = new FakeSupabase({
      mcp_tokens: [],
      mcp_oauth_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000201",
          client_id: "ssmcp_client_test",
          user_id: userId,
          workspace_id: workspaceId,
          workspace_ids: [workspaceId, secondWorkspaceId],
          scope: "mcp:dm mcp:read",
          resource: resourceUrl,
          access_token_sha256: sha256Hex(token),
          access_token_expires_at: "2999-01-01T00:00:00.000Z",
          revoked_at: null,
        },
      ],
      mcp_oauth_clients: [
        {
          client_id: "ssmcp_client_test",
          client_name: "Claude",
          revoked_at: null,
        },
      ],
      workspaces: [
        {
          id: workspaceId,
          name: "Primary Workspace",
          organization_id: "00000000-0000-4000-8000-000000000701",
        },
        {
          id: secondWorkspaceId,
          name: "Second Workspace",
          organization_id: "00000000-0000-4000-8000-000000000702",
        },
      ],
      organizations: [
        {
          id: "00000000-0000-4000-8000-000000000701",
          name: "Primary Workspace",
        },
        {
          id: "00000000-0000-4000-8000-000000000702",
          name: "Second Workspace",
        },
      ],
      workspace_members: [
        { workspace_id: workspaceId, user_id: userId, role: "member" },
        { workspace_id: secondWorkspaceId, user_id: userId, role: "member" },
      ],
      organization_members: [],
      workflows: [
        {
          id: "00000000-0000-4000-8000-000000000301",
          workspace_id: secondWorkspaceId,
          name: "Second Workspace Workflow",
          description: null,
          is_default: false,
          is_active: true,
          show_ai_dashboard: true,
          icon: "folder.fill",
          color: "#5599FF",
          database_ids: [],
          relevance_threshold: null,
          prompt_template: null,
          scoring_rubric: null,
          surf_prompt: null,
          tool_config: {},
          variables: {},
          config: {},
          agent_id: null,
          display_order: 0,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          deleted_at: null,
        },
      ],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const { server, url } = await listen(
      makeConfig({
        authMode: "database",
        resourceUrl,
        tokenEntries: [],
      }),
      () => new SignalSurfRepository(db as any)
    )
    listeners.push(server)

    const contextResponse = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: callToolBody("get_context"),
    })

    expect(contextResponse.status).toBe(200)
    const contextBody = await readMcpJson(contextResponse)
    const contextContent = JSON.parse(contextBody.result.content[0].text)
    expect(contextContent.data.workspaces).toMatchObject([
      {
        workspaceId,
        name: "Primary Workspace",
        organizationName: "Primary Workspace",
      },
      {
        workspaceId: secondWorkspaceId,
        name: "Second Workspace",
        organizationName: "Second Workspace",
      },
    ])

    const missingWorkspace = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: callToolBody("list_workflows"),
    })

    expect(missingWorkspace.status).toBe(200)
    const missingBody = await readMcpJson(missingWorkspace)
    expect(missingBody.result.isError).toBe(true)
    expect(JSON.parse(missingBody.result.content[0].text)).toMatchObject({
      code: "BAD_REQUEST",
    })

    const explicitWorkspace = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: callToolBody("list_workflows", { workspaceId: secondWorkspaceId }),
    })

    expect(explicitWorkspace.status).toBe(200)
    const body = await readMcpJson(explicitWorkspace)
    const content = JSON.parse(body.result.content[0].text)
    expect(content.data.workflows).toMatchObject([
      { name: "Second Workspace Workflow" },
    ])
  })

  it("rejects OAuth access tokens with blank stored scopes", async () => {
    const resourceUrl = "https://mcp.example.com/mcp"
    const db = new FakeSupabase({
      mcp_tokens: [],
      mcp_oauth_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000201",
          client_id: "ssmcp_client_test",
          user_id: "00000000-0000-4000-8000-000000000202",
          workspace_id: workspaceId,
          scope: "  ",
          resource: resourceUrl,
          access_token_sha256: sha256Hex(token),
          access_token_expires_at: "2999-01-01T00:00:00.000Z",
          revoked_at: null,
        },
      ],
      mcp_oauth_clients: [
        {
          client_id: "ssmcp_client_test",
          client_name: "Claude",
          revoked_at: null,
        },
      ],
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const { server, url } = await listen(
      makeConfig({
        authMode: "database",
        resourceUrl,
        tokenEntries: [],
      }),
      () => new SignalSurfRepository(db as any)
    )
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(401)
  })

  it("rejects OAuth access tokens issued for another MCP resource", async () => {
    const db = new FakeSupabase({
      mcp_tokens: [],
      mcp_oauth_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000201",
          client_id: "ssmcp_client_test",
          user_id: "00000000-0000-4000-8000-000000000202",
          workspace_id: workspaceId,
          scope: "mcp:read",
          resource: "https://other.example.com/mcp",
          access_token_sha256: sha256Hex(token),
          access_token_expires_at: "2999-01-01T00:00:00.000Z",
          revoked_at: null,
        },
      ],
      mcp_oauth_clients: [
        {
          client_id: "ssmcp_client_test",
          client_name: "Claude",
          revoked_at: null,
        },
      ],
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const { server, url } = await listen(
      makeConfig({
        authMode: "database",
        resourceUrl: "https://mcp.example.com/mcp",
        tokenEntries: [],
      }),
      () => new SignalSurfRepository(db as any)
    )
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(401)
  })

  it("rejects unexpected Host headers", async () => {
    const { server, url } = await listen()
    listeners.push(server)

    const response = await requestWithHost(url, "evil.test")

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      code: "FORBIDDEN_HOST",
    })
  })

  it("returns MCP parse errors for malformed JSON", async () => {
    const { server, url } = await listen()
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{",
    })

    expect(response.status).toBe(400)
    expect(await readMcpJson(response)).toMatchObject({
      jsonrpc: "2.0",
      error: {
        code: -32700,
      },
      id: null,
    })
  })

  it("documents stateless GET and DELETE behavior as 405", async () => {
    const { server, url } = await listen()
    listeners.push(server)

    const getResponse = await fetch(url)
    expect(getResponse.status).toBe(405)
    expect(await getResponse.json()).toMatchObject({ ok: false })

    const deleteResponse = await fetch(url, { method: "DELETE" })
    expect(deleteResponse.status).toBe(405)
    expect(await deleteResponse.json()).toMatchObject({ ok: false })
  })

  it("publishes the connector icon from the authorization origin", async () => {
    const { server, url } = await listen(
      makeConfig({ authorizationServerUrl: "https://www.signalsurf.ai/oauth" })
    )
    listeners.push(server)
    const origin = new URL(url).origin

    for (const path of ["/favicon.ico", "/apple-touch-icon.png"]) {
      const response = await fetch(`${origin}${path}`, { redirect: "manual" })
      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(
        "https://www.signalsurf.ai/apple-touch-icon.png"
      )
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=3600"
      )
    }
  })

  it("does not redirect an icon request back to the same origin", async () => {
    const config = makeConfig({
      resourceUrl: "https://app.example.com:443/mcp",
      authorizationServerUrl: "https://app.example.com",
    })
    const { server, url } = await listen(config)
    listeners.push(server)
    const origin = new URL(url).origin

    const response = await fetch(`${origin}/apple-touch-icon.png`, {
      redirect: "manual",
    })
    expect(response.status).toBe(404)
    expect(response.headers.get("location")).toBeNull()
  })

  it("does not redirect an icon back through an allowed alternate host", async () => {
    const config = makeConfig({
      trustProxy: true,
      resourceUrl: "https://mcp.example.com/mcp",
      authorizationServerUrl: "https://app.example.com",
      allowedHosts: ["app.example.com"],
    })
    const { server, url } = await listen(config)
    listeners.push(server)

    const response = await getWithHeaders(
      `${new URL(url).origin}/apple-touch-icon.png`,
      { Host: "app.example.com:443", "X-Forwarded-Proto": "https" }
    )
    expect(response.status).toBe(404)
    expect(response.location).toBeUndefined()
  })

  it("does not advertise an icon through an allowed alternate host", async () => {
    const config = makeConfig({
      trustProxy: true,
      resourceUrl: "https://mcp.example.com/mcp",
      authorizationServerUrl: "https://app.example.com",
      allowedHosts: ["app.example.com"],
    })
    const { server, url } = await listen(config)
    listeners.push(server)

    const response = await requestWithHost(url, "app.example.com:443", {
      "X-Forwarded-Proto": "https",
    })
    expect(response.status).toBe(200)
    expect(parseMcpText(response.body).result.serverInfo.icons).toBeUndefined()
  })

  it("uses a trusted forwarded host to prevent an icon redirect loop", async () => {
    const config = makeConfig({
      trustProxy: true,
      resourceUrl: "https://mcp.example.com/mcp",
      authorizationServerUrl: "https://app.example.com",
    })
    const { server, url } = await listen(config)
    listeners.push(server)

    const response = await getWithHeaders(
      `${new URL(url).origin}/apple-touch-icon.png`,
      {
        Host: "127.0.0.1",
        "X-Forwarded-Host": "app.example.com:443",
        "X-Forwarded-Proto": "https",
      }
    )
    expect(response.status).toBe(404)
    expect(response.location).toBeUndefined()
  })

  it("preserves a valid HTTP-to-HTTPS icon redirect on the same host", async () => {
    const config = makeConfig({
      resourceUrl: "http://mcp.example.com/mcp",
      authorizationServerUrl: "https://app.example.com",
      allowedHosts: ["app.example.com"],
    })
    const { server, url } = await listen(config)
    listeners.push(server)

    const iconResponse = await getWithHeaders(
      `${new URL(url).origin}/apple-touch-icon.png`,
      { Host: "app.example.com" }
    )
    expect(iconResponse.status).toBe(302)
    expect(iconResponse.location).toBe(
      "https://app.example.com/apple-touch-icon.png"
    )

    const initializeResponse = await requestWithHost(url, "app.example.com")
    expect(initializeResponse.status).toBe(200)
    expect(parseMcpText(initializeResponse.body).result.serverInfo.icons).toEqual(
      [
        {
          src: "https://app.example.com/apple-touch-icon.png",
          mimeType: "image/png",
          sizes: ["180x180"],
        },
      ]
    )
  })

  it("does not advertise an icon that the same-origin server cannot serve", async () => {
    const config = makeConfig({
      resourceUrl: "https://app.example.com:443/mcp",
      authorizationServerUrl: "https://app.example.com",
    })
    const { server, url } = await listen(config)
    listeners.push(server)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: initializeBody(),
    })

    expect(response.status).toBe(200)
    const body = await readMcpJson(response)
    expect(body.result.serverInfo.icons).toBeUndefined()
  })

  it("rejects auth-disabled mode for HTTP config", () => {
    expect(() =>
      loadConfig({
        SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
        SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SIGNALSURF_MCP_TRANSPORT: "http",
        SIGNALSURF_MCP_AUTH_DISABLED: "true",
        SIGNALSURF_MCP_WORKSPACE_ID: workspaceId,
      })
    ).toThrow(
      "SIGNALSURF_MCP_AUTH_DISABLED is only allowed for stdio transport"
    )
  })

  it("requires HTTP transport for database auth mode", () => {
    expect(() =>
      loadConfig({
        SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
        SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SIGNALSURF_MCP_TRANSPORT: "stdio",
        SIGNALSURF_MCP_AUTH_MODE: "database",
      })
    ).toThrow("SIGNALSURF_MCP_AUTH_MODE=database is only supported for HTTP")
  })

  it("requires explicit hosted OAuth config for database auth mode", () => {
    expect(() =>
      loadConfig({
        SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
        SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SIGNALSURF_MCP_TRANSPORT: "http",
        SIGNALSURF_MCP_AUTH_MODE: "database",
        SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL: "https://app.example.com",
        SIGNALSURF_MCP_ALLOWED_HOSTS: "mcp.example.com",
      })
    ).toThrow("SIGNALSURF_MCP_RESOURCE_URL is required")

    expect(() =>
      loadConfig({
        SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
        SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SIGNALSURF_MCP_TRANSPORT: "http",
        SIGNALSURF_MCP_AUTH_MODE: "database",
        SIGNALSURF_MCP_RESOURCE_URL: "https://mcp.example.com/mcp",
        SIGNALSURF_MCP_ALLOWED_HOSTS: "mcp.example.com",
      })
    ).toThrow("SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL is required")

    expect(() =>
      loadConfig({
        SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
        SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SIGNALSURF_MCP_TRANSPORT: "http",
        SIGNALSURF_MCP_AUTH_MODE: "database",
        SIGNALSURF_MCP_RESOURCE_URL: "https://mcp.example.com/mcp",
        SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL: "https://app.example.com",
      })
    ).toThrow("SIGNALSURF_MCP_ALLOWED_HOSTS is required")
  })

  it("uses platform PORT defaults for hosted HTTP deployments", () => {
    const config = loadConfig({
      SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
      SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SIGNALSURF_MCP_TRANSPORT: "http",
      PORT: "4173",
    })

    expect(config.port).toBe(4173)
    expect(config.host).toBe("0.0.0.0")
  })

  it("lets platform PORT override SIGNALSURF_MCP_PORT", () => {
    const config = loadConfig({
      SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
      SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SIGNALSURF_MCP_TRANSPORT: "http",
      PORT: "4173",
      SIGNALSURF_MCP_PORT: "3333",
    })

    expect(config.port).toBe(4173)
  })

  it("reports invalid OAuth URL configuration as config errors", () => {
    expect(() =>
      loadConfig({
        SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
        SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SIGNALSURF_MCP_RESOURCE_URL: "not-a-url",
      })
    ).toThrow("SIGNALSURF_MCP_RESOURCE_URL must be an absolute URL")
  })

  it("reports invalid Supabase URL configuration as config errors", () => {
    expect(() =>
      loadConfig({
        SIGNALSURF_SUPABASE_URL: "example.supabase.co",
        SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
      })
    ).toThrow("SIGNALSURF_SUPABASE_URL must be a valid HTTP or HTTPS URL")
  })
})
