import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"
import { buildEnrichTablePrompt } from "../src/prompts.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import type { SignalSurfContext } from "../src/types.js"

describe("buildEnrichTablePrompt", () => {
  it("instructs discovery when no databaseId is given", () => {
    const text = buildEnrichTablePrompt({})
    expect(text).toMatch(/list_tables/)
    expect(text).toMatch(/get_enrichment_context/)
    expect(text).toMatch(/enable_quick_surf/)
    expect(text).toMatch(/run_quick_surf/)
    expect(text).toMatch(/wait_for_surf_job/)
  })

  it("embeds the resolved databaseId when provided", () => {
    const text = buildEnrichTablePrompt({ databaseId: "db-42" })
    expect(text).toContain("db-42")
  })
})

describe("enrich_table prompt over MCP", () => {
  let cleanup: Array<() => Promise<void>> = []
  afterEach(async () => {
    await Promise.all(cleanup.map((fn) => fn()))
    cleanup = []
  })

  it("is listed and renders with a passed databaseId argument", async () => {
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

    const prompts = await client.listPrompts()
    expect(prompts.prompts.map((p) => p.name)).toContain("enrich_table")

    const got = await client.getPrompt({
      name: "enrich_table",
      arguments: { databaseId: "db-99" },
    })
    const text =
      got.messages[0]?.content.type === "text"
        ? got.messages[0].content.text
        : ""
    expect(text).toContain("db-99")
    expect(text).toMatch(/run_quick_surf/)
  })
})
