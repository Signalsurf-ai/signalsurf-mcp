import {
  FLOW_VERSION,
  stepCondition,
  type SequenceStep,
  type SurfPointFlowV2,
} from "./index.js"
import { addNode, connectNodes } from "./mutations.js"

/**
 * Campaign builder (SIG-1023).
 *
 * A Campaign is a FIXED multi-part graph that the Surfer agent must NOT hand-wire
 * (it mis-wires the sequence node / step handles / per-step agents / mailbox). So
 * `create_campaign` supplies only high-level intent and this pure builder
 * assembles the correct-by-construction graph:
 *
 *   sequence (entry, audience + cadence)
 *     ├── step:0 ─▶ agent (step 1 copy, sends via the mailbox tool)
 *     ├── step:1 ─▶ agent (step 2 copy)
 *     └── step:N ─▶ agent (step N+1 copy)
 *
 * The sequence node is the sole entry (no inbound) — enrolment seeds it directly
 * (see sequencer.enrollInFlow). Each step agent narrows its tool pool to the one
 * shared `unipile_email` tool, so it composes and sends that step's email; the
 * runtime threads follow-ups and judges the gate (see the worker's "sequence"
 * node handler). Pure: ids come from `mintId` so it is deterministic + testable,
 * and it reuses addNode/connectNodes so the same legality core validates wiring.
 */

export type CampaignGate = "none" | "replied" | "not_replied"

export interface CampaignStepInput {
  /** WAIT this long before the step (step 1 measures from enrolment). Seconds. */
  delaySeconds: number
  /** Condition checked AFTER the wait; "none" = always send. Step 1 is forced
   *  "none" (nothing has been sent yet, so a reply gate is meaningless). */
  gate: CampaignGate
  /** The step agent's instruction — it composes + sends this email. */
  copy: string
}

export interface BuildCampaignFlowParams {
  /** Audience: the contact-list table the campaign enrols from. */
  contactTableId: string
  /** Contact column holding the recipient address (default "email"). */
  recipientField: string
  /** Ordered steps (>= 1). */
  steps: CampaignStepInput[]
  /** The shared unipile_email tool id every step agent sends through. */
  toolId: string
}

export interface BuildCampaignFlowResult {
  flow: SurfPointFlowV2
  sequenceNodeId: string
  stepAgentIds: string[]
}

/** Editor canvas layout so the built graph isn't stacked at the origin. */
const SEQUENCE_POS = { x: 0, y: 0 }
const AGENT_COL_X = 360
const AGENT_ROW_Y = 160

export function buildCampaignFlow(
  params: BuildCampaignFlowParams,
  mintId: (kind: "node" | "edge") => string
): BuildCampaignFlowResult {
  const steps: SequenceStep[] = params.steps.map((s, i) => ({
    delaySeconds: Math.max(0, Math.floor(s.delaySeconds || 0)),
    condition: i === 0 ? "none" : s.gate,
  }))

  // Read FLOW_VERSION at call time (not module-load) — campaign.ts and
  // surf-flow/index.ts are mutually imported, so a module-level constant could
  // capture FLOW_VERSION before the barrel finishes initializing it.
  const empty: SurfPointFlowV2 = { version: FLOW_VERSION, nodes: [], edges: [] }
  const sequenceNodeId = mintId("node")
  let flow = addNode(
    empty,
    {
      type: "sequence",
      label: "Campaign",
      position: SEQUENCE_POS,
      databaseId: params.contactTableId,
      recipientField: params.recipientField,
      steps,
    },
    sequenceNodeId
  )

  const stepAgentIds: string[] = []
  params.steps.forEach((step, i) => {
    const agentId = mintId("node")
    flow = addNode(
      flow,
      {
        type: "agent",
        label: `Step ${i + 1}`,
        position: { x: AGENT_COL_X, y: i * AGENT_ROW_Y },
        prompt: step.copy,
        allowedToolIds: [params.toolId],
      },
      agentId
    )
    flow = connectNodes(
      flow,
      { source: sequenceNodeId, target: agentId, condition: stepCondition(i) },
      mintId("edge")
    )
    stepAgentIds.push(agentId)
  })

  return { flow, sequenceNodeId, stepAgentIds }
}
