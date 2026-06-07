import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"

import { PUBLIC_MCP_TOOL_NAMES } from "../src/capabilities.js"
import { SignalSurfRepository } from "../src/repository.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"

const context: SignalSurfContext = {
  productId: "00000000-0000-4000-8000-000000000001",
  role: "viewer",
}
const secondProductId = "00000000-0000-4000-8000-000000000002"
const databaseId = "00000000-0000-4000-8000-000000000201"
const surfPointId = "00000000-0000-4000-8000-000000000101"

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
          id: surfPointId,
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
      sources: [
        {
          id: "00000000-0000-4000-8000-000000000801",
          playbook_id: surfPointId,
          name: "Threads search",
          type: "pull",
          pull_config: {
            endpoint_id: "threads-keyword-search",
            schedule: "0 */6 * * *",
          },
          metadata: { provider: "threads" },
          is_active: true,
          updated_at: "2026-06-01T00:00:00Z",
          credentials: { token: "secret" },
        },
      ],
      product_tools: [
        {
          id: "00000000-0000-4000-8000-000000000901",
          product_id: context.productId,
          tool_type: "slack",
          config: { nickname: "Slack alerts", token: "secret" },
          is_enabled: true,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
        },
      ],
    })
    const server = createSignalSurfMcpServer({
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

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort()
    )

    const result = await client.callTool({
      name: "list_surf_points",
      arguments: {},
    })

    expect(result.isError).toBeFalsy()
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(JSON.parse(text).data.surfPoints[0].name).toBe("Active")
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        surfPoints: [{ name: "Active" }],
      },
    })

    const resources = await client.listResources()
    expect(resources.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining([
        "signalsurf://context",
        "signalsurf://surf-points",
        `signalsurf://surf-points/${surfPointId}`,
        `signalsurf://surf-points/${surfPointId}/sources`,
        `signalsurf://surf-points/${surfPointId}/tools`,
        "signalsurf://product-tools",
        "signalsurf://databases",
        `signalsurf://databases/${databaseId}/rows`,
      ])
    )

    const surfPointResource = await client.readResource({
      uri: `signalsurf://surf-points/${surfPointId}`,
    })
    const surfPointResourceText =
      surfPointResource.contents?.[0]?.text?.toString() ?? ""
    expect(JSON.parse(surfPointResourceText)).toMatchObject({
      surfPoint: {
        surfPointId,
        name: "Active",
      },
    })

    const sourcesResource = await client.readResource({
      uri: `signalsurf://surf-points/${surfPointId}/sources`,
    })
    const sourcesResourceText =
      sourcesResource.contents?.[0]?.text?.toString() ?? ""
    const parsedSourcesResource = JSON.parse(sourcesResourceText)
    expect(parsedSourcesResource.sources).toMatchObject([
      {
        surfPointId,
        isActive: true,
      },
    ])
    expect(parsedSourcesResource.sources[0]).not.toHaveProperty("credentials")

    const toolsResource = await client.readResource({
      uri: `signalsurf://surf-points/${surfPointId}/tools`,
    })
    const toolsResourceText =
      toolsResource.contents?.[0]?.text?.toString() ?? ""
    expect(JSON.parse(toolsResourceText)).toMatchObject({
      surfPointId,
      toolIds: [],
    })

    const productToolsResource = await client.readResource({
      uri: "signalsurf://product-tools",
    })
    const productToolsResourceText =
      productToolsResource.contents?.[0]?.text?.toString() ?? ""
    const parsedProductToolsResource = JSON.parse(productToolsResourceText)
    expect(parsedProductToolsResource.tools).toMatchObject([
      {
        toolType: "slack",
        name: "Slack alerts",
      },
    ])
    expect(parsedProductToolsResource.tools[0]).not.toHaveProperty("config")
  })

  it("advertises the stable public tool contract and denies viewer writes", async () => {
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
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    cleanup.push(async () => client.close())
    cleanup.push(async () => server.close())

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort()
    )

    const result = await client.callTool({
      name: "create_surf_point",
      arguments: { name: "Denied" },
    })
    expect(result.isError).toBe(true)
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(JSON.parse(text)).toMatchObject({
      code: "FORBIDDEN",
    })
    expect(db.tables.playbooks).toHaveLength(0)
  })

  it("honors granular scopes when evaluating public tools", async () => {
    const db = new FakeSupabase({
      playbooks: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const scopedContext: SignalSurfContext = {
      productId: context.productId,
      role: "editor",
      scopes: ["mcp:tables.read", "mcp:tables.write"],
    }
    const server = createSignalSurfMcpServer({
      context: scopedContext,
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

    const contextResult = await client.callTool({
      name: "get_context",
      arguments: {},
    })
    const contextText =
      contextResult.content?.[0]?.type === "text"
        ? contextResult.content[0].text
        : ""
    const contextBody = JSON.parse(contextText).data
    expect(contextBody.capabilities.tools).toMatchObject({
      create_product: false,
      create_table: false,
      update_table: false,
      create_table_row: true,
      update_table_row: true,
      delete_table_rows: false,
      get_surf_point: false,
      create_surf_point: false,
      run_surf_point: false,
      cancel_surf_job: false,
      get_surf_job: false,
      wait_for_surf_job: false,
      list_surf_jobs: false,
      list_database_fields: false,
      add_database_field: false,
      create_relation_field: false,
      list_surf_point_sources: false,
      create_surf_point_source: false,
      update_surf_point_source: false,
      delete_surf_point_source: false,
      set_surf_point_source_active: false,
      list_product_tools: false,
      list_surf_point_tools: false,
      attach_surf_point_tool: false,
      detach_surf_point_tool: false,
    })

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort()
    )

    const denied = await client.callTool({
      name: "create_surf_point",
      arguments: { name: "Denied" },
    })
    expect(denied.isError).toBe(true)
    const deniedText =
      denied.content?.[0]?.type === "text" ? denied.content[0].text : ""
    expect(JSON.parse(deniedText)).toMatchObject({
      code: "INSUFFICIENT_SCOPE",
      details: {
        oauthError: "insufficient_scope",
        requiredScopes: ["mcp:surf_points.write"],
      },
    })

    const deniedRun = await client.callTool({
      name: "run_surf_point",
      arguments: {
        surfPointId: "00000000-0000-4000-8000-000000000101",
      },
    })
    expect(deniedRun.isError).toBe(true)
    const deniedRunText =
      deniedRun.content?.[0]?.type === "text" ? deniedRun.content[0].text : ""
    expect(JSON.parse(deniedRunText)).toMatchObject({
      code: "INSUFFICIENT_SCOPE",
      details: {
        oauthError: "insufficient_scope",
        requiredScopes: ["mcp:surf_points.execute"],
      },
    })
    expect(db.tables.playbooks).toHaveLength(0)
  })

  it("requires productId for product-scoped tools when context has multiple products", async () => {
    const db = new FakeSupabase({
      playbooks: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          product_id: context.productId,
          name: "Primary Product Surf Point",
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
        {
          id: "00000000-0000-4000-8000-000000000102",
          product_id: secondProductId,
          name: "Second Product Surf Point",
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
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const multiProductContext: SignalSurfContext = {
      ...context,
      productIds: [context.productId, secondProductId],
      products: [
        {
          productId: context.productId,
          name: "Primary Product",
          organizationName: "Primary Workspace",
        },
        {
          productId: secondProductId,
          name: "Second Product",
          organizationName: "Second Workspace",
        },
      ],
    }
    const server = createSignalSurfMcpServer({
      context: multiProductContext,
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

    const contextResult = await client.callTool({
      name: "get_context",
      arguments: {},
    })
    const contextText =
      contextResult.content?.[0]?.type === "text"
        ? contextResult.content[0].text
        : ""
    const parsedContext = JSON.parse(contextText).data
    expect(parsedContext.productIds).toEqual([
      context.productId,
      secondProductId,
    ])
    expect(parsedContext.products).toMatchObject([
      {
        productId: context.productId,
        name: "Primary Product",
        organizationName: "Primary Workspace",
      },
      {
        productId: secondProductId,
        name: "Second Product",
        organizationName: "Second Workspace",
      },
    ])

    const missingProduct = await client.callTool({
      name: "list_surf_points",
      arguments: {},
    })
    expect(missingProduct.isError).toBe(true)
    const missingProductText =
      missingProduct.content?.[0]?.type === "text"
        ? missingProduct.content[0].text
        : ""
    expect(JSON.parse(missingProductText)).toMatchObject({
      code: "BAD_REQUEST",
    })

    const result = await client.callTool({
      name: "list_surf_points",
      arguments: { productId: secondProductId },
    })
    expect(result.isError).toBeFalsy()
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(JSON.parse(text).data.surfPoints).toMatchObject([
      { name: "Second Product Surf Point" },
    ])

    const resources = await client.listResources()
    expect(resources.resources.map((resource) => resource.uri)).toEqual([
      "signalsurf://context",
    ])

    const contextResource = await client.readResource({
      uri: "signalsurf://context",
    })
    const contextResourceText =
      contextResource.contents?.[0]?.text?.toString() ?? ""
    const parsedContextResource = JSON.parse(contextResourceText)
    expect(parsedContextResource.productIds).toEqual([
      context.productId,
      secondProductId,
    ])
    expect(parsedContextResource.products).toMatchObject([
      {
        productId: context.productId,
        name: "Primary Product",
      },
      {
        productId: secondProductId,
        name: "Second Product",
      },
    ])
  })
})
