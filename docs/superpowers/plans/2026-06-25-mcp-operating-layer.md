# MCP Operating Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give external MCP agents the operating guidance and context they need to drive SignalSurf like the internal Surfer — without moving any reasoning off the server brain.

**Architecture:** Three additive, read-only layers on the existing 44-tool MCP server: (0) an upgraded always-on `instructions` operating manual, (1) a `get_enrichment_context` tool that bundles brand + schema + relations + field conventions + popular values, and (2) the first MCP **Prompt** (`enrich_table`) that scripts the Quick Surf enrichment flow. The brain and existing tools are untouched.

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk` ^1.29, `zod` ^3.25, Supabase JS (service role), `vitest` ^4.

## Global Constraints

- Node `>=22.13.0`; package manager `pnpm@10.0.0` (run via `corepack pnpm@10.0.0 ...`).
- All new code is **read-only**; no new write paths, no brain changes.
- Reuse existing helpers; do not duplicate: `getDatabaseAndValidateProduct`, `asRecord`, `schemaFields`, `formatBrandContext`, `runJsonTool`, `registerPublicTool`, `toolContext`, `assertToolAllowed`, `resolveProductContext`.
- Rows live in the `entries` table, JSONB `data` column, scoped by `database_id`. The table/database concept is the `databases` table; surf points are `playbooks`.
- `popularValues` is computed by a **bounded in-repo aggregation** (fetch ≤ `POPULAR_VALUES_SCAN_LIMIT` rows scoped by `database_id`, tally array values in JS). Do NOT add a Supabase migration/RPC in this repo.
- Tests: `corepack pnpm@10.0.0 typecheck` and `corepack pnpm@10.0.0 test` must stay green. Parity gate: `node scripts/check-surfer-parity.mjs` must pass.
- Commit after every task.

---

### Task 1: Field conventions constant + popular-values aggregator

**Files:**
- Create: `src/conventions.ts`
- Create: `src/popular-values.ts`
- Test: `tests/popular-values.test.ts`

**Interfaces:**
- Produces: `FIELD_CONVENTIONS: string` (exported from `src/conventions.ts`).
- Produces: `aggregatePopularValues(entries: Array<{ data: unknown }>, fieldKeys: string[], topN: number): Record<string, Array<{ value: string; count: number }>>` (exported from `src/popular-values.ts`). Only fields whose values appear as string arrays are included; fields with no array values are omitted from the result.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/popular-values.test.ts
import { describe, expect, it } from "vitest"
import { aggregatePopularValues } from "../src/popular-values.js"

describe("aggregatePopularValues", () => {
  const entries = [
    { data: { tags: ["ai", "saas"], name: "Acme" } },
    { data: { tags: ["ai", "fintech"], name: "Beta" } },
    { data: { tags: ["ai"], name: "Gamma" } },
    { data: { tags: "not-an-array", name: "Delta" } },
  ]

  it("counts string array values per field and sorts by count desc", () => {
    const result = aggregatePopularValues(entries, ["tags", "name"], 10)
    expect(result.tags).toEqual([
      { value: "ai", count: 3 },
      { value: "saas", count: 1 },
      { value: "fintech", count: 1 },
    ])
  })

  it("omits fields that never hold a string array", () => {
    const result = aggregatePopularValues(entries, ["tags", "name"], 10)
    expect(result.name).toBeUndefined()
  })

  it("caps results at topN", () => {
    const many = [{ data: { tags: ["a", "b", "c", "d"] } }]
    const result = aggregatePopularValues(many, ["tags"], 2)
    expect(result.tags).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@10.0.0 exec vitest run tests/popular-values.test.ts`
Expected: FAIL — `Cannot find module '../src/popular-values.js'`.

- [ ] **Step 3: Write the conventions constant**

```typescript
// src/conventions.ts
// Ported from the internal Surfer system prompt
// (SignalsurfWeb/supabase/functions/_shared/pipeline/brain-analyze.ts:668-674)
// so external agents fill columns by the same rules.
export const FIELD_CONVENTIONS = `Field conventions (apply when filling columns):
- Website field: use a standalone domain homepage OR a profile page URL, never a single post/article URL.
- profile_url for creators: construct deterministically from the handle (Instagram: https://instagram.com/<handle>, TikTok: https://www.tiktok.com/@<handle>). Do not copy it from a signal payload.
- Image/logo/avatar: do not invent an image field. If the schema declares one, fill it from an enrichment result or leave it null for the cache job to derive.
- Free-text array/tag fields: normalize values to lowercase, dash-not-space, singular form. Reuse existing values (see popularValues) instead of inventing near-duplicates.
- Stable identifiers for dedup: post URL for posts, lowercase brand name for brands, handle for creators.`
```

- [ ] **Step 4: Write the aggregator**

```typescript
// src/popular-values.ts
type Counted = { value: string; count: number }

export function aggregatePopularValues(
  entries: Array<{ data: unknown }>,
  fieldKeys: string[],
  topN: number
): Record<string, Counted[]> {
  const counts = new Map<string, Map<string, number>>()

  for (const entry of entries) {
    const data =
      entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)
        ? (entry.data as Record<string, unknown>)
        : {}
    for (const key of fieldKeys) {
      const raw = data[key]
      if (!Array.isArray(raw)) continue
      let perField = counts.get(key)
      if (!perField) {
        perField = new Map<string, number>()
        counts.set(key, perField)
      }
      for (const item of raw) {
        if (typeof item !== "string") continue
        const trimmed = item.trim()
        if (!trimmed) continue
        perField.set(trimmed, (perField.get(trimmed) ?? 0) + 1)
      }
    }
  }

  const result: Record<string, Counted[]> = {}
  for (const [key, perField] of counts) {
    if (perField.size === 0) continue
    result[key] = [...perField.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, topN)
  }
  return result
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm@10.0.0 exec vitest run tests/popular-values.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/conventions.ts src/popular-values.ts tests/popular-values.test.ts
git commit -m "feat: field conventions constant + popular-values aggregator"
```

---

### Task 2: `getEnrichmentContext` repository method

**Files:**
- Modify: `src/repository.ts` (add method on `SignalSurfRepository`; reuse `getDatabaseAndValidateProduct`, `asRecord`, `schemaFields`, `formatBrandContext`)
- Test: `tests/enrichment-context.test.ts`

**Interfaces:**
- Consumes: `FIELD_CONVENTIONS` (Task 1), `aggregatePopularValues` (Task 1).
- Produces: `SignalSurfRepository.getEnrichmentContext(context: SignalSurfContext, input: { databaseId: string; fieldKey?: string }): Promise<{ databaseId: string; brand: unknown; table: { fields: unknown[]; relations: unknown[] }; relations: unknown[]; conventions: string; popularValues: Record<string, Array<{ value: string; count: number }>> }>`. Throws `UserFacingError` 400 (with valid field keys listed) when `fieldKey` is given but absent from the schema. Product-scope errors propagate from `getDatabaseAndValidateProduct`.
- Produces: exported const `POPULAR_VALUES_SCAN_LIMIT = 1000` and `POPULAR_VALUES_TOP_N = 30` from `src/repository.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/enrichment-context.test.ts
import { describe, expect, it, vi } from "vitest"
import { SignalSurfRepository } from "../src/repository.js"
import { UserFacingError } from "../src/errors.js"

function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  const repo = Object.create(SignalSurfRepository.prototype) as SignalSurfRepository
  ;(repo as any).getDatabaseAndValidateProduct = vi.fn(async () => ({
    id: "db-1",
    schema: {
      fields: [
        { key: "tags", type: "multi_select" },
        { key: "name", type: "text" },
      ],
      relations: [{ source: "db-1", type: "works_at", target: "db-2" }],
    },
    ...(overrides.database as object),
  }))
  ;(repo as any).getBrandContext = vi.fn(async () => ({
    brandContext: { brandName: "Acme" },
  }))
  ;(repo as any).db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({
              data: [
                { data: { tags: ["ai", "saas"] } },
                { data: { tags: ["ai"] } },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
  }
  return repo
}

const ctx = { productId: "p1", role: "viewer" } as any

describe("getEnrichmentContext", () => {
  it("bundles brand, schema, relations, conventions, and popular values", async () => {
    const repo = makeRepo()
    const result = await repo.getEnrichmentContext(ctx, { databaseId: "db-1" })
    expect(result.databaseId).toBe("db-1")
    expect(result.brand).toEqual({ brandName: "Acme" })
    expect(result.table.fields).toHaveLength(2)
    expect(result.relations).toEqual([
      { source: "db-1", type: "works_at", target: "db-2" },
    ])
    expect(result.conventions).toContain("Field conventions")
    expect(result.popularValues.tags[0]).toEqual({ value: "ai", count: 2 })
  })

  it("throws 400 listing valid field keys when fieldKey is unknown", async () => {
    const repo = makeRepo()
    await expect(
      repo.getEnrichmentContext(ctx, { databaseId: "db-1", fieldKey: "ghost" })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      repo.getEnrichmentContext(ctx, { databaseId: "db-1", fieldKey: "ghost" })
    ).rejects.toThrow(/tags/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@10.0.0 exec vitest run tests/enrichment-context.test.ts`
Expected: FAIL — `repo.getEnrichmentContext is not a function`.

- [ ] **Step 3: Add constants + method to `src/repository.ts`**

Add near the other module constants (top of file):

```typescript
export const POPULAR_VALUES_SCAN_LIMIT = 1000
export const POPULAR_VALUES_TOP_N = 30
```

Add the import at the top with the other local imports:

```typescript
import { FIELD_CONVENTIONS } from "./conventions.js"
import { aggregatePopularValues } from "./popular-values.js"
```

Add this method inside the `SignalSurfRepository` class (next to `listDatabaseFields`):

```typescript
  async getEnrichmentContext(
    context: SignalSurfContext,
    input: { databaseId: string; fieldKey?: string }
  ) {
    const database = await this.getDatabaseAndValidateProduct(
      context,
      input.databaseId
    )
    const schema = asRecord(database.schema)
    const fields = schemaFields(schema)
    const relations = Array.isArray(schema.relations) ? schema.relations : []

    const fieldKeys = fields
      .map((field) =>
        field && typeof field === "object"
          ? (field as Record<string, unknown>).key
          : undefined
      )
      .filter((key): key is string => typeof key === "string")

    if (input.fieldKey && !fieldKeys.includes(input.fieldKey)) {
      throw new UserFacingError(
        `Unknown fieldKey "${input.fieldKey}". Valid field keys: ${fieldKeys.join(", ")}`,
        { code: "BAD_REQUEST", status: 400 }
      )
    }

    const scanKeys = input.fieldKey ? [input.fieldKey] : fieldKeys
    const { data: rows, error } = await this.db
      .from("entries")
      .select("data")
      .eq("database_id", input.databaseId)
      .order("updated_at", { ascending: false })
      .limit(POPULAR_VALUES_SCAN_LIMIT)
    requireNoDbError(error, "Failed to scan rows for popular values")

    const popularValues = aggregatePopularValues(
      (rows ?? []) as Array<{ data: unknown }>,
      scanKeys,
      POPULAR_VALUES_TOP_N
    )

    const { brandContext } = await this.getBrandContext(context)

    return {
      databaseId: input.databaseId,
      brand: brandContext,
      table: { fields, relations },
      relations,
      conventions: FIELD_CONVENTIONS,
      popularValues,
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm@10.0.0 exec vitest run tests/enrichment-context.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm@10.0.0 typecheck`
Expected: no errors. (If `getDatabaseAndValidateProduct`/`schemaFields`/`asRecord`/`requireNoDbError` are module-private rather than class/module scope, reference them exactly as the existing `listDatabaseFields` method does.)

- [ ] **Step 6: Commit**

```bash
git add src/repository.ts tests/enrichment-context.test.ts
git commit -m "feat: getEnrichmentContext repository method (brand + schema + relations + conventions + popular values)"
```

---

### Task 3: `get_enrichment_context` MCP tool

**Files:**
- Modify: `src/schemas.ts` (add `getEnrichmentContextSchema`)
- Modify: `src/capabilities.ts` (add `get_enrichment_context` to `PUBLIC_MCP_TOOLS`)
- Modify: `src/server.ts` (register the tool; import the schema)
- Test: `tests/enrichment-context-tool.test.ts`

**Interfaces:**
- Consumes: `SignalSurfRepository.getEnrichmentContext` (Task 2).
- Produces: public MCP tool `get_enrichment_context` with `requiredCapability: "tables.read"`.

- [ ] **Step 1: Add the input schema**

In `src/schemas.ts`, next to `listDatabaseFieldsSchema`:

```typescript
export const getEnrichmentContextSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  fieldKey: z.string().min(1).max(100).optional(),
}
```

- [ ] **Step 2: Add the capability entry**

In `src/capabilities.ts`, add to the `PUBLIC_MCP_TOOLS` object (after `get_brand_context`):

```typescript
  get_enrichment_context: {
    title: "Get Enrichment Context",
    description:
      "Bundle everything an agent needs before filling or enriching a table column: brand/positioning context, the table schema (fields, types, options, entry key, relations), the most popular existing values per tag/array field, and SignalSurf field conventions. Call this before writing whatToDo for enable_quick_surf or before manual row edits. Pass productId when this connection can access multiple products; pass fieldKey to scope popular values to one column.",
    requiredCapability: "tables.read",
    surferSurface: "enrichment context",
    publicStatus: "supported",
    annotations: READ_ANNOTATIONS,
  },
```

- [ ] **Step 3: Register the tool in `src/server.ts`**

Add `getEnrichmentContextSchema` to the schema import block, then add this registration alongside the other `registerPublicTool` calls (e.g. after `get_brand_context` / near `list_database_fields`):

```typescript
  registerPublicTool(
    "get_enrichment_context",
    getEnrichmentContextSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("get_enrichment_context")
        return repository.getEnrichmentContext(toolContext(args), {
          databaseId: args.databaseId,
          fieldKey: args.fieldKey,
        })
      })
  )
```

- [ ] **Step 4: Write the test**

```typescript
// tests/enrichment-context-tool.test.ts
import { describe, expect, it, vi } from "vitest"
import { createSignalSurfMcpServer } from "../src/server.js"

const context = {
  productId: "p1",
  productIds: ["p1"],
  products: [{ productId: "p1", name: "Acme" }],
  role: "editor",
  scopes: undefined,
} as any

it("exposes get_enrichment_context and routes to the repository", async () => {
  const getEnrichmentContext = vi.fn(async () => ({
    databaseId: "db-1",
    brand: { brandName: "Acme" },
    table: { fields: [], relations: [] },
    relations: [],
    conventions: "Field conventions: ...",
    popularValues: {},
  }))
  const repository = { getEnrichmentContext } as any
  const server = createSignalSurfMcpServer({ context, repository })
  // The tool must be registered under this exact name.
  expect(
    (server as any)._registeredTools?.get_enrichment_context ??
      (server as any)._registeredTools?.["get_enrichment_context"]
  ).toBeTruthy()
})
```

> Note: confirm the actual private accessor the SDK exposes for registered tools by reading how existing `tests/` assert tool registration; mirror that exact pattern instead of `_registeredTools` if it differs.

- [ ] **Step 5: Run tests + typecheck**

Run: `corepack pnpm@10.0.0 exec vitest run tests/enrichment-context-tool.test.ts && corepack pnpm@10.0.0 typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/schemas.ts src/capabilities.ts src/server.ts tests/enrichment-context-tool.test.ts
git commit -m "feat: get_enrichment_context MCP tool"
```

---

### Task 4: `enrich_table` MCP prompt

**Files:**
- Create: `src/prompts.ts`
- Modify: `src/server.ts` (call `registerPrompts(server)` from `createSignalSurfMcpServer`, after `registerTools`)
- Test: `tests/prompts.test.ts`

**Interfaces:**
- Produces: `registerPrompts(server: McpServer): void` exported from `src/prompts.ts`, registering an `enrich_table` prompt with optional args `{ databaseId?, productId? }`.
- Produces: `buildEnrichTablePrompt(args: { databaseId?: string; productId?: string }): string` (pure, exported for testing).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/prompts.test.ts
import { describe, expect, it } from "vitest"
import { buildEnrichTablePrompt } from "../src/prompts.js"

describe("buildEnrichTablePrompt", () => {
  it("instructs discovery when no databaseId is given", () => {
    const text = buildEnrichTablePrompt({})
    expect(text).toMatch(/list_tables/)
    expect(text).toMatch(/get_enrichment_context/)
    expect(text).toMatch(/enable_quick_surf/)
    expect(text).toMatch(/run_quick_surf/)
    expect(text).toMatch(/wait_for_surf_job/)
  })

  it("embeds the resolved databaseId when provided", () => {
    const text = buildEnrichTablePrompt({ databaseId: "db-42" })
    expect(text).toContain("db-42")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@10.0.0 exec vitest run tests/prompts.test.ts`
Expected: FAIL — `Cannot find module '../src/prompts.js'`.

- [ ] **Step 3: Write `src/prompts.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

export function buildEnrichTablePrompt(args: {
  databaseId?: string
  productId?: string
}): string {
  const dbLine = args.databaseId
    ? `Target databaseId: ${args.databaseId} (already resolved — skip discovery).`
    : "No databaseId given yet — resolve it first."
  const productLine = args.productId
    ? `Use productId ${args.productId} on every product-scoped call.`
    : "If get_context reports multiple products, pass the chosen productId on every call."

  return `You are operating SignalSurf to enrich a whole table. The SignalSurf brain fills each cell server-side; your job is to set up, trigger, and poll — not to fill cells by hand.

${dbLine}
${productLine}

Follow these steps in order:
1. Call get_context. ${args.productId ? "" : "Pick the productId if multiple are returned. "}${args.databaseId ? "" : "Then call list_tables and choose the target table's databaseId."}
2. Call get_enrichment_context(databaseId${args.databaseId ? `="${args.databaseId}"` : ""}) to load brand context, the table schema, popular existing values, and field conventions.
3. For each column you want to enrich: call enable_quick_surf(databaseId, fieldKey, whatToDo). Write whatToDo using the brand context and schema from step 2, and follow the field conventions (e.g. reuse popular values; lowercase-dash-singular for tag arrays). Optionally set runCondition to only fill rows that meet a gate.
4. Call run_quick_surf(databaseId, fieldKey, scope="all") for each enabled column to backfill every row (capped at 1000).
5. Poll with wait_for_surf_job / list_surf_jobs until jobs finish, then report which columns were filled and any skipped rows.

Never pass a null or guessed id — always resolve real ids in steps 1–2 first.`
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "enrich_table",
    {
      title: "Enrich a table (Quick Surf)",
      description:
        "Guided workflow to enrich an entire SignalSurf table column-by-column using Quick Surf, with the server brain filling each cell.",
      argsSchema: {
        databaseId: z.string().optional(),
        productId: z.string().optional(),
      },
    },
    async (args: { databaseId?: string; productId?: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: buildEnrichTablePrompt(args) },
        },
      ],
    })
  )
}
```

- [ ] **Step 4: Wire it into the server**

In `src/server.ts`, import and call it. Add to imports:

```typescript
import { registerPrompts } from "./prompts.js"
```

Enable the prompts capability and register, inside `createSignalSurfMcpServer`. Update the `capabilities` object to include `prompts: {}`:

```typescript
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
```

And after `registerTools(server, repository, context)` add:

```typescript
  registerPrompts(server)
```

- [ ] **Step 5: Run tests + typecheck**

Run: `corepack pnpm@10.0.0 exec vitest run tests/prompts.test.ts && corepack pnpm@10.0.0 typecheck`
Expected: PASS (2 tests), no type errors. (If `registerPrompt`'s `argsSchema` typing rejects the shape, match the exact `PromptArgsRawShape` form the SDK expects — a plain object of zod types, as written.)

- [ ] **Step 6: Commit**

```bash
git add src/prompts.ts src/server.ts tests/prompts.test.ts
git commit -m "feat: enrich_table MCP prompt (first guided playbook)"
```

---

### Task 5: Upgrade the `instructions` operating manual

**Files:**
- Modify: `src/server.ts:102-103` (the `instructions` string)
- Test: `tests/instructions.test.ts`

**Interfaces:**
- Produces: exported const `SERVER_INSTRUCTIONS: string` from `src/server.ts` (so it is testable and reusable), referenced by the `McpServer` config.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/instructions.test.ts
import { describe, expect, it } from "vitest"
import { SERVER_INSTRUCTIONS } from "../src/server.js"

describe("SERVER_INSTRUCTIONS", () => {
  it("tells agents to resolve ids before id-typed params", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/get_context/)
    expect(SERVER_INSTRUCTIONS).toMatch(/list_tables/)
    expect(SERVER_INSTRUCTIONS).toMatch(/never pass.*null/i)
  })

  it("points at the enrich_table prompt and the enrichment context tool", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/enrich_table/)
    expect(SERVER_INSTRUCTIONS).toMatch(/get_enrichment_context/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@10.0.0 exec vitest run tests/instructions.test.ts`
Expected: FAIL — `SERVER_INSTRUCTIONS` is not exported.

- [ ] **Step 3: Add the constant and use it**

In `src/server.ts`, add above `createSignalSurfMcpServer`:

```typescript
export const SERVER_INSTRUCTIONS = `SignalSurf MCP — operating manual.

Golden rule: call get_context FIRST. Resolve real ids before any id-typed parameter — productId from get_context (when multiple products), databaseId from list_tables, surfPointId from list_surf_points. Never pass a null or guessed id.

Execution model: enrichment runs on the SignalSurf server brain via Quick Surf and surf points. Your job is to set up, trigger, and poll — not to fill cells by hand unless explicitly asked.

I want to… →
- Enrich a whole table → use the enrich_table prompt; it scripts get_enrichment_context → enable_quick_surf → run_quick_surf(scope="all") → wait_for_surf_job.
- Decide what to write into a column → call get_enrichment_context(databaseId[, fieldKey]) for brand context, schema, popular existing values, and field conventions.
- Run or monitor a surf point → run_surf_point, then list_surf_jobs / wait_for_surf_job.
- Inspect data → list_tables, read_table, list_database_fields.

When multiple products are authorized, pass products[].productId (from get_context) on every product-scoped call.`
```

Then set the server config to use it:

```typescript
      instructions: SERVER_INSTRUCTIONS,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm@10.0.0 exec vitest run tests/instructions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/instructions.test.ts
git commit -m "feat: upgrade MCP instructions to a full operating manual"
```

---

### Task 6: Parity registration + full regression

**Files:**
- Modify: `docs/surfer-mcp-parity.json` (add the new tool + prompt)
- Verify: whole suite + parity script

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Inspect the parity check expectations**

Run: `node scripts/check-surfer-parity.mjs`
Expected: it currently passes against `knownPublicMcpTools`. Read `scripts/check-surfer-parity.mjs` to learn exactly which fields it validates (tool list source, mapping completeness) before editing the JSON.

- [ ] **Step 2: Register `get_enrichment_context` in the parity contract**

In `docs/surfer-mcp-parity.json`, add `"get_enrichment_context"` to `knownPublicMcpTools` (keep the array alphabetically sorted — it goes right after `get_context`). Add a mapping entry under `operationMappings`:

```json
    "get_enrichment_context": ["get_enrichment_context"],
```

If the script validates that the live MCP tool surface equals `knownPublicMcpTools`, this addition keeps it in sync. (Prompts are not tools; only add `enrich_table` to the parity JSON if the script has a prompts section — otherwise leave prompts out and note them in the design doc only.)

- [ ] **Step 3: Run the parity check**

Run: `node scripts/check-surfer-parity.mjs`
Expected: PASS. If it fails because it introspects the built server for the tool list, run `corepack pnpm@10.0.0 build` first, then re-run.

- [ ] **Step 4: Full regression**

Run: `corepack pnpm@10.0.0 typecheck && corepack pnpm@10.0.0 test`
Expected: all tests pass (existing suite + the 4 new test files), no type errors.

- [ ] **Step 5: Commit**

```bash
git add docs/surfer-mcp-parity.json
git commit -m "chore: register get_enrichment_context in surfer parity contract"
```

---

## Self-Review

**Spec coverage:**
- Layer 0 (instructions manual) → Task 5. ✓
- Layer 1 (`get_enrichment_context`: brand, schema, relations, conventions, popularValues) → Tasks 1–3. ✓
- Layer 2 (`enrich_table` MCP prompt) → Task 4. ✓
- popularValues via bounded in-repo aggregation → Tasks 1–2 (reconciled from spec's SQL choice; same interface, no migration). ✓
- Error handling: fieldKey-not-found 400 with valid keys → Task 2; product-scope guard reused → Task 2. ✓
- Testing + parity gate → Task 6. ✓
- Non-goals (no brain change, no memory, read-only) → enforced by Global Constraints. ✓

**Placeholder scan:** No "TBD/TODO". Two explicit "confirm against existing pattern" notes (tool-registration accessor in Task 3 Step 4; parity-script field validation in Task 6 Step 1) are verification instructions with a concrete fallback, not missing content.

**Type consistency:** `getEnrichmentContext(context, { databaseId, fieldKey })` signature is identical in Tasks 2 and 3. `aggregatePopularValues(entries, fieldKeys, topN)` identical in Tasks 1 and 2. `buildEnrichTablePrompt(args)` / `registerPrompts(server)` identical in Task 4. `SERVER_INSTRUCTIONS` identical in Task 5. Tool name `get_enrichment_context` consistent across Tasks 3 and 6.

> **Deviation from spec, flagged:** the spec chose SQL `jsonb_array_elements` aggregation; that requires a Postgres RPC migration in the SignalsurfWeb repo. To keep this work self-contained in the MCP repo with the brain untouched, popularValues is computed by a bounded in-repo aggregation over a service-role fetch (≤1000 rows, like `runQuickSurf` already does). Same output shape and tool interface; swappable for an RPC later with no caller change.
