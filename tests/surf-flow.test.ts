import { describe, expect, it } from "vitest"
import {
  applyFlowEdits,
  buildCampaignFlow,
  describeNodeTypes,
  surfPointFlowV2Schema,
  validateFlow,
  type SurfPointFlowV2,
} from "../src/surf-flow/index.js"

function flow(
  nodes: SurfPointFlowV2["nodes"],
  edges: SurfPointFlowV2["edges"]
): SurfPointFlowV2 {
  return { version: 2, nodes, edges }
}

describe("surfPointFlowV2Schema", () => {
  it("parses a valid trigger -> agent flow", () => {
    const parsed = surfPointFlowV2Schema.safeParse({
      version: 2,
      nodes: [
        { id: "t1", type: "trigger" },
        { id: "a1", type: "agent", prompt: "do the thing" },
      ],
      edges: [{ id: "e1", source: "t1", target: "a1", condition: "always" }],
    })
    expect(parsed.success).toBe(true)
  })
})

describe("validateFlow", () => {
  it("flags a dangling edge", () => {
    const problems = validateFlow(
      flow(
        [{ id: "t1", type: "trigger" }],
        [{ id: "e1", source: "t1", target: "ghost", condition: "always" }]
      )
    )
    expect(problems.some((p) => p.code === "dangling_edge")).toBe(true)
  })

  it("flags a cycle", () => {
    const problems = validateFlow(
      flow(
        [
          { id: "a", type: "agent", prompt: "x" },
          { id: "b", type: "agent", prompt: "y" },
        ],
        [
          { id: "e1", source: "a", target: "b", condition: "always" },
          { id: "e2", source: "b", target: "a", condition: "always" },
        ]
      )
    )
    expect(problems.some((p) => p.code === "cycle")).toBe(true)
  })

  it("passes a clean DAG", () => {
    const problems = validateFlow(
      flow(
        [
          { id: "t1", type: "trigger" },
          { id: "a1", type: "agent", prompt: "x" },
        ],
        [{ id: "e1", source: "t1", target: "a1", condition: "always" }]
      )
    )
    expect(problems).toHaveLength(0)
  })
})

describe("applyFlowEdits", () => {
  it("builds a graph using refs and mints ids", () => {
    let n = 0
    const mintId = (kind: "node" | "edge") => `${kind}-${++n}`
    const result = applyFlowEdits(
      { version: 2, nodes: [], edges: [] },
      [
        { op: "add_node", ref: "trig", node: { type: "trigger" } },
        { op: "add_node", ref: "ag", node: { type: "agent", prompt: "go" } },
        { op: "connect", source: "trig", target: "ag", condition: "always" },
      ],
      mintId
    )
    expect(result.ok).toBe(true)
    expect(result.flow.nodes).toHaveLength(2)
    expect(result.flow.edges).toHaveLength(1)
    expect(result.refs.trig).toBe("node-1")
  })

  it("is atomic: a bad op rolls back the whole batch", () => {
    const start = { version: 2, nodes: [], edges: [] } as SurfPointFlowV2
    let n = 0
    const result = applyFlowEdits(
      start,
      [
        { op: "add_node", ref: "ag", node: { type: "agent", prompt: "go" } },
        { op: "connect", source: "ag", target: "missing" },
      ],
      () => `id-${++n}`
    )
    expect(result.ok).toBe(false)
    expect(result.flow.nodes).toHaveLength(0)
  })
})

describe("buildCampaignFlow", () => {
  it("wires a sequence node to one agent per step", () => {
    let n = 0
    const built = buildCampaignFlow(
      {
        contactTableId: "db-contacts",
        recipientField: "email",
        toolId: "tool-mailbox",
        steps: [
          { copy: "hi", gate: "none", delaySeconds: 0 },
          { copy: "follow up", gate: "not_replied", delaySeconds: 86400 },
        ],
      },
      (kind) => `${kind}-${++n}`
    )
    const seq = built.flow.nodes.find((node) => node.type === "sequence")
    expect(seq).toBeTruthy()
    expect(built.stepAgentIds).toHaveLength(2)
    expect(built.flow.edges.map((e) => e.condition).sort()).toEqual([
      "step:0",
      "step:1",
    ])
    expect(validateFlow(built.flow)).toHaveLength(0)
  })
})

describe("describeNodeTypes", () => {
  it("lists all six node types", () => {
    const catalog = describeNodeTypes()
    expect(catalog.nodeTypes.map((n) => n.type).sort()).toEqual([
      "action",
      "agent",
      "rule",
      "sequence",
      "trigger",
      "wait",
    ])
  })
})
