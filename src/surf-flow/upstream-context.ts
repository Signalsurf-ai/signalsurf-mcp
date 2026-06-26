import type { FlowNode, FlowNodeType, SurfPointFlowV2 } from "./index.js"

/**
 * Topology-aware data-flow resolution for SurfPointFlow V2.
 *
 * In a linear pipeline "the data" is just the signal and every step sees it. In
 * an open graph, what is in scope at a node depends on the PATH taken to reach
 * it: which trigger fed it, which upstream agent committed what. This module
 * answers "what can this node reference?" by walking the graph upstream — the
 * analog of n8n's get_expression_data_mapping, and the fix for the dominant
 * "topologically-valid-but-semantically-wrong" failure mode (e.g. a create_row
 * node mapping a field that does not exist on this path).
 *
 * External data (table columns, detected signal fields, source types) is
 * supplied through injected resolvers so the core stays pure and the offline
 * eval can use a fake catalog while the chat path resolves via exec(...).
 */

export interface UpstreamResolvers {
  /** Column names for a database/table id (e.g. via list_database_fields). */
  tableColumns?: (databaseId: string) => string[] | Promise<string[]>
  /** Field names on the incoming signal (detected structure / a sample). */
  signalFields?: () => string[] | Promise<string[]>
  /** Resolve a trigger sourceId to a human-readable source type/label. */
  sourceType?: (sourceId: string) => string | Promise<string>
}

export interface UpstreamContext {
  node: { id: string; type: FlowNodeType; label?: string }
  ancestors: { id: string; type: FlowNodeType; label?: string }[]
  upstreamTriggers: {
    nodeId: string
    sourceIds: string[]
    sourceTypes?: string[]
  }[]
  upstreamAgentWrites: {
    nodeId: string
    databaseId: string
    columns: string[]
  }[]
  /** Columns of this node's own target table (create_row / object_sink). */
  targetTableColumns?: string[]
  signalFields: string[]
  /** Suggested {{path}} references the node can safely read from. */
  resolvableVariables: string[]
}

/**
 * All nodes upstream of `nodeId` (reverse-reachable), in BFS order, excluding
 * the node itself. Cycle-safe via a visited set; ignores edges whose endpoints
 * are missing (consistent with validateFlow's liveEdges).
 */
export function upstreamAncestors(
  flow: SurfPointFlowV2,
  nodeId: string
): FlowNode[] {
  const ids = new Set(flow.nodes.map((n) => n.id))
  const incoming = new Map<string, string[]>()
  for (const e of flow.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    const list = incoming.get(e.target)
    if (list) list.push(e.source)
    else incoming.set(e.target, [e.source])
  }
  const byId = new Map(flow.nodes.map((n) => [n.id, n]))
  // Pre-seed with the queried node so a cycle never reports it as its own
  // ancestor (and never loops). A node is never upstream of itself.
  const seen = new Set<string>([nodeId])
  const out: FlowNode[] = []
  const queue = [...(incoming.get(nodeId) ?? [])]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (seen.has(cur)) continue
    seen.add(cur)
    const node = byId.get(cur)
    if (node) out.push(node)
    for (const parent of incoming.get(cur) ?? []) {
      if (!seen.has(parent)) queue.push(parent)
    }
  }
  return out
}

function brief(node: FlowNode): {
  id: string
  type: FlowNodeType
  label?: string
} {
  return { id: node.id, type: node.type, label: node.label }
}

function actionTargetDatabaseId(node: FlowNode): string | undefined {
  if (node.type !== "action") return undefined
  if (node.actionKind !== "create_row" && node.actionKind !== "object_sink")
    return undefined
  const cfg = (node.actionConfig ?? {}) as Record<string, unknown>
  return typeof cfg.database_id === "string" && cfg.database_id
    ? cfg.database_id
    : undefined
}

/**
 * Resolve the data context available at `nodeId`. Async because the chat path's
 * resolvers call exec(...); the eval passes synchronous fake-catalog resolvers.
 */
export async function buildUpstreamContext(
  flow: SurfPointFlowV2,
  nodeId: string,
  resolvers: UpstreamResolvers = {}
): Promise<UpstreamContext> {
  const node = flow.nodes.find((n) => n.id === nodeId)
  if (!node) {
    throw new Error(`No node "${nodeId}" in flow.`)
  }
  const ancestors = upstreamAncestors(flow, nodeId)

  const upstreamTriggers = await Promise.all(
    ancestors
      .filter(
        (n): n is Extract<FlowNode, { type: "trigger" }> => n.type === "trigger"
      )
      .map(async (t) => {
        const sourceIds = t.sourceIds ?? []
        const sourceTypes = resolvers.sourceType
          ? await Promise.all(sourceIds.map((id) => resolvers.sourceType!(id)))
          : undefined
        return {
          nodeId: t.id,
          sourceIds,
          ...(sourceTypes ? { sourceTypes } : {}),
        }
      })
  )

  const agentNodes = ancestors.filter(
    (n): n is Extract<FlowNode, { type: "agent" }> => n.type === "agent"
  )
  const upstreamAgentWrites: UpstreamContext["upstreamAgentWrites"] = []
  for (const agent of agentNodes) {
    for (const databaseId of agent.databaseIds ?? []) {
      const columns = resolvers.tableColumns
        ? await resolvers.tableColumns(databaseId)
        : []
      upstreamAgentWrites.push({ nodeId: agent.id, databaseId, columns })
    }
  }

  const targetDbId = actionTargetDatabaseId(node)
  const targetTableColumns =
    targetDbId && resolvers.tableColumns
      ? await resolvers.tableColumns(targetDbId)
      : undefined

  const signalFields = resolvers.signalFields
    ? await resolvers.signalFields()
    : []

  return {
    node: brief(node),
    ancestors: ancestors.map(brief),
    upstreamTriggers,
    upstreamAgentWrites,
    ...(targetTableColumns ? { targetTableColumns } : {}),
    signalFields,
    resolvableVariables: signalFields.map((f) => `{{signal.${f}}}`),
  }
}
