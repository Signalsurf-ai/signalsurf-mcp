import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"

import { SignalSurfRepository } from "../src/repository.js"
import { createSignalSurfMcpServer } from "../src/server.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"

const productId = "00000000-0000-4000-8000-000000000001"
const playbookId = "00000000-0000-4000-8000-000000000101"

function editorContext(): SignalSurfContext {
  return { productId, role: "editor" }
}

function playbookRow(config: Record<string, unknown> = {}) {
  return {
    id: playbookId,
    product_id: productId,
    name: "My Playbook",
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
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
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
    const client = await connect(new FakeSupabase({ playbooks: [] }))
    const result = await client.callTool({
      name: "describe_node_types",
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
    expect(data(result).nodeTypes.map((n: any) => n.type).sort()).toEqual([
      "action",
      "agent",
      "rule",
      "sequence",
      "trigger",
      "wait",
    ])
  })
})

describe("update_surf_point_flow tool", () => {
  it("saves a valid trigger -> agent graph", async () => {
    const client = await connect(new FakeSupabase({ playbooks: [playbookRow()] }))
    const result = await client.callTool({
      name: "update_surf_point_flow",
      arguments: { playbookId, flow: triggerAgentFlow },
    })
    expect(result.isError).toBeFalsy()
    expect(data(result).nodeCount).toBe(2)
    expect(data(result).edgeCount).toBe(1)
  })

  it("rejects a cyclic graph", async () => {
    const client = await connect(new FakeSupabase({ playbooks: [playbookRow()] }))
    const result = await client.callTool({
      name: "update_surf_point_flow",
      arguments: {
        playbookId,
        flow: {
          version: 2,
          nodes: [
            { id: "a", type: "agent", prompt: "x" },
            { id: "b", type: "agent", prompt: "y" },
          ],
          edges: [
            { id: "e1", source: "a", target: "b", condition: "always" },
            { id: "e2", source: "b", target: "a", condition: "always" },
          ],
        },
      },
    })
    expect(result.isError).toBeTruthy()
  })

  it("is blocked for a viewer token (needs surf_points.write)", async () => {
    const client = await connect(
      new FakeSupabase({ playbooks: [playbookRow()] }),
      { productId, role: "viewer" }
    )
    const result = await client.callTool({
      name: "update_surf_point_flow",
      arguments: { playbookId, flow: triggerAgentFlow },
    })
    expect(result.isError).toBeTruthy()
  })
})

describe("apply_flow_edits tool", () => {
  it("builds a graph atomically with refs", async () => {
    const client = await connect(new FakeSupabase({ playbooks: [playbookRow()] }))
    const result = await client.callTool({
      name: "apply_flow_edits",
      arguments: {
        playbookId,
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
})

describe("get_node_upstream_context tool", () => {
  it("returns the upstream trigger for a node", async () => {
    const client = await connect(
      new FakeSupabase({ playbooks: [playbookRow({ flow: triggerAgentFlow })] })
    )
    const result = await client.callTool({
      name: "get_node_upstream_context",
      arguments: { playbookId, nodeId: "a1" },
    })
    expect(result.isError).toBeFalsy()
    expect(data(result).ancestors.map((a: any) => a.id)).toContain("t1")
  })

  it("errors when the node id is unknown", async () => {
    const client = await connect(
      new FakeSupabase({ playbooks: [playbookRow({ flow: triggerAgentFlow })] })
    )
    const result = await client.callTool({
      name: "get_node_upstream_context",
      arguments: { playbookId, nodeId: "ghost" },
    })
    expect(result.isError).toBeTruthy()
  })
})

describe("create_campaign tool", () => {
  it("requires an explicit mailbox (the MCP cannot list Unipile accounts)", async () => {
    const client = await connect(new FakeSupabase({ playbooks: [playbookRow()] }))
    const result = await client.callTool({
      name: "create_campaign",
      arguments: {
        playbookId,
        contactTableId: "00000000-0000-4000-8000-000000000201",
        steps: [{ copy: "hello" }],
      },
    })
    expect(result.isError).toBeTruthy()
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toMatch(/mailbox/i)
  })
})

describe("test_surf_point_node tool", () => {
  it("errors clearly when surf-flow-debug is unavailable", async () => {
    const client = await connect(
      new FakeSupabase({ playbooks: [playbookRow({ flow: triggerAgentFlow })] })
    )
    const result = await client.callTool({
      name: "test_surf_point_node",
      arguments: { playbookId, nodeId: "a1" },
    })
    // FakeSupabase has no functions.invoke -> the tool reports it is unavailable.
    expect(result.isError).toBeTruthy()
  })
})
