import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js"
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
import {
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

const CURSOR_PREFIX = "signalsurf-tools-v2:"
export const DEFAULT_TOOL_LIST_PAGE_BYTES = 64 * 1024
export const TOOL_LIST_FRAMING_RESERVE_BYTES = 512
const EMPTY_OBJECT_JSON_SCHEMA = { type: "object", properties: {} } as const
const REPEATED_WORKSPACE_GUIDANCE =
  "Pass workspaceId when this connection can access multiple workspaces."
type DescriptionOverride = { sourceSha256: string; summary: string }

const DISCOVERY_DESCRIPTION_OVERRIDES: Record<string, DescriptionOverride> = {
  wait_for_thread_response: {
    sourceSha256: "590bca956973a49c86a879c3052f0919c1ca0e325a0142be7dd838b076bcb291",
    summary:
      "Wait for the Agent after starting or replying in a Thread. First use eventSequence for both sequence inputs; on repeats keep inputSequence fixed and advance afterSequence. Keep polling while still_working; inspect and report settled events.",
  },
  run_enrich: {
    sourceSha256: "6faf699f0a97f7440bf61ce52c7fd17ba4792e6b5bf385ee565c47bbff57c927",
    summary:
      "Queue Enrich with exactly one of scope, entryIds, or entryId. Existing values are skipped; set overwriteExisting=true only with explicit user consent. Persisted runCondition gates still apply. Poll the returned jobs. Credits are charged as jobs run.",
  },
  deepline_search_people: {
    sourceSha256: "3d873b6077abe8589ba748de803168871978a3d073e7aa776a8c97a2aeee6094",
    summary:
      "Search people through managed Deepline/Crustdata after an exact, unexpired one-time Web approval. Supports provider-neutral or compatible Apollo-shaped filters. Returns previews and counts; finding emails requires the separate enrich step.",
  },
  enable_enrich: {
    sourceSha256: "47fea7091fe8a936ce2619be6ced43d21a9778aeb78effd7832f382218f60e4e",
    summary:
      "Enable one Table column for AI enrichment with a whatToDo instruction, optional automatic filling for new rows, and an optional runCondition. Re-enabling restores an off column and updates its instruction.",
  },
  deepline_search_companies: {
    sourceSha256: "731fcb10b9ad125fb1173a46a27688ec51126fd2c823e6ca027b4a1573facf54",
    summary:
      "Search companies through managed Deepline/Crustdata after an exact, unexpired one-time Web approval. Supports provider-neutral company filters and compatible Apollo-shaped names; Apollo itself requires an explicit BYOC override.",
  },
  get_enrichment_context: {
    sourceSha256: "935a57f153a9befb151b1711889a5fe3522518f522d4583a1c180dc91713b2b3",
    summary:
      "Get brand context, Table schema, popular values, and field conventions before configuring Enrich or editing rows. Optionally pass fieldKey to focus the result on one column.",
  },
  edit_workflow_flows: {
    sourceSha256: "6ebed4dd311e7ef4dfb3976310b5088aba032e4984897d26c36ffb7ebab42f81",
    summary:
      "Atomically edit a Workflow node graph with ordered add, connect, update, remove-node, and remove-edge operations. Connected Nodes share a Flow; disconnected chains form separate Flows. Any invalid edit rejects the whole batch.",
  },
  publish_project_conclusion: {
    sourceSha256: "c425eddd414fbb75bbc31fd2bb4cb1991d7cba518d1d2d6464564457e858c473",
    summary:
      "Publish a durable decision, direction, research summary, assumption, or next step to the relevant Project Thread, or create a conclusion Thread. Store only the useful conclusion and evidence—never the private transcript or routine tool chatter.",
  },
  get_node_upstream_context: {
    sourceSha256: "b596e39f5b84677bd8e4ecbb496e4e4d02f5c99fb066927070d57844b1443077",
    summary:
      "Inspect a node's upstream chain, triggers, sources, writable targets, target-table columns, and signal fields. Always call this before mapping create_row or object_sink fields.",
  },
  deepline_execute_tool: {
    sourceSha256: "32b1cad69bc45ceeaa140f53159d0e8a22ed1e7e4693a587d6bcdd63c4e7e911",
    summary:
      "Execute a Deepline tool only with an exact, unexpired one-time Web approval bound to this grant, workspace, tool id, and payload. May spend provider credits and requires the workspace Deepline integration key.",
  },
  find_capabilities: {
    sourceSha256: "187591bca1eab3130faf3dc649ce24284cab5f5440dd5e6d9a116038aee14161",
    summary:
      "Search the tools and guided prompts available to this token by intent. Use this instead of scanning the catalog when unsure; pass an empty query to list guided workflows.",
  },
  update_workflow: {
    sourceSha256: "e13a03aa079208a512a5a6f97f06825eb59231b837af766c6aa0d2ac8f239930",
    summary:
      "Update authorized Workflow metadata, Project placement, prompts, target Tables, JSON config, or attached integration tool ids. toolConfigPatch is shallow-merged.",
  },
  create_campaign: {
    sourceSha256: "302ecebf892191d4d9c02bc1b338753c0b950e7c49b0b0d478db3ff995249c3e",
    summary:
      "Create a draft cold-email Campaign for a Table/Object audience. Requires a connected Unipile mailbox id and campaign steps. It remains independent from Workflows and does not enroll contacts automatically.",
  },
  get_brand_context: {
    sourceSha256: "9e13f287c89f06068009fbefe9a108d749abe1128896607d604d378ea394bca3",
    summary:
      "Read the workspace's brand and positioning context, including audience, competitors, selling points, categories, and website. Unconfigured fields are returned empty.",
  },
  search_instagram_content: {
    sourceSha256: "c68b8c00d0600bce55a46422644dceacee5cd343b3a061d2eb4b0dfe4f91526c",
    summary:
      "Search the public Instagram post corpus after an exact, unexpired one-time Web approval. Returns post evidence and deduplicated creators, costs three SignalSurf credits per page, and never substitutes for Instagram Reels Search.",
  },
  deepline_enrich_contact: {
    sourceSha256: "5c3bc638221adc10107475112b16527da65ad2e1416d05f267db9a8137778cb6",
    summary:
      "Find a verified work email through Deepline after an exact, unexpired one-time Web approval. Requires first and last name plus domain or company name. Credits are charged only on a hit; misses are free.",
  },
  plan_sender_capacity: {
    sourceSha256: "830325c33fc7b1ff2af209ae1adecb2639054bbf30edae0cd51d68c06cf5653f",
    summary:
      "Plan worst-case Email capacity from recipients, touches, sending days, daily volume, utilization, and mailboxes per Domain. Defaults are editable planning assumptions, not hard limits; unverified live capacity counts as zero.",
  },
  search_sender_domains: {
    sourceSha256: "39b2e43750ea3b889158f8c1b5b3d2c3741bb6abd8db2320cc99f6bea1ff804c",
    summary:
      "Check managed Email Domain availability or generate candidates from a brand seed. This read does not price or purchase Domains; pricing, plan credits, registrant details, and purchase confirmation stay in the secure app.",
  },
  start_thread: {
    sourceSha256: "035b2e67841fd0e214a901e9ae71ecc3ce21611b607cf5a335335ef16622502a",
    summary:
      "Start a Thread in an existing Project as the authorizing member. Set mentionsSurfer when the Project Agent should work on it; if waiting_for_surfer is returned, poll wait_for_thread_response through settlement.",
  },
  test_workflow_node: {
    sourceSha256: "0875c24247ac4713b86a94935d769fd62a996f5284bd4ee4640a9b4ef4b4a289",
    summary:
      "Dry-run one Workflow node without committing changes. Returns rule, classifier, or proposed Agent-write output and requires the surf-flow-debug service to be reachable.",
  },
  update_table: {
    sourceSha256: "ebfd875f59177d2c33ae545b9655da5f5892ec677528f357e23fcad0ffeb4906",
    summary:
      "Update authorized Table metadata, custom schema, saved views, or folder placement. Applying a canonical template upgrades a compatible Table while preserving additive custom fields.",
  },
  inspect_sender_infrastructure: {
    sourceSha256: "e6726cf81e8b157cf8248b65fc2b449a33b5c7e501cd3a0740adf02fd4a36341",
    summary:
      "Read managed Domains, mailbox lifecycle/health, Warm-up and Placement metrics, sender settings, connected channel bindings, and entitlements. Secrets and mailbox credentials are never returned.",
  },
  describe_node_types: {
    sourceSha256: "e4a09036dfa294fe727044792158bf871ff6e4d9cc13004d9dede5d55d1af608",
    summary:
      "List Workflow Flow V2 node types, fields, and legal edge conditions. Call this before building or editing the node graph so Nodes and edges are shaped correctly.",
  },
  create_signal: {
    sourceSha256: "a2dc6323ba0fd08bbc1945c5b834ab21565d735002992330f824dd05d6b4d18a",
    summary:
      "Create a Signal for an authorized Workflow across supported public, custom, webhook, monitor, and internal trigger types. Webhook Signals return their callable SignalSurf webhookUrl.",
  },
  create_table: {
    sourceSha256: "415d7ca2f56313d3d62b12ad8d4e85ef1682581fbc506daa072ea842e1a10d38",
    summary:
      "Create a Table/List in an authorized workspace, optionally from a canonical template. Templates provide baseline schemas while allowing additive custom fields.",
  },
}

type RegisteredTool = {
  enabled: boolean
  title?: string
  description?: string
  inputSchema?: Parameters<typeof normalizeObjectSchema>[0]
  outputSchema?: Parameters<typeof normalizeObjectSchema>[0]
  annotations?: Tool["annotations"]
  execution?: Tool["execution"]
  _meta?: Tool["_meta"]
}

function compactAnnotations(
  annotations: Tool["annotations"]
): Tool["annotations"] {
  if (!annotations) return undefined
  const compact = { ...annotations }
  // These are the protocol defaults. Leaving them implicit preserves the same
  // client semantics without repeating four booleans across every definition.
  if (compact.readOnlyHint === false) delete compact.readOnlyHint
  if (compact.readOnlyHint === true) {
    // MCP defines both hints as meaningful only for mutating tools.
    delete compact.destructiveHint
    delete compact.idempotentHint
  } else {
    if (compact.destructiveHint === true) delete compact.destructiveHint
    if (compact.idempotentHint === false) delete compact.idempotentHint
  }
  if (compact.openWorldHint === true) delete compact.openWorldHint
  return Object.keys(compact).length > 0 ? compact : undefined
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

async function compactDescription(
  name: string,
  description: string | undefined
): Promise<string | undefined> {
  if (!description) return description
  const override = DISCOVERY_DESCRIPTION_OVERRIDES[name]
  if (override) {
    return (await sha256Hex(description)) === override.sourceSha256
      ? override.summary
      : description
  }
  return description
    .replace(` ${REPEATED_WORKSPACE_GUIDANCE}`, "")
    .replace(REPEATED_WORKSPACE_GUIDANCE, "")
    .trim()
}

async function toolDefinition(
  name: string,
  tool: RegisteredTool
): Promise<Tool> {
  const input = normalizeObjectSchema(tool.inputSchema)
  const inputSchema = (input
    ? toJsonSchemaCompat(input, {
        strictUnions: true,
        pipeStrategy: "input",
      })
    : EMPTY_OBJECT_JSON_SCHEMA) as Tool["inputSchema"]
  const output = normalizeObjectSchema(tool.outputSchema)
  const outputSchema = output
    ? (toJsonSchemaCompat(output, {
        strictUnions: true,
        pipeStrategy: "input",
      }) as Tool["outputSchema"])
    : undefined
  // The root draft marker is repeated for every tool and does not alter
  // validation. Keep parameter descriptions/defaults: remote models need them
  // to construct correct calls from discovery alone.
  delete inputSchema.$schema
  if (outputSchema) delete outputSchema.$schema
  const definition: Tool = {
    name,
    title: tool.title,
    description: await compactDescription(name, tool.description),
    inputSchema,
    outputSchema,
    annotations: compactAnnotations(tool.annotations),
    _meta: tool._meta,
  }
  return definition
}

function cursorFor(index: number, fingerprint: string): string {
  return `${CURSOR_PREFIX}${fingerprint}:${index}`
}

function parseCursor(
  cursor: string | undefined,
  length: number,
  fingerprint: string
): number {
  if (cursor === undefined) return 0
  if (!cursor.startsWith(CURSOR_PREFIX)) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid tools/list cursor")
  }
  const match = /^([a-f0-9]{64}):(\d+)$/.exec(
    cursor.slice(CURSOR_PREFIX.length)
  )
  if (!match) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid tools/list cursor")
  }
  if (match[1] !== fingerprint) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Tools catalog changed; restart tools/list without a cursor"
    )
  }
  const index = Number(match[2])
  if (!Number.isSafeInteger(index) || index <= 0 || index >= length) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid tools/list cursor")
  }
  return index
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

async function fingerprintCatalog(tools: Tool[]): Promise<string> {
  return sha256Hex(JSON.stringify(tools))
}

/**
 * The v1 SDK's high-level McpServer returns every registered tool in one page.
 * Override only its public tools/list handler so large combined capability
 * catalogs use the protocol's cursor contract; tools/call remains SDK-owned.
 */
export function installPaginatedToolList(
  server: McpServer,
  maxPageBytes = DEFAULT_TOOL_LIST_PAGE_BYTES
): void {
  if (!Number.isSafeInteger(maxPageBytes) || maxPageBytes < 1024) {
    throw new Error("maxPageBytes must be an integer of at least 1024 bytes")
  }
  const registered = (
    server as unknown as { _registeredTools: Record<string, RegisteredTool> }
  )._registeredTools
  if (!registered || typeof registered !== "object") {
    throw new Error("MCP SDK tool registry is unavailable")
  }

  server.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const tools = await Promise.all(
      Object.entries(registered)
        .filter(([, tool]) => tool.enabled)
        .map(([name, tool]) => toolDefinition(name, tool))
    )
    const fingerprint = await fingerprintCatalog(tools)
    const start = parseCursor(
      request.params?.cursor,
      tools.length,
      fingerprint
    )
    const page: Tool[] = []

    for (let index = start; index < tools.length; index += 1) {
      const candidate = [...page, tools[index]!]
      const hasMore = index + 1 < tools.length
      const result = {
        tools: candidate,
        ...(hasMore
          ? { nextCursor: cursorFor(index + 1, fingerprint) }
          : {}),
      }
      if (encodedBytes(result) + TOOL_LIST_FRAMING_RESERVE_BYTES > maxPageBytes) {
        if (page.length === 0) {
          throw new McpError(
            ErrorCode.InternalError,
            "A tool definition exceeds the discovery page limit"
          )
        }
        break
      }
      page.push(tools[index]!)
    }

    const nextIndex = start + page.length
    return {
      tools: page,
      ...(nextIndex < tools.length
        ? { nextCursor: cursorFor(nextIndex, fingerprint) }
        : {}),
    }
  })
}
