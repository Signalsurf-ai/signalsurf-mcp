import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"

import { SignalSurfRepository } from "../src/repository.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"

const context: SignalSurfContext = {
  productId: "00000000-0000-4000-8000-000000000001",
  role: "viewer",
}
const databaseId = "00000000-0000-4000-8000-000000000201"

let cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()))
  cleanup = []
})

describe("MCP server", () => {
  it("registers SignalSurf tools and executes read calls over MCP", async () => {
    const db = new FakeSupabase({
      playbooks: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          product_id: context.productId,
          name: "Active",
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
          folder_id: null,
          display_order: 0,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          deleted_at: null,
        },
      ],
      databases: [
        {
          id: databaseId,
          product_id: context.productId,
          name: "Companies",
          description: null,
          icon: null,
          color: null,
          schema: null,
          item_type: "company",
          system_type: null,
          view_configs: {},
          display_order: 0,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
        },
      ],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const server = createSignalSurfMcpServer({
      context,
      repository: new SignalSurfRepository(db as any),
    })
    const client = new Client({ name: "test-client", version: "0.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    cleanup.push(async () => client.close())
    cleanup.push(async () => server.close())

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_surf_points",
        "create_surf_point",
        "delete_surf_point",
        "read_table",
        "update_table_row",
      ])
    )

    const result = await client.callTool({
      name: "list_surf_points",
      arguments: {},
    })

    expect(result.isError).toBeFalsy()
    const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(JSON.parse(text).data.surfPoints[0].name).toBe("Active")

    const resources = await client.listResources()
    expect(resources.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining([
        "signalsurf://context",
        "signalsurf://surf-points",
        "signalsurf://databases",
        `signalsurf://databases/${databaseId}/rows`,
      ])
    )
  })

  it("returns MCP tool errors for viewer write attempts", async () => {
    const db = new FakeSupabase({
      playbooks: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const server = createSignalSurfMcpServer({
      context,
      repository: new SignalSurfRepository(db as any),
    })
    const client = new Client({ name: "test-client", version: "0.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    cleanup.push(async () => client.close())
    cleanup.push(async () => server.close())

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const result = await client.callTool({
      name: "create_surf_point",
      arguments: { name: "Forbidden" },
    })

    expect(result.isError).toBe(true)
    const text = result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    })
    expect(db.tables.playbooks).toHaveLength(0)
  })
})
