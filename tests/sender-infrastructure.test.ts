import { afterEach, describe, expect, it, vi } from "vitest"

import {
  inspectSenderInfrastructure,
  planSenderCapacity,
  searchSenderDomains,
} from "../src/sender-infrastructure.js"
import { FakeSupabase } from "./fake-supabase.js"

const PRODUCT_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_PRODUCT_ID = "00000000-0000-4000-8000-000000000002"
const context = {
  productId: PRODUCT_ID,
  userId: "user-1",
  role: "viewer" as const,
}

function seed() {
  return {
    managed_email_domains: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        workspace_id: PRODUCT_ID,
        domain_name: "goacme.com",
        provider: "internal-domain-provider",
        desired_state: "active",
        lifecycle_status: "ready",
        autorenew_enabled: false,
      },
      {
        id: "10000000-0000-4000-8000-000000000002",
        workspace_id: OTHER_PRODUCT_ID,
        domain_name: "other-secret.com",
        desired_state: "active",
      },
    ],
    managed_email_mailboxes: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        workspace_id: PRODUCT_ID,
        domain_id: "10000000-0000-4000-8000-000000000001",
        email_address: "hello@goacme.com",
        provider: "internal-mailbox-provider",
        desired_state: "active",
        lifecycle_status: "ready",
        campaign_eligibility_status: "eligible",
        unipile_account_id: "account-email",
        password: "must-never-leak",
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        workspace_id: OTHER_PRODUCT_ID,
        email_address: "hidden@other-secret.com",
        desired_state: "active",
      },
    ],
    email_sender_warmup_profiles: [
      {
        workspace_id: PRODUCT_ID,
        unipile_account_id: "account-email",
        heat_score: 82,
        placement_primary_percent: 91,
      },
    ],
    product_unipile_accounts: [
      {
        workspace_id: PRODUCT_ID,
        unipile_account_id: "account-email",
        provider: "GMAIL",
      },
      {
        workspace_id: PRODUCT_ID,
        unipile_account_id: "account-linkedin",
        provider: "LINKEDIN",
      },
    ],
    product_tools: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        workspace_id: PRODUCT_ID,
        user_id: "user-1",
        tool_type: "unipile",
        updated_at: "2026-08-01T00:00:00Z",
        config: {
          dailyLimits: { "account-email": 40 },
          signatures: { "account-email": "Private signature text" },
          credentials: { password: "must-never-leak" },
        },
      },
    ],
    products: [{ id: PRODUCT_ID, organization_id: "org-1" }],
    subscriptions: [
      {
        organization_id: "org-1",
        plan_name: "team",
        status: "active",
        created_at: "2026-09-01T00:00:00Z",
      },
    ],
    billing_plan_catalog: [
      {
        plan_key: "team",
        managed_mailbox_slots: 10,
        connected_email_senders: 5,
        linkedin_senders: 2,
        instagram_senders: 1,
      },
    ],
    managed_sender_entitlements: [],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function controlPlane(fetchImpl: typeof fetch = vi.fn()) {
  return {
    workspaceId: PRODUCT_ID,
    authorizationServerUrl: "https://app.signalsurf.ai",
    accessToken: "ssmcp_at_test",
    fetchImpl,
  }
}

describe("hosted sender infrastructure", () => {
  it("keeps inventory product-scoped and strips credentials and signature text", async () => {
    const result = await inspectSenderInfrastructure(
      new FakeSupabase(seed()) as never,
      context
    )

    expect(result.domains.map((domain) => domain.domainName)).toEqual([
      "goacme.com",
    ])
    expect(result.mailboxes.map((mailbox) => mailbox.emailAddress)).toEqual([
      "hello@goacme.com",
    ])
    expect(result.senderSettings.signatureConfigured).toEqual({
      "account-email": true,
    })
    expect(JSON.stringify(result)).not.toContain("must-never-leak")
    expect(JSON.stringify(result)).not.toContain("Private signature text")
    expect(JSON.stringify(result)).not.toContain("internal-domain-provider")
    expect(JSON.stringify(result)).not.toContain("internal-mailbox-provider")
    expect(result.connectedAccounts[0]).not.toHaveProperty("provider")
  })

  it("merges shared sender settings deterministically while the current user wins", async () => {
    const data = seed()
    data.product_tools = [
      {
        id: "tool-newer-shared",
        workspace_id: PRODUCT_ID,
        user_id: "user-3",
        tool_type: "unipile",
        updated_at: "2026-08-03T00:00:00Z",
        config: { dailyLimits: { "account-email": 55 } },
      },
      {
        id: "tool-older-shared",
        workspace_id: PRODUCT_ID,
        user_id: "user-2",
        tool_type: "unipile",
        updated_at: "2026-08-02T00:00:00Z",
        config: { dailyLimits: { "account-email": 45 } },
      },
      {
        id: "tool-own",
        workspace_id: PRODUCT_ID,
        user_id: "user-1",
        tool_type: "unipile",
        updated_at: "2026-08-01T00:00:00Z",
        config: { dailyLimits: { "account-email": 35 } },
      },
    ]

    const result = await inspectSenderInfrastructure(
      new FakeSupabase(data) as never,
      context
    )

    expect(result.senderSettings.dailyLimits).toEqual({
      "account-email": 35,
    })
  })

  it("returns unavailable catalog facts instead of inventing plan slots", async () => {
    const data = seed()
    data.billing_plan_catalog = []

    const result = await inspectSenderInfrastructure(
      new FakeSupabase(data) as never,
      context
    )

    expect(result.entitlement.managedEmail.included).toBeNull()
    expect(result.entitlement.email.limit).toBeNull()
    expect(result.entitlement.email.remaining).toBeNull()
    expect(result.entitlement.connectedEmail.planLimit).toBeNull()
  })

  it("counts only grants that are active at the observation time", async () => {
    const data = seed()
    data.managed_sender_entitlements = [
      {
        workspace_id: PRODUCT_ID,
        kind: "sender_seat",
        quantity: 2,
        status: "active",
        starts_at: "2020-01-01T00:00:00Z",
        expires_at: "2999-01-01T00:00:00Z",
      },
      {
        workspace_id: PRODUCT_ID,
        kind: "sender_seat",
        quantity: 50,
        status: "active",
        starts_at: "2999-01-01T00:00:00Z",
        expires_at: null,
      },
      {
        workspace_id: PRODUCT_ID,
        kind: "sender_seat",
        quantity: 100,
        status: "active",
        starts_at: "2020-01-01T00:00:00Z",
        expires_at: "2021-01-01T00:00:00Z",
      },
    ]

    const result = await inspectSenderInfrastructure(
      new FakeSupabase(data) as never,
      context
    )

    expect(result.entitlement.additionalSenderSeats).toBe(2)
  })

  it("shows the transparent worst-case formula and editable mailbox/domain ratio", async () => {
    const db = new FakeSupabase(seed()) as never
    const defaultPlan = await planSenderCapacity(db, context, {
      recipients: 10_000,
      touchesPerRecipient: 3,
      sendingDays: 20,
    })
    const fivePerDomain = await planSenderCapacity(db, context, {
      recipients: 10_000,
      touchesPerRecipient: 3,
      sendingDays: 20,
      mailboxesPerDomain: 5,
    })

    expect(defaultPlan.formulas.plannedMessages).toBe("10000 × 3 = 30000")
    expect(defaultPlan.formulas.targetDailyMessages).toBe(
      "ceil(30000 ÷ 20) = 1500"
    )
    expect(defaultPlan.comparisons.meetTarget.requiredNewMailboxes).toBe(63)
    expect(defaultPlan.comparisons.meetTarget.requiredNewDomains).toBe(21)
    expect(defaultPlan.comparisons.meetTarget.additionalDomains).toBe(21)
    expect(fivePerDomain.comparisons.meetTarget.requiredNewDomains).toBe(13)
    expect(
      defaultPlan.comparisons.meetTarget.projectedInventoryAfterPurchase
        .mailboxes
    ).toBe(64)
    expect(defaultPlan.comparisons.useExisting.creditedDailyCapacity).toBe(0)
  })

  it("fails closed when live Domain availability is not configured", async () => {
    await expect(
      searchSenderDomains({ domains: ["goacme.com"] })
    ).rejects.toMatchObject({
      code: "DOMAIN_AVAILABILITY_UNAVAILABLE",
    })
  })

  it("returns availability without duplicating customer pricing authority", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sender_domain_search: true,
          infrastructureClass: "isolated",
          seed: "acme",
          requested: [
            {
              domain: "goacme.com",
              available: true,
              priceMinor: null,
              currency: null,
              purchasable: false,
              pending: false,
              warnings: [],
            },
          ],
          suggested: [],
          priceDefinition: "Availability only.",
          observedAt: "2026-09-01T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    const result = await searchSenderDomains(
      {
        domains: ["goacme.com"],
        infrastructureClass: "isolated",
      },
      controlPlane(fetchImpl)
    )

    expect(result.requested[0]).toMatchObject({
      domain: "goacme.com",
      available: true,
      priceMinor: null,
      currency: null,
      purchasable: false,
    })
    expect(result.priceDefinition).not.toMatch(/provider cost|1\.25|margin/i)
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.signalsurf.ai/api/mcp/sender-domains",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer ssmcp_at_test",
        }),
        body: JSON.stringify({
          workspaceId: PRODUCT_ID,
          domains: ["goacme.com"],
          count: 5,
          exclude: [],
          infrastructureClass: "isolated",
        }),
      })
    )
  })

  it("never treats an HTTP 202 availability response as final or purchasable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sender_domain_search: true,
          infrastructureClass: "standard",
          seed: null,
          requested: [
            {
              domain: "goacme.com",
              available: true,
              priceMinor: null,
              currency: null,
              purchasable: false,
              pending: false,
              warnings: [],
            },
          ],
          suggested: [],
          observedAt: "2026-09-01T00:00:00.000Z",
        }),
        { status: 202, headers: { "content-type": "application/json" } }
      )
    )

    const result = await searchSenderDomains(
      { domains: ["goacme.com"] },
      controlPlane(fetchImpl)
    )

    expect(result.requested[0]).toMatchObject({
      available: null,
      priceMinor: null,
      currency: null,
      purchasable: false,
      pending: true,
    })
  })

  it("sanitizes control-plane network failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("getaddrinfo ENOTFOUND private.internal"))

    await expect(
      searchSenderDomains({ domains: ["goacme.com"] }, controlPlane(fetchImpl))
    ).rejects.toMatchObject({
      code: "DOMAIN_AVAILABILITY_UNAVAILABLE",
      status: 503,
      message: "Live Domain availability could not be loaded.",
    })
  })

  it("sanitizes malformed control-plane responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("private upstream failure details", { status: 200 })
      )

    await expect(
      searchSenderDomains({ domains: ["goacme.com"] }, controlPlane(fetchImpl))
    ).rejects.toMatchObject({
      code: "DOMAIN_AVAILABILITY_UNAVAILABLE",
      status: 503,
      message: "Live Domain availability could not be loaded.",
    })
  })
})
