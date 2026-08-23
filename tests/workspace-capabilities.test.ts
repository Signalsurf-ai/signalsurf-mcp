import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"

import { SignalSurfRepository } from "../src/repository.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import type { SignalSurfContext } from "../src/types.js"
import {
  WORKSPACE_CAPABILITIES,
  loadWorkspaceCapabilities,
  resolveEffectiveWorkspaceCapabilities,
} from "../src/workspace-capabilities.js"
import { FakeSupabase } from "./fake-supabase.js"

const productId = "00000000-0000-4000-8000-000000000001"
const organizationId = "00000000-0000-4000-8000-000000000002"
let cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()))
  cleanup = []
})

function policyDb(overrides: Array<Record<string, unknown>> = []) {
  return new FakeSupabase({
    products: [
      { id: productId, organization_id: organizationId, name: "Acme" },
    ],
    product_capability_overrides: overrides,
    subscriptions: [],
    billing_plan_catalog: [
      {
        plan_key: "individual",
        workspace_capabilities: [...WORKSPACE_CAPABILITIES],
      },
    ],
    playbooks: [],
    databases: [],
    entries: [],
    surf_jobs: [],
    user_preferences: [],
    sources: [],
    product_tools: [],
  })
}

async function connect(db: FakeSupabase) {
  const context: SignalSurfContext = {
    productId,
    products: [{ productId, name: "Acme", organizationId }],
    role: "editor",
  }
  const server = await createSignalSurfMcpServer({
    context,
    repository: new SignalSurfRepository(db as any),
  })
  const client = new Client({ name: "test-client", version: "0.0.0" })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  cleanup.push(async () => client.close())
  cleanup.push(async () => server.close())
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return client
}

describe("hosted MCP Workspace capability projection", () => {
  it("projects plan defaults with explicit Workspace overrides", () => {
    expect(
      resolveEffectiveWorkspaceCapabilities(
        ["tables", "workflows"],
        [
          { capability_key: "workflows", enabled: false },
          { capability_key: "campaigns", enabled: true },
        ]
      )
    ).toEqual(["tables", "campaigns"])
  })

  it("keeps existing workspaces enabled during a rolling schema deploy", async () => {
    const db = new FakeSupabase(
      {
        products: [{ id: productId, organization_id: organizationId }],
        product_capability_overrides: [],
      },
      {
        tableErrors: {
          subscriptions: {
            code: "42703",
            message: "column current_period_end does not exist",
          },
        },
      }
    )

    await expect(
      loadWorkspaceCapabilities(db as any, [productId])
    ).resolves.toEqual({ [productId]: [...WORKSPACE_CAPABILITIES] })
  })

  it("omits disabled tools, prompts, discovery entries, and resources", async () => {
    const db = policyDb([
      { product_id: productId, capability_key: "tables", enabled: false },
      { product_id: productId, capability_key: "workflows", enabled: false },
    ])
    const client = await connect(db)

    const tools = await client.listTools()
    const toolNames = tools.tools.map((tool) => tool.name)
    expect(toolNames).not.toContain("list_tables")
    expect(toolNames).not.toContain("create_table")
    expect(toolNames).not.toContain("list_surf_points")
    expect(toolNames).not.toContain("list_signals")
    expect(toolNames).toContain("create_campaign")
    expect(toolNames).toContain("find_capabilities")

    await expect(client.listPrompts()).rejects.toThrow("Method not found")

    const resources = await client.listResources()
    const resourceUris = resources.resources.map((resource) => resource.uri)
    expect(resourceUris).not.toContain("signalsurf://surf-points")
    expect(resourceUris).not.toContain("signalsurf://databases")

    const discovery = await client.callTool({
      name: "find_capabilities",
      arguments: { query: "table workflow" },
    })
    const text =
      discovery.content?.[0]?.type === "text" ? discovery.content[0].text : ""
    const body = JSON.parse(text)
    expect(
      body.data.tools.map((tool: { name: string }) => tool.name)
    ).not.toEqual(expect.arrayContaining(["list_tables", "list_surf_points"]))
    expect(body.data.prompts).toEqual([])
  })

  it("rechecks policy before a stale registered tool can mutate", async () => {
    const db = policyDb()
    const client = await connect(db)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "create_table"
    )

    db.tables.product_capability_overrides.push({
      product_id: productId,
      capability_key: "tables",
      enabled: false,
    })
    const result = await client.callTool({
      name: "create_table",
      arguments: { name: "Must not exist" },
    })
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""

    expect(result.isError).toBe(true)
    expect(JSON.parse(text)).toMatchObject({
      code: "FORBIDDEN",
      error: "This operation is unavailable in the current Workspace.",
    })
    expect(db.tables.databases).toEqual([])
  })
})
