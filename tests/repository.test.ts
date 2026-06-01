import { describe, expect, it } from "vitest"

import { SignalSurfRepository } from "../src/repository.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"

const context: SignalSurfContext = {
  productId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000010",
  role: "editor",
  tokenName: "test-agent",
}

const db1 = "00000000-0000-4000-8000-000000000201"
const db2 = "00000000-0000-4000-8000-000000000202"
const otherProductDb = "00000000-0000-4000-8000-000000000299"
const surfPoint1 = "00000000-0000-4000-8000-000000000101"
const surfPoint2 = "00000000-0000-4000-8000-000000000104"
const row1 = "00000000-0000-4000-8000-000000000301"
const row2 = "00000000-0000-4000-8000-000000000302"
const otherProductRow = "00000000-0000-4000-8000-000000000399"

function makeDb() {
  return new FakeSupabase({
    playbooks: [
      {
        id: surfPoint1,
        product_id: context.productId,
        name: "Active",
        description: null,
        is_default: false,
        is_active: true,
        show_ai_dashboard: true,
        icon: "folder.fill",
        color: "#5599FF",
        database_ids: [db1],
        relevance_threshold: null,
        prompt_template: null,
        scoring_rubric: null,
        surf_prompt: null,
        tool_config: {},
        variables: {},
        config: {},
        folder_id: null,
        display_order: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: surfPoint2,
        product_id: context.productId,
        name: "Second",
        description: null,
        is_default: false,
        is_active: true,
        show_ai_dashboard: true,
        icon: "folder.fill",
        color: "#5599FF",
        database_ids: [db2],
        relevance_threshold: null,
        prompt_template: null,
        scoring_rubric: null,
        surf_prompt: null,
        tool_config: {},
        variables: {},
        config: {},
        folder_id: null,
        display_order: 1,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        product_id: context.productId,
        name: "Deleted",
        is_default: false,
        is_active: true,
        show_ai_dashboard: true,
        database_ids: [],
        created_at: "2026-06-01T00:00:00Z",
        deleted_at: "2026-06-01T01:00:00Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000103",
        product_id: "00000000-0000-4000-8000-000000000099",
        name: "Other Product",
        is_default: false,
        is_active: true,
        show_ai_dashboard: true,
        database_ids: [],
        created_at: "2026-06-01T00:00:00Z",
        deleted_at: null,
      },
    ],
    databases: [
      {
        id: db1,
        product_id: context.productId,
        name: "Companies",
        description: null,
        icon: null,
        color: null,
        schema: {
          fields: [
            {
              key: "parent",
              type: "item_ref",
            },
          ],
        },
        item_type: "company",
        system_type: null,
        view_configs: {},
        display_order: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        id: db2,
        product_id: context.productId,
        name: "People",
        description: null,
        icon: null,
        color: null,
        schema: null,
        item_type: "person",
        system_type: null,
        view_configs: {},
        display_order: 1,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        id: otherProductDb,
        product_id: "00000000-0000-4000-8000-000000000099",
        name: "Other",
        description: null,
        icon: null,
        color: null,
        schema: null,
        item_type: "company",
        system_type: null,
        view_configs: {},
        display_order: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    entries: [
      {
        id: row1,
        database_id: db1,
        playbook_id: surfPoint1,
        data: { name: "Acme", stage: "new" },
        note: null,
        origin: "mcp",
        origin_ref: null,
        entry_key_hash: null,
        raw_signal_id: null,
        triggered: false,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        id: row2,
        database_id: db1,
        playbook_id: surfPoint1,
        data: { name: "Beta", stage: "new" },
        note: null,
        origin: "mcp",
        origin_ref: null,
        entry_key_hash: null,
        raw_signal_id: null,
        triggered: false,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        id: otherProductRow,
        database_id: otherProductDb,
        playbook_id: null,
        data: { name: "Other" },
        note: null,
        origin: "mcp",
        origin_ref: null,
        entry_key_hash: null,
        raw_signal_id: null,
        triggered: false,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    surf_jobs: [
      {
        id: "job-1",
        playbook_id: surfPoint1,
        status: "pending",
      },
    ],
    user_preferences: [
      {
        user_id: context.userId,
        current_playbook_id: surfPoint1,
      },
    ],
    sources: [],
  })
}

describe("SignalSurfRepository", () => {
  it("lists only active surf points in the current product", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.listSurfPoints(context)

    expect(
      result.surfPoints.map((point: { name: string }) => point.name)
    ).toEqual(["Active", "Second"])
  })

  it("soft-deletes surf points and cancels pending jobs", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await repo.deleteSurfPoints(context, [surfPoint1])

    const row = db.tables.playbooks.find(
      (playbook) => playbook.id === surfPoint1
    )
    expect(row).toBeTruthy()
    expect(row?.deleted_at).toEqual(expect.any(String))
    expect(db.tables.surf_jobs[0].status).toBe("failed")
    expect(db.tables.user_preferences[0].current_playbook_id).toBe(surfPoint2)
  })

  it("creates prompt templates from scoring rubric and surf prompt", async () => {
    const db = makeDb()
    db.tables.databases = db.tables.databases.filter((row) => row.id === db1)
    const repo = new SignalSurfRepository(db as any)

    await repo.createSurfPoint(context, {
      name: "New point",
      scoringRubric: "Score qualified leads highly.",
      surfPrompt: "Find recent funding events.",
    })

    const inserted = db.tables.playbooks.at(-1)
    expect(inserted).toMatchObject({
      name: "New point",
      database_ids: [db1],
      prompt_template:
        "## Scoring Rubric\n\nScore qualified leads highly.\n\nFind recent funding events.",
    })
  })

  it("uses explicit prompt templates instead of synthesized prompt sections", async () => {
    const db = makeDb()
    db.tables.databases = db.tables.databases.filter((row) => row.id === db1)
    const repo = new SignalSurfRepository(db as any)

    await repo.createSurfPoint(context, {
      name: "Explicit point",
      promptTemplate: "Use this exact prompt.",
      scoringRubric: "Ignored for prompt_template.",
      surfPrompt: "Also ignored for prompt_template.",
    })

    const inserted = db.tables.playbooks.at(-1)
    expect(inserted?.prompt_template).toBe("Use this exact prompt.")
  })

  it("shallow-merges surf point patches and recomputes prompt templates", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.updateSurfPoint(context, {
      surfPointId: surfPoint1,
      variablesPatch: { region: "US" },
      toolConfigPatch: { maxResults: 10 },
      configPatch: { cadence: "daily" },
      scoringRubric: "Prefer new accounts.",
    })

    expect(result.surfPoint.variables).toMatchObject({ region: "US" })
    expect(result.surfPoint.toolConfig).toMatchObject({ maxResults: 10 })
    expect(result.surfPoint.config).toMatchObject({ cadence: "daily" })
    expect(result.surfPoint.promptTemplate).toContain("Prefer new accounts.")
  })

  it("rejects conflicting full and patch updates", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateSurfPoint(context, {
        surfPointId: surfPoint1,
        variables: { region: "US" },
        variablesPatch: { segment: "enterprise" },
      })
    ).rejects.toThrow("Pass either variables or variablesPatch")
  })

  it("rejects table reads outside the token product", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.readTable(context, {
        databaseId: otherProductDb,
      })
    ).rejects.toThrow("Database not found or access denied")
  })

  it("preserves exact pre-pagination counts when reading tables", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.readTable(context, {
      databaseId: db1,
      limit: 1,
      offset: 0,
    })

    expect(result.rows).toHaveLength(1)
    expect(result.totalCount).toBe(2)
  })

  it("updates row data through the entry changelog RPC", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.updateTableRow(context, {
      rowId: row1,
      dataPatch: { stage: "contacted" },
    })

    expect(result.row.data).toMatchObject({ name: "Acme", stage: "contacted" })
    expect(db.rpcCalls[0]).toMatchObject({
      name: "update_entry_with_source",
      args: {
        p_entry_id: "00000000-0000-4000-8000-000000000301",
        p_source: "mcp",
        p_source_ref: "test-agent",
      },
    })
  })

  it("validates item references before creating or updating row data", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.createTableRow(context, {
        databaseId: db1,
        data: {
          name: "Bad ref",
          parent: {
            database_id: otherProductDb,
            entry_id: otherProductRow,
          },
        },
      })
    ).rejects.toThrow("Database not found or access denied")

    await expect(
      repo.updateTableRow(context, {
        rowId: row1,
        dataPatch: {
          parent: {
            database_id: otherProductDb,
            entry_id: otherProductRow,
          },
        },
      })
    ).rejects.toThrow("Database not found or access denied")
  })

  it("stamps MCP provenance when creating rows", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await repo.createTableRow(context, {
      databaseId: db1,
      data: { name: "Created" },
      playbookId: surfPoint1,
      note: "created by test",
    })

    expect(db.tables.entries.at(-1)).toMatchObject({
      database_id: db1,
      playbook_id: surfPoint1,
      origin: "mcp",
      origin_ref: "test-agent",
      triggered: false,
    })
  })

  it("rejects row attribution to surf points that do not target the row database", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.createTableRow(context, {
        databaseId: db1,
        data: { name: "Wrong attribution" },
        playbookId: surfPoint2,
      })
    ).rejects.toThrow("is not configured to write to database")

    await expect(
      repo.updateTableRow(context, {
        rowId: row1,
        playbookId: surfPoint2,
      })
    ).rejects.toThrow("is not configured to write to database")
  })

  it("updates row notes through the entry note RPC", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.updateTableRow(context, {
      rowId: row1,
      note: "Follow up next week.",
    })

    expect(result.row.note).toBe("Follow up next week.")
    expect(db.rpcCalls[0]).toMatchObject({
      name: "update_entry_note_with_source",
      args: {
        p_entry_id: row1,
        p_note: "Follow up next week.",
        p_source_ref: "test-agent",
      },
    })
  })

  it("rejects partial row deletes without deleting the valid subset", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.deleteTableRows(context, [row1, otherProductRow, row1])
    ).rejects.toThrow("Database not found or access denied")

    expect(db.tables.entries.some((entry) => entry.id === row1)).toBe(true)
    expect(db.tables.entries.some((entry) => entry.id === otherProductRow)).toBe(
      true
    )
  })
})
