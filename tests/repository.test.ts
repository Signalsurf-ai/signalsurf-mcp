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
const workflow1 = "00000000-0000-4000-8000-000000000101"
const workflow2 = "00000000-0000-4000-8000-000000000104"
const otherProductWorkflow = "00000000-0000-4000-8000-000000000103"
const project1 = "00000000-0000-4000-8000-000000000501"
const row1 = "00000000-0000-4000-8000-000000000301"
const row2 = "00000000-0000-4000-8000-000000000302"
const otherProductRow = "00000000-0000-4000-8000-000000000399"
const source1 = "00000000-0000-4000-8000-000000000801"
const otherProductSource = "00000000-0000-4000-8000-000000000802"
const tool1 = "00000000-0000-4000-8000-000000000901"
const tool2 = "00000000-0000-4000-8000-000000000902"
const accountListProfile1 = "00000000-0000-4000-8000-000000000a01"
const archivedAccountListProfile = "00000000-0000-4000-8000-000000000a02"
const otherProductAccountListProfile = "00000000-0000-4000-8000-000000000a99"
const pendingJob = "00000000-0000-4000-8000-000000000401"
const otherProductJob = "00000000-0000-4000-8000-000000000402"
const completedJob = "00000000-0000-4000-8000-000000000403"

function makeDb() {
  return new FakeSupabase({
    workflows: [
      {
        id: workflow1,
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
        project_id: null,
        display_order: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: workflow2,
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
        project_id: null,
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
        id: otherProductWorkflow,
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
    database_folders: [
      {
        id: project1,
        product_id: context.productId,
        name: "GTM",
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
        workflow_id: workflow1,
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
        workflow_id: workflow1,
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
        workflow_id: null,
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
    organization_members: [
      {
        organization_id: org1,
        user_id: context.userId,
        role: "owner",
      },
      {
        organization_id: org2,
        user_id: context.userId,
        role: "viewer",
      },
    ],
    product_members: [
      {
        product_id: context.productId,
        user_id: context.userId,
        role: "owner",
      },
    ],
    product_goals: [
      {
        product_id: context.productId,
        user_id: context.userId,
        brand_name: "Acme",
        brand_description: "Acme makes widgets.",
        product_description: "A widget platform.",
        product_categories: ["SaaS", "Widgets", "SaaS"],
        selling_points: ["Fast", "Reliable"],
        target_audience: "SMB operators",
        competitors: ["Globex", "Initech"],
        official_website: "https://acme.example",
        brand_voice: { secret: "should-not-leak" },
        updated_at: "2026-06-02T00:00:00Z",
      },
    ],
    surf_jobs: [
      {
        id: pendingJob,
        product_id: context.productId,
        user_id: context.userId,
        workflow_id: workflow1,
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
        current_workflow_id: workflow1,
      },
    ],
    sources: [
      {
        id: source1,
        user_id: context.userId,
        workflow_id: workflow1,
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
        workflow_id: otherProductWorkflow,
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
    account_list_profiles: [
      {
        id: accountListProfile1,
        product_id: context.productId,
        name: "Seed SaaS GTM",
        description: "Founder-led GTM buyers",
        status: "active",
        source: "manual",
        profile_version: 2,
        config: {
          enabled: true,
          providers: ["apollo", "bycrawl"],
          previewLimit: 100,
          company: {
            fundingStages: ["Seed", "Series A"],
            companyTypes: ["B2B", "SaaS"],
          },
          people: {
            seniorities: ["VP", "Head"],
            functions: ["Sales", "RevOps"],
          },
        },
        sample_accounts: ["Linear"],
        reject_accounts: ["Agencies"],
        ai_prompt: null,
        ai_summary: null,
        created_by: context.userId,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-03T00:00:00Z",
      },
      {
        id: archivedAccountListProfile,
        product_id: context.productId,
        name: "Archived ICP",
        description: null,
        status: "archived",
        source: "ai_draft",
        profile_version: 1,
        config: {
          providers: ["crunchbase"],
        },
        sample_accounts: [],
        reject_accounts: [],
        ai_prompt: "old prompt",
        ai_summary: "old summary",
        created_by: context.userId,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-02T00:00:00Z",
      },
      {
        id: otherProductAccountListProfile,
        product_id: "00000000-0000-4000-8000-000000000099",
        name: "Other Product ICP",
        description: null,
        status: "active",
        source: "manual",
        profile_version: 1,
        config: {
          providers: ["pdl"],
        },
        sample_accounts: [],
        reject_accounts: [],
        ai_prompt: null,
        ai_summary: null,
        created_by: null,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-04T00:00:00Z",
      },
    ],
  })
}

describe("SignalSurfRepository", () => {
  it("lists only active Workflows in the current product", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.listWorkflows(context)

    expect(
      result.workflows.map((point: { name: string }) => point.name)
    ).toEqual(["Active", "Second"])
  })

  it("reads one product-scoped Workflow", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(repo.getWorkflow(context, workflow1)).resolves.toMatchObject(
      {
        workflow: {
          workflowId: workflow1,
          name: "Active",
        },
      }
    )

    await expect(
      repo.getWorkflow(context, otherProductWorkflow)
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("reads product-scoped brand context without leaking other goal fields", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const { brandContext } = await repo.getBrandContext(context)

    expect(brandContext).toEqual({
      productId: context.productId,
      brandName: "Acme",
      brandDescription: "Acme makes widgets.",
      productDescription: "A widget platform.",
      productCategories: ["SaaS", "Widgets"],
      sellingPoints: ["Fast", "Reliable"],
      targetAudience: "SMB operators",
      competitors: ["Globex", "Initech"],
      officialWebsite: "https://acme.example",
      updatedAt: "2026-06-02T00:00:00Z",
    })
  })

  it("returns empty brand context when the product has no goals row", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const { brandContext } = await repo.getBrandContext({
      ...context,
      productId: secondProductId,
    })

    expect(brandContext).toEqual({
      productId: secondProductId,
      brandName: null,
      brandDescription: null,
      productDescription: null,
      productCategories: [],
      sellingPoints: [],
      targetAudience: null,
      competitors: [],
      officialWebsite: null,
      updatedAt: null,
    })
  })

  it("soft-deletes Workflows and cancels pending jobs", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await repo.deleteWorkflows(context, [workflow1])

    const row = db.tables.workflows.find(
      (workflow) => workflow.id === workflow1
    )
    expect(row).toBeTruthy()
    expect(row?.deleted_at).toEqual(expect.any(String))
    expect(db.tables.surf_jobs[0].status).toBe("failed")
    expect(db.tables.user_preferences[0].current_workflow_id).toBe(workflow2)
  })

  it("queues an active Workflow run", async () => {
    const db = makeDb()
    db.tables.surf_jobs = []
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.runWorkflow(context, {
      workflowId: workflow1,
    })

    expect(result).toMatchObject({
      enqueued: true,
      enqueuedCount: 1,
      skippedCount: 0,
      sourceIdsQueued: [source1],
      job: {
        workflowId: workflow1,
        sourceId: source1,
        jobType: "extract",
        status: "pending",
      },
    })
    expect(db.tables.surf_jobs).toHaveLength(1)
    expect(db.tables.surf_jobs[0]).toMatchObject({
      product_id: context.productId,
      user_id: context.userId,
      workflow_id: workflow1,
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

  it("deduplicates pending Workflow runs by default", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.runWorkflow(context, {
      workflowId: workflow1,
    })

    expect(result).toMatchObject({
      enqueued: false,
      reason: "active_jobs_exist",
      enqueuedCount: 0,
      skippedCount: 1,
      job: {
        jobId: pendingJob,
        workflowId: workflow1,
        sourceId: source1,
        jobType: "extract",
        status: "pending",
      },
    })
    expect(db.tables.surf_jobs).toHaveLength(1)
  })

  it("requires an explicit override to run inactive Workflows", async () => {
    const db = makeDb()
    db.tables.surf_jobs = []
    const workflow = db.tables.workflows.find(
      (workflow) => workflow.id === workflow1
    )
    workflow!.is_active = false
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.runWorkflow(context, { workflowId: workflow1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })

    await expect(
      repo.runWorkflow(context, {
        workflowId: workflow1,
        allowInactive: true,
      })
    ).resolves.toMatchObject({
      enqueued: true,
      job: {
        workflowId: workflow1,
        status: "pending",
      },
    })
  })

  it("uses idempotency keys to avoid duplicate Workflow runs", async () => {
    const db = makeDb()
    db.tables.surf_jobs = []
    const repo = new SignalSurfRepository(db as any)

    const first = await repo.runWorkflow(context, {
      workflowId: workflow1,
      idempotencyKey: "daily-digest-2026-06-04",
    })
    const second = await repo.runWorkflow(context, {
      workflowId: workflow1,
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
      workflow_id: "00000000-0000-4000-8000-000000000103",
      source_id: otherProductSource,
      job_type: "extract",
      status: "pending",
      created_at: "2026-06-02T00:00:00Z",
    })
    const repo = new SignalSurfRepository(db as any)

    await expect(repo.getSurfJob(context, pendingJob)).resolves.toMatchObject({
      job: {
        jobId: pendingJob,
        workflowId: workflow1,
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
      workflow_id: workflow1,
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

  it("lists and toggles safe Workflow source metadata", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.listWorkflowSources(context, workflow1)

    expect(result).toMatchObject({
      workflowId: workflow1,
      totalCount: 1,
      sources: [
        {
          sourceId: source1,
          workflowId: workflow1,
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

    const updated = await repo.setWorkflowSourceActive(context, {
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
      repo.setWorkflowSourceActive(context, {
        sourceId: otherProductSource,
        isActive: false,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("creates and updates typed Workflow source config without leaking secrets", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const created = await repo.createWorkflowSource(context, {
      workflowId: workflow1,
      sourceType: "custom-pull",
      name: "Partner API",
      config: {
        url: "https://example.com/api/leads",
        method: "POST",
        schedule: "0 */2 * * *",
        headers: { Authorization: "Bearer secret" },
        body: { limit: 100 },
        responsePath: "$.items",
      },
    })

    expect(created).toMatchObject({
      replacedCount: 0,
      source: {
        name: "Partner API",
        sourceType: "custom-pull",
        type: "pull",
        url: "https://example.com/api/leads",
        schedule: "0 */2 * * *",
      },
    })
    expect(created.source).not.toHaveProperty("headers")
    expect(created.source).not.toHaveProperty("auth")
    const inserted = db.tables.sources.find(
      (source) => source.id === created.source.sourceId
    )
    expect(inserted).toMatchObject({
      user_id: context.userId,
      workflow_id: workflow1,
      pull_config: {
        method: "POST",
        response_path: "$.items",
        headers: { Authorization: "Bearer secret" },
      },
    })

    const updated = await repo.updateWorkflowSource(context, {
      sourceId: created.source.sourceId,
      pullConfigPatch: { schedule: "0 9 * * *" },
      metadataPatch: { provider: "partner-api" },
      isActive: false,
    })

    expect(updated).toMatchObject({
      changedFields: ["is_active", "pull_config", "metadata"],
      source: {
        sourceId: created.source.sourceId,
        provider: "partner-api",
        schedule: "0 9 * * *",
        isActive: false,
      },
    })
  })

  it("returns the callable SignalSurf URL for custom webhook sources", async () => {
    const previousUrl = process.env.SIGNALSURF_SUPABASE_URL
    process.env.SIGNALSURF_SUPABASE_URL = "https://example.supabase.co"
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    try {
      const created = await repo.createWorkflowSource(context, {
        workflowId: workflow1,
        sourceType: "webhook",
        name: "BlockRun intake",
      })
      const sourceId = created.source.sourceId
      const webhookUrl = `https://example.supabase.co/functions/v1/webhook-signal?source_id=${sourceId}`

      expect(created).toMatchObject({
        webhookUrl,
        source: {
          sourceId,
          sourceType: "webhook",
          type: "webhook",
          name: "BlockRun intake",
          webhookUrl,
          webhookSecretConfigured: false,
        },
      })
      expect(
        db.tables.sources.find((source) => source.id === sourceId)
      ).toMatchObject({
        user_id: context.userId,
        workflow_id: workflow1,
        type: "webhook",
      })
    } finally {
      if (previousUrl === undefined) {
        delete process.env.SIGNALSURF_SUPABASE_URL
      } else {
        process.env.SIGNALSURF_SUPABASE_URL = previousUrl
      }
    }
  })

  it("creates webhook import mappings and previews/replays captured payloads", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)
    const importMapping = {
      version: "signalsurf.import_mapping.v1" as const,
      mappings: [
        {
          name: "GitHub stargazers",
          targetDatabaseId: db1,
          recordsPath: "$.contacts[*]",
          operation: "upsert" as const,
          uniqueKey: {
            template: "github:{login}",
            normalize: "lowercase" as const,
          },
          fields: [
            {
              targetField: "name",
              sourcePath: "$.name",
              transform: "trim" as const,
            },
            {
              targetField: "githubHandle",
              sourcePath: "$.login",
              transform: "lowercase" as const,
            },
            {
              targetField: "email",
              sourcePath: "$.email",
              transform: "lowercase" as const,
            },
          ],
        },
      ],
    }

    const created = await repo.createWorkflowSource(context, {
      workflowId: workflow1,
      sourceType: "webhook",
      name: "GitHub stars webhook",
      config: {
        importMapping,
      },
    })
    const sourceId = created.source.sourceId as string

    expect(created.source).toMatchObject({
      sourceType: "webhook",
      importMapping: {
        version: "signalsurf.import_mapping.v1",
        mappingNames: ["GitHub stargazers"],
        targetDatabaseIds: [db1],
        mappedFieldCount: 3,
      },
    })
    expect(
      db.tables.sources.find((source) => source.id === sourceId)?.data_schema
    ).toMatchObject({
      fields: [],
      import_mapping: importMapping,
    })

    const updatedMapping = {
      ...importMapping,
      mappings: [
        {
          ...importMapping.mappings[0],
          name: "Reach candidates",
        },
      ],
    }
    const updated = await repo.updateWorkflowSource(context, {
      sourceId,
      sourceType: "webhook",
      config: {
        importMapping: updatedMapping,
      },
    })
    expect(updated.source).toMatchObject({
      importMapping: {
        mappingNames: ["Reach candidates"],
        mappedFieldCount: 3,
      },
    })

    const payloadId = "00000000-0000-4000-8000-000000000b01"
    db.tables.raw_signals = [
      {
        id: payloadId,
        source_id: sourceId,
        status: "received",
        received_at: "2026-06-08T00:00:00Z",
        dedup_key: "stars-1",
        data: {
          contacts: [
            {
              login: "AgenticNick",
              name: " Nick ",
              email: "Nick@Example.COM",
            },
          ],
        },
      },
    ]

    await expect(
      repo.listWebhookPayloadSamples(context, { sourceId })
    ).resolves.toMatchObject({
      sourceId,
      totalCount: 1,
      samples: [
        {
          payloadId,
          dedupKey: "stars-1",
          payload: {
            contacts: [
              {
                login: "AgenticNick",
              },
            ],
          },
        },
      ],
    })

    await expect(
      repo.previewImportMapping(context, {
        sourceId,
        importMapping: updatedMapping,
        payload: {
          contacts: [
            {
              login: "AgenticNick",
              name: "Nick",
              email: "Nick@Example.COM",
            },
          ],
        },
      })
    ).resolves.toMatchObject({
      rowCount: 1,
      rows: [
        {
          targetDatabaseId: db1,
          entryKeyHash: "github:agenticnick",
          data: {
            name: "Nick",
            githubHandle: "agenticnick",
            email: "nick@example.com",
          },
        },
      ],
    })

    const capturedPreview = await repo.previewImportMapping(context, {
      sourceId,
      payloadId,
    })
    expect(capturedPreview).toMatchObject({
      rowCount: 1,
      rows: [
        {
          entryKeyHash: "github:agenticnick",
          data: {
            name: "Nick",
            githubHandle: "agenticnick",
          },
        },
      ],
    })

    const replayed = await repo.replayWebhookPayload(context, {
      sourceId,
      payloadId,
    })
    expect(replayed).toMatchObject({
      importedRows: 1,
      rows: [
        {
          databaseId: db1,
          workflowId: workflow1,
          entryKeyHash: "github:agenticnick",
          rawSignalId: payloadId,
          data: {
            name: "Nick",
            githubHandle: "agenticnick",
            email: "nick@example.com",
          },
        },
      ],
      warnings: [],
    })

    const inserted = db.tables.entries.find(
      (entry) => entry.entry_key_hash === "github:agenticnick"
    )
    expect(inserted).toMatchObject({
      database_id: db1,
      workflow_id: workflow1,
      origin: "pipeline",
      origin_ref: `raw_signal:${payloadId}`,
      data: {
        name: "Nick",
      },
    })

    db.tables.raw_signals[0].data.contacts[0].name = "Nick Updated"
    await repo.replayWebhookPayload(context, {
      sourceId,
      payloadId,
    })
    expect(
      db.tables.entries.filter(
        (entry) => entry.entry_key_hash === "github:agenticnick"
      )
    ).toHaveLength(1)
    expect(
      db.tables.entries.find(
        (entry) => entry.entry_key_hash === "github:agenticnick"
      )?.data
    ).toMatchObject({
      name: "Nick Updated",
      email: "nick@example.com",
    })
  })

  it("rejects webhook import mappings with unsupported transform options", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)
    const baseMapping = {
      version: "signalsurf.import_mapping.v1" as const,
      mappings: [
        {
          name: "GitHub stargazers",
          targetDatabaseId: db1,
          recordsPath: "$.contacts[*]",
          operation: "upsert" as const,
          uniqueKey: {
            template: "github:{login}",
            normalize: "lowercase" as const,
          },
          fields: [
            {
              targetField: "githubHandle",
              sourcePath: "$.login",
              transform: "lowercase" as const,
            },
          ],
        },
      ],
    }

    await expect(
      repo.createWorkflowSource(context, {
        workflowId: workflow1,
        sourceType: "webhook",
        name: "Invalid transform webhook",
        config: {
          importMapping: {
            ...baseMapping,
            mappings: [
              {
                ...baseMapping.mappings[0],
                fields: [
                  {
                    targetField: "githubHandle",
                    sourcePath: "$.login",
                    transform: "lowerCase",
                  },
                ],
              },
            ],
          },
        },
      })
    ).rejects.toThrow("config.importMapping must match")

    await expect(
      repo.createWorkflowSource(context, {
        workflowId: workflow1,
        sourceType: "webhook",
        name: "Invalid normalize webhook",
        config: {
          importMapping: {
            ...baseMapping,
            mappings: [
              {
                ...baseMapping.mappings[0],
                uniqueKey: {
                  template: "github:{login}",
                  normalize: "lowerCase",
                },
              },
            ],
          },
        },
      })
    ).rejects.toThrow("config.importMapping must match")
  })

  it("writes platform source search config", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const created = await repo.createWorkflowSource(context, {
      workflowId: workflow1,
      sourceType: "platform",
      config: {
        endpointId: "threads-keyword-search",
        keywords: ["x402", "MCP"],
        trackedAccounts: ["@blockrun"],
      },
    })

    expect(created.source).toMatchObject({
      sourceId: source1,
      sourceType: "platform",
      endpointId: "threads-keyword-search",
    })
    expect(created).toMatchObject({ updatedExisting: true })
    expect(
      db.tables.sources.filter((source) => source.workflow_id === workflow1)
    ).toHaveLength(1)
    expect(db.tables.platform_search_config).toMatchObject([
      {
        product_id: context.productId,
        workflow_id: workflow1,
        platform: "threads-keyword-search",
        keywords: ["x402", "MCP"],
      },
    ])
    expect(db.tables.tracked_accounts).toMatchObject([
      {
        product_id: context.productId,
        workflow_id: workflow1,
        platform: "threads-keyword-search",
        username: "blockrun",
      },
    ])
  })

  it("disables orphaned platform config when source endpoints change", async () => {
    const db = makeDb()
    db.tables.platform_search_config = [
      {
        product_id: context.productId,
        workflow_id: workflow1,
        platform: "threads-keyword-search",
        is_enabled: true,
        keywords: ["old"],
      },
    ]
    db.tables.tracked_accounts = [
      {
        product_id: context.productId,
        workflow_id: workflow1,
        platform: "threads-keyword-search",
        username: "old-account",
        is_enabled: true,
      },
    ]
    const repo = new SignalSurfRepository(db as any)

    await repo.updateWorkflowSource(context, {
      sourceId: source1,
      sourceType: "platform",
      config: {
        endpointId: "x-post-search",
        keywords: ["x402"],
        trackedAccounts: ["@blockrun"],
      },
    })

    expect(db.tables.platform_search_config).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: "threads-keyword-search",
          is_enabled: false,
        }),
        expect.objectContaining({
          platform: "x-post-search",
          is_enabled: true,
          keywords: ["x402"],
        }),
      ])
    )
    expect(db.tables.tracked_accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: "threads-keyword-search",
          username: "old-account",
          is_enabled: false,
        }),
        expect.objectContaining({
          platform: "x-post-search",
          username: "blockrun",
          is_enabled: true,
        }),
      ])
    )
  })

  it("enforces internal trigger exclusivity and supports explicit replacement", async () => {
    const db = makeDb()
    db.tables.surf_jobs.push({
      id: completedJob,
      product_id: context.productId,
      user_id: context.userId,
      workflow_id: workflow1,
      source_id: source1,
      job_type: "extract",
      status: "completed",
      created_at: "2026-06-02T00:00:00Z",
    })
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.createWorkflowSource(context, {
        workflowId: workflow1,
        sourceType: "item-updated",
        name: "Stage updated",
        config: {
          databaseId: db1,
          triggerColumn: "stage",
          triggerValue: "qualified",
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })

    const created = await repo.createWorkflowSource(context, {
      workflowId: workflow1,
      sourceType: "item-updated",
      name: "Stage updated",
      config: {
        databaseId: db1,
        triggerColumn: "stage",
        triggerValue: "qualified",
      },
      replaceExisting: true,
    })

    expect(created).toMatchObject({
      replacedCount: 1,
      source: {
        sourceType: "item-updated",
        type: "internal",
        eventType: "item_updated",
        databaseId: db1,
      },
    })
    expect(
      db.tables.sources.find((source) => source.id === source1)
    ).toBeFalsy()
    expect(db.tables.surf_jobs).toEqual([
      expect.objectContaining({
        id: completedJob,
        status: "completed",
      }),
    ])
    expect(
      db.tables.sources.find((source) => source.id === otherProductSource)
    ).toBeTruthy()
    expect(
      db.tables.sources.find((source) => source.id === created.source.sourceId)
        ?.metadata
    ).toMatchObject({
      source_database_name: "Companies",
      column_updates: [
        {
          column: "stage",
          valueType: "constant",
          value: "qualified",
        },
      ],
    })
  })

  it("deletes Workflow sources after product-scope validation", async () => {
    const db = makeDb()
    db.tables.platform_search_config = [
      {
        product_id: context.productId,
        workflow_id: workflow1,
        platform: "threads-keyword-search",
        is_enabled: true,
        keywords: ["old"],
      },
    ]
    db.tables.tracked_accounts = [
      {
        product_id: context.productId,
        workflow_id: workflow1,
        platform: "threads-keyword-search",
        username: "old-account",
        is_enabled: true,
      },
    ]
    db.tables.surf_jobs.push({
      id: completedJob,
      product_id: context.productId,
      user_id: context.userId,
      workflow_id: workflow1,
      source_id: source1,
      job_type: "extract",
      status: "completed",
      created_at: "2026-06-02T00:00:00Z",
    })
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.deleteWorkflowSource(context, {
        sourceId: otherProductSource,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })

    const deleted = await repo.deleteWorkflowSource(context, {
      sourceId: source1,
    })

    expect(deleted).toEqual({
      sourceIds: [source1],
      deletedCount: 1,
    })
    expect(
      db.tables.sources.find((source) => source.id === source1)
    ).toBeFalsy()
    expect(db.tables.surf_jobs).toEqual([
      expect.objectContaining({
        id: completedJob,
        status: "completed",
      }),
    ])
    expect(db.tables.platform_search_config[0]).toMatchObject({
      platform: "threads-keyword-search",
      is_enabled: false,
    })
    expect(db.tables.tracked_accounts[0]).toMatchObject({
      platform: "threads-keyword-search",
      username: "old-account",
      is_enabled: false,
    })
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

  it("manages Workflow tool ids idempotently", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(repo.listWorkflowTools(context, workflow1)).resolves.toEqual(
      {
        workflowId: workflow1,
        toolIds: [],
        totalCount: 0,
      }
    )

    await expect(
      repo.attachWorkflowTool(context, {
        workflowId: workflow1,
        toolId: tool1,
      })
    ).resolves.toMatchObject({
      changed: true,
      toolIds: [tool1],
      workflow: {
        workflowId: workflow1,
        toolConfig: {
          auto_tool_ids: [tool1],
        },
      },
    })

    await expect(
      repo.attachWorkflowTool(context, {
        workflowId: workflow1,
        toolId: tool1,
      })
    ).resolves.toMatchObject({
      changed: false,
      toolIds: [tool1],
    })

    await repo.attachWorkflowTool(context, {
      workflowId: workflow1,
      toolId: tool2,
    })

    await expect(
      repo.detachWorkflowTool(context, {
        workflowId: workflow1,
        toolId: tool1,
      })
    ).resolves.toMatchObject({
      changed: true,
      toolIds: [tool2],
    })

    expect(
      db.tables.workflows.find((workflow) => workflow.id === workflow1)
        ?.tool_config
    ).toMatchObject({
      auto_tool_ids: [tool2],
    })

    await expect(
      repo.attachWorkflowTool(context, {
        workflowId: otherProductWorkflow,
        toolId: tool1,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })

    await expect(
      repo.attachWorkflowTool(context, {
        workflowId: workflow1,
        toolId: "00000000-0000-4000-8000-000000000903",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("validates auto_tool_ids ownership when update_workflow writes tool config", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateWorkflow(context, {
        workflowId: workflow1,
        toolConfigPatch: { auto_tool_ids: [tool1] },
      })
    ).resolves.toBeDefined()

    await expect(
      repo.updateWorkflow(context, {
        workflowId: workflow1,
        toolConfigPatch: {
          auto_tool_ids: ["00000000-0000-4000-8000-000000000903"],
        },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("lists product-scoped account list profiles", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const active = await repo.listAccountListProfiles(context)

    expect(active).toMatchObject({
      totalCount: 1,
      profiles: [
        {
          profileId: accountListProfile1,
          productId: context.productId,
          name: "Seed SaaS GTM",
          status: "active",
          source: "manual",
          profileVersion: 2,
          accountList: {
            providers: ["apollo", "bycrawl"],
            company: {
              fundingStages: ["Seed", "Series A"],
            },
          },
          sampleAccounts: ["Linear"],
          rejectAccounts: ["Agencies"],
        },
      ],
    })

    const all = await repo.listAccountListProfiles(context, {
      includeArchived: true,
    })
    expect(
      all.profiles.map((profile: { profileId: string }) => profile.profileId)
    ).toEqual([accountListProfile1, archivedAccountListProfile])
  })

  it("creates account list profiles with structured ICP config", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.saveAccountListProfile(context, {
      name: "Enterprise RevOps",
      description: "Find companies expanding outbound",
      source: "manual",
      accountList: {
        enabled: true,
        providers: ["apollo", "crunchbase", "bycrawl"],
        previewLimit: 75,
        company: {
          fundingStages: ["Series A"],
          technologies: ["HubSpot"],
        },
        people: {
          seniorities: ["VP", "Head"],
          functions: ["Sales", "RevOps"],
          emailStatuses: ["verified"],
        },
        liveSignals: {
          queries: ["hiring SDR"],
          includeJobBoards: true,
        },
      },
      sampleAccounts: ["Linear"],
      rejectAccounts: ["Agencies"],
    })

    expect(result).toMatchObject({
      created: true,
      profile: {
        profileId: expect.any(String),
        productId: context.productId,
        name: "Enterprise RevOps",
        profileVersion: 1,
        accountList: {
          providers: ["apollo", "crunchbase", "bycrawl"],
          company: {
            technologies: ["HubSpot"],
          },
          people: {
            emailStatuses: ["verified"],
          },
        },
        createdBy: context.userId,
      },
    })
    expect(db.tables.account_list_profiles.at(-1)).toMatchObject({
      id: result.profileId,
      product_id: context.productId,
      name: "Enterprise RevOps",
      status: "active",
      source: "manual",
      profile_version: 1,
      created_by: context.userId,
      config: {
        liveSignals: {
          includeJobBoards: true,
        },
      },
    })
  })

  it("updates and archives account list profiles without crossing product scope", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const updated = await repo.saveAccountListProfile(context, {
      id: accountListProfile1,
      name: "Seed SaaS RevOps",
      description: null,
      source: "ai_draft",
      accountList: {
        enabled: true,
        providers: ["pdl"],
        people: {
          functions: ["RevOps"],
        },
      },
      aiPrompt: "focus on revenue operations",
      aiSummary: "Tighter RevOps ICP",
    })

    expect(updated).toMatchObject({
      created: false,
      profile: {
        profileId: accountListProfile1,
        name: "Seed SaaS RevOps",
        description: null,
        source: "ai_draft",
        profileVersion: 3,
        accountList: {
          providers: ["pdl"],
        },
        aiPrompt: "focus on revenue operations",
      },
    })

    const stored = db.tables.account_list_profiles.find(
      (profile) => profile.id === accountListProfile1
    )
    expect(stored).toMatchObject({
      created_by: context.userId,
      profile_version: 3,
      config: {
        providers: ["pdl"],
      },
    })

    const archived = await repo.archiveAccountListProfile(
      context,
      accountListProfile1
    )
    expect(archived).toMatchObject({
      archived: true,
      profile: {
        profileId: accountListProfile1,
        status: "archived",
      },
    })

    await expect(
      repo.saveAccountListProfile(context, {
        id: otherProductAccountListProfile,
        name: "Denied",
        accountList: {},
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })

    await expect(
      repo.archiveAccountListProfile(context, otherProductAccountListProfile)
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

    await repo.deleteWorkflows(hostedContext!, [workflow1])

    expect(db.tables.user_preferences[0].current_workflow_id).toBe(workflow1)
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
        scope: "mcp:workflows.read mcp:tables.read offline_access",
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

  it("creates products through hosted OAuth and expands the active grant", async () => {
    const db = makeDb()
    const oauthTokenId = "00000000-0000-4000-8000-000000000601"
    db.tables.mcp_oauth_tokens = [
      {
        id: oauthTokenId,
        product_id: context.productId,
        product_ids: [context.productId],
      },
    ]
    const oauthContext: SignalSurfContext = {
      ...context,
      productIds: [context.productId],
      products: [
        {
          productId: context.productId,
          name: "Primary Product",
          organizationId: org1,
          organizationName: "Primary Workspace",
        },
      ],
      scopes: ["mcp:products.write"],
      authKind: "oauth",
      oauthTokenId,
    }
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.createProduct(oauthContext, {
      name: "Agent-created Product",
      displayOrder: 3,
    })

    expect(result.product).toMatchObject({
      productId: expect.any(String),
      name: "Agent-created Product",
      organizationId: org1,
      organizationName: "Primary Workspace",
      ownerId: context.userId,
    })
    expect(db.tables.products.at(-1)).toMatchObject({
      id: result.productId,
      organization_id: org1,
      owner_id: context.userId,
      name: "Agent-created Product",
    })
    expect(db.tables.product_members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_id: result.productId,
          user_id: context.userId,
          role: "owner",
          display_order: 3,
        }),
      ])
    )
    expect(db.tables.product_goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_id: result.productId,
          user_id: context.userId,
        }),
      ])
    )
    expect(db.tables.mcp_oauth_tokens[0].product_ids).toEqual([
      context.productId,
      result.productId,
    ])
    expect(oauthContext.productIds).toEqual([
      context.productId,
      result.productId,
    ])
    expect(oauthContext.products?.at(-1)).toMatchObject({
      productId: result.productId,
      name: "Agent-created Product",
    })
  })

  it("rejects product creation outside hosted OAuth grants", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.createProduct(context, { name: "Manual token product" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("creates prompt templates from scoring rubric and surf prompt", async () => {
    const db = makeDb()
    db.tables.databases = db.tables.databases.filter((row) => row.id === db1)
    const repo = new SignalSurfRepository(db as any)

    await repo.createWorkflow(context, {
      name: "New point",
      scoringRubric: "Score qualified leads highly.",
      surfPrompt: "Find recent funding events.",
    })

    const inserted = db.tables.workflows.at(-1)
    expect(inserted).toMatchObject({
      name: "New point",
      database_ids: [db1],
      prompt_template:
        "## Scoring Rubric\n\nScore qualified leads highly.\n\nFind recent funding events.",
    })
  })

  it("places Workflows in Projects without using legacy Workflow folders", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const created = await repo.createWorkflow(context, {
      name: "Project Workflow",
      projectId: project1,
      databaseIds: [db1],
    })

    expect(created.workflow).toMatchObject({ projectId: project1 })
    expect(db.tables.workflows.at(-1)).toMatchObject({
      project_id: project1,
    })
    expect(db.tables).not.toHaveProperty("workflow" + "_folders")

    const updated = await repo.updateWorkflow(context, {
      workflowId: workflow1,
      projectId: project1,
    })

    expect(updated.workflow).toMatchObject({ projectId: project1 })
  })

  it("uses explicit prompt templates instead of synthesized prompt sections", async () => {
    const db = makeDb()
    db.tables.databases = db.tables.databases.filter((row) => row.id === db1)
    const repo = new SignalSurfRepository(db as any)

    await repo.createWorkflow(context, {
      name: "Explicit point",
      promptTemplate: "Use this exact prompt.",
      scoringRubric: "Ignored for prompt_template.",
      surfPrompt: "Also ignored for prompt_template.",
    })

    const inserted = db.tables.workflows.at(-1)
    expect(inserted?.prompt_template).toBe("Use this exact prompt.")
  })

  it("shallow-merges Workflow patches and recomputes prompt templates", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.updateWorkflow(context, {
      workflowId: workflow1,
      variablesPatch: { region: "US" },
      toolConfigPatch: { maxResults: 10 },
      configPatch: { cadence: "daily" },
      scoringRubric: "Prefer new accounts.",
    })

    expect(result.workflow.variables).toMatchObject({ region: "US" })
    expect(result.workflow.toolConfig).toMatchObject({ maxResults: 10 })
    expect(result.workflow.config).toMatchObject({ cadence: "daily" })
    expect(result.workflow.promptTemplate).toContain("Prefer new accounts.")
  })

  it("rejects conflicting full and patch updates", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateWorkflow(context, {
        workflowId: workflow1,
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
      fields: [{ key: "parent" }, { key: "priority", label: "Deal Priority" }],
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

  it("creates and updates tables with custom schema", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const created = await repo.createTable(context, {
      name: "Agent Accounts",
      itemType: "account",
      schema: {
        template_key: "outbound_accounts",
        schema_version: 2,
        database_kind: "outbound.account_list",
        fields: [
          { key: "name", type: "text", label: "Name" },
          {
            key: "owner",
            type: "item_ref",
            target_database_id: db2,
            label: "Owner",
          },
        ],
      },
      viewConfigs: {
        saved_views: [
          { id: "default", name: "All accounts" },
          {
            id: "tiering",
            name: "Tiering",
            viewType: "board",
            groupByKey: "tier",
          },
        ],
        table_hidden_columns: [],
      },
      displayOrder: 8,
    })

    expect(created.database).toMatchObject({
      databaseId: expect.any(String),
      name: "Agent Accounts",
      itemType: "account",
      displayOrder: 8,
      schema: {
        fields: [
          { key: "name", type: "text" },
          { key: "owner", target_database_id: db2 },
        ],
      },
    })

    const updated = await repo.updateTable(context, {
      databaseId: created.database.databaseId,
      name: "Agent Accounts v2",
      schemaPatch: {
        fields: [
          { key: "name", type: "text", label: "Company Name" },
          { key: "priority", type: "enum", options: ["P0", "P1"] },
          {
            key: "tier",
            type: "enum",
            options: ["tier_1", "tier_2", "tier_3"],
            enrich: true,
            ai_enabled: true,
            sources: [{ id: "legacy-tier-source" }],
          },
          { key: "employee_count", type: "number" },
          { key: "active_job_count", type: "number" },
          { key: "review_reason", type: "string" },
        ],
      },
    })

    expect(updated).toMatchObject({
      changedFields: ["name", "schema"],
      database: {
        name: "Agent Accounts v2",
        schema: {
          fields: [
            { key: "name", label: "Company Name" },
            { key: "priority", type: "enum" },
            { key: "tier", type: "enum" },
            { key: "employee_count", type: "number" },
            { key: "active_job_count", type: "number" },
            { key: "review_reason", type: "string" },
          ],
        },
      },
    })

    const upgraded = await repo.updateTable(context, {
      databaseId: created.database.databaseId,
      template: "outbound_accounts",
    })
    const upgradedFields = upgraded.database.schema.fields as Array<{
      key: string
      type?: string
    }>
    expect(upgraded.database).toMatchObject({
      itemType: "outbound_account",
      schema: {
        template_key: "outbound_accounts",
        schema_version: 3,
      },
    })
    expect(upgradedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "company", type: "string" }),
        expect.objectContaining({ key: "tech_stack", type: "array" }),
        expect.objectContaining({ key: "priority", type: "enum" }),
        expect.objectContaining({
          key: "tier",
          type: "enum",
          enrich: false,
          ai_enabled: false,
          sources: [],
        }),
        expect.objectContaining({ key: "employee_count", type: "number" }),
        expect.objectContaining({ key: "active_job_count", type: "number" }),
        expect.objectContaining({ key: "review_reason", type: "string" }),
      ])
    )
    expect(upgraded.database.viewConfigs.table_hidden_columns).toEqual(
      expect.arrayContaining([
        "output.tier",
        "output.employee_count",
        "output.active_job_count",
        "output.review_reason",
      ])
    )
    expect(upgraded.database.viewConfigs.saved_views).toContainEqual(
      expect.objectContaining({
        id: "tiering",
        viewType: "board",
        groupByKey: "tier",
      })
    )
  })

  it("creates outbound account and contact tables from additive templates", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const accounts = await repo.createTable(context, {
      name: "Outbound Accounts",
      template: "outbound_accounts",
      schema: {
        fields: [
          { key: "website", type: "text", label: "Wrong override" },
          { key: "is_yc", type: "boolean", label: "YC" },
        ],
      },
    })
    const accountSchema = accounts.database.schema as {
      template_key?: string
      database_kind?: string
      required_fields?: string[]
      report_fields?: string[]
      fields?: Array<Record<string, unknown>>
    }
    const accountFields = new Map(
      accountSchema.fields?.map((field) => [field.key, field]) ?? []
    )

    expect(accounts.database).toMatchObject({ itemType: "outbound_account" })
    expect(accountSchema).toMatchObject({
      template_key: "outbound_accounts",
      database_kind: "outbound.account_list",
      required_fields: ["company", "status"],
    })
    expect(accountFields.get("website")).toMatchObject({
      type: "url",
      label: "Website",
    })
    expect(accountFields.get("status")).toMatchObject({
      type: "enum",
      options: ["new", "researching", "qualified", "rejected"],
    })
    expect(accountSchema).toMatchObject({ schema_version: 3 })
    expect(accountFields.get("tech_stack")).toMatchObject({ type: "array" })
    expect(
      accountSchema.fields
        ?.map((field) => field.key)
        .filter((key) => key !== "is_yc")
    ).toEqual([
      "company",
      "domain",
      "website",
      "linkedin_url",
      "location",
      "industry",
      "company_size",
      "funding_stage",
      "tech_stack",
      "latest_round_date",
      "fit_score",
      "fit_reason",
      "status",
    ])
    expect(accountSchema.report_fields).toEqual([
      "company",
      "website",
      "linkedin_url",
      "location",
      "industry",
      "company_size",
      "funding_stage",
      "latest_round_date",
      "tech_stack",
      "fit_score",
      "status",
      "fit_reason",
    ])
    expect(accountFields.get("is_yc")).toMatchObject({
      type: "boolean",
      label: "YC",
    })
    expect(accountFields.has("tier")).toBe(false)
    expect(accountFields.has("employee_count")).toBe(false)
    expect(accountFields.has("active_job_count")).toBe(false)
    expect(accountFields.has("review_reason")).toBe(false)
    expect(accountFields.has("campaign_ready")).toBe(false)
    expect(
      (accounts.database.viewConfigs.saved_views as Array<{ id?: string }>).map(
        (view) => view.id
      )
    ).not.toContain("tiering")
    expect(accounts.database.viewConfigs).toMatchObject({
      table_column_visibility_mode: "auto_provider_facts",
      sort_key: "fit_score",
      sort_direction: "desc",
      table_column_order: [
        "output.company",
        "output.domain",
        "output.website",
        "output.linkedin_url",
        "output.location",
        "output.industry",
        "output.company_size",
        "output.funding_stage",
        "output.latest_round_date",
        "output.tech_stack",
        "output.fit_score",
        "output.fit_reason",
        "output.status",
      ],
      table_hidden_columns: [
        "output.domain",
        "output.linkedin_url",
        "output.location",
        "output.industry",
        "output.company_size",
        "output.funding_stage",
        "output.latest_round_date",
        "output.tech_stack",
      ],
    })

    const contacts = await repo.createTable(context, {
      name: "Outbound Contacts",
      template: "contacts",
      schema: {
        fields: [
          { key: "email", type: "text", label: "Wrong override" },
          {
            key: "account",
            type: "item_ref",
            target_database_id: accounts.database.databaseId,
            label: "Account",
          },
        ],
      },
    })
    const contactSchema = contacts.database.schema as {
      template_key?: string
      fields?: Array<Record<string, unknown>>
    }
    const contactFields = new Map(
      contactSchema.fields?.map((field) => [field.key, field]) ?? []
    )

    expect(contacts.database).toMatchObject({ itemType: "contact" })
    expect(contactSchema.template_key).toBe("contacts")
    expect(contactFields.get("email")).toMatchObject({ type: "email" })
    expect(contactFields.get("linkedin_url")).toMatchObject({
      type: "url",
      contact_platform: "linkedin",
    })
    expect(contactFields.get("account")).toMatchObject({
      type: "item_ref",
      target_database_id: accounts.database.databaseId,
    })
  })

  it("refuses to apply an outbound template to an unclassified table", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateTable(context, {
        databaseId: db1,
        template: "outbound_accounts",
      })
    ).rejects.toThrow(/already classified as outbound\.account_list/i)
  })

  it("rejects table schemas that reference another product", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.createTable(context, {
        name: "Bad relations",
        schema: {
          fields: [
            {
              key: "external",
              type: "item_ref",
              target_database_id: otherProductDb,
            },
          ],
        },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("deletes product tables and unlinks them from active Workflows", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)
    const secondWorkflow = db.tables.workflows.find(
      (row) => row.id === workflow2
    )!
    secondWorkflow.database_ids = [db1, db2]

    const result = await repo.deleteTables(context, [db1, db1])

    expect(result).toMatchObject({
      deletedDatabaseIds: [db1],
      count: 1,
      deletedTables: [{ databaseId: db1, name: "Companies" }],
    })
    expect(result.unlinkedWorkflows).toEqual(
      expect.arrayContaining([
        { id: workflow1, databaseIds: [] },
        { id: workflow2, databaseIds: [db2] },
      ])
    )
    expect(db.tables.databases.some((database) => database.id === db1)).toBe(
      false
    )
    expect(db.tables.databases.some((database) => database.id === db2)).toBe(
      true
    )
    expect(
      db.tables.databases.some((database) => database.id === otherProductDb)
    ).toBe(true)
    expect(
      db.tables.workflows.find((row) => row.id === workflow1)?.database_ids
    ).toEqual([])
    expect(
      db.tables.workflows.find((row) => row.id === workflow2)?.database_ids
    ).toEqual([db2])
  })

  it("rejects partial table deletes without deleting the valid subset", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.deleteTables(context, [db1, otherProductDb])
    ).rejects.toThrow("Database not found or access denied")

    expect(db.tables.databases.some((database) => database.id === db1)).toBe(
      true
    )
    expect(
      db.tables.databases.some((database) => database.id === otherProductDb)
    ).toBe(true)
  })

  it("refuses to delete system tables through MCP", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)
    const systemDb = "00000000-0000-4000-8000-000000000298"
    db.tables.databases.push({
      id: systemDb,
      product_id: context.productId,
      name: "System Table",
      description: null,
      icon: null,
      color: null,
      schema: null,
      item_type: "system",
      system_type: "account_list_profiles",
      view_configs: {},
      display_order: 10,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    })

    await expect(repo.deleteTables(context, [systemDb])).rejects.toThrow(
      "System tables cannot be deleted through MCP"
    )

    expect(
      db.tables.databases.some((database) => database.id === systemDb)
    ).toBe(true)
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

  it("updates row data through the batch changelog RPC (single-edit call)", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.updateTableRows(context, {
      edits: [{ rowId: row1, dataPatch: { stage: "contacted" } }],
    })

    expect(result.rows[0]?.data).toMatchObject({
      name: "Acme",
      stage: "contacted",
    })
    expect(db.rpcCalls[0]).toMatchObject({
      name: "update_entries_with_source_batch",
      args: {
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
      repo.updateTableRows(context, {
        edits: [
          {
            rowId: row1,
            dataPatch: {
              parent: {
                database_id: otherProductDb,
                entry_id: otherProductRow,
              },
            },
          },
        ],
      })
    ).rejects.toThrow("Referenced entry not found or access denied")
  })

  it("stamps MCP provenance when creating rows", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await repo.createTableRow(context, {
      databaseId: db1,
      data: { name: "Created" },
      workflowId: workflow1,
      note: "created by test",
    })

    expect(db.tables.entries.at(-1)).toMatchObject({
      database_id: db1,
      workflow_id: workflow1,
      origin: "mcp",
      origin_ref: "test-agent",
      triggered: false,
    })
  })

  it("rejects row attribution to Workflows that do not target the row database", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.createTableRow(context, {
        databaseId: db1,
        data: { name: "Wrong attribution" },
        workflowId: workflow2,
      })
    ).rejects.toThrow("is not configured to write to database")

    await expect(
      repo.updateTableRows(context, {
        edits: [{ rowId: row1, workflowId: workflow2 }],
      })
    ).rejects.toThrow("is not configured to write to database")
  })

  it("updates row notes through the entry note RPC", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.updateTableRows(context, {
      edits: [{ rowId: row1, note: "Follow up next week." }],
    })

    expect(result.rows[0]?.note).toBe("Follow up next week.")
    expect(db.rpcCalls[0]).toMatchObject({
      name: "update_entry_note_with_source",
      args: {
        p_entry_id: row1,
        p_note: "Follow up next week.",
        p_source_ref: "test-agent",
      },
    })
  })

  it("checks a per-edit databaseId against the row's actual database", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateTableRows(context, {
        edits: [{ rowId: row1, databaseId: db2, dataPatch: { stage: "x" } }],
      })
    ).rejects.toThrow(`belongs to database ${db1}`)

    expect(db.rpcCalls).toHaveLength(0)
  })

  it("batch-updates distinct data across rows in a single atomic RPC call", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.updateTableRows(context, {
      edits: [
        { rowId: row1, dataPatch: { stage: "contacted" } },
        { rowId: row2, data: { name: "Beta Corp" } },
      ],
    })

    expect(result.rows).toHaveLength(2)
    expect(result.rows.find((row) => row.id === row1)?.data).toMatchObject({
      name: "Acme",
      stage: "contacted",
    })
    expect(result.rows.find((row) => row.id === row2)?.data).toEqual({
      name: "Beta Corp",
    })
    expect(db.rpcCalls).toHaveLength(1)
    expect(db.rpcCalls[0]).toMatchObject({
      name: "update_entries_with_source_batch",
      args: { p_source: "mcp", p_source_ref: "test-agent" },
    })
    expect(db.rpcCalls[0].args.p_entries).toHaveLength(2)
  })

  it("rejects a batch with a duplicate rowId without writing anything", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateTableRows(context, {
        edits: [
          { rowId: row1, dataPatch: { stage: "a" } },
          { rowId: row1, dataPatch: { stage: "b" } },
        ],
      })
    ).rejects.toThrow("unique rowId")

    expect(db.rpcCalls).toHaveLength(0)
    expect(db.tables.entries.find((e) => e.id === row1)?.data.stage).toBe("new")
  })

  it("rejects the whole batch when any row is not found or unauthorized", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateTableRows(context, {
        edits: [
          { rowId: row1, dataPatch: { stage: "contacted" } },
          { rowId: otherProductRow, dataPatch: { stage: "contacted" } },
        ],
      })
    ).rejects.toThrow("Row not found or access denied")

    expect(db.rpcCalls).toHaveLength(0)
    expect(db.tables.entries.find((e) => e.id === row1)?.data.stage).toBe("new")
  })

  it("rejects a no-op edit with none of data, dataPatch, note, or workflowId", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateTableRows(context, {
        edits: [{ rowId: row1 }],
      })
    ).rejects.toThrow(
      "must include at least one of data, dataPatch, note, or workflowId"
    )
  })

  it("accepts a note-only edit with no data change", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    const result = await repo.updateTableRows(context, {
      edits: [{ rowId: row1, note: "Note only, no data change." }],
    })

    expect(result.rows[0]?.note).toBe("Note only, no data change.")
    expect(
      db.rpcCalls.some(
        (call) => call.name === "update_entries_with_source_batch"
      )
    ).toBe(false)
  })

  it("rejects an edit with both data and dataPatch", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateTableRows(context, {
        edits: [
          { rowId: row1, data: { name: "X" }, dataPatch: { stage: "y" } },
        ],
      })
    ).rejects.toThrow("pass either data or dataPatch, not both")
  })

  it("validates item references for every edit before writing the batch", async () => {
    const db = makeDb()
    const repo = new SignalSurfRepository(db as any)

    await expect(
      repo.updateTableRows(context, {
        edits: [
          {
            rowId: row1,
            dataPatch: {
              parent: {
                database_id: otherProductDb,
                entry_id: otherProductRow,
              },
            },
          },
        ],
      })
    ).rejects.toThrow("Referenced entry not found or access denied")

    expect(db.rpcCalls).toHaveLength(0)
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
