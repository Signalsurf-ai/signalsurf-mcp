import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"

import { SignalSurfRepository } from "../src/repository.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"

const productId = "00000000-0000-4000-8000-000000000001"
const workflowId = "00000000-0000-4000-8000-000000000101"

function editorContext(): SignalSurfContext {
  return { productId, role: "editor" }
}

function workflowRow(config: Record<string, unknown> = {}) {
  return {
    id: workflowId,
    product_id: productId,
    name: "My Workflow",
    config,
    tool_config: {},
    variables: {},
    scoring_rubric: null,
    surf_prompt: null,
    prompt_template: null,
    relevance_threshold: null,
    is_active: true,
    deleted_at: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  }
}

const triggerAgentFlow = {
  version: 2,
  nodes: [
    { id: "t1", type: "trigger" },
    { id: "a1", type: "agent", prompt: "enrich it" },
  ],
  edges: [{ id: "e1", source: "t1", target: "a1", condition: "always" }],
}

let cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()))
  cleanup = []
})

async function connect(db: FakeSupabase, context = editorContext()) {
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

function data(result: any) {
  return (result.structuredContent as any)?.data
}

describe("describe_node_types tool", () => {
  it("returns the six Flow V2 node types", async () => {
    const client = await connect(new FakeSupabase({ workflows: [] }))
    const result = await client.callTool({
      name: "describe_node_types",
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
    expect(
      data(result)
        .nodeTypes.map((n: any) => n.type)
        .sort()
    ).toEqual(["action", "agent", "rule", "sequence", "trigger", "wait"])
  })
})

describe("edit_workflow_flows tool", () => {
  it("builds a graph atomically with refs", async () => {
    const client = await connect(
      new FakeSupabase({ workflows: [workflowRow()] })
    )
    const result = await client.callTool({
      name: "edit_workflow_flows",
      arguments: {
        workflowId,
        edits: [
          { op: "add_node", ref: "trig", node: { type: "trigger" } },
          { op: "add_node", ref: "ag", node: { type: "agent", prompt: "go" } },
          { op: "connect", source: "trig", target: "ag", condition: "always" },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    expect(data(result).applied).toBe(true)
    expect(data(result).nodeCount).toBe(2)
  })

  it("is blocked for a viewer token", async () => {
    const client = await connect(
      new FakeSupabase({ workflows: [workflowRow()] }),
      { productId, role: "viewer" }
    )
    const result = await client.callTool({
      name: "edit_workflow_flows",
      arguments: {
        workflowId,
        edits: [{ op: "add_node", node: { type: "trigger" } }],
      },
    })
    expect(result.isError).toBeTruthy()
  })

  it("does not expose retired Flow mutation tool names", async () => {
    const client = await connect(new FakeSupabase({ workflows: [] }))
    const tools = await client.listTools()
    const names = tools.tools.map((tool) => tool.name)
    expect(names).not.toContain("update_workflow_flow")
    expect(names).not.toContain("apply_flow_edits")
  })
})

describe("get_node_upstream_context tool", () => {
  it("returns the upstream trigger for a node", async () => {
    const client = await connect(
      new FakeSupabase({
        workflows: [
          workflowRow({
            flows: [{ id: "flow-1", name: "Flow 1", ...triggerAgentFlow }],
          }),
        ],
      })
    )
    const result = await client.callTool({
      name: "get_node_upstream_context",
      arguments: { workflowId, nodeId: "a1" },
    })
    expect(result.isError).toBeFalsy()
    expect(data(result).ancestors.map((a: any) => a.id)).toContain("t1")
  })

  it("errors when the node id is unknown", async () => {
    const client = await connect(
      new FakeSupabase({
        workflows: [
          workflowRow({
            flows: [{ id: "flow-1", name: "Flow 1", ...triggerAgentFlow }],
          }),
        ],
      })
    )
    const result = await client.callTool({
      name: "get_node_upstream_context",
      arguments: { workflowId, nodeId: "ghost" },
    })
    expect(result.isError).toBeTruthy()
  })
})

describe("create_campaign tool", () => {
  it("requires an explicit mailbox (the MCP cannot list Unipile accounts)", async () => {
    const client = await connect(new FakeSupabase({ campaigns: [] }))
    const result = await client.callTool({
      name: "create_campaign",
      arguments: {
        name: "Founder outreach",
        goal: "Book product calls",
        audienceDatabaseId: "00000000-0000-4000-8000-000000000201",
        steps: [{ copy: "hello" }],
      },
    })
    expect(result.isError).toBeTruthy()
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toMatch(/mailbox/i)
  })

  it("creates a first-class Campaign without a Workflow or partial tool row", async () => {
    const audienceDatabaseId = "00000000-0000-4000-8000-000000000201"
    const db = new FakeSupabase({
      campaigns: [],
      workflows: [],
      product_tools: [],
      product_unipile_accounts: [
        {
          product_id: productId,
          unipile_account_id: "mailbox-1",
          provider: "MAIL",
        },
      ],
      managed_email_mailboxes: [],
      databases: [
        {
          id: audienceDatabaseId,
          product_id: productId,
          name: "Founders",
          data_model: "table",
          schema: {
            fields: [{ key: "email", label: "Email", type: "email" }],
          },
        },
      ],
    })
    const client = await connect(db, {
      productId,
      role: "editor",
      workspaceCapabilities: ["campaigns"],
    })
    const result = await client.callTool({
      name: "create_campaign",
      arguments: {
        name: "Founder outreach",
        goal: "Book product calls",
        audienceDatabaseId,
        mailbox: "mailbox-1",
        steps: [{ copy: "hello", delayDays: 1 }],
      },
    })

    expect(result.isError).toBeFalsy()
    expect(db.tables.workflows).toEqual([])
    expect(db.tables.product_tools).toEqual([])
    expect(db.tables.campaigns).toEqual([
      expect.objectContaining({
        product_id: productId,
        name: "Founder outreach",
        goal: "Book product calls",
        audience_database_id: audienceDatabaseId,
        recipient_field: "email",
        status: "draft",
      }),
    ])
    expect(db.tables.campaigns[0]).not.toHaveProperty("workflow_id")
  })

  it("rejects an unbound or non-email Campaign mailbox before inserting", async () => {
    const audienceDatabaseId = "00000000-0000-4000-8000-000000000201"
    const db = new FakeSupabase({
      campaigns: [],
      product_unipile_accounts: [
        {
          product_id: productId,
          unipile_account_id: "linkedin-1",
          provider: "LINKEDIN",
        },
      ],
      managed_email_mailboxes: [],
      databases: [
        {
          id: audienceDatabaseId,
          product_id: productId,
          data_model: "table",
          schema: { fields: [{ key: "email", type: "email" }] },
        },
      ],
    })
    const client = await connect(db)
    for (const mailbox of ["other-workspace-mailbox", "linkedin-1"]) {
      const result = await client.callTool({
        name: "create_campaign",
        arguments: {
          name: "Must not exist",
          goal: "No side effects",
          audienceDatabaseId,
          mailbox,
          steps: [{ copy: "hello" }],
        },
      })
      expect(result.isError).toBe(true)
    }
    expect(db.tables.campaigns).toEqual([])
  })
})

describe("test_workflow_node tool", () => {
  it("errors clearly when surf-flow-debug is unavailable", async () => {
    const client = await connect(
      new FakeSupabase({ workflows: [workflowRow({ flow: triggerAgentFlow })] })
    )
    const result = await client.callTool({
      name: "test_workflow_node",
      arguments: { workflowId, nodeId: "a1" },
    })
    // FakeSupabase has no functions.invoke -> the tool reports it is unavailable.
    expect(result.isError).toBeTruthy()
  })
})
