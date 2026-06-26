import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"
import { searchCapabilities } from "../src/tool-search.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import type { SignalSurfContext } from "../src/types.js"

const catalog = {
  tools: [
    {
      name: "run_quick_surf",
      title: "Run Quick Surf",
      description: "Queue Quick Surf enrichment for a column to backfill rows.",
    },
    {
      name: "deepline_search_people",
      title: "Search People via Deepline",
      description: "Search people through Deepline's Apollo people search.",
    },
    {
      name: "list_tables",
      title: "List Tables",
      description: "List databases/tables for an authorized product.",
    },
  ],
  prompts: [
    {
      name: "enrich_table",
      title: "Enrich a table (Quick Surf)",
      description: "Guided workflow to enrich an entire table using Quick Surf.",
    },
    {
      name: "build_lead_list",
      title: "Build a lead list (Deepline)",
      description: "Find prospects with Deepline and enrich emails.",
    },
  ],
}

describe("searchCapabilities", () => {
  it("ranks the enrich_table prompt first and surfaces the quick surf tool", () => {
    const result = searchCapabilities("enrich a table", catalog)
    expect(result.prompts[0].name).toBe("enrich_table")
    expect(result.tools.map((t) => t.name)).toContain("run_quick_surf")
  })

  it("matches deepline/lead intent", () => {
    const result = searchCapabilities("find leads with deepline", catalog)
    expect(result.tools.map((t) => t.name)).toContain("deepline_search_people")
    expect(result.prompts.map((p) => p.name)).toContain("build_lead_list")
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
      productId: "00000000-0000-4000-8000-000000000001",
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
    // run_quick_surf needs surf_points.execute — a viewer token must not see it.
    expect(toolNames).not.toContain("run_quick_surf")
  })
})
