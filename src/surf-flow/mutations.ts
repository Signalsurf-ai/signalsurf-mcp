import {
  CATEGORY_CONDITION_PREFIX,
  STEP_CONDITION_PREFIX,
  flowNodeSchema,
  parseCategoryCondition,
  parseStepCondition,
  type FlowEdge,
  type FlowEdgeCondition,
  type FlowNode,
  type SurfPointFlowV2,
} from "./index.js"

/**
 * Pure, in-place-free graph mutations for SurfPointFlow V2.
 *
 * These are the granular building blocks the Surfer agent uses to edit an open
 * node graph incrementally (instead of re-emitting the whole `config.flow`).
 * They are pure: caller supplies node/edge ids (the chat executor mints them,
 * the eval uses a counter) so the functions never depend on randomness and are
 * trivially testable, and both the online chat path and the offline eval call
 * the exact same legality logic — one source of truth.
 *
 * Each function returns a NEW flow and throws `FlowMutationError` only on a
 * LOCAL boundary violation it can decide from the node/edge alone (unknown
 * endpoint, illegal condition, target-is-trigger, duplicate/missing id). GLOBAL
 * properties that depend on the whole graph (cycles, reachability) are NOT
 * checked here — the caller runs `validateFlow` on the result and decides
 * persistence. See docs/surf-point-flow-v2.md and
 * docs/superpowers/specs/2026-06-22-surfer-open-graph-build-tools-design.md.
 */

export type FlowMutationErrorCode =
  | "unknown_source"
  | "unknown_target"
  | "target_is_trigger"
  | "illegal_condition"
  | "unknown_category"
  | "node_not_found"
  | "edge_not_found"
  | "duplicate_id"
  | "type_immutable"
  | "invalid_node"

export class FlowMutationError extends Error {
  constructor(
    public readonly code: FlowMutationErrorCode,
    message: string,
    /** A short, model-facing hint on how to fix the call. */
    public readonly hint?: string
  ) {
    super(message)
    this.name = "FlowMutationError"
  }
}

/**
 * Distributive Omit so the discriminated union keeps each variant's own fields
 * (a plain `Omit<Union, K>` collapses to only the shared keys).
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

/**
 * Node input for `addNode`: a node minus its id (the caller mints it).
 * `typeVersion` is optional here — it has a schema default, so callers need not
 * supply it (the parse fills it in).
 */
export type FlowNodeInput = DistributiveOmit<FlowNode, "id" | "typeVersion"> & {
  typeVersion?: 1
}

function nodeById(flow: SurfPointFlowV2, id: string): FlowNode | undefined {
  return flow.nodes.find((n) => n.id === id)
}

/** A rule with no explicit mode behaves as relevance (schema back-compat). */
function ruleMode(node: Extract<FlowNode, { type: "rule" }>): string {
  return node.mode ?? "relevance"
}

/**
 * Is `condition` a legal outbound edge condition for `source`? Encodes the edge
 * semantics that previously lived only in prose + post-hoc validation:
 * - trigger / agent / action: only `always`.
 * - relevance rule: `always` | `on_pass` | `on_fail`.
 * - classify rule: `always` | `category:<label>` for a declared category.
 */
export function legalConditionForSource(
  source: FlowNode,
  condition: FlowEdgeCondition
): { ok: true } | { ok: false; code: FlowMutationErrorCode; hint: string } {
  if (condition === "always") return { ok: true }

  const category = parseCategoryCondition(condition)

  if (source.type === "rule") {
    const mode = ruleMode(source)
    if (mode === "relevance") {
      if (condition === "on_pass" || condition === "on_fail")
        return { ok: true }
      return {
        ok: false,
        code: "illegal_condition",
        hint: `A relevance rule branches with "on_pass" / "on_fail" / "always", not "${condition}".`,
      }
    }
    // classify
    if (category !== null) {
      if ((source.categories ?? []).includes(category)) return { ok: true }
      return {
        ok: false,
        code: "unknown_category",
        hint: `Classify rule "${
          source.label ?? source.id
        }" has no category "${category}". Declared: ${JSON.stringify(
          source.categories ?? []
        )}.`,
      }
    }
    return {
      ok: false,
      code: "illegal_condition",
      hint: `A classify rule branches with "${CATEGORY_CONDITION_PREFIX}<label>" or "always", not "${condition}".`,
    }
  }

  // A Campaign (sequence) node fans one `step:<index>` handle per ordered step;
  // each step routes to its own agent. Positional, so the index must be a real
  // step. (`always` is already accepted above and is harmless here.)
  if (source.type === "sequence") {
    const step = parseStepCondition(condition)
    if (step !== null) {
      const count = source.steps?.length ?? 0
      if (step >= 0 && step < count) return { ok: true }
      return {
        ok: false,
        code: "illegal_condition",
        hint: `Campaign "${
          source.label ?? source.id
        }" has ${count} step(s); "${condition}" is out of range. Use "${STEP_CONDITION_PREFIX}0".."${STEP_CONDITION_PREFIX}${Math.max(
          0,
          count - 1
        )}".`,
      }
    }
    return {
      ok: false,
      code: "illegal_condition",
      hint: `A Campaign (sequence) node routes each step out its own "${STEP_CONDITION_PREFIX}<index>" handle, not "${condition}".`,
    }
  }

  // trigger / agent / action / wait are not branching nodes.
  return {
    ok: false,
    code: "illegal_condition",
    hint: `A "${source.type}" node only has unconditional ("always") outbound edges; "${condition}" requires a rule or sequence node.`,
  }
}

/** Append a new node (id supplied by caller). Validates the node shape. */
export function addNode(
  flow: SurfPointFlowV2,
  nodeInput: FlowNodeInput,
  id: string
): SurfPointFlowV2 {
  if (nodeById(flow, id)) {
    throw new FlowMutationError(
      "duplicate_id",
      `A node with id "${id}" already exists.`,
      "Use a fresh id, or update the existing node with update_flow_node."
    )
  }
  const parsed = flowNodeSchema.safeParse({ ...nodeInput, id })
  if (!parsed.success) {
    throw new FlowMutationError(
      "invalid_node",
      `Invalid node: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      "Check the required fields for this node type (rule needs a mode/threshold or categories; agent needs a prompt; action needs actionKind+actionConfig or toolId)."
    )
  }
  return { ...flow, nodes: [...flow.nodes, parsed.data] }
}

/** Connect two nodes. Hard-rejects local boundary violations. */
export function connectNodes(
  flow: SurfPointFlowV2,
  link: { source: string; target: string; condition?: FlowEdgeCondition },
  edgeId: string
): SurfPointFlowV2 {
  const condition = link.condition ?? "always"
  if (flow.edges.some((e) => e.id === edgeId)) {
    throw new FlowMutationError(
      "duplicate_id",
      `An edge with id "${edgeId}" already exists.`
    )
  }
  const source = nodeById(flow, link.source)
  if (!source) {
    throw new FlowMutationError(
      "unknown_source",
      `No node "${link.source}" to connect from.`,
      "Add the source node first, or reference an existing node id."
    )
  }
  const target = nodeById(flow, link.target)
  if (!target) {
    throw new FlowMutationError(
      "unknown_target",
      `No node "${link.target}" to connect to.`,
      "Add the target node first, or reference an existing node id."
    )
  }
  if (target.type === "trigger") {
    throw new FlowMutationError(
      "target_is_trigger",
      `Cannot connect into trigger "${link.target}" — triggers are entry nodes with no inbound edges.`,
      "Connect from the trigger to downstream nodes, not into it."
    )
  }
  const legal = legalConditionForSource(source, condition)
  if (!legal.ok) {
    throw new FlowMutationError(legal.code, legal.hint, legal.hint)
  }
  const edge: FlowEdge = {
    id: edgeId,
    source: link.source,
    target: link.target,
    condition,
  }
  return { ...flow, edges: [...flow.edges, edge] }
}

/** Patch an existing node. Type is immutable; the merged node is re-validated. */
export function updateNode(
  flow: SurfPointFlowV2,
  nodeId: string,
  patch: Record<string, unknown>
): SurfPointFlowV2 {
  const node = nodeById(flow, nodeId)
  if (!node) {
    throw new FlowMutationError(
      "node_not_found",
      `No node "${nodeId}" to update.`
    )
  }
  if (typeof patch.type === "string" && patch.type !== node.type) {
    throw new FlowMutationError(
      "type_immutable",
      `Cannot change node "${nodeId}" from "${node.type}" to "${patch.type}".`,
      "Remove the node and add a new one of the desired type instead."
    )
  }
  // id and type are never patched.
  const { id: _ignoredId, type: _ignoredType, ...rest } = patch
  const merged = { ...node, ...rest, id: node.id, type: node.type }
  const parsed = flowNodeSchema.safeParse(merged)
  if (!parsed.success) {
    throw new FlowMutationError(
      "invalid_node",
      `Patch makes node "${nodeId}" invalid: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`
    )
  }
  return {
    ...flow,
    nodes: flow.nodes.map((n) => (n.id === nodeId ? parsed.data : n)),
  }
}

/** Remove a node and every edge touching it. */
export function removeNode(
  flow: SurfPointFlowV2,
  nodeId: string
): SurfPointFlowV2 {
  if (!nodeById(flow, nodeId)) {
    throw new FlowMutationError(
      "node_not_found",
      `No node "${nodeId}" to remove.`
    )
  }
  return {
    ...flow,
    nodes: flow.nodes.filter((n) => n.id !== nodeId),
    edges: flow.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  }
}

/** Remove a single edge by id. */
export function removeEdge(
  flow: SurfPointFlowV2,
  edgeId: string
): SurfPointFlowV2 {
  if (!flow.edges.some((e) => e.id === edgeId)) {
    throw new FlowMutationError(
      "edge_not_found",
      `No edge "${edgeId}" to remove.`
    )
  }
  return { ...flow, edges: flow.edges.filter((e) => e.id !== edgeId) }
}

// ─── Batch edits ─────────────────────────────────────────────────────────────

/**
 * One edit in an atomic batch. `add_node` may carry a `ref` — a local handle the
 * model picks so later ops in the SAME batch can reference the not-yet-minted
 * node by ref (source/target/nodeId accept a ref or a real id).
 */
export interface FlowEditOp {
  op: "add_node" | "connect" | "update_node" | "remove_node" | "remove_edge"
  ref?: string
  node?: FlowNodeInput
  source?: string
  target?: string
  condition?: FlowEdgeCondition
  nodeId?: string
  patch?: Record<string, unknown>
  edgeId?: string
}

export interface FlowEditResult {
  index: number
  op: string
  ok: boolean
  nodeId?: string
  edgeId?: string
  error?: string
  hint?: string
}

/**
 * Apply a list of edits in one shot — the same incremental, self-validating
 * mutations, but in a single round-trip (the model emits a plan of ops instead
 * of 10+ tool calls). ATOMIC: if any op fails its boundary check, the whole
 * batch is rejected and the ORIGINAL flow is returned (with the failing op
 * flagged) so a partial graph never lands. Returns the ref→minted-id map.
 */
export function applyFlowEdits(
  flow: SurfPointFlowV2,
  edits: FlowEditOp[],
  mintId: (kind: "node" | "edge") => string
): {
  ok: boolean
  flow: SurfPointFlowV2
  results: FlowEditResult[]
  refs: Record<string, string>
} {
  let working = flow
  const refs: Record<string, string> = {}
  const results: FlowEditResult[] = []
  const resolve = (idOrRef?: string): string =>
    (idOrRef && refs[idOrRef]) || idOrRef || ""

  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]!
    try {
      if (e.op === "add_node") {
        if (!e.node)
          throw new FlowMutationError(
            "invalid_node",
            "add_node requires `node`."
          )
        const id = mintId("node")
        working = addNode(working, e.node, id)
        if (e.ref) refs[e.ref] = id
        results.push({ index: i, op: e.op, ok: true, nodeId: id })
      } else if (e.op === "connect") {
        const edgeId = mintId("edge")
        working = connectNodes(
          working,
          {
            source: resolve(e.source),
            target: resolve(e.target),
            condition: e.condition,
          },
          edgeId
        )
        results.push({ index: i, op: e.op, ok: true, edgeId })
      } else if (e.op === "update_node") {
        const nodeId = resolve(e.nodeId)
        working = updateNode(working, nodeId, e.patch ?? {})
        results.push({ index: i, op: e.op, ok: true, nodeId })
      } else if (e.op === "remove_node") {
        const nodeId = resolve(e.nodeId)
        working = removeNode(working, nodeId)
        results.push({ index: i, op: e.op, ok: true, nodeId })
      } else if (e.op === "remove_edge") {
        if (!e.edgeId)
          throw new FlowMutationError(
            "edge_not_found",
            "remove_edge requires `edgeId`."
          )
        working = removeEdge(working, e.edgeId)
        results.push({ index: i, op: e.op, ok: true, edgeId: e.edgeId })
      } else {
        throw new FlowMutationError(
          "invalid_node",
          `Unknown op "${(e as FlowEditOp).op}".`
        )
      }
    } catch (err) {
      const me = err instanceof FlowMutationError ? err : null
      results.push({
        index: i,
        op: e.op,
        ok: false,
        error: me?.code ?? "error",
        hint: me?.hint ?? (err as Error).message,
      })
      // Atomic: drop the whole batch, return the untouched original.
      return { ok: false, flow, results, refs }
    }
  }
  return { ok: true, flow: working, results, refs }
}

// ─── Node-type catalog (grounding read tool) ─────────────────────────────────

/**
 * The node + edge catalog the agent can query instead of guessing field names
 * or legal wiring (and learning the rules only by trial-and-error rejections).
 * Static, derived from the schema's intent.
 */
export function describeNodeTypes() {
  return {
    nodeTypes: [
      {
        type: "trigger",
        purpose:
          "Entry node; binds the signal source(s). Has NO inbound edges.",
        fields: {
          sourceIds:
            "optional string[] — source ids this trigger listens to; omitted = the Surf Point's sources",
        },
        outboundConditions: ["always"],
      },
      {
        type: "rule",
        purpose:
          "Branching gate. relevance: score a signal 0-10 vs a threshold. classify: sort into named categories.",
        fields: {
          mode: "'relevance' | 'classify' (omitted = relevance)",
          prompt: "optional instructions / guidance",
          relevanceThreshold: "0-10 integer (relevance mode)",
          categories: "string[] of labels (classify mode)",
        },
        outboundConditions: [
          "on_pass / on_fail (relevance mode)",
          "category:<label> (classify mode, label must be declared)",
          "always",
        ],
      },
      {
        type: "agent",
        purpose:
          "A Surf step: an AI task that enriches/decides/writes over a scoped context.",
        fields: {
          prompt: "required — the task for this step",
          databaseIds:
            "optional string[] — narrow which tables this step may write",
          allowedToolIds:
            "optional string[] — narrow which tools this step may fire",
        },
        outboundConditions: ["always"],
      },
      {
        type: "action",
        purpose: "Deterministic side effect (no AI).",
        fields: {
          actionKind: "'webhook' | 'http' | 'create_row' | 'object_sink'",
          actionConfig:
            "create_row/object_sink: { database_id, fields:[{key,value}] } — each key MUST be a real column (call get_node_upstream_context); webhook/http: { url, method?, headers?, params?, body? }",
          toolId: "legacy alternative: a configured product tool id",
        },
        outboundConditions: ["always"],
      },
      {
        type: "wait",
        purpose:
          "A pure timer. Pauses the run for delaySeconds then continues; optionally stops the run if the contact replied in the meantime.",
        fields: {
          delaySeconds: "integer seconds to pause (0 = pass straight through)",
          stopOnReply:
            "boolean (default true) — stop the run here if the contact replied since our last outbound",
        },
        outboundConditions: ["always"],
      },
      {
        type: "sequence",
        purpose:
          "A Campaign: a contact-list email drip. Owns the audience + ordered steps (delay + gate). Each step routes out its own step:<index> handle to a dedicated agent that composes + sends that step's email. Build with create_campaign — do NOT hand-wire it.",
        fields: {
          databaseId: "the audience (contact-list table id) to enrol from",
          recipientField:
            "contact column holding the email address (default 'email')",
          steps:
            "ordered [{ delaySeconds, condition: 'none'|'replied'|'not_replied'|'accepted'|'not_accepted', replyChannel? }] — cadence only; the copy lives on each step's agent",
        },
        outboundConditions: ["step:<index> (one per declared step)"],
      },
    ],
    edgeRules:
      "An edge's condition must match its SOURCE node: 'always' from any node; 'on_pass'/'on_fail' only from a relevance rule; 'category:<label>' only from a classify rule with that label declared; 'step:<index>' only from a sequence (Campaign) node for a declared step. Never connect INTO a trigger. The graph is a DAG (no cycles).",
  }
}
