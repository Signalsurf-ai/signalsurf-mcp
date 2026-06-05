import { describe, expect, it } from "vitest"

import { sha256Hex } from "../src/auth.js"
import { SignalSurfRepository } from "../src/repository.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"

const context: SignalSurfContext = {
  productId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000010",
  role: "editor",
  tokenName: "test-agent",
}

const secondProductId = "00000000-0000-4000-8000-000000000002"
const org1 = "00000000-0000-4000-8000-000000000701"
const org2 = "00000000-0000-4000-8000-000000000702"
const db1 = "00000000-0000-4000-8000-000000000201"
const db2 = "00000000-0000-4000-8000-000000000202"
const otherProductDb = "00000000-0000-4000-8000-000000000299"
const surfPoint1 = "00000000-0000-4000-8000-000000000101"
const surfPoint2 = "00000000-0000-4000-8000-000000000104"
const otherProductSurfPoint = "00000000-0000-4000-8000-000000000103"
const row1 = "00000000-0000-4000-8000-000000000301"
const row2 = "00000000-0000-4000-8000-000000000302"
const otherProductRow = "00000000-0000-4000-8000-000000000399"
const source1 = "00000000-0000-4000-8000-000000000801"
const otherProductSource = "00000000-0000-4000-8000-000000000802"
const tool1 = "00000000-0000-4000-8000-000000000901"
const tool2 = "00000000-0000-4000-8000-000000000902"
const pendingJob = "00000000-0000-4000-8000-000000000401"
const otherProductJob = "00000000-0000-4000-8000-000000000402"
const completedJob = "00000000-0000-4000-8000-000000000403"

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
        id: otherProductSurfPoint,
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
        data: {
          name: "Acme",
          stage: "new",
          score: 9,
          tags: ["AI", "Founder"],
          event_date: "2026-06-04",
        },
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
        data: {
          name: "Beta",
          stage: "qualified",
          score: 4,
          tags: ["VC"],
          event_date: "2026-06-10",
        },
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
    products: [
      {
        id: context.productId,
        name: "Primary Product",
        organization_id: org1,
        owner_id: context.userId,
      },
      {
        id: secondProductId,
        name: "Second Product",
        organization_id: org2,
        owner_id: "00000000-0000-4000-8000-000000000011",
      },
    ],
    organizations: [
      {
        id: org1,
        name: "Primary Workspace",
      },
      {
        id: org2,
        name: "Second Workspace",
      },
    ],
    surf_jobs: [
      {
        id: pendingJob,
        product_id: context.productId,
        user_id: context.userId,
        playbook_id: surfPoint1,
        source_id: source1,
        job_type: "extract",
        status: "pending",
        priority: 1,
        attempt_count: 0,
        max_attempts: 3,
        payload: {},
      },
    ],
    user_preferences: [
      {
        user_id: context.userId,
        current_playbook_id: surfPoint1,
      },
    ],
    sources: [
      {
        id: source1,
        user_id: context.userId,
        playbook_id: surfPoint1,
        name: "Threads search",
        type: "pull",
        pull_config: {
          endpoint_id: "threads-keyword-search",
          schedule: "0 */6 * * *",
        },
        metadata: { provider: "threads" },
        is_active: true,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        config: { should_not_leak: true },
        credentials: { token: "secret" },
      },
      {
        id: otherProductSource,
        user_id: "00000000-0000-4000-8000-000000000099",
        playbook_id: otherProductSurfPoint,
        name: "Other source",
        type: "pull",
        pull_config: {},
        metadata: {},
        is_active: true,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    product_tools: [
      {
        id: tool1,
        product_id: context.productId,
        user_id: context.userId,
        tool_type: "slack",
        config: { nickname: "Slack alerts", token: "secret" },
        is_enabled: true,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        id: tool2,
        product_id: context.productId,
        user_id: context.userId,
        tool_type: "webhook",
        config: { nickname: "Webhook" },
        is_enabled: true,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000903",
        product_id: "00000000-0000-4000-8000-000000000099",
        user_id: "00000000-0000-4000-8000-000000000099",
        tool_type: "slack",
        config: {},
        is_enabled: true,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
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

  it("reads one product-scoped surf point", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(repo.getSurfPoint(context, surfPoint1)).resolves.toMatchObject({
      surfPoint: {
        surfPointId: surfPoint1,
        name: "Active",
      },
    })

    await expect(
      repo.getSurfPoint(context, otherProductSurfPoint)
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
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

  it("queues an active surf point run", async () => {
    const db = makeDb()
    db.tables.surf_jobs = []
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.runSurfPoint(context, {
      surfPointId: surfPoint1,
    })

    expect(result).toMatchObject({
      enqueued: true,
      enqueuedCount: 1,
      skippedCount: 0,
      sourceIdsQueued: [source1],
      job: {
        surfPointId: surfPoint1,
        sourceId: source1,
        jobType: "extract",
        status: "pending",
      },
    })
    expect(db.tables.surf_jobs).toHaveLength(1)
    expect(db.tables.surf_jobs[0]).toMatchObject({
      product_id: context.productId,
      user_id: context.userId,
      playbook_id: surfPoint1,
      source_id: source1,
      job_type: "extract",
      status: "pending",
      priority: 1,
      payload: {
        source_id: source1,
        triggered_by: "mcp",
      },
    })
    expect(db.tables.surf_jobs[0].id).toEqual(expect.any(String))
  })

  it("deduplicates pending surf point runs by default", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.runSurfPoint(context, {
      surfPointId: surfPoint1,
    })

    expect(result).toMatchObject({
      enqueued: false,
      reason: "active_jobs_exist",
      enqueuedCount: 0,
      skippedCount: 1,
      job: {
        jobId: pendingJob,
        surfPointId: surfPoint1,
        sourceId: source1,
        jobType: "extract",
        status: "pending",
      },
    })
    expect(db.tables.surf_jobs).toHaveLength(1)
  })

  it("requires an explicit override to run inactive surf points", async () => {
    const db = makeDb()
    db.tables.surf_jobs = []
    const surfPoint = db.tables.playbooks.find(
      (playbook) => playbook.id === surfPoint1
    )
    surfPoint!.is_active = false
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.runSurfPoint(context, { surfPointId: surfPoint1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })

    await expect(
      repo.runSurfPoint(context, {
        surfPointId: surfPoint1,
        allowInactive: true,
      })
    ).resolves.toMatchObject({
      enqueued: true,
      job: {
        surfPointId: surfPoint1,
        status: "pending",
      },
    })
  })

  it("uses idempotency keys to avoid duplicate surf point runs", async () => {
    const db = makeDb()
    db.tables.surf_jobs = []
    const repo = new SignalSurfRepository(db as any)

    const first = await repo.runSurfPoint(context, {
      surfPointId: surfPoint1,
      idempotencyKey: "daily-digest-2026-06-04",
    })
    const second = await repo.runSurfPoint(context, {
      surfPointId: surfPoint1,
      idempotencyKey: "daily-digest-2026-06-04",
      dedupePending: false,
    })

    expect(first).toMatchObject({ enqueued: true })
    expect(second).toMatchObject({
      enqueued: false,
      reason: "idempotency_or_active_jobs_exist",
    })
    expect(second.job.jobId).toBe(first.job.jobId)
    expect(db.tables.surf_jobs).toHaveLength(1)
  })

  it("reads, lists, and cancels product-scoped surf jobs", async () => {
    const db = makeDb()
    db.tables.surf_jobs.push({
      id: otherProductJob,
      product_id: "00000000-0000-4000-8000-000000000099",
      user_id: "00000000-0000-4000-8000-000000000099",
      playbook_id: "00000000-0000-4000-8000-000000000103",
      source_id: otherProductSource,
      job_type: "extract",
      status: "pending",
      created_at: "2026-06-02T00:00:00Z",
    })
    const repo = new SignalSurfRepository(db as any)

    await expect(repo.getSurfJob(context, pendingJob)).resolves.toMatchObject({
      job: {
        jobId: pendingJob,
        surfPointId: surfPoint1,
        status: "pending",
      },
    })

    const list = await repo.listSurfJobs(context)
    expect(list.jobs.map((job: { jobId: string }) => job.jobId)).toEqual([
      pendingJob,
    ])

    await expect(
      repo.getSurfJob(context, otherProductJob)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    })

    const cancelled = await repo.cancelSurfJob(context, pendingJob)
    expect(cancelled).toMatchObject({
      cancelled: true,
      job: {
        jobId: pendingJob,
        status: "failed",
        lastError: "Cancelled by MCP",
      },
    })
    expect(db.tables.surf_jobs[0]).toMatchObject({
      status: "failed",
      last_error: "Cancelled by MCP",
      completed_at: expect.any(String),
    })
  })

  it("waits for surf jobs and returns timeout state for active jobs", async () => {
    const db = makeDb()
    db.tables.surf_jobs.push({
      id: completedJob,
      product_id: context.productId,
      user_id: context.userId,
      playbook_id: surfPoint1,
      source_id: source1,
      job_type: "extract",
      status: "completed",
      created_at: "2026-06-02T00:00:00Z",
    })
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.waitForSurfJob(context, {
        jobId: completedJob,
        timeoutMs: 0,
      })
    ).resolves.toMatchObject({
      terminal: true,
      timedOut: false,
      polls: 1,
      job: {
        jobId: completedJob,
        status: "completed",
      },
    })

    await expect(
      repo.waitForSurfJob(context, {
        jobId: pendingJob,
        timeoutMs: 0,
      })
    ).resolves.toMatchObject({
      terminal: false,
      timedOut: true,
      polls: 1,
      job: {
        jobId: pendingJob,
        status: "pending",
      },
    })
  })

  it("lists and toggles safe surf point source metadata", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.listSurfPointSources(context, surfPoint1)

    expect(result).toMatchObject({
      surfPointId: surfPoint1,
      totalCount: 1,
      sources: [
        {
          sourceId: source1,
          surfPointId: surfPoint1,
          name: "Threads search",
          type: "pull",
          endpointId: "threads-keyword-search",
          schedule: "0 */6 * * *",
          provider: "threads",
          isActive: true,
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    })
    expect(result.sources[0]).not.toHaveProperty("config")
    expect(result.sources[0]).not.toHaveProperty("credentials")

    const updated = await repo.setSurfPointSourceActive(context, {
      sourceId: source1,
      isActive: false,
    })

    expect(updated.source).toMatchObject({
      sourceId: source1,
      isActive: false,
    })
    expect(db.tables.sources[0]).toMatchObject({
      id: source1,
      is_active: false,
      updated_at: expect.any(String),
    })

    await expect(
      repo.setSurfPointSourceActive(context, {
        sourceId: otherProductSource,
        isActive: false,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("lists safe product tool metadata without leaking config secrets", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.listProductTools(context)

    expect(result).toMatchObject({
      totalCount: 2,
      tools: [
        {
          toolId: tool1,
          toolType: "slack",
          name: "Slack alerts",
          isEnabled: true,
        },
        {
          toolId: tool2,
          toolType: "webhook",
          name: "Webhook",
          isEnabled: true,
        },
      ],
    })
    expect(result.tools[0]).not.toHaveProperty("config")
    expect(result.tools[0]).not.toHaveProperty("token")
  })

  it("manages surf point tool ids idempotently", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(repo.listSurfPointTools(context, surfPoint1)).resolves.toEqual({
      surfPointId: surfPoint1,
      toolIds: [],
      totalCount: 0,
    })

    await expect(
      repo.attachSurfPointTool(context, {
        surfPointId: surfPoint1,
        toolId: tool1,
      })
    ).resolves.toMatchObject({
      changed: true,
      toolIds: [tool1],
      surfPoint: {
        surfPointId: surfPoint1,
        toolConfig: {
          auto_tool_ids: [tool1],
        },
      },
    })

    await expect(
      repo.attachSurfPointTool(context, {
        surfPointId: surfPoint1,
        toolId: tool1,
      })
    ).resolves.toMatchObject({
      changed: false,
      toolIds: [tool1],
    })

    await repo.attachSurfPointTool(context, {
      surfPointId: surfPoint1,
      toolId: tool2,
    })

    await expect(
      repo.detachSurfPointTool(context, {
        surfPointId: surfPoint1,
        toolId: tool1,
      })
    ).resolves.toMatchObject({
      changed: true,
      toolIds: [tool2],
    })

    expect(
      db.tables.playbooks.find((playbook) => playbook.id === surfPoint1)
        ?.tool_config
    ).toMatchObject({
      auto_tool_ids: [tool2],
    })

    await expect(
      repo.attachSurfPointTool(context, {
        surfPointId: otherProductSurfPoint,
        toolId: tool1,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })

    await expect(
      repo.attachSurfPointTool(context, {
        surfPointId: surfPoint1,
        toolId: "00000000-0000-4000-8000-000000000903",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("does not expose hosted token creators as interactive user context", async () => {
    const db = makeDb()
    db.tables.mcp_tokens = [
      {
        id: "00000000-0000-4000-8000-000000000501",
        product_id: context.productId,
        created_by: context.userId,
        name: "hosted-agent",
        role: "editor",
        token_sha256: sha256Hex("hosted-token"),
        revoked_at: null,
      },
    ]
    const repo = new SignalSurfRepository(db as any)

    const hostedContext = await repo.resolveMcpToken("hosted-token")

    expect(hostedContext).toMatchObject({
      productId: context.productId,
      products: [
        {
          productId: context.productId,
          name: "Primary Product",
          organizationId: org1,
          organizationName: "Primary Workspace",
        },
      ],
      role: "editor",
      tokenName: "hosted-agent",
    })
    expect(hostedContext?.userId).toBeUndefined()

    await repo.deleteSurfPoints(hostedContext!, [surfPoint1])

    expect(db.tables.user_preferences[0].current_playbook_id).toBe(surfPoint1)
  })

  it("resolves OAuth tokens with every authorized product id", async () => {
    const db = makeDb()
    db.tables.mcp_tokens = []
    db.tables.mcp_oauth_clients = [
      {
        client_id: "ssmcp_client_multi",
        client_name: "Typeless",
        revoked_at: null,
      },
    ]
    db.tables.mcp_oauth_tokens = [
      {
        id: "00000000-0000-4000-8000-000000000601",
        client_id: "ssmcp_client_multi",
        user_id: context.userId,
        product_id: context.productId,
        product_ids: [context.productId, secondProductId],
        scope: "mcp:surf_points.read mcp:tables.read offline_access",
        resource: "https://mcp.signalsurf.ai/mcp",
        access_token_sha256: sha256Hex("oauth-token"),
        access_token_expires_at: "2999-01-01T00:00:00Z",
        revoked_at: null,
      },
    ]
    const repo = new SignalSurfRepository(db as any)

    const oauthContext = await repo.resolveMcpToken("oauth-token", {
      resource: "https://mcp.signalsurf.ai/mcp",
    })

    expect(oauthContext).toMatchObject({
      productId: context.productId,
      productIds: [context.productId, secondProductId],
      products: [
        {
          productId: context.productId,
          name: "Primary Product",
          organizationName: "Primary Workspace",
        },
        {
          productId: secondProductId,
          name: "Second Product",
          organizationName: "Second Workspace",
        },
      ],
      role: "viewer",
      tokenName: "OAuth: Typeless",
    })
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

  it("filters and sorts table rows with UI-style data operators", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.readTable(context, {
      databaseId: db1,
      filters: [
        { field: "score", op: "gte", value: 5 },
        { field: "tags", op: "array_contains", value: "AI" },
      ],
      sorts: [{ field: "event_date", direction: "desc" }],
    })

    expect(result.rows.map((row: { data: any }) => row.data.name)).toEqual([
      "Acme",
    ])
    expect(result).toMatchObject({
      totalCount: 1,
      scannedCount: 2,
      hasMoreToScan: false,
    })
  })

  it("supports OR table filters and data-field sorting", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.readTable(context, {
      databaseId: db1,
      filterLogic: "or",
      filters: [
        { field: "name", op: "contains", value: "acm" },
        { field: "stage", op: "eq", value: "qualified" },
      ],
      sorts: [{ field: "score", direction: "asc" }],
    })

    expect(result.rows.map((row: { data: any }) => row.data.name)).toEqual([
      "Beta",
      "Acme",
    ])
    expect(result.totalCount).toBe(2)
  })

  it("lists and reads database saved views", async () => {
    const db = makeDb()
    const database = db.tables.databases.find((row) => row.id === db1)
    database!.view_configs = {
      saved_views: [
        {
          id: "hot",
          name: "Hot Leads",
          viewType: "table",
          sort_key: "score",
          sort_direction: "desc",
          column_filters: [
            {
              field: "score",
              op: "gte",
              value: 5,
            },
          ],
        },
      ],
    }
    const repo = new SignalSurfRepository(db as any)

    const views = await repo.listDatabaseViews(context, db1)
    expect(views.views).toMatchObject([
      {
        id: "hot",
        name: "Hot Leads",
        filters: [{ field: "score", op: "gte", value: 5 }],
      },
    ])

    const result = await repo.readTableView(context, {
      databaseId: db1,
      viewId: "hot",
    })
    expect(result.view).toMatchObject({ id: "hot", name: "Hot Leads" })
    expect(result.rows.map((row: { data: any }) => row.data.name)).toEqual([
      "Acme",
    ])
  })

  it("adds, updates, and removes database schema fields", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.addDatabaseField(context, {
        databaseId: db1,
        field: {
          key: "priority",
          type: "enum",
          label: "Priority",
          options: ["P0", "P1"],
        },
      })
    ).resolves.toMatchObject({
      fields: [
        { key: "parent" },
        { key: "priority", type: "enum", label: "Priority" },
      ],
    })

    await expect(
      repo.updateDatabaseField(context, {
        databaseId: db1,
        fieldKey: "priority",
        patch: { label: "Deal Priority" },
      })
    ).resolves.toMatchObject({
      fields: [
        { key: "parent" },
        { key: "priority", label: "Deal Priority" },
      ],
    })

    await expect(
      repo.removeDatabaseField(context, {
        databaseId: db1,
        fieldKey: "priority",
      })
    ).resolves.toMatchObject({
      removesRowData: false,
      fields: [{ key: "parent" }],
    })
  })

  it("creates relation fields only to product-owned databases", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.createRelationField(context, {
        databaseId: db1,
        key: "person",
        label: "Person",
        targetDatabaseId: db2,
        displayField: "name",
      })
    ).resolves.toMatchObject({
      fields: [
        { key: "parent" },
        {
          key: "person",
          type: "item_ref",
          target_database_id: db2,
          display_field: "name",
        },
      ],
    })

    await expect(
      repo.createRelationField(context, {
        databaseId: db1,
        key: "bad_relation",
        targetDatabaseId: otherProductDb,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
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
    ).rejects.toThrow("Referenced entry not found or access denied")

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
    ).rejects.toThrow("Referenced entry not found or access denied")
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
    ).rejects.toThrow("Row not found or access denied")

    expect(db.tables.entries.some((entry) => entry.id === row1)).toBe(true)
    expect(
      db.tables.entries.some((entry) => entry.id === otherProductRow)
    ).toBe(true)
  })
})
