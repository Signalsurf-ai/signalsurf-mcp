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

const workspaceId = "00000000-0000-4000-8000-000000000001"
const organizationId = "00000000-0000-4000-8000-000000000002"
const hiddenTableId = "00000000-0000-4000-8000-000000000003"
const listeningTableId = "00000000-0000-4000-8000-000000000004"
const ordinaryWorkflowId = "00000000-0000-4000-8000-000000000005"
const listeningWorkflowId = "00000000-0000-4000-8000-000000000006"
let cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()))
  cleanup = []
})

function policyDb(overrides: Array<Record<string, unknown>> = []) {
  return new FakeSupabase({
    workspaces: [
      { id: workspaceId, organization_id: organizationId, name: "Acme" },
    ],
    workspace_capability_overrides: overrides,
    subscriptions: [
      {
        workspace_id: workspaceId,
        plan_name: "individual",
        status: "active",
        current_period_end: null,
        created_at: "2026-09-21T00:00:00Z",
      },
    ],
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
    workspace_tools: [],
    workflows: [],
  })
}

async function connect(db: FakeSupabase) {
  const context: SignalSurfContext = {
    workspaceId,
    workspaces: [{ workspaceId, name: "Acme", organizationId }],
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

  it("fails closed during a rolling subscription-schema deploy", async () => {
    const db = new FakeSupabase(
      {
        workspaces: [{ id: workspaceId, organization_id: organizationId }],
        workspace_capability_overrides: [],
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
      loadWorkspaceCapabilities(db as any, [workspaceId])
    ).resolves.toEqual({ [workspaceId]: [] })
  })

  it("keeps only explicit enables when later plan tables are rolling out", async () => {
    const db = new FakeSupabase(
      {
        workspaces: [{ id: workspaceId, organization_id: organizationId }],
        workspace_capability_overrides: [
          {
            workspace_id: workspaceId,
            capability_key: "listening",
            enabled: true,
          },
        ],
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

    const capabilities = await loadWorkspaceCapabilities(db as any, [workspaceId])
    expect(capabilities[workspaceId]).toContain("listening")
    expect(capabilities[workspaceId]).not.toContain("workflows")
  })

  it("keeps Listening independent from ordinary Workflows", async () => {
    const db = policyDb([
      { workspace_id: workspaceId, capability_key: "workflows", enabled: false },
    ])
    db.tables.workflows.push(
      {
        id: ordinaryWorkflowId,
        workspace_id: workspaceId,
        name: "Hidden ordinary Workflow",
        kind: "workflow",
        is_active: true,
        deleted_at: null,
        created_at: "2026-08-24T00:00:00Z",
      },
      {
        id: listeningWorkflowId,
        workspace_id: workspaceId,
        name: "Visible Listening",
        kind: "listening",
        is_active: true,
        deleted_at: null,
        created_at: "2026-08-24T00:00:00Z",
      }
    )
    const client = await connect(db)
    const toolNames = (await client.listTools()).tools.map((tool) => tool.name)
    expect(toolNames).toContain("list_workflows")
    expect(toolNames).toContain("create_workflow")
    expect(toolNames).toContain("describe_node_types")

    const listed = await client.callTool({
      name: "list_workflows",
      arguments: { limit: 1 },
    })
    const listedText =
      listed.content?.[0]?.type === "text" ? listed.content[0].text : ""
    expect(JSON.parse(listedText).data.workflows).toEqual([
      expect.objectContaining({ workflowId: ordinaryWorkflowId }),
    ])

    const flowEdit = await client.callTool({
      name: "edit_workflow_flows",
      arguments: {
        workflowId: ordinaryWorkflowId,
        edits: [{ op: "add_node", node: { type: "trigger" } }],
      },
    })
    expect(flowEdit.isError).toBe(true)

    const denied = await client.callTool({
      name: "get_workflow",
      arguments: { workflowId: ordinaryWorkflowId },
    })
    expect(denied.isError).toBeFalsy()
    const allowed = await client.callTool({
      name: "get_workflow",
      arguments: { workflowId: listeningWorkflowId },
    })
    expect(allowed.isError).toBeFalsy()

    const prompts = await client.listPrompts()
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain(
      "set_up_workflow"
    )
    const contextResult = await client.callTool({
      name: "get_context",
      arguments: {},
    })
    const contextText =
      contextResult.content?.[0]?.type === "text"
        ? contextResult.content[0].text
        : ""
    expect(JSON.parse(contextText).data.capabilities.effective).toContain(
      "sources.read"
    )
  })

  it("keeps disabled modules discoverable and read-only", async () => {
    const db = policyDb([
      { workspace_id: workspaceId, capability_key: "tables", enabled: false },
      { workspace_id: workspaceId, capability_key: "objects", enabled: false },
      { workspace_id: workspaceId, capability_key: "listening", enabled: false },
      { workspace_id: workspaceId, capability_key: "workflows", enabled: false },
    ])
    const client = await connect(db)

    const tools = await client.listTools()
    const toolNames = tools.tools.map((tool) => tool.name)
    expect(toolNames).toContain("list_tables")
    expect(toolNames).toContain("create_table")
    expect(toolNames).toContain("list_workflows")
    expect(toolNames).toContain("list_signals")
    expect(toolNames).toContain("create_campaign")
    expect(toolNames).toContain("find_capabilities")

    expect((await client.listPrompts()).prompts.length).toBeGreaterThan(0)

    const resources = await client.listResources()
    const resourceUris = resources.resources.map((resource) => resource.uri)
    expect(resourceUris).toContain("signalsurf://workflows")
    expect(resourceUris).toContain("signalsurf://databases")

    const discovery = await client.callTool({
      name: "find_capabilities",
      arguments: { query: "table workflow" },
    })
    const text =
      discovery.content?.[0]?.type === "text" ? discovery.content[0].text : ""
    const body = JSON.parse(text)
    expect(body.data.tools.length).toBeGreaterThan(0)
    expect(body.data.prompts.length).toBeGreaterThan(0)

    const mutation = await client.callTool({
      name: "create_table",
      arguments: { name: "Upgrade required" },
    })
    expect(mutation.isError).toBe(true)
  })

  it("removes Campaign OAuth capability from the model-visible manifest", async () => {
    const client = await connect(
      policyDb([
        {
          workspace_id: workspaceId,
          capability_key: "campaigns",
          enabled: false,
        },
      ])
    )
    const result = await client.callTool({
      name: "get_context",
      arguments: {},
    })
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""

    expect(JSON.parse(text).data.capabilities.effective).not.toContain(
      "campaigns.write"
    )
  })

  it("keeps retained sender reads visible while Inbox is inactive", async () => {
    const client = await connect(
      policyDb([
        {
          workspace_id: workspaceId,
          capability_key: "inbox",
          enabled: false,
        },
      ])
    )

    const tools = (await client.listTools()).tools.map((tool) => tool.name)
    expect(tools).toContain("inspect_sender_infrastructure")
    expect(tools).toContain("plan_sender_capacity")
    expect(tools).toContain("search_sender_domains")

    const result = await client.callTool({
      name: "get_context",
      arguments: {},
    })
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(JSON.parse(text).data.capabilities.effective).toContain(
      "sender_infrastructure.read"
    )

    const externalLookup = await client.callTool({
      name: "search_sender_domains",
      arguments: { domains: ["example.com"] },
    })
    expect(externalLookup.isError).toBe(true)
  })

  it("rechecks policy before a stale registered tool can mutate", async () => {
    const db = policyDb()
    const client = await connect(db)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "create_table"
    )

    db.tables.workspace_capability_overrides.push({
      workspace_id: workspaceId,
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

  it("keeps retained table discovery and reads available", async () => {
    const db = policyDb([
      { workspace_id: workspaceId, capability_key: "tables", enabled: false },
      { workspace_id: workspaceId, capability_key: "objects", enabled: false },
    ])
    db.tables.databases.push(
      {
        id: hiddenTableId,
        workspace_id: workspaceId,
        name: "Hidden table",
        data_model: "table",
        system_role: null,
        display_order: 0,
        created_at: "2026-08-24T00:00:00Z",
      },
      {
        id: listeningTableId,
        workspace_id: workspaceId,
        name: "Visible listening feed",
        data_model: "table",
        system_role: null,
        display_order: 1,
        created_at: "2026-08-24T00:00:00Z",
      }
    )
    db.tables.workflows.push({
      id: "workflow-listening",
      workspace_id: workspaceId,
      kind: "listening",
      database_ids: [listeningTableId],
      deleted_at: null,
    })
    const client = await connect(db)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "list_tables"
    )

    const listed = await client.callTool({
      name: "list_tables",
      arguments: { limit: 1 },
    })
    const listedText =
      listed.content?.[0]?.type === "text" ? listed.content[0].text : ""
    expect(JSON.parse(listedText).data.databases).toEqual([
      expect.objectContaining({ databaseId: hiddenTableId }),
    ])

    const denied = await client.callTool({
      name: "read_table",
      arguments: { databaseId: hiddenTableId },
    })
    expect(denied.isError).toBeFalsy()
  })

  it("does not require module classification for retained reads", async () => {
    const db = new FakeSupabase(
      {
        ...policyDb([
          {
            workspace_id: workspaceId,
            capability_key: "listening",
            enabled: false,
          },
        ]).tables,
        databases: [
          {
            id: hiddenTableId,
            workspace_id: workspaceId,
            name: "Ambiguous table",
            data_model: "table",
            system_role: null,
            display_order: 0,
          },
        ],
      },
      {
        tableErrors: {
          workflows: { code: "42703", message: "column kind does not exist" },
        },
      }
    )
    const client = await connect(db)
    const listed = await client.callTool({
      name: "list_tables",
      arguments: {},
    })

    expect(listed.isError).toBeFalsy()
    expect(db.tables.databases).toHaveLength(1)
  })
})
