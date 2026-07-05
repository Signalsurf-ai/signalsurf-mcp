# MCP Batch Row Edit (`update_table_rows`) — Design

**Date:** 2026-07-05
**Branch:** `neonthewei/surfer-batch-edit-tools`
**Status:** Approved (brainstorming) — ready for implementation

## Problem

MCP's row-edit surface has one asymmetry: `delete_table_rows` accepts a batch of
`rowIds` (`src/schemas.ts:349`, `src/repository.ts:3742`), but `update_table_row`
only accepts one `rowId` at a time (`src/schemas.ts:339`, `src/repository.ts:3672`).
An agent that enriches N rows (the common case — see `src/prompts.ts:67`, which
today instructs "write each found email back with `update_table_row`") must make N
separate tool round trips to write results back.

SignalsurfWeb's in-app Surfer agent already has a batch-write tool
(`bulk_update_items`, `src/lib/ai/chat-tools/bulk-tools.ts:8`), but it solves a
different problem — a **filter** (`field === value`) applied with the **same**
update object to every matching row, executed as a sequential per-row loop
(`src/trpc/routers/signals/entries.ts:122-131`, no transaction, no set-based SQL).
`docs/surfer-mcp-parity.json`'s `bulk_and_notes` exception group explicitly keeps
`bulk_update_items`/`bulk_delete_items` off the public MCP contract pending
dry-run/max-limits/confirmation/audit guarantees — so mirroring that tool
directly is not an option here.

## Goal

Let an agent write **different** data to **many** explicit rows in one MCP call,
with the same safety bar as the existing single-row/batch-delete tools — no
filter-matching, no silent partial writes.

**Non-goals (YAGNI):** no filter-based bulk update (that's the `bulk_update_items`
shape, gated separately); no per-edit `note`/`playbookId` (single-row
`update_table_row` still handles that); no dry-run mode (not needed — the agent
supplies exact row ids and values, same risk class as `create_table_row`/
`delete_table_rows`, not the implicit-filter risk class `bulk_and_notes` guards
against).

## Design

### New tool: `update_table_rows`

- **Input:** `{ productId?, edits: [{ rowId, data? | dataPatch? }], }`, 1–100
  edits (same cap as `delete_table_rows`). Exactly one of `data`/`dataPatch` per
  edit, and no duplicate `rowId`s — validated in the repository method, matching
  the existing convention where `updateTableRow` enforces the `data`/`dataPatch`
  exclusivity in code rather than in the zod shape (`src/repository.ts:3689-3694`).
- **Output:** `{ rows: EntryRow[] }`.

### Execution: atomic via a single set-based SQL statement, not a loop

1. Node validates every `rowId` exists and belongs to the authorized product in
   one round trip, reusing `getEntriesAndValidateProduct` (already batch-shaped —
   `deleteTableRows` calls it the same way, `src/repository.ts:3744`).
2. Node computes each row's next `data` (full replace or shallow `dataPatch`
   merge against the row's current `data`, same as `updateTableRow`) and runs
   the existing `validateEntryDataReferences` check per edit — **before any
   write**, so one bad `item_ref` value anywhere rejects the whole batch with
   nothing written.
3. Node calls one new Postgres RPC, `update_entries_with_source_batch(p_entries
   jsonb, p_source text, p_source_ref text)` — a sibling to
   `update_entry_with_source` (`SignalsurfWeb/supabase/schemas/50_functions.sql:2368`)
   that does the same audit `set_config` calls once, then a **single** set-based
   `UPDATE ... FROM jsonb_to_recordset(p_entries) ... WHERE entries.id = v.entry_id`.
   One SQL statement touching all rows is atomic by construction — no manual
   transaction wrapper, no per-row loop, and strictly better than the web app's
   `bulkUpdateEntries` loop.
4. Node re-fetches the updated rows and returns them.

This RPC is being added on the SignalsurfWeb side by another agent in parallel;
this repo only needs to call it by name.

### Files touched (this repo)

- `src/schemas.ts` — `updateTableRowsSchema`.
- `src/repository.ts` — `updateTableRows()` method.
- `src/capabilities.ts` — add `"update_table_rows"` to `PublicMcpToolName` and
  `PUBLIC_MCP_TOOLS` (`tables.write`, `manage_data` surface, `MUTATE_ANNOTATIONS`).
- `src/server.ts` — register the tool.
- `src/prompts.ts:67` — point the enrichment workflow at the new batch tool
  instead of a per-row loop.
- `docs/surfer-mcp-parity.json` — add `update_table_rows` to
  `knownPublicMcpTools` (no `operationMappings` entry — this tool has no
  corresponding Surfer web operation; it does not touch `bulk_and_notes`).
- `docs/capabilities.md` — add a row to the public tool contract table.
- Tests mirroring `tests/repository.test.ts:2317-2428` (batch update happy
  path, duplicate rowId rejected, mixed data/dataPatch rejected, one missing
  row rejects the whole batch, cap of 100 enforced) and a `mcp-server.test.ts`
  registration check.

## Testing

`npm run typecheck`, `npm test`, `npm run check:surfer-parity`.
