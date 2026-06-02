import http from "node:http"
import type { Server } from "node:http"

import { afterEach, describe, expect, it } from "vitest"

import { sha256Hex } from "../src/auth.js"
import {
  MCP_DEFAULT_RESOURCE_SCOPES,
  MCP_OFFLINE_ACCESS_SCOPE,
  MCP_RESOURCE_SCOPES,
} from "../src/capabilities.js"
import type { AppConfig } from "../src/config.js"
import { loadConfig } from "../src/config.js"
import { createHttpApp } from "../src/http.js"
import { SignalSurfRepository } from "../src/repository.js"
import { FakeSupabase } from "./fake-supabase.js"

const productId = "00000000-0000-4000-8000-000000000001"
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
    allowedHosts: ["127.0.0.1", "localhost", "::1"],
    authDisabled: false,
    tokenEntries: [
      {
        name: "test-token",
        tokenSha256: sha256Hex(token),
        productId,
        role: "editor",
      },
    ],
    ...overrides,
  }
}

function makeRepository() {
  return new SignalSurfRepository(
    new FakeSupabase({
      playbooks: [],
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

async function readMcpJson(response: Response) {
  const text = await response.text()
  if (!text.startsWith("event:")) return JSON.parse(text)
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "))
  if (!dataLine) throw new Error(`Missing SSE data line: ${text}`)
  return JSON.parse(dataLine.slice("data: ".length))
}

function requestWithHost(
  url: string,
  host: string
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
    const body = await readMcpJson(response)
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "signalsurf-mcp",
        },
      },
    })
  })

  it("resolves hosted database tokens for HTTP auth", async () => {
    const db = new FakeSupabase({
      mcp_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          product_id: productId,
          created_by: "00000000-0000-4000-8000-000000000102",
          name: "hosted-agent",
          role: "editor",
          token_sha256: sha256Hex(token),
          revoked_at: null,
          last_used_at: null,
          last_used_ip: null,
        },
      ],
      playbooks: [],
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
          product_id: productId,
          created_by: "00000000-0000-4000-8000-000000000102",
          name: "hosted-agent",
          role: "editor",
          token_sha256: sha256Hex(token),
          revoked_at: "2026-06-01T00:00:00Z",
        },
      ],
      playbooks: [],
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
    const db = new FakeSupabase({
      mcp_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          product_id: productId,
          created_by: null,
          name: "hosted-agent",
          role: "editor",
          token_sha256: sha256Hex(token),
          revoked_at: null,
          last_used_ip: null,
        },
      ],
      playbooks: [],
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
      `scope="${MCP_DEFAULT_RESOURCE_SCOPES.join(" ")}"`
    )
    expect(response.headers.get("www-authenticate")).not.toContain(
      MCP_OFFLINE_ACCESS_SCOPE
    )
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
      scopes_supported: MCP_RESOURCE_SCOPES,
    })
    expect(body.scopes_supported).not.toContain(MCP_OFFLINE_ACCESS_SCOPE)
  })

  it("resolves OAuth access tokens with harmless additive scopes", async () => {
    const resourceUrl = "https://mcp.example.com/mcp"
    const db = new FakeSupabase({
      mcp_tokens: [],
      mcp_oauth_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000201",
          client_id: "ssmcp_client_test",
          user_id: "00000000-0000-4000-8000-000000000202",
          product_id: productId,
          scope: "mcp:read mcp:write offline_access openid profile",
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
      playbooks: [],
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

  it("rejects OAuth access tokens with blank stored scopes", async () => {
    const resourceUrl = "https://mcp.example.com/mcp"
    const db = new FakeSupabase({
      mcp_tokens: [],
      mcp_oauth_tokens: [
        {
          id: "00000000-0000-4000-8000-000000000201",
          client_id: "ssmcp_client_test",
          user_id: "00000000-0000-4000-8000-000000000202",
          product_id: productId,
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
      playbooks: [],
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
          product_id: productId,
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
      playbooks: [],
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

  it("rejects auth-disabled mode for HTTP config", () => {
    expect(() =>
      loadConfig({
        SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
        SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SIGNALSURF_MCP_TRANSPORT: "http",
        SIGNALSURF_MCP_AUTH_DISABLED: "true",
        SIGNALSURF_MCP_PRODUCT_ID: productId,
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
