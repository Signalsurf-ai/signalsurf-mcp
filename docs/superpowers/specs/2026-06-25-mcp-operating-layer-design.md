# SignalSurf MCP "Operating Layer" — Design

**Date:** 2026-06-25
**Branch:** `neonthewei/bycrawl-mcp-connector`
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

External agents connect to the SignalSurf MCP and receive 44 well-described tools but
no operating guidance. They have hands, not a playbook. The concrete failure: an agent
called `list_quick_surf` with `databaseId: null` because it never resolved the real
database id first (`MCP error -32602: invalid_type, expected string, received null,
path: [databaseId]`). The internal Surfer agent does not have this problem because its
dynamically-built system prompt (`SignalsurfWeb/.../pipeline/brain-analyze.ts:620-889`)
injects the operating workflow plus rich context (schema, brand, field conventions,
relation definitions, popular values).

## Goal & Success Criteria

A strong external agent (e.g. Claude Code) connected to the MCP can carry out Surfer's
core workflows correctly, first try, with the heavy reasoning staying on the **server
brain** (unchanged). Specifically:

1. The `databaseId: null` class of error becomes structurally impossible — the agent is
   guided to resolve ids before any id-typed parameter, and id-not-found errors return
   the valid options.
2. "Enrich the whole table" is a single guided flow (`enrich_table` prompt) that ends in
   the server brain filling every row via Quick Surf.
3. The agent has access to the same contextual "material" Surfer uses, on demand, via one
   read-only tool.

**Non-goals (YAGNI / parity gates):** not replicating or relocating the brain; not
exposing memory (sensitive, gated in `docs/surfer-mcp-parity.json`); no new write paths
beyond existing tools; only one workflow prompt (`enrich_table`) this cut — others
(`set_up_surf_point`, `triage_signals`, `build_lead_list`) are follow-ups using the same
shape.

## Decision: this keeps the brain on the server

The external model's role is to **operate SignalSurf like Surfer does** — orchestrate and
poll — while Quick Surf / surf points execute per-cell enrichment server-side with the
full internal context. We are closing the *guidance + context* gap, not the *reasoning*
gap.

## Architecture — three layers + one flagship workflow

### Layer 0 — Always-on operating manual (`instructions`)

Replace the single sentence at `src/server.ts:102-103` with a compact (~30–40 line)
structured manual. Content:

- **Golden rule:** call `get_context` first; resolve `productId` (when multi-product) and
  `databaseId` / `surfPointId` via the relevant `list_*` tool before passing any id-typed
  parameter. Never pass `null` or a guessed id.
- **"I want to X → read prompt Y / use tools Z"** quick map.
- **Execution model note:** enrichment is executed by the server brain (Quick Surf and
  surf points). The agent's job is to set up, trigger, and poll — not to fill cells by
  hand unless explicitly asked.

Keep it short so it does not bloat every request.

### Layer 1 — Context bundle tool: `get_enrichment_context` (read-only)

New public MCP tool.

**Input:** `{ databaseId: uuid, fieldKey?: string, productId?: uuid }`
**Capability required:** `context.read` + `tables.read` (reuse `assertCanUseCapability`).
**Output (single JSON):**

- `brand` — from existing brand-context read (brand/product description, categories,
  selling points, target audience, competitors, website). Empty fields when brand setup
  is incomplete (same behavior as `get_brand_context`).
- `table` — schema: each field with `key`, `type`, `options`, `isEntryKey`, `description`,
  and relation-field markers (from existing `listTableFields`).
- `relations` — relation definitions touching this table (source → relationType → target),
  each with a one-line "how to link" note.
- `conventions` — static text ported from `brain-analyze.ts:668-674`: website/profile_url
  construction rules, free-text array normalization (lowercase, dash-not-space, singular),
  stable-identifier rules. Stored as a constant in the MCP repo.
- `popularValues` — for each free-text array/tag field, top-N `{ value, count }`. When
  `fieldKey` is provided, scope to that field only.

**popularValues implementation — chosen: (a) SQL aggregation.** Add a repository method
that runs, against the `entries` table (JSONB `data` column, scoped by the table's id):

```sql
SELECT value, COUNT(*) AS count
FROM entries e, jsonb_array_elements_text(e.data -> $fieldKey) AS value
WHERE e.database_id = $databaseId   -- exact scoping column verified during implementation
GROUP BY value
ORDER BY count DESC
LIMIT $n;                            -- N default ~30, bounded
```

Note: Surfer itself defines but does not currently populate `popularArrayValues`
(`brain-analyze.ts` type at ~101-104, consumed ~759-766 but never computed), so the MCP
agent gets parity-plus on this axis.

### Layer 2 — MCP Prompts (the playbooks)

Enable the currently-unused MCP Prompts primitive via `server.registerPrompt` (available
in `@modelcontextprotocol/sdk` ^1.29). First and only prompt this cut:

**`enrich_table({ databaseId?: uuid, productId?: uuid })`** → returns a guided, parametrized
message sequence. When `databaseId` is supplied, the resolved id is embedded; when omitted,
step 1 instructs discovery instead of failing. Steps:

1. (if no `databaseId`) call `list_tables`, pick the table.
2. call `get_enrichment_context(databaseId)` to load brand / schema / conventions /
   popularValues.
3. for each column to fill: `enable_quick_surf(databaseId, fieldKey, whatToDo)` — write
   `whatToDo` using the brand + schema context; optionally set a `runCondition` gate.
4. `run_quick_surf(databaseId, fieldKey, scope: 'all')` — the server brain fills every row.
5. `wait_for_surf_job` / `list_surf_jobs` to poll and report.

The prompt body embeds the conventions and the "the brain does the work, you orchestrate"
framing. Structured so additional prompts are drop-in additions.

## Data flow

```
external agent
  → reads instructions (always present)
  → invokes enrich_table prompt
  → prompt directs it to call get_enrichment_context
        → server assembles brand + schema + conventions + popularValues from Supabase (read-only)
  → agent calls enable_quick_surf / run_quick_surf
        → server brain executes per-cell with full internal context  ← reasoning stays here
  → agent polls jobs (wait_for_surf_job / list_surf_jobs)
```

All new code is **read-only context assembly + static prompt/manual text**. The brain and
the existing 44 tools are unchanged.

## Error handling

- `get_enrichment_context`:
  - invalid / unauthorized `databaseId` → reuse `resolveProductContext` product-scope guard
    (404/403 via `UserFacingError`).
  - brand not set up → empty `brand` fields (no error).
  - `fieldKey` provided but not found → `400` whose message **lists the valid field keys**,
    so the agent self-corrects (direct antidote to the "null id / wrong key" failure mode).
- `enrich_table` prompt: pure text; omitting `databaseId` triggers the discovery step, never
  an error.
- Prompts themselves require no scope to read, but reference tools the agent must be scoped
  for; insufficient scope still surfaces through the existing tool-call path.

## Testing

- Unit: `get_enrichment_context` assembles the correct bundle from a mocked repository
  (schema + brand + conventions + popularValues); product-scope guard rejects an
  unauthorized `databaseId`; `fieldKey`-not-found returns the helpful 400 with valid keys.
- popularValues query: aggregation correctness, `LIMIT` cap, array-field-only behavior.
- Prompt: `enrich_table` renders with and without `databaseId`; embeds the resolved id when
  provided.
- Parity: add `enrich_table` (prompt) and `get_enrichment_context` (tool) to
  `docs/surfer-mcp-parity.json` so `scripts/check-surfer-parity.mjs` passes.
- Regression: existing 44-tool tests, `typecheck`, and `vitest` stay green.

## Files touched (anticipated)

- `src/server.ts` — upgraded `instructions`; new `registerPrompts` section.
- `src/capabilities.ts` — `get_enrichment_context` entry in `PUBLIC_MCP_TOOLS`.
- `src/schemas.ts` — input schema for `get_enrichment_context`.
- `src/repository.ts` — `getEnrichmentContext` assembly + popularValues SQL method.
- `src/prompts.ts` (new) — `enrich_table` prompt builder + registration helper.
- `src/conventions.ts` (new) — ported `FIELD_CONVENTIONS` constant.
- `docs/surfer-mcp-parity.json` — register the new tool/prompt.
- `tests/` — units above.

## Open questions

None blocking. Exact `entries` scoping column (`database_id` vs `shore_id`) to be confirmed
against the live schema during implementation.
