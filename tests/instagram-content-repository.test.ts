import { afterEach, describe, expect, it, vi } from "vitest"

import {
  mcpActionPayloadSha256,
  SignalSurfRepository,
} from "../src/repository.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"

const context: SignalSurfContext = {
  productId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000010",
  role: "viewer",
  authKind: "oauth",
  oauthTokenId: "00000000-0000-4000-8000-000000000099",
  oauthGrantId: "00000000-0000-4000-8000-000000000088",
  oauthClientId: "ssmcp_client_test",
}

const approvalId = "00000000-0000-4000-8000-000000000777"
const approvalPayload = {
  query: "KATSEYE fan fashion",
  pages: 2,
  approved_credit_ceiling: 6,
}

function seed(overrides: Record<string, unknown[]> = {}) {
  return {
    products: [
      {
        id: context.productId,
        owner_id: context.userId,
        organization_id: "00000000-0000-4000-8000-000000000020",
      },
    ],
    organizations: [
      {
        id: "00000000-0000-4000-8000-000000000020",
        owner_id: context.userId,
      },
    ],
    subscriptions: [
      {
        user_id: context.userId,
        status: "active",
        plan_name: "individual",
        current_period_start: "2026-07-01T00:00:00.000Z",
        current_period_end: null,
        created_at: "2026-07-01T00:00:00.000Z",
      },
    ],
    mcp_action_approvals: [],
    ...overrides,
  }
}

function approvedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: approvalId,
    oauth_token_id: context.oauthTokenId,
    oauth_grant_id: context.oauthGrantId,
    user_id: context.userId,
    client_id: context.oauthClientId,
    product_id: context.productId,
    tool_name: "search_instagram_content",
    provider_tool_id: "instagram_content_search",
    payload_sha256: mcpActionPayloadSha256(approvalPayload),
    status: "approved",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("hosted Instagram Content Search", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("creates an exact one-time approval before provider dispatch", async () => {
    vi.stubEnv("BYCRAWL_API_KEY", "test-key")
    const providerCall = vi.fn()
    vi.stubGlobal("fetch", providerCall)
    const db = new FakeSupabase(seed())
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.searchInstagramContent(context, {
        query: "KATSEYE fan fashion",
        pages: 2,
      })
    ).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED",
      details: {
        mcpToolName: "search_instagram_content",
        payloadSha256: mcpActionPayloadSha256(approvalPayload),
      },
    })
    expect(providerCall).not.toHaveBeenCalled()
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      tool_name: "search_instagram_content",
      provider_tool_id: "instagram_content_search",
      status: "pending",
      preview: {
        payload: {
          values: approvalPayload,
        },
      },
    })
  })

  it("consumes approval, reserves and books six credits, then returns creators", async () => {
    vi.stubEnv("BYCRAWL_API_KEY", "test-key")
    vi.stubEnv("BYCRAWL_API_URL", "https://bycrawl.example")
    const providerCall = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            posts: [
              {
                shortcode: "abc",
                author: { username: "fan.style", fullName: "Fan Style" },
              },
            ],
            pages: 2,
            count: 1,
          },
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal("fetch", providerCall)
    const db = new FakeSupabase(seed({ mcp_action_approvals: [approvedRow()] }))
    const repo = new SignalSurfRepository(db as never)

    const result = await repo.searchInstagramContent(context, {
      query: "KATSEYE fan fashion",
      pages: 2,
      approvalRequestId: approvalId,
    })

    expect(providerCall).toHaveBeenCalledWith(
      "https://bycrawl.example/instagram/posts/search?q=KATSEYE+fan+fashion&pages=2&get_sentiment=false",
      expect.objectContaining({ headers: expect.any(Object) })
    )
    expect(result).toMatchObject({
      success: true,
      creditsConsumed: 6,
      coverage: "instagram_content",
      creators: [{ platformAccount: "fan.style" }],
    })
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      status: "executed",
    })
    expect(db.rpcCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "reserve_credit_spend" }),
        expect.objectContaining({
          name: "record_credit_usage",
          args: expect.objectContaining({
            p_credits: 6,
            p_unbooked_idempotency_key: `bycrawl:hosted_mcp:search_instagram_content:${approvalId}`,
          }),
        }),
      ])
    )
  })

  it("marks a transport failure ambiguous and does not book it", async () => {
    vi.stubEnv("BYCRAWL_API_KEY", "test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("socket closed"))
    )
    const db = new FakeSupabase(seed({ mcp_action_approvals: [approvedRow()] }))
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.searchInstagramContent(context, {
        query: "KATSEYE fan fashion",
        pages: 2,
        approvalRequestId: approvalId,
      })
    ).rejects.toMatchObject({ code: "EXTERNAL_ACTION_AMBIGUOUS" })
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      status: "ambiguous",
    })
    expect(
      db.rpcCalls.some((call) => call.name === "record_credit_usage")
    ).toBe(false)
  })

  it("does not dispatch when the atomic credit reservation rejects the ceiling", async () => {
    vi.stubEnv("BYCRAWL_API_KEY", "test-key")
    const providerCall = vi.fn()
    vi.stubGlobal("fetch", providerCall)
    const db = new FakeSupabase(
      seed({ mcp_action_approvals: [approvedRow()] }),
      {
        rpcErrors: {
          reserve_credit_spend: {
            message: "credit limit reached: 4999 used + 6 requested > 5000",
          },
        },
      }
    )
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.searchInstagramContent(context, {
        query: "KATSEYE fan fashion",
        pages: 2,
        approvalRequestId: approvalId,
      })
    ).rejects.toMatchObject({ code: "CREDIT_LIMIT_REACHED" })
    expect(providerCall).not.toHaveBeenCalled()
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      status: "failed",
    })
  })

  it("ignores an expired subscription when calculating the reservation", async () => {
    vi.stubEnv("BYCRAWL_API_KEY", "test-key")
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: { posts: [] } }), { status: 200 })
        )
    )
    const db = new FakeSupabase(
      seed({
        subscriptions: [
          {
            user_id: context.userId,
            status: "active",
            plan_name: "enterprise",
            current_period_start: "2025-01-01T00:00:00.000Z",
            current_period_end: "2025-02-01T00:00:00.000Z",
            created_at: "2025-01-01T00:00:00.000Z",
          },
        ],
        mcp_action_approvals: [approvedRow()],
      })
    )
    const repo = new SignalSurfRepository(db as never)

    await repo.searchInstagramContent(context, {
      query: "KATSEYE fan fashion",
      pages: 2,
      approvalRequestId: approvalId,
    })

    expect(
      db.rpcCalls.find((call) => call.name === "reserve_credit_spend")?.args
    ).toMatchObject({ p_monthly_quota: 5_000 })
  })

  it("writes the real booking error back for reconciliation", async () => {
    vi.stubEnv("BYCRAWL_API_KEY", "test-key")
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: { posts: [] } }), { status: 200 })
        )
    )
    const db = new FakeSupabase(
      seed({ mcp_action_approvals: [approvedRow()] }),
      { rpcErrors: { record_credit_usage: { message: "database offline" } } }
    )
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.searchInstagramContent(context, {
        query: "KATSEYE fan fashion",
        pages: 2,
        approvalRequestId: approvalId,
      })
    ).rejects.toMatchObject({ code: "EXTERNAL_ACTION_AMBIGUOUS" })
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      status: "ambiguous",
      error: "record_credit_usage failed: database offline",
    })
    expect(
      db.rpcCalls.find(
        (call, index) =>
          call.name === "record_unbooked_credit_spend" && index > 0
      )?.args
    ).toMatchObject({
      p_error_message: "record_credit_usage failed: database offline",
    })
  })

  it("keeps the approval ambiguous when reconciliation classification also fails", async () => {
    vi.stubEnv("BYCRAWL_API_KEY", "test-key")
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: { posts: [] } }), { status: 200 })
        )
    )
    const db = new FakeSupabase(
      seed({ mcp_action_approvals: [approvedRow()] }),
      {
        rpcErrors: {
          record_credit_usage: {
            message: "insufficient bonus credits (required 6, consumed 0)",
          },
          record_unbooked_credit_spend: {
            message: "reconciliation database offline",
          },
        },
      }
    )
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.searchInstagramContent(context, {
        query: "KATSEYE fan fashion",
        pages: 2,
        approvalRequestId: approvalId,
      })
    ).rejects.toMatchObject({ code: "EXTERNAL_ACTION_AMBIGUOUS" })
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      status: "ambiguous",
      error: expect.stringContaining("reconciliation database offline"),
    })
  })
})
