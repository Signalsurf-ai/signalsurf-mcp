import http from "node:http"
import type { Server } from "node:http"

import { afterEach, describe, expect, it } from "vitest"

import { sha256Hex } from "../src/auth.js"
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
    host: "127.0.0.1",
    port: 3333,
    path: "/mcp",
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

async function listen(config = makeConfig()): Promise<{
  server: Server
  url: string
}> {
  const app = createHttpApp(config, {
    createRepository: makeRepository,
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
  const dataLine = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
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
    ).toThrow("SIGNALSURF_MCP_AUTH_DISABLED is only allowed for stdio transport")
  })
})
