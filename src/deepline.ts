// Minimal Deepline v2 client for the MCP server (Node runtime).
//
// Mirrors the contract used in SignalsurfWeb, verified against the live catalog
// (scripts/deepline-run.sh --tools): one key routes across Deepline's provider
// tools. We drive a small curated set and expose the catalog-search + execute
// bridge used by SignalsurfWeb's agent.
//
//   POST {base}/api/v2/integrations/{toolId}/execute  body {"payload": {...}}
//   GET  {base}/api/v2/tools
//   Authorization: Bearer <key>
//   x-deepline-execute-response-contract: v2-tool-response
//   -> { status: "completed"|"success"|"ok", toolResponse: { raw } }

const DEFAULT_BASE_URL = "https://code.deepline.com"
const EXECUTE_RESPONSE_CONTRACT = "v2-tool-response"

/** Tool ids confirmed against the live catalog; env-overridable. */
export const DEEPLINE_TOOL_IDS = {
  searchPeople: () =>
    process.env.DEEPLINE_PROSPECT_SEARCH_TOOL_ID?.trim() ||
    "apollo_search_people",
  searchCompanies: () =>
    process.env.DEEPLINE_COMPANY_SEARCH_TOOL_ID?.trim() ||
    "apollo_company_search",
  emailFinder: () =>
    process.env.DEEPLINE_EMAIL_FINDER_TOOL_ID?.trim() ||
    "leadmagic_email_finder",
}

/** Kill-switch (default off). Mirrors SignalsurfWeb's DEEPLINE_DISABLED. */
export function isDeeplineDisabled(): boolean {
  const v = process.env.DEEPLINE_DISABLED
  if (!v) return false
  const s = v.trim().toLowerCase()
  return s === "1" || s === "true" || s === "yes" || s === "on"
}

function baseUrl(): string {
  return (
    process.env.DEEPLINE_API_BASE_URL ||
    process.env.DEEPLINE_HOST_URL ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "")
}

export interface DeeplineEnvelope {
  status?: string
  toolResponse?: { raw?: unknown } | null
  result?: unknown
  data?: unknown
  [key: string]: unknown
}

export function deeplineStatusOk(status: unknown): boolean {
  return status === "completed" || status === "success" || status === "ok"
}

export function unwrapDeepline(envelope: DeeplineEnvelope): unknown {
  if (envelope?.toolResponse && "raw" in envelope.toolResponse) {
    return envelope.toolResponse.raw
  }
  if (envelope?.result !== undefined) return envelope.result
  if (envelope?.data !== undefined) return envelope.data
  return envelope
}

/** Drop undefined/empty fields so finders that reject unknown/empty keys 200. */
export function cleanDeeplinePayload(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue
    if (typeof value === "string" && !value.trim()) continue
    out[key] = value
  }
  return out
}

export type FetchLike = typeof fetch

/** List Deepline's live v2 tool catalog. Throws on a non-2xx response. */
export async function listDeeplineTools(
  apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<Array<Record<string, unknown>>> {
  const res = await fetchImpl(`${baseUrl()}/api/v2/tools`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(
      `Deepline tool catalog -> HTTP ${res.status}${
        text ? `: ${text.slice(0, 300)}` : ""
      }`
    )
  }
  const data = (await res.json()) as { tools?: unknown } | unknown[]
  const tools = Array.isArray(data) ? data : data.tools
  return Array.isArray(tools) ? (tools as Array<Record<string, unknown>>) : []
}

/** Execute one Deepline tool. Throws on a non-2xx (message carries the status). */
export async function executeDeeplineTool(
  toolId: string,
  payload: Record<string, unknown>,
  apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<DeeplineEnvelope> {
  const res = await fetchImpl(
    `${baseUrl()}/api/v2/integrations/${encodeURIComponent(toolId)}/execute`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "x-deepline-execute-response-contract": EXECUTE_RESPONSE_CONTRACT,
      },
      body: JSON.stringify({ payload }),
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(
      `Deepline ${toolId} -> HTTP ${res.status}${
        text ? `: ${text.slice(0, 300)}` : ""
      }`
    )
  }
  return (await res.json()) as DeeplineEnvelope
}
