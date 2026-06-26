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

function seed() {
  return new FakeSupabase({
    databases: [
      {
        id: databaseId,
        product_id: context.productId,
        name: "Companies",
        description: null,
        icon: null,
        color: null,
        schema: {
          fields: [
            { key: "industry", type: "multi_select" },
            { key: "name", type: "text" },
          ],
          relations: [{ source: databaseId, type: "works_at", target: "db-2" }],
        },
        item_type: "company",
        system_type: null,
        view_configs: {},
        display_order: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    entries: [
      {
        id: "00000000-0000-4000-8000-000000000301",
        database_id: databaseId,
        data: { industry: ["saas", "fintech"], name: "Acme" },
        updated_at: "2026-06-03T00:00:00Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000302",
        database_id: databaseId,
        data: { industry: ["saas"], name: "Beta" },
        updated_at: "2026-06-02T00:00:00Z",
      },
    ],
    product_goals: [
      {
        product_id: context.productId,
        user_id: "00000000-0000-4000-8000-000000000010",
        brand_name: "Acme",
        brand_description: "Acme makes widgets.",
        product_description: "A widget platform.",
        product_categories: ["SaaS"],
        selling_points: ["Fast"],
        target_audience: "SMB operators",
        competitors: ["Globex"],
        official_website: "https://acme.example",
        updated_at: "2026-06-02T00:00:00Z",
      },
    ],
  })
}

async function connect(db: FakeSupabase) {
  const server = await createSignalSurfMcpServer({
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
  return client
}

describe("get_enrichment_context tool", () => {
  it("returns brand, schema, relations, conventions, and popular values", async () => {
    const client = await connect(seed())
    const result = await client.callTool({
      name: "get_enrichment_context",
      arguments: { databaseId },
    })
    expect(result.isError).toBeFalsy()
    const data = (result.structuredContent as any).data
    expect(data.databaseId).toBe(databaseId)
    expect(data.brand.brandName).toBe("Acme")
    expect(data.table.fields).toHaveLength(2)
    expect(data.relations[0]).toMatchObject({ type: "works_at" })
    expect(data.conventions).toContain("Field conventions")
    expect(data.popularValues.industry[0]).toEqual({ value: "saas", count: 2 })
  })

  it("errors with the valid field keys when fieldKey is unknown", async () => {
    const client = await connect(seed())
    const result = await client.callTool({
      name: "get_enrichment_context",
      arguments: { databaseId, fieldKey: "ghost" },
    })
    expect(result.isError).toBeTruthy()
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toMatch(/industry/)
  })
})
