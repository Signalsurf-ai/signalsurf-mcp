import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"

import { PUBLIC_MCP_TOOL_NAMES } from "../src/capabilities.js"
import { SignalSurfRepository } from "../src/repository.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"

const context: SignalSurfContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  role: "viewer",
}
const secondWorkspaceId = "00000000-0000-4000-8000-000000000002"
const databaseId = "00000000-0000-4000-8000-000000000201"
const workflowId = "00000000-0000-4000-8000-000000000101"

let cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()))
  cleanup = []
})

describe("MCP server", () => {
  it("registers SignalSurf tools and executes read calls over MCP", async () => {
    const db = new FakeSupabase({
      workflows: [
        {
          id: workflowId,
          workspace_id: context.workspaceId,
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
          agent_id: null,
          display_order: 0,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          deleted_at: null,
        },
      ],
      databases: [
        {
          id: databaseId,
          workspace_id: context.workspaceId,
          name: "Companies",
          description: null,
          icon: null,
          color: null,
          schema: null,
          item_type: "company",
          system_role: null,
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
          workflow_id: workflowId,
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
      workspace_tools: [
        {
          id: "00000000-0000-4000-8000-000000000901",
          workspace_id: context.workspaceId,
          tool_type: "slack",
          config: { nickname: "Slack alerts", token: "secret" },
          is_enabled: true,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
        },
      ],
      workspace_brand_profiles: [
        {
          workspace_id: context.workspaceId,
          brand_name: "Acme",
          brand_description: "Acme makes widgets.",
          product_description: "A widget platform.",
          official_website: "https://acme.example",
          updated_at: "2026-06-02T00:00:00Z",
        },
      ],
    })
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

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort()
    )

    const result = await client.callTool({
      name: "list_workflows",
      arguments: {},
    })

    expect(result.isError).toBeFalsy()
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(JSON.parse(text).data.workflows[0].name).toBe("Active")

    const brandResult = await client.callTool({
      name: "get_brand_context",
      arguments: {},
    })
    expect(brandResult.isError).toBeFalsy()
    const brandText =
      brandResult.content?.[0]?.type === "text"
        ? brandResult.content[0].text
        : ""
    const brandContext = JSON.parse(brandText).data.brandContext
    expect(brandContext).toMatchObject({
      workspaceId: context.workspaceId,
      brandName: "Acme",
      brandDescription: "Acme makes widgets.",
      productDescription: "A widget platform.",
      // SIG-2385 kept five brand facts; the retired keys read empty.
      productCategories: [],
      sellingPoints: [],
      targetAudience: null,
      competitors: [],
      officialWebsite: "https://acme.example",
    })
    expect(brandContext).not.toHaveProperty("brandVoice")
    expect(brandContext).not.toHaveProperty("brand_voice")

    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        workflows: [{ name: "Active" }],
      },
    })

    const resources = await client.listResources()
    expect(resources.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining([
        "signalsurf://context",
        "signalsurf://workflows",
        `signalsurf://workflows/${workflowId}`,
        `signalsurf://workflows/${workflowId}/sources`,
        `signalsurf://workflows/${workflowId}/tools`,
        "signalsurf://workspace-tools",
        "signalsurf://databases",
        `signalsurf://databases/${databaseId}/rows`,
      ])
    )

    const workflowResource = await client.readResource({
      uri: `signalsurf://workflows/${workflowId}`,
    })
    const workflowResourceText =
      workflowResource.contents?.[0]?.text?.toString() ?? ""
    expect(JSON.parse(workflowResourceText)).toMatchObject({
      workflow: {
        workflowId,
        name: "Active",
      },
    })

    const sourcesResource = await client.readResource({
      uri: `signalsurf://workflows/${workflowId}/sources`,
    })
    const sourcesResourceText =
      sourcesResource.contents?.[0]?.text?.toString() ?? ""
    const parsedSourcesResource = JSON.parse(sourcesResourceText)
    expect(parsedSourcesResource.sources).toMatchObject([
      {
        workflowId,
        isActive: true,
      },
    ])
    expect(parsedSourcesResource.sources[0]).not.toHaveProperty("credentials")

    const toolsResource = await client.readResource({
      uri: `signalsurf://workflows/${workflowId}/tools`,
    })
    const toolsResourceText =
      toolsResource.contents?.[0]?.text?.toString() ?? ""
    expect(JSON.parse(toolsResourceText)).toMatchObject({
      workflowId,
      toolIds: [],
    })

    const workspaceToolsResource = await client.readResource({
      uri: "signalsurf://workspace-tools",
    })
    const workspaceToolsResourceText =
      workspaceToolsResource.contents?.[0]?.text?.toString() ?? ""
    const parsedWorkspaceToolsResource = JSON.parse(workspaceToolsResourceText)
    expect(parsedWorkspaceToolsResource.tools).toMatchObject([
      {
        toolType: "slack",
        name: "Slack alerts",
      },
    ])
    expect(parsedWorkspaceToolsResource.tools[0]).not.toHaveProperty("config")
  })

  it("advertises the stable public tool contract and denies viewer writes", async () => {
    const db = new FakeSupabase({
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
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

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort()
    )

    const result = await client.callTool({
      name: "create_workflow",
      arguments: { name: "Denied" },
    })
    expect(result.isError).toBe(true)
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(JSON.parse(text)).toMatchObject({
      code: "FORBIDDEN",
    })
    expect(db.tables.workflows).toHaveLength(0)
  })

  it("honors granular scopes when evaluating public tools", async () => {
    const db = new FakeSupabase({
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const scopedContext: SignalSurfContext = {
      workspaceId: context.workspaceId,
      role: "editor",
      scopes: ["mcp:tables.read", "mcp:tables.write"],
    }
    const server = await createSignalSurfMcpServer({
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
      get_brand_context: true,
      create_table: false,
      update_table: false,
      delete_table: false,
      create_table_row: true,
      update_table_rows: true,
      delete_table_rows: false,
      get_workflow: false,
      create_workflow: false,
      run_workflow: false,
      cancel_surf_job: false,
      get_surf_job: false,
      wait_for_surf_job: false,
      list_surf_jobs: false,
      list_table_fields: false,
      add_table_field: false,
      create_relation_field: false,
      list_signals: false,
      create_signal: false,
      update_signal: false,
      delete_signal: false,
      list_workspace_tools: false,
      list_workflow_tools: false,
      inspect_sender_infrastructure: false,
      plan_sender_capacity: false,
      search_sender_domains: false,
    })

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...PUBLIC_MCP_TOOL_NAMES].sort()
    )

    const denied = await client.callTool({
      name: "create_workflow",
      arguments: { name: "Denied" },
    })
    expect(denied.isError).toBe(true)
    const deniedText =
      denied.content?.[0]?.type === "text" ? denied.content[0].text : ""
    expect(JSON.parse(deniedText)).toMatchObject({
      code: "INSUFFICIENT_SCOPE",
      details: {
        oauthError: "insufficient_scope",
        requiredScopes: ["mcp:workflows.write"],
      },
    })

    const deniedRun = await client.callTool({
      name: "run_workflow",
      arguments: {
        workflowId: "00000000-0000-4000-8000-000000000101",
      },
    })
    expect(deniedRun.isError).toBe(true)
    const deniedRunText =
      deniedRun.content?.[0]?.type === "text" ? deniedRun.content[0].text : ""
    expect(JSON.parse(deniedRunText)).toMatchObject({
      code: "INSUFFICIENT_SCOPE",
      details: {
        oauthError: "insufficient_scope",
        requiredScopes: ["mcp:workflows.execute"],
      },
    })

    const deniedSenderInfrastructure = await client.callTool({
      name: "inspect_sender_infrastructure",
      arguments: {},
    })
    expect(deniedSenderInfrastructure.isError).toBe(true)
    const deniedSenderText =
      deniedSenderInfrastructure.content?.[0]?.type === "text"
        ? deniedSenderInfrastructure.content[0].text
        : ""
    expect(JSON.parse(deniedSenderText)).toMatchObject({
      code: "INSUFFICIENT_SCOPE",
      details: {
        oauthError: "insufficient_scope",
        requiredScopes: ["mcp:sender_infrastructure.read"],
      },
    })

    expect(db.tables.workflows).toHaveLength(0)
  })

  it("reports campaign-only grants as write-capable", async () => {
    const db = new FakeSupabase({
      workflows: [],
      databases: [],
      entries: [],
      surf_jobs: [],
      user_preferences: [],
      sources: [],
    })
    const server = await createSignalSurfMcpServer({
      context: {
        workspaceId: context.workspaceId,
        role: "editor",
        scopes: ["mcp:campaigns.write"],
      },
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

    const result = await client.callTool({
      name: "get_context",
      arguments: {},
    })
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    const capabilities = JSON.parse(text).data.capabilities
    expect(capabilities.write).toBe(true)
    expect(capabilities.tools.create_campaign).toBe(true)
  })

  it("requires workspaceId for workspace-scoped tools when context has multiple workspaces", async () => {
    const db = new FakeSupabase({
      workflows: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          workspace_id: context.workspaceId,
          name: "Primary Workspace Workflow",
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
          agent_id: null,
          display_order: 0,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          deleted_at: null,
        },
        {
          id: "00000000-0000-4000-8000-000000000102",
          workspace_id: secondWorkspaceId,
          name: "Second Workspace Workflow",
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
          agent_id: null,
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
    const multiWorkspaceContext: SignalSurfContext = {
      ...context,
      workspaceIds: [context.workspaceId, secondWorkspaceId],
      workspaces: [
        {
          workspaceId: context.workspaceId,
          name: "Primary Workspace",
          organizationName: "Primary Workspace",
        },
        {
          workspaceId: secondWorkspaceId,
          name: "Second Workspace",
          organizationName: "Second Workspace",
        },
      ],
    }
    const server = await createSignalSurfMcpServer({
      context: multiWorkspaceContext,
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
    expect(parsedContext.workspaceIds).toEqual([
      context.workspaceId,
      secondWorkspaceId,
    ])
    expect(parsedContext.workspaces).toMatchObject([
      {
        workspaceId: context.workspaceId,
        name: "Primary Workspace",
        organizationName: "Primary Workspace",
      },
      {
        workspaceId: secondWorkspaceId,
        name: "Second Workspace",
        organizationName: "Second Workspace",
      },
    ])

    const missingWorkspace = await client.callTool({
      name: "list_workflows",
      arguments: {},
    })
    expect(missingWorkspace.isError).toBe(true)
    const missingWorkspaceText =
      missingWorkspace.content?.[0]?.type === "text"
        ? missingWorkspace.content[0].text
        : ""
    expect(JSON.parse(missingWorkspaceText)).toMatchObject({
      code: "BAD_REQUEST",
    })

    const result = await client.callTool({
      name: "list_workflows",
      arguments: { workspaceId: secondWorkspaceId },
    })
    expect(result.isError).toBeFalsy()
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(JSON.parse(text).data.workflows).toMatchObject([
      { name: "Second Workspace Workflow" },
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
    expect(parsedContextResource.workspaceIds).toEqual([
      context.workspaceId,
      secondWorkspaceId,
    ])
    expect(parsedContextResource.workspaces).toMatchObject([
      {
        workspaceId: context.workspaceId,
        name: "Primary Workspace",
      },
      {
        workspaceId: secondWorkspaceId,
        name: "Second Workspace",
      },
    ])
  })
})
