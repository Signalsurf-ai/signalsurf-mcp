export type CapabilityEntry = {
  name: string
  title: string
  description: string
}

export type CapabilityCatalog = {
  tools: CapabilityEntry[]
  prompts: CapabilityEntry[]
}

export type CapabilitySearchResult = {
  query: string
  tools: CapabilityEntry[]
  prompts: CapabilityEntry[]
  hint: string
}

function scoreEntry(entry: CapabilityEntry, terms: string[]): number {
  const name = entry.name.toLowerCase()
  const title = entry.title.toLowerCase()
  const description = entry.description.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (name.includes(term)) score += 3
    if (title.includes(term)) score += 2
    if (description.includes(term)) score += 1
  }
  return score
}

function rank(
  entries: CapabilityEntry[],
  terms: string[],
  limit: number
): CapabilityEntry[] {
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter((scored) => scored.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.entry.name.localeCompare(b.entry.name)
    )
    .slice(0, limit)
    .map((scored) => scored.entry)
}

const STOPWORDS = new Set([
  "a", "an", "the", "to", "with", "for", "of", "and", "or", "my", "me", "i",
  "in", "on", "is", "it", "this", "that", "how", "do", "can",
])

export function searchCapabilities(
  query: string,
  catalog: CapabilityCatalog,
  limit = 8
): CapabilitySearchResult {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term))

  // Empty query: surface the guided workflows (prompts) as the entry point
  // rather than dumping every tool.
  if (terms.length === 0) {
    return {
      query,
      tools: [],
      prompts: catalog.prompts,
      hint: "Describe what you want to do (e.g. \"enrich a table\", \"find leads\", \"set up a surf point\") to get the matching tools and prompts.",
    }
  }

  const tools = rank(catalog.tools, terms, limit)
  const prompts = rank(catalog.prompts, terms, limit)

  const hint =
    tools.length === 0 && prompts.length === 0
      ? "No capability matched. Try a broader query, or call get_context and list_tables to explore."
      : "Prefer a prompt for a guided multi-step workflow (fetch it via prompts/get); call a tool directly for a single action. Resolve real ids with get_context / list_tables before calling id-typed tools."

  return { query, tools, prompts, hint }
}
