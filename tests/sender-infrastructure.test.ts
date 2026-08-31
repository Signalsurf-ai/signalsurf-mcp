import { afterEach, describe, expect, it, vi } from "vitest"

import {
  inspectSenderInfrastructure,
  planSenderCapacity,
  searchSenderDomains,
} from "../src/sender-infrastructure.js"
import { FakeSupabase } from "./fake-supabase.js"

const PRODUCT_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_PRODUCT_ID = "00000000-0000-4000-8000-000000000002"
const context = { productId: PRODUCT_ID, role: "viewer" as const }

function seed() {
  return {
    managed_email_domains: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        workspace_id: PRODUCT_ID,
        domain_name: "goacme.com",
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
        tool_type: "unipile",
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
  delete process.env.MAILFORGE_API_KEY
  delete process.env.MAILFORGE_API_BASE_URL
})

describe("hosted sender infrastructure", () => {
  it("keeps inventory product-scoped and strips credentials and signature text", async () => {
    const result = await inspectSenderInfrastructure(new FakeSupabase(seed()) as never, context)

    expect(result.domains.map((domain) => domain.domainName)).toEqual(["goacme.com"])
    expect(result.mailboxes.map((mailbox) => mailbox.emailAddress)).toEqual(["hello@goacme.com"])
    expect(result.senderSettings.signatureConfigured).toEqual({
      "account-email": true,
    })
    expect(JSON.stringify(result)).not.toContain("must-never-leak")
    expect(JSON.stringify(result)).not.toContain("Private signature text")
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
    expect(defaultPlan.formulas.targetDailyMessages).toBe("ceil(30000 ÷ 20) = 1500")
    expect(defaultPlan.comparisons.meetTarget.totalMailboxes).toBe(63)
    expect(defaultPlan.comparisons.meetTarget.totalDomains).toBe(21)
    expect(defaultPlan.comparisons.meetTarget.additionalDomains).toBe(21)
    expect(fivePerDomain.comparisons.meetTarget.totalDomains).toBe(13)
    expect(defaultPlan.comparisons.useExisting.creditedDailyCapacity).toBe(0)
  })

  it("fails closed when live Domain availability is not configured", async () => {
    await expect(searchSenderDomains({ domains: ["goacme.com"] })).rejects.toMatchObject({
      code: "DOMAIN_AVAILABILITY_UNAVAILABLE",
    })
  })

  it("parses live quotes and applies the exact annual retail formula", async () => {
    process.env.MAILFORGE_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                domain: "goacme.com",
                available: true,
                priceMinor: 1200,
                currency: "USD",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    )

    const result = await searchSenderDomains({ domains: ["goacme.com"] })

    expect(result.requested[0]).toMatchObject({
      domain: "goacme.com",
      priceMinor: 1700,
      currency: "USD",
      purchasable: true,
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://api.mailforge.ai/public/check-domain-availability-bulk",
      expect.objectContaining({ method: "POST" })
    )
  })
})
