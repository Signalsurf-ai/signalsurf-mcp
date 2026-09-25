import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  TOOL_LIST_FRAMING_RESERVE_BYTES,
  installPaginatedToolList,
} from "../src/tool-list-pagination.js"

describe("tools/list pagination", () => {
  it("preserves result contracts and safety metadata while compacting defaults", async () => {
    const server = new McpServer({ name: "metadata-test", version: "1.0.0" })
    const client = new Client({ name: "metadata-client", version: "1.0.0" })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    server.registerTool(
      "read_context",
      {
        title: "Read context",
        description: "Read the current context.",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        outputSchema: {
          ok: z.boolean(),
          data: z.unknown().optional(),
        },
        inputSchema: {
          description: z.string().describe("Member-provided description"),
          default: z.string().optional().describe("Member-provided default"),
          nested: z.object({
            description: z.string().describe("Nested description"),
          }),
        },
      },
      async () => ({ content: [{ type: "text", text: "ok" }] })
    )
    server.registerTool(
      "write_context",
      {
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => ({ content: [{ type: "text", text: "ok" }] })
    )
    installPaginatedToolList(server)
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const listed = await client.listTools()
    expect(listed.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "read_context",
          title: "Read context",
          description: "Read the current context.",
          outputSchema: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              data: {},
            },
            required: ["ok"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
          },
        }),
        expect.objectContaining({
          name: "write_context",
          annotations: {
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        }),
      ])
    )
    expect(listed.tools[0]?.inputSchema).not.toHaveProperty("$schema")
    expect(listed.tools[0]?.inputSchema).toMatchObject({
      properties: {
        description: { type: "string" },
        default: { type: "string" },
        nested: {
          type: "object",
          properties: { description: { type: "string" } },
        },
      },
      required: ["description", "nested"],
    })
    expect(
      listed.tools[0]?.inputSchema.properties?.description
    ).not.toHaveProperty("description")
    await Promise.all([client.close(), server.close()])
  })

  it("keeps every tool discoverable without one oversized response", async () => {
    const server = new McpServer({ name: "pagination-test", version: "1.0.0" })
    const client = new Client({ name: "pagination-client", version: "1.0.0" })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    const maxPageBytes = 4_000

    for (let index = 0; index < 40; index += 1) {
      server.registerTool(
        `tool_${index.toString().padStart(2, "0")}`,
        {
          description: `Capability ${index}: ${"bounded description ".repeat(8)}`,
          inputSchema: {
            workspaceId: z.string().uuid().optional(),
            query: z.string().max(500).describe("Search query"),
          },
        },
        async () => ({ content: [{ type: "text", text: "ok" }] })
      )
    }
    installPaginatedToolList(server, maxPageBytes)
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const names: string[] = []
    const pageSizes: number[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined)
      names.push(...page.tools.map((tool) => tool.name))
      pageSizes.push(new TextEncoder().encode(JSON.stringify(page)).byteLength)
      cursor = page.nextCursor
    } while (cursor)

    expect(pageSizes.length).toBeGreaterThan(1)
    expect(
      pageSizes.every(
        (bytes) => bytes + TOOL_LIST_FRAMING_RESERVE_BYTES <= maxPageBytes
      )
    ).toBe(true)
    expect(names).toEqual(
      Array.from({ length: 40 }, (_, index) =>
        `tool_${index.toString().padStart(2, "0")}`
      )
    )

    await Promise.all([client.close(), server.close()])
  })

  it("rejects cursors not issued by this server", async () => {
    const server = new McpServer({ name: "pagination-test", version: "1.0.0" })
    const client = new Client({ name: "pagination-client", version: "1.0.0" })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    server.registerTool("read_context", {}, async () => ({
      content: [{ type: "text", text: "ok" }],
    }))
    installPaginatedToolList(server)
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    await expect(client.listTools({ cursor: "made-up" })).rejects.toThrow(
      "Invalid tools/list cursor"
    )
    await Promise.all([client.close(), server.close()])
  })

  it("rejects a cursor after the tool catalog changes", async () => {
    const server = new McpServer({ name: "pagination-test", version: "1.0.0" })
    const client = new Client({ name: "pagination-client", version: "1.0.0" })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    for (let index = 0; index < 20; index += 1) {
      server.registerTool(
        `tool_${index.toString().padStart(2, "0")}`,
        { description: "x".repeat(200) },
        async () => ({ content: [{ type: "text", text: "ok" }] })
      )
    }
    installPaginatedToolList(server, 2_000)
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const firstPage = await client.listTools()
    expect(firstPage.nextCursor).toBeDefined()
    server.registerTool("new_tool", {}, async () => ({
      content: [{ type: "text", text: "ok" }],
    }))

    await expect(
      client.listTools({ cursor: firstPage.nextCursor! })
    ).rejects.toThrow(
      "Tools catalog changed; restart tools/list without a cursor"
    )
    await Promise.all([client.close(), server.close()])
  })

  it("rejects one tool that cannot fit inside the wire budget", async () => {
    const server = new McpServer({ name: "oversize-test", version: "1.0.0" })
    const client = new Client({ name: "oversize-client", version: "1.0.0" })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    server.registerTool(
      "oversized_tool",
      { description: "x".repeat(4_000) },
      async () => ({ content: [{ type: "text", text: "ok" }] })
    )
    installPaginatedToolList(server, 2_000)
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    await expect(client.listTools()).rejects.toThrow(
      "A tool definition exceeds the discovery page limit"
    )
    await Promise.all([client.close(), server.close()])
  })
})
