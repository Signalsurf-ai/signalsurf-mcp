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

const otherProductId = "00000000-0000-4000-8000-000000000002"
const db1 = "00000000-0000-4000-8000-000000000201"
const otherDb = "00000000-0000-4000-8000-000000000299"
const entry1 = "00000000-0000-4000-8000-000000000301"
const entry2 = "00000000-0000-4000-8000-000000000302"

function makeDb() {
  return new FakeSupabase({
    products: [{ id: context.productId, owner_id: context.userId }],
    databases: [
      {
        id: db1,
        product_id: context.productId,
        name: "Customers",
        schema: {
          fields: [
            { key: "name", label: "Name", type: "string", is_primary: true },
            { key: "work_email", label: "Work Email", type: "string" },
          ],
        },
      },
      {
        id: otherDb,
        product_id: otherProductId,
        name: "Other product DB",
        schema: { fields: [{ key: "work_email", type: "string" }] },
      },
    ],
    playbooks: [],
    sources: [],
    entries: [
      {
        id: entry1,
        database_id: db1,
        data: { name: "Ada", company: "SignalSurf", score: 80 },
        updated_at: "2026-06-02T00:00:00Z",
      },
      {
        id: entry2,
        database_id: db1,
        data: { name: "Linus", company: "Linux", score: 20 },
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    raw_signals: [],
    surf_jobs: [],
  })
}

function makeRepo(db: FakeSupabase) {
  return new SignalSurfRepository(db as never)
}

describe("Quick Surf column enrichment", () => {
  it("enables Quick Surf by creating a product-scoped surf point + manual_trigger source", async () => {
    const db = makeDb()
    const repo = makeRepo(db)

    const result = await repo.enableQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      whatToDo: "Find the person's work email from their name and company.",
    })

    expect(result.success).toBe(true)
    expect(result.reused).toBe(false)
    expect(result.surfPointId).toBeTruthy()

    const playbook = db.tables.playbooks.find((p) => p.id === result.surfPointId)
    expect(playbook?.product_id).toBe(context.productId)
    expect(playbook?.surf_prompt).toContain("work email")
    expect(playbook?.relevance_threshold).toBe(0)

    const source = db.tables.sources.find((s) => s.id === result.sourceId)
    expect(source?.type).toBe("internal")
    expect(source?.playbook_id).toBe(result.surfPointId)
    expect(source?.metadata).toMatchObject({
      event_type: "manual_trigger",
      database_id: db1,
      target_field: "work_email",
    })
  })

  it("persists auto mode and run-condition metadata when enabling Quick Surf", async () => {
    const db = makeDb()
    const repo = makeRepo(db)

    await repo.enableQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      whatToDo: "Find work email for qualified companies.",
      auto: "on_created",
      runCondition: { column: "score", predicate: "gt", value: 50 },
    })

    expect(db.tables.sources[0].metadata).toMatchObject({
      auto: "on_created",
      run_condition: { column: "score", predicate: "gt", value: 50 },
    })
  })

  it("rejects enabling on a missing column or the primary column", async () => {
    const repo = makeRepo(makeDb())
    await expect(
      repo.enableQuickSurf(context, {
        databaseId: db1,
        fieldKey: "nope",
        whatToDo: "x",
      })
    ).rejects.toThrow(/not found/i)
    await expect(
      repo.enableQuickSurf(context, {
        databaseId: db1,
        fieldKey: "name",
        whatToDo: "x",
      })
    ).rejects.toThrow(/primary/i)
  })

  it("does not reach a database in another product", async () => {
    const repo = makeRepo(makeDb())
    await expect(
      repo.enableQuickSurf(context, {
        databaseId: otherDb,
        fieldKey: "work_email",
        whatToDo: "x",
      })
    ).rejects.toThrow(/not found or access denied/i)
  })

  it("reuses the binding and converges the instruction on re-enable", async () => {
    const db = makeDb()
    const repo = makeRepo(db)
    const first = await repo.enableQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      whatToDo: "First instruction.",
    })
    const second = await repo.enableQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      whatToDo: "Updated instruction.",
    })
    expect(second.reused).toBe(true)
    expect(second.sourceId).toBe(first.sourceId)
    expect(db.tables.sources).toHaveLength(1)
    const playbook = db.tables.playbooks.find((p) => p.id === first.surfPointId)
    expect(playbook?.surf_prompt).toBe("Updated instruction.")
  })

  it("disable keeps the instruction (off-but-remembered) and list hides it; re-enable restores", async () => {
    const db = makeDb()
    const repo = makeRepo(db)
    await repo.enableQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      whatToDo: "Keep me.",
    })

    const listed = await repo.listQuickSurf(context, { databaseId: db1 })
    expect(listed.columns.map((c) => c.fieldKey)).toEqual(["work_email"])

    await repo.disableQuickSurf(context, { databaseId: db1, fieldKey: "work_email" })
    const afterDisable = await repo.listQuickSurf(context, { databaseId: db1 })
    expect(afterDisable.columns).toHaveLength(0)
    // surf_prompt is preserved even while disabled.
    const source = db.tables.sources[0]
    expect(source.metadata.disabled).toBe(true)
    const playbook = db.tables.playbooks[0]
    expect(playbook.surf_prompt).toBe("Keep me.")

    const restored = await repo.enableQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      whatToDo: "Keep me.",
    })
    expect(restored.restored).toBe(true)
    const afterRestore = await repo.listQuickSurf(context, { databaseId: db1 })
    expect(afterRestore.columns).toHaveLength(1)
  })

  it("runs a column scope by enqueuing one analyze job per row (capped)", async () => {
    const db = makeDb()
    const repo = makeRepo(db)
    await repo.enableQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      whatToDo: "Find the work email.",
    })

    const run = await repo.runQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      scope: "first10",
    })

    expect(run.mode).toBe("column")
    expect(run.queued).toBe(2)
    expect(run.rawSignalIds).toHaveLength(2)
    expect(db.tables.raw_signals).toHaveLength(2)
    const jobs = db.tables.surf_jobs
    expect(jobs).toHaveLength(2)
    for (const job of jobs) {
      expect(job.job_type).toBe("analyze")
      expect(job.status).toBe("pending")
      expect(job.product_id).toBe(context.productId)
      expect(job.payload.target_field).toBe("work_email")
    }
  })

  it("runs a single cell by entryId", async () => {
    const db = makeDb()
    const repo = makeRepo(db)
    await repo.enableQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      whatToDo: "Find the work email.",
    })
    const run = await repo.runQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      entryId: entry1,
    })
    expect(run.mode).toBe("cell")
    expect(run.queued).toBe(1)
    expect(db.tables.surf_jobs).toHaveLength(1)
    expect(db.tables.raw_signals[0].data.entry_id).toBe(entry1)
  })

  it("runs an explicit row subset and applies the persisted run condition", async () => {
    const db = makeDb()
    const repo = makeRepo(db)
    await repo.enableQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      whatToDo: "Find the work email.",
      runCondition: { column: "score", predicate: "gt", value: 50 },
    })

    const run = await repo.runQuickSurf(context, {
      databaseId: db1,
      fieldKey: "work_email",
      entryIds: [entry1, entry2],
    })

    expect(run.mode).toBe("column")
    expect(run.selected).toBe(2)
    expect(run.queued).toBe(1)
    expect(run.skipped).toBe(1)
    expect(run.entryIds).toEqual([entry1])
    expect(db.tables.raw_signals).toHaveLength(1)
    expect(db.tables.raw_signals[0].data.entry_id).toBe(entry1)
  })

  it("requires one run mode, and refuses to run a column with no Quick Surf", async () => {
    const repo = makeRepo(makeDb())
    await expect(
      repo.runQuickSurf(context, { databaseId: db1, fieldKey: "work_email" })
    ).rejects.toThrow(/scope.*entryId.*entryIds/i)
    await expect(
      repo.runQuickSurf(context, {
        databaseId: db1,
        fieldKey: "work_email",
        scope: "all",
      })
    ).rejects.toThrow(/not set up/i)
  })
})
