import { z } from "zod"

/**
 * SurfPoint Flow V2 — a persisted multi-step graph (DAG) stored at
 * `playbooks.config.flow`. See docs/surf-point-flow-v2.md.
 *
 * This is the single source of truth for the flow shape. It is shared between
 * the Next.js app (editor + tRPC validation) and the Deno edge worker
 * (executor), which reaches it through the `_shared/ai-skill` re-export shim.
 * Do not duplicate the shape anywhere else.
 */

export const FLOW_VERSION = 2 as const

/**
 * How an outbound edge is selected from its source node's branch result.
 * Binary rules + agents use "always" | "on_pass" | "on_fail". A classify rule
 * emits one branch per category, encoded as `category:<label>` (see
 * categoryCondition); its outbound edges carry those.
 */
export const flowEdgeConditionSchema = z.string()
export type FlowEdgeCondition = z.infer<typeof flowEdgeConditionSchema>

/** Rule evaluation modes. `replied` reads per-entry external state (the Inbox)
 * rather than the signal content: on_pass = the contact replied since our last
 * outbound, on_fail = no reply. It is the composable "stop on reply" gate for
 * drips (pair it after a wait node). */
export const ruleModeSchema = z.enum(["relevance", "classify", "replied"])
export type RuleMode = z.infer<typeof ruleModeSchema>

/** Classify category <-> edge condition encoding. */
export const CATEGORY_CONDITION_PREFIX = "category:"
export function categoryCondition(label: string): string {
  return `${CATEGORY_CONDITION_PREFIX}${label}`
}
export function parseCategoryCondition(condition: string): string | null {
  return condition.startsWith(CATEGORY_CONDITION_PREFIX)
    ? condition.slice(CATEGORY_CONDITION_PREFIX.length)
    : null
}

/** Campaign step <-> edge condition encoding. A Campaign node fans one output
 * handle per ordered step (`step:<index>`); the matching edge routes that step
 * to its own agent. Positional (the runtime's stepper increments through them),
 * so steps are append/truncate-only in the editor. */
export const STEP_CONDITION_PREFIX = "step:"
export function stepCondition(index: number): string {
  return `${STEP_CONDITION_PREFIX}${index}`
}
export function parseStepCondition(condition: string): number | null {
  if (!condition.startsWith(STEP_CONDITION_PREFIX)) return null
  const n = Number(condition.slice(STEP_CONDITION_PREFIX.length))
  return Number.isInteger(n) && n >= 0 ? n : null
}

const positionSchema = z.object({ x: z.number(), y: z.number() })

const baseNodeFields = {
  id: z.string().min(1),
  /** Editor-only canvas position; the runtime ignores it. */
  position: positionSchema.optional(),
  /** Optional user-facing label; falls back to a type-derived default. */
  label: z.string().optional(),
  /** Per-node schema version for forward-compatible migrations. */
  typeVersion: z.literal(1).default(1),
}

/** Trigger: references existing source(s)/event bindings. Not a new config home. */
export const triggerNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal("trigger"),
  /** Source ids this trigger listens to; empty/omitted = the playbook's sources. */
  sourceIds: z.array(z.string()).optional(),
})

/**
 * Rule: a branching gate. Two modes:
 * - relevance: score 0-10 vs threshold -> on_pass / on_fail.
 * - classify: sort into one of `categories` -> a branch per category
 *   (`category:<label>` edges; see categoryCondition).
 */
export const ruleNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal("rule"),
  /** Evaluation mode; omitted = "relevance" (back-compat). The removed legacy
   * "pass_fail" mode coerces to "relevance" — both gate via on_pass/on_fail. */
  mode: z
    .union([ruleModeSchema, z.literal("pass_fail")])
    .optional()
    .transform((m) => (m === "pass_fail" ? "relevance" : m)),
  /** relevance: overrides scoring_rubric; classify: extra guidance. */
  prompt: z.string().optional(),
  /** relevance mode: minimum relevance (0-10) to take on_pass. */
  relevanceThreshold: z.number().int().min(0).max(10).optional(),
  /** classify mode: the categories a signal is sorted into (each gets a branch). */
  categories: z.array(z.string().min(1)).optional(),
})

/** Agent: one focused Brain task that proposes writes/actions over a scoped context. */
export const agentNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal("agent"),
  prompt: z.string(),
  /** Narrows the playbook database_ids for this node; omitted = inherit all. */
  databaseIds: z.array(z.string()).optional(),
  /** Narrows the playbook tool pool for this node; omitted = inherit all. */
  allowedToolIds: z.array(z.string()).optional(),
  /** Per-node run mode (SIG-974): "standard" = one-shot phase-split,
   * "thinking" = multi-step agent loop with tools. Auto-inferred from the
   * instruction. Omitted = inherit the playbook's agent_loop_enabled flag. */
  agentMode: z.enum(["standard", "thinking"]).optional(),
})

/** Deterministic action kinds whose config lives inline on the node (no agent,
 * no backing product_tools row): POST a payload to a webhook, call an HTTP
 * endpoint, insert a new row into one of the Surf Point's databases, or
 * "object_sink" — the editor surface for `playbooks.config.object_sink`: a
 * webhook's whole payload lands as one object column on a table. The object_sink
 * node is declarative (the webhook receiver does the write; see SIG-971); it is a
 * no-op if a signal reaches it during a flow run. */
export const actionKindSchema = z.enum([
  "webhook",
  "http",
  "create_row",
  "object_sink",
  // SIG-998: deterministic Unipile send (no agent) — DM today, email/posting as
  // those actions land. actionConfig references a configured Unipile action:
  // { tool_id } (a product_tools unipile_send_dm / unipile_email row).
  "unipile",
])
export type ActionKind = z.infer<typeof actionKindSchema>

/**
 * Action: a downstream side effect. Two shapes:
 * - inline deterministic: `actionKind` + `actionConfig` fire directly when the
 *   signal reaches the node (no agent).
 * - legacy: `toolId` references a configured product_tools action.
 */
export const actionNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal("action"),
  toolId: z.string().min(1).optional(),
  actionKind: actionKindSchema.optional(),
  /** Inline config for actionKind. Values support {{path}} templating against
   * the signal. webhook { url, fields: [{key,value}] }; http { url, method,
   * headers, params, body }; create_row { database_id, fields: [{key,value}] }. */
  actionConfig: z.record(z.unknown()).optional(),
})

/**
 * Wait: a general timer. Pauses the run for `delaySeconds`, then continues along
 * its outbound edge(s) (branch "always"). It is a *pure* timer — it knows nothing
 * about the signal content; compose it with a rule node (e.g. a "replied" gate)
 * for conditional cadence. The runtime implements the pause by enqueuing the
 * downstream flow_node job with `locked_until = now + delaySeconds`; the queue
 * claimer (`claim_next_surf_job`) skips that job until it is due, so no scheduler
 * or per-run pointer is needed. See docs/surf-point-flow-v2.md.
 */
export const waitNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal("wait"),
  /** How long to pause before continuing. Stored in seconds; authored in days in
   * the editor. 0 = pass straight through (no delay). */
  delaySeconds: z.number().int().min(0).default(0),
  /** When the wait elapses, check the Inbox first: if the contact replied since
   * our last outbound, stop the whole run here (no downstream). This merges the
   * old separate "replied?" gate into the wait for the common drip case — one
   * node, single output. A run with no contact email never stops (no-op). */
  stopOnReply: z.boolean().optional().default(true),
})

/** One step of a Campaign: a GATE (what must be true before it fires) + cadence.
 * The "how to write this step" instruction does NOT live here — each step routes
 * out its own `step:<index>` handle to a dedicated agent node, and that agent's
 * own prompt + attached Unipile tool compose and send. The Campaign only emits
 * context; the agents own the copy. */
export const sequenceStepSchema = z.object({
  /** WAIT this long first (after the previous step; step 1 measures from enrol),
   * THEN evaluate the condition. 0 = check immediately. */
  delaySeconds: z.number().int().min(0).default(0),
  /** The CONDITION checked AFTER the wait. It holds → FIRE; it doesn't → SKIP the
   * step (advance without sending). Pairs are complementary, so "yes → step A /
   * no → step B" composes linearly (each its own step + agent), no canvas fork.
   * Step 1 is always "none".
   * - "none": always fire.
   * - "accepted" / "not_accepted": did the LinkedIn connection get accepted by now
   *   (the relation webhook stamps `linkedin_accepted_at`).
   * - "replied" / "not_replied": did the contact reply since our last send (Inbox,
   *   optionally limited to `replyChannel`). */
  condition: z
    .enum(["none", "accepted", "not_accepted", "replied", "not_replied"])
    .default("none"),
  /** For replied/not_replied: which channel's reply counts (Inbox `channel`,
   * case-insensitive). Omitted = any channel. */
  replyChannel: z.string().optional(),
})
export type SequenceStep = z.infer<typeof sequenceStepSchema>

/**
 * Campaign: the entry node that owns a contact drip. It binds the AUDIENCE (a
 * contact list / `databaseId`) and the ordered STEPS (cadence only), and
 * self-drives — woken by enrolment, its own timer (a deferred re-enqueue), and
 * an inbound reply. On each wake it reads the contact's run state, stops if they
 * replied, otherwise fires that step's OWN output handle (`step:<index>`) to the
 * agent wired there — handing it only context (which contact, which step, the
 * in-thread reply id), never copy. Each step's agent owns its prompt + mailbox
 * (its attached Unipile email tool). So the node is a pure context emitter:
 * Campaign + one agent per step. (`type` stays "sequence" for back-compat; the
 * UI labels it "Campaign".) Per-contact progress lives on
 * `entries.data.flow_run` (`step` + `status`).
 */
export const sequenceNodeSchema = z.object({
  ...baseNodeFields,
  type: z.literal("sequence"),
  /** The audience: the contact list (database id) this campaign enrols from. */
  databaseId: z.string().optional(),
  steps: z.array(sequenceStepSchema).min(1),
  /** Contact column holding the recipient address; default "email". */
  recipientField: z.string().optional(),
})

export const flowNodeSchema = z.discriminatedUnion("type", [
  triggerNodeSchema,
  ruleNodeSchema,
  agentNodeSchema,
  actionNodeSchema,
  waitNodeSchema,
  sequenceNodeSchema,
])
export type FlowNode = z.infer<typeof flowNodeSchema>
export type FlowNodeType = FlowNode["type"]

export const flowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  condition: flowEdgeConditionSchema.default("always"),
})
export type FlowEdge = z.infer<typeof flowEdgeSchema>

/**
 * The versioned envelope. Future versions extend this as a
 * `z.discriminatedUnion("version", [...])` so old saved specs keep parsing.
 */
export const surfPointFlowV2Schema = z.object({
  version: z.literal(FLOW_VERSION),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
})
export type SurfPointFlowV2 = z.infer<typeof surfPointFlowV2Schema>

// ─── Graph helpers (pure; safe in both Node and Deno) ────────────────────────

function liveEdges(flow: SurfPointFlowV2): FlowEdge[] {
  const ids = new Set(flow.nodes.map((n) => n.id))
  return flow.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
}

/** Entry nodes = nodes with no inbound edge. Computed, never stored. */
export function flowEntryNodeIds(flow: SurfPointFlowV2): string[] {
  const targets = new Set(liveEdges(flow).map((e) => e.target))
  return flow.nodes.filter((n) => !targets.has(n.id)).map((n) => n.id)
}

/**
 * Entry trigger nodes that should fire for a signal from `sourceId`: triggers
 * whose `sourceIds` include it, or that list no sources (= a catch-all that
 * listens to every source). Returns an empty array when no trigger is bound to
 * the source: the signal belongs to no workflow in this graph, so it must NOT
 * fan out to unrelated entry chains (e.g. a sibling workflow's LinkedIn-invite
 * action). Skipping it mirrors the unipile-relation-webhook seeding, which also
 * drops a signal whose source no trigger listens to. Used to seed only the
 * relevant per-source trigger node(s).
 */
export function entryTriggersForSource(
  flow: SurfPointFlowV2,
  sourceId: string
): string[] {
  const entries = flowEntryNodeIds(flow)
  const byId = new Map(flow.nodes.map((n) => [n.id, n]))
  return entries.filter((id) => {
    const n = byId.get(id)
    if (!n || n.type !== "trigger") return false
    return !n.sourceIds?.length || n.sourceIds.includes(sourceId)
  })
}

/** First node of a type in declared order (used by the legacy dual-write). */
export function firstNodeOfType<T extends FlowNodeType>(
  flow: SurfPointFlowV2,
  type: T
): Extract<FlowNode, { type: T }> | undefined {
  return flow.nodes.find((n) => n.type === type) as
    | Extract<FlowNode, { type: T }>
    | undefined
}

/** Outbound edges of a node whose condition matches the node's branch result. */
export function nextEdges(
  flow: SurfPointFlowV2,
  nodeId: string,
  branch: FlowEdgeCondition
): FlowEdge[] {
  return liveEdges(flow).filter(
    (e) =>
      e.source === nodeId &&
      (e.condition === "always" || e.condition === branch)
  )
}

/**
 * Narrow a default id list by a node override. Returns the intersection so a
 * node can only ever shrink the playbook's authorized set, never widen it.
 * An absent override inherits the defaults. This is the node-scoping security
 * boundary the executor relies on. See docs/surf-point-flow-v2.md.
 */
export function narrowIds(defaults: string[], override?: string[]): string[] {
  if (!override) return defaults
  const allowed = new Set(defaults)
  return override.filter((id) => allowed.has(id))
}

export type FlowProblemCode =
  | "cycle"
  | "dangling_edge"
  | "no_entry"
  | "unrouted_category"
  | "action_unconfigured"
  | "unresolved_field"

export interface FlowProblem {
  code: FlowProblemCode
  message: string
  nodeId?: string
  edgeId?: string
}

/**
 * Structural validation for the executor: DAG-only; fan-in/joins are allowed.
 * Returns an empty array when the flow is structurally runnable.
 */
export function validateFlow(flow: SurfPointFlowV2): FlowProblem[] {
  const problems: FlowProblem[] = []
  const nodeIds = new Set(flow.nodes.map((n) => n.id))

  for (const e of flow.edges) {
    if (!nodeIds.has(e.source))
      problems.push({
        code: "dangling_edge",
        edgeId: e.id,
        message: `Edge "${e.id}" has an unknown source "${e.source}".`,
      })
    if (!nodeIds.has(e.target))
      problems.push({
        code: "dangling_edge",
        edgeId: e.id,
        message: `Edge "${e.id}" has an unknown target "${e.target}".`,
      })
  }

  const outgoing = new Map<string, string[]>()
  const inbound = new Map<string, number>()
  for (const n of flow.nodes) {
    outgoing.set(n.id, [])
    inbound.set(n.id, 0)
  }
  for (const e of liveEdges(flow)) {
    outgoing.get(e.source)!.push(e.target)
    inbound.set(e.target, (inbound.get(e.target) ?? 0) + 1)
  }

  // Multiple inbound edges (fan-in / joins) are allowed: each raw signal
  // traverses independently, and the executor dedups re-entry on
  // run_id + flow_node_id, so a node never runs twice for one signal.

  if (
    flow.nodes.length > 0 &&
    flow.nodes.every((n) => (inbound.get(n.id) ?? 0) > 0)
  ) {
    problems.push({
      code: "no_entry",
      message: "Flow has no entry node; every node has an inbound edge.",
    })
  }

  // 3-color DFS cycle detection.
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const n of flow.nodes) color.set(n.id, WHITE)
  const visit = (id: string): boolean => {
    color.set(id, GRAY)
    for (const next of outgoing.get(id) ?? []) {
      const c = color.get(next)
      if (c === GRAY) return true
      if (c === WHITE && visit(next)) return true
    }
    color.set(id, BLACK)
    return false
  }
  for (const n of flow.nodes) {
    if (color.get(n.id) === WHITE && visit(n.id)) {
      problems.push({ code: "cycle", message: "Flow contains a cycle." })
      break
    }
  }

  // Classify rules emit a branch per category; warn (non-blocking) on any
  // category with no outbound edge wired to it, so its signals would stop here.
  const live = liveEdges(flow)
  for (const n of flow.nodes) {
    if (n.type !== "rule" || n.mode !== "classify") continue
    const wired = new Set(
      live.filter((e) => e.source === n.id).map((e) => e.condition)
    )
    for (const cat of n.categories ?? []) {
      if (!wired.has(categoryCondition(cat)))
        problems.push({
          code: "unrouted_category",
          nodeId: n.id,
          message: `Classify category "${cat}" is not connected to anything.`,
        })
    }
  }

  // Action nodes need their target configured or they fail at runtime for
  // every signal (executeInlineAction returns "Missing url" / "No target
  // table"). Surface it as a non-blocking problem so the editor warns before
  // the Surf Point goes live, without blocking auto-save mid-edit.
  for (const n of flow.nodes) {
    if (n.type !== "action") continue
    const label = n.label ?? n.id
    if (n.actionKind) {
      const cfg = (n.actionConfig ?? {}) as Record<string, unknown>
      const hasUrl = typeof cfg.url === "string" && cfg.url.trim().length > 0
      const hasTable =
        typeof cfg.database_id === "string" && cfg.database_id.length > 0
      if ((n.actionKind === "webhook" || n.actionKind === "http") && !hasUrl)
        problems.push({
          code: "action_unconfigured",
          nodeId: n.id,
          message: `Action "${label}" is missing a URL.`,
        })
      if (
        (n.actionKind === "create_row" || n.actionKind === "object_sink") &&
        !hasTable
      )
        problems.push({
          code: "action_unconfigured",
          nodeId: n.id,
          message: `Action "${label}" has no target table selected.`,
        })
      // SIG-998/999: a Unipile node needs a connected action referenced
      // (tool_id) or a full inline mapping. DM needs account + message column;
      // a LinkedIn invite needs account + recipient (profile) column.
      if (n.actionKind === "unipile") {
        const hasTool =
          typeof cfg.tool_id === "string" && cfg.tool_id.trim().length > 0
        const hasAccount =
          typeof cfg.account_id === "string" && cfg.account_id.length > 0
        const hasFields =
          cfg.unipile_action === "invite"
            ? typeof cfg.recipient_field_key === "string" &&
              cfg.recipient_field_key.length > 0
            : typeof cfg.message_field_key === "string" &&
              cfg.message_field_key.length > 0
        if (!hasTool && !(hasAccount && hasFields))
          problems.push({
            code: "action_unconfigured",
            nodeId: n.id,
            message: `Action "${label}" has no Unipile action configured.`,
          })
      }
    } else if (!n.toolId) {
      problems.push({
        code: "action_unconfigured",
        nodeId: n.id,
        message: `Action "${label}" has no action configured.`,
      })
    }
  }

  return problems
}

/**
 * Field-reference validation (SIG-977): a create_row / object_sink action that
 * maps a field key which is not a real column of its target table will fail or
 * silently write nothing at runtime. Pure: the caller supplies the known columns
 * per database id (the executor fetches them; the eval uses a fake catalog). A
 * database id with no entry in the map is skipped (unknown columns must not
 * produce false positives). Returns non-blocking `unresolved_field` problems —
 * surfaced as warnings so the agent can self-repair without blocking the save.
 */
export function validateFieldReferences(
  flow: SurfPointFlowV2,
  columnsByDatabaseId: Record<string, string[]>
): FlowProblem[] {
  const problems: FlowProblem[] = []
  for (const node of flow.nodes) {
    if (node.type !== "action") continue
    if (node.actionKind !== "create_row" && node.actionKind !== "object_sink")
      continue
    const cfg = (node.actionConfig ?? {}) as Record<string, unknown>
    const databaseId =
      typeof cfg.database_id === "string" ? cfg.database_id : ""
    const columns = columnsByDatabaseId[databaseId]
    // Unknown columns (missing or empty) → skip, never a false positive.
    if (!columns || columns.length === 0) continue
    const columnSet = new Set(columns)
    const fields = Array.isArray(cfg.fields) ? cfg.fields : []
    for (const field of fields) {
      const key = (field as Record<string, unknown> | null)?.key
      if (typeof key !== "string") continue
      if (!columnSet.has(key)) {
        problems.push({
          code: "unresolved_field",
          nodeId: node.id,
          message: `Action "${
            node.label ?? node.id
          }" maps field "${key}", which is not a column of its target table. Available columns: ${columns.join(
            ", "
          )}.`,
        })
      }
    }
  }
  return problems
}

// Granular graph mutations + topology-aware data-flow resolution (SIG-977).
export * from "./mutations.js"
export * from "./upstream-context.js"
// Campaign (sequence) graph builder for create_campaign (SIG-1023).
export * from "./campaign.js"
