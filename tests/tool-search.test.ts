import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"

import { createSignalSurfMcpServer } from "../src/server.js"
import { searchCapabilities } from "../src/tool-search.js"
import type { SignalSurfContext } from "../src/types.js"

const catalog = {
  tools: [
    {
      name: "run_enrich",
      title: "Run Enrich",
      description: "Queue Enrich for a column to backfill rows.",
    },
    {
      name: "deepline_search_people",
      title: "Search People via Deepline",
      description: "Search people through Deepline's Apollo people search.",
    },
    {
      name: "list_tables",
      title: "List Tables",
      description: "List databases/tables for an authorized workspace.",
    },
  ],
  prompts: [
    {
      name: "enrich_table",
      title: "Enrich a table (Enrich)",
      description: "Guided workflow to enrich an entire table using Enrich.",
    },
    {
      name: "build_lead_list",
      title: "Build a lead list (Deepline)",
      description: "Find prospects with Deepline and enrich emails.",
    },
  ],
}

describe("searchCapabilities", () => {
  it("ranks the enrich_table prompt first and surfaces the enrich tool", () => {
    const result = searchCapabilities("enrich a table", catalog)
    expect(result.prompts[0].name).toBe("enrich_table")
    expect(result.tools.map((t) => t.name)).toContain("run_enrich")
  })

  it("matches deepline/lead intent", () => {
    const result = searchCapabilities("find leads with deepline", catalog)
    expect(result.tools.map((t) => t.name)).toContain("deepline_search_people")
    expect(result.prompts.map((p) => p.name)).toContain("build_lead_list")
  })

  it("maps CRM language to Table and record capabilities", () => {
    const result = searchCapabilities("show CRM records", catalog)
    expect(result.tools.map((tool) => tool.name)).toContain("list_tables")
  })

  it("returns prompts as the entry point for an empty query", () => {
    const result = searchCapabilities("   ", catalog)
    expect(result.tools).toHaveLength(0)
    expect(result.prompts).toHaveLength(2)
    expect(result.hint).toMatch(/Describe what you want/)
  })

  it("returns a helpful hint when nothing matches", () => {
    const result = searchCapabilities("zzzzz nonsense", catalog)
    expect(result.tools).toHaveLength(0)
    expect(result.prompts).toHaveLength(0)
    expect(result.hint).toMatch(/No capability matched/)
  })
})

describe("find_capabilities tool over MCP", () => {
  let cleanup: Array<() => Promise<void>> = []
  afterEach(async () => {
    await Promise.all(cleanup.map((fn) => fn()))
    cleanup = []
  })

  it("returns matching prompts/tools and respects capability gating", async () => {
    const context: SignalSurfContext = {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      role: "viewer",
    }
    const server = await createSignalSurfMcpServer({
      context,
      repository: {} as any,
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

    const result = await client.callTool({
      name: "find_capabilities",
      arguments: { query: "enrich a table" },
    })
    expect(result.isError).toBeFalsy()
    const data = (result.structuredContent as any).data
    expect(data.prompts.map((p: any) => p.name)).toContain("enrich_table")
    const toolNames = data.tools.map((t: any) => t.name)
    expect(toolNames).toContain("get_enrichment_context")
    // run_enrich needs workflows.execute — a viewer token must not see it.
    expect(toolNames).not.toContain("run_enrich")
  })

  it("does not recommend Project tools outside the token grant", async () => {
    const context: SignalSurfContext = {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      role: "editor",
      scopes: ["mcp:tables.read"],
    }
    const server = await createSignalSurfMcpServer({
      context,
      repository: {} as any,
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

    const result = await client.callTool({
      name: "find_capabilities",
      arguments: { query: "project thread" },
    })
    expect(result.isError).toBeFalsy()
    const toolNames = (result.structuredContent as any).data.tools.map(
      (tool: any) => tool.name
    )
    expect(toolNames).not.toContain("list_projects")
    expect(toolNames).not.toContain("start_thread")

    // Discovery remains stable even when execution/search is grant-filtered.
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "start_thread"
    )
  })

  it("keeps the CRM bootstrap tool within the full catalog result limit", async () => {
    const context: SignalSurfContext = {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      role: "editor",
    }
    const server = await createSignalSurfMcpServer({
      context,
      repository: {} as any,
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

    const result = await client.callTool({
      name: "find_capabilities",
      arguments: { query: "show CRM records" },
    })
    expect(result.isError).toBeFalsy()
    const toolNames = (result.structuredContent as any).data.tools.map(
      (tool: any) => tool.name
    )
    expect(toolNames).toHaveLength(8)
    expect(toolNames).toContain("list_tables")
  })
})
