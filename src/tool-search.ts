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
  limit: number,
  preferredNames: readonly string[] = []
): CapabilityEntry[] {
  const preferred = new Set(preferredNames)
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter((scored) => scored.score > 0)
    .sort(
      (a, b) =>
        Number(preferred.has(b.entry.name)) -
          Number(preferred.has(a.entry.name)) ||
        b.score - a.score ||
        a.entry.name.localeCompare(b.entry.name)
    )
    .slice(0, limit)
    .map((scored) => scored.entry)
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "with",
  "for",
  "of",
  "and",
  "or",
  "my",
  "me",
  "i",
  "in",
  "on",
  "is",
  "it",
  "this",
  "that",
  "how",
  "do",
  "can",
])

const DOMAIN_ALIASES: Record<string, readonly string[]> = {
  crm: ["table", "row", "record", "database"],
}

const DOMAIN_BOOTSTRAP_TOOLS: Record<string, readonly string[]> = {
  crm: ["list_tables"],
}

function queryTerms(query: string): string[] {
  const literalTerms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term))
  return [
    ...new Set(
      literalTerms.flatMap((term) => [term, ...(DOMAIN_ALIASES[term] ?? [])])
    ),
  ]
}

export function searchCapabilities(
  query: string,
  catalog: CapabilityCatalog,
  limit = 8
): CapabilitySearchResult {
  const domains = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => DOMAIN_ALIASES[term])
  const terms = queryTerms(query)

  // Empty query: surface the guided workflows (prompts) as the entry point
  // rather than dumping every tool.
  if (terms.length === 0) {
    return {
      query,
      tools: [],
      prompts: catalog.prompts,
      hint: 'Describe what you want to do (e.g. "enrich a table", "find leads", "set up a Workflow") to get the matching tools and prompts.',
    }
  }

  const bootstrapTools = domains.flatMap(
    (domain) => DOMAIN_BOOTSTRAP_TOOLS[domain] ?? []
  )
  const tools = rank(catalog.tools, terms, limit, bootstrapTools)
  const prompts = rank(catalog.prompts, terms, limit)

  const hint =
    tools.length === 0 && prompts.length === 0
      ? "No capability matched. Try a broader query, or call get_workspace_context and list_tables to explore."
      : "Prefer a prompt for a guided multi-step workflow (fetch it via prompts/get); call a tool directly for a single action. Resolve real ids with get_workspace_context / list_tables before calling id-typed tools."

  return { query, tools, prompts, hint }
}
