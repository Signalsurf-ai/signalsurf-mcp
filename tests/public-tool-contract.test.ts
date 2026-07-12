import { readFile } from "node:fs/promises"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { canonicalSha256 } from "../src/canonical-json.js"
import { PUBLIC_MCP_TOOL_NAMES } from "../src/capabilities.js"
import { SignalSurfRepository } from "../src/repository.js"
import { PUBLIC_MCP_TOOL_SCHEMAS } from "../src/schemas.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import { FakeSupabase } from "./fake-supabase.js"

type Contract = {
  inputSchemaSha256: Record<string, string>
  semanticFixtures: Record<string, { valid: unknown[]; invalid: unknown[] }>
}

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()))
})

async function readContract(): Promise<Contract> {
  return JSON.parse(
    await readFile(
      new URL("../docs/public-tool-contract.json", import.meta.url),
      "utf8"
    )
  ) as Contract
}

describe("public MCP tool contract", () => {
  it("canonicalizes semantically identical payload objects to one digest", () => {
    expect(canonicalSha256({ z: [3, { b: 2, a: 1 }], a: "first" })).toBe(
      canonicalSha256({ a: "first", z: [3, { a: 1, b: 2 }] })
    )
  })

  it("pins every executable tool input schema to the shared fingerprint artifact", async () => {
    const db = new FakeSupabase({ products: [], organizations: [] })
    const server = await createSignalSurfMcpServer({
      context: {
        productId: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
      },
      repository: new SignalSurfRepository(db as never),
    })
    const client = new Client({ name: "contract-test", version: "0.0.0" })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    cleanup.push(async () => client.close())
    cleanup.push(async () => server.close())
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const contract = await readContract()
    const tools = (await client.listTools()).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort()
    )
    expect(Object.keys(PUBLIC_MCP_TOOL_SCHEMAS).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort()
    )
    expect(
      Object.fromEntries(
        tools.map((tool) => [tool.name, canonicalSha256(tool.inputSchema)])
      )
    ).toEqual(contract.inputSchemaSha256)
  })

  it("keeps shared semantic fixtures accepted or rejected by the canonical schemas", async () => {
    const contract = await readContract()
    expect(Object.keys(contract.semanticFixtures).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort()
    )

    for (const [toolName, fixtures] of Object.entries(
      contract.semanticFixtures
    )) {
      const shape =
        PUBLIC_MCP_TOOL_SCHEMAS[
          toolName as keyof typeof PUBLIC_MCP_TOOL_SCHEMAS
        ]
      expect(
        fixtures.valid.length,
        `${toolName} needs a valid fixture`
      ).toBeGreaterThan(0)
      expect(
        fixtures.invalid.length,
        `${toolName} needs an invalid fixture`
      ).toBeGreaterThan(0)

      const schema = z.object((shape ?? {}) as z.ZodRawShape)
      for (const fixture of fixtures.valid) {
        expect(
          schema.safeParse(fixture).success,
          `${toolName} valid fixture`
        ).toBe(true)
      }
      for (const fixture of fixtures.invalid) {
        expect(
          schema.safeParse(fixture).success,
          `${toolName} invalid fixture`
        ).toBe(false)
      }
    }
  })
})
