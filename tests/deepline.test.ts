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
  role: "editor",
  tokenName: "test-agent",
}

const oauthContext: SignalSurfContext = {
  ...context,
  authKind: "oauth",
  oauthTokenId: "00000000-0000-4000-8000-000000000099",
  oauthGrantId: "00000000-0000-4000-8000-000000000088",
  oauthClientId: "ssmcp_client_test",
}

function dbWithKey(apiKey = "dl_test") {
  return new FakeSupabase({
    integration_accounts: [
      {
        product_id: context.productId,
        integration_type: "deepline",
        credentials: { api_key: apiKey },
      },
    ],
  })
}

function approvalRow(
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "00000000-0000-4000-8000-000000000777",
    oauth_token_id: oauthContext.oauthTokenId,
    oauth_grant_id: oauthContext.oauthGrantId,
    user_id: oauthContext.userId,
    client_id: oauthContext.oauthClientId,
    product_id: oauthContext.productId,
    tool_name: "deepline_execute_tool",
    provider_tool_id: "hubspot_create_contact",
    payload_sha256: mcpActionPayloadSha256(payload),
    status: "approved",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const mock = vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
  vi.stubGlobal("fetch", mock)
  return mock
}

describe("Deepline capabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("enrich_contact sends leadmagic's accepted fields and returns the email", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const fetchMock = stubFetch({
      status: "completed",
      toolResponse: { raw: { email: "jane@acme.com", status: "valid" } },
    })
    const repo = new SignalSurfRepository(dbWithKey() as never)
    const res = await repo.deeplineEnrichContact(context, {
      firstName: "Jane",
      lastName: "Doe",
      domain: "acme.com",
    })
    expect(res.email).toBe("jane@acme.com")
    const call = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]
    const [url, reqInit] = call as [string, { body: string; headers: Record<string, string> }]
    expect(String(url)).toContain("/api/v2/integrations/")
    expect(JSON.parse(reqInit.body).payload).toEqual({
      first_name: "Jane",
      last_name: "Doe",
      domain: "acme.com",
    })
    expect(reqInit.headers.Authorization).toBe("Bearer dl_test")
  })

  it("search_people passes the filters + per_page through to Apollo", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const fetchMock = stubFetch({
      status: "completed",
      toolResponse: { raw: { total_entries: 5, people: [] } },
    })
    const repo = new SignalSurfRepository(dbWithKey() as never)
    const res = await repo.deeplineSearchPeople(context, {
      filters: { person_titles: ["VP of Sales"] },
      limit: 3,
    })
    expect((res.result as { total_entries: number }).total_entries).toBe(5)
    const call = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]
    const reqInit = (call as [string, { body: string }])[1]
    expect(JSON.parse(reqInit.body).payload).toEqual({
      person_titles: ["VP of Sales"],
      per_page: 3,
    })
  })

  it("search_catalog filters Deepline's live tool catalog", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const fetchMock = stubFetch({
      tools: [
        {
          toolId: "hubspot_create_contact",
          provider: "hubspot",
          displayName: "HubSpot Create Contact",
          bestFor: "Create a CRM contact",
        },
        {
          toolId: "apollo_search_people",
          provider: "apollo",
          displayName: "Apollo People Search",
          bestFor: "Find prospects",
        },
      ],
    })
    const repo = new SignalSurfRepository(dbWithKey() as never)
    const res = await repo.deeplineSearchCatalog(context, {
      query: "hubspot",
      limit: 5,
    })
    expect(res).toEqual({
      tools: [
        {
          toolId: "hubspot_create_contact",
          provider: "hubspot",
          displayName: "HubSpot Create Contact",
          bestFor: "Create a CRM contact",
        },
      ],
      count: 1,
    })
    const [url, reqInit] = (
      fetchMock as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0] as [string, { method: string; headers: Record<string, string> }]
    expect(String(url)).toContain("/api/v2/tools")
    expect(reqInit.method).toBe("GET")
    expect(reqInit.headers.Authorization).toBe("Bearer dl_test")
  })

  it("execute_tool preserves arbitrary payloads and reports credits", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const fetchMock = stubFetch({
      status: "completed",
      toolResponse: {
        raw: {
          id: "contact_123",
          ok: true,
          credits_consumed: 2,
        },
      },
    })
    const payload = {
      email: "jane@acme.com",
      note: "",
      metadata: { nullable: null },
    }
    const db = new FakeSupabase({
      integration_accounts: dbWithKey().tables.integration_accounts,
      mcp_action_approvals: [approvalRow(payload)],
    })
    const repo = new SignalSurfRepository(db as never)
    const res = await repo.deeplineExecuteTool(oauthContext, {
      toolId: "hubspot_create_contact",
      approvalRequestId: "00000000-0000-4000-8000-000000000777",
      payload,
    })
    expect(res).toMatchObject({
      toolId: "hubspot_create_contact",
      ok: true,
      status: "completed",
      credits_consumed: 2,
      result: { id: "contact_123", ok: true },
    })
    const call = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]
    const [url, reqInit] = call as [string, { body: string }]
    expect(String(url)).toContain(
      "/api/v2/integrations/hubspot_create_contact/execute"
    )
    expect(JSON.parse(reqInit.body).payload).toEqual({
      email: "jane@acme.com",
      note: "",
      metadata: { nullable: null },
    })
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      status: "executed",
      execution_started_at: expect.any(String),
      executed_at: expect.any(String),
      error: null,
    })
  })

  it("execute_tool preserves an approval across access-token rotation in the same grant", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const fetchMock = stubFetch({
      status: "completed",
      toolResponse: { raw: { id: "contact_123", ok: true } },
    })
    const payload = { email: "jane@acme.com" }
    const db = new FakeSupabase({
      integration_accounts: dbWithKey().tables.integration_accounts,
      mcp_action_approvals: [
        approvalRow(payload, {
          oauth_token_id: "00000000-0000-4000-8000-000000000077",
        }),
      ],
    })
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.deeplineExecuteTool(oauthContext, {
        toolId: "hubspot_create_contact",
        approvalRequestId: "00000000-0000-4000-8000-000000000777",
        payload,
      })
    ).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(db.tables.mcp_action_approvals[0].status).toBe("executed")
  })

  it("execute_tool creates a redacted pending request when approvalRequestId is missing", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    vi.stubEnv(
      "SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL",
      "https://www.signalsurf.ai"
    )
    const noop = vi.fn()
    vi.stubGlobal("fetch", noop)
    const db = dbWithKey()
    const repo = new SignalSurfRepository(db as never)

    let firstError: unknown
    try {
      await repo.deeplineExecuteTool(oauthContext, {
        toolId: "hubspot_create_contact",
        payload: { email: "jane@acme.com" },
      })
    } catch (error) {
      firstError = error
    }
    expect(firstError).toMatchObject({
      code: "APPROVAL_REQUIRED",
      details: {
        requestId: expect.any(String),
        approvalUrl: expect.stringMatching(
          /^https:\/\/www\.signalsurf\.ai\/approvals\?mcpAction=/
        ),
        status: "pending",
        expiresAt: expect.any(String),
      },
    })
    expect(db.tables.mcp_action_approvals).toHaveLength(1)
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      oauth_token_id: oauthContext.oauthTokenId,
      oauth_grant_id: oauthContext.oauthGrantId,
      user_id: oauthContext.userId,
      client_id: oauthContext.oauthClientId,
      product_id: oauthContext.productId,
      tool_name: "deepline_execute_tool",
      provider_tool_id: "hubspot_create_contact",
      payload_sha256: mcpActionPayloadSha256({ email: "jane@acme.com" }),
      status: "pending",
      preview: {
        payload: {
          keys: ["email"],
          fieldCount: 1,
          byteLength: expect.any(Number),
        },
      },
    })
    expect(JSON.stringify(db.tables.mcp_action_approvals[0].preview)).not.toContain(
      "jane@acme.com"
    )

    let secondError: unknown
    try {
      await repo.deeplineExecuteTool(oauthContext, {
        toolId: "hubspot_create_contact",
        payload: { email: "jane@acme.com" },
      })
    } catch (error) {
      secondError = error
    }
    expect(secondError).toMatchObject({
      code: "APPROVAL_REQUIRED",
      details: {
        requestId: db.tables.mcp_action_approvals[0].id,
      },
    })
    expect(db.tables.mcp_action_approvals).toHaveLength(1)
    expect(noop).not.toHaveBeenCalled()
  })

  it("returns the pending request id with a null URL when the Web base URL is not configured", async () => {
    vi.stubEnv("SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL", "")
    const noop = vi.fn()
    vi.stubGlobal("fetch", noop)
    const db = dbWithKey()
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.deeplineExecuteTool(oauthContext, {
        toolId: "hubspot_create_contact",
        payload: { email: "jane@acme.com" },
      })
    ).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED",
      details: {
        requestId: expect.any(String),
        approvalUrl: null,
      },
    })
    expect(db.tables.mcp_action_approvals).toHaveLength(1)
    expect(noop).not.toHaveBeenCalled()
  })

  it("expires an old pending request before creating its replacement", async () => {
    const noop = vi.fn()
    vi.stubGlobal("fetch", noop)
    const payload = { email: "jane@acme.com" }
    const db = new FakeSupabase({
      integration_accounts: dbWithKey().tables.integration_accounts,
      mcp_action_approvals: [
        approvalRow(payload, {
          status: "pending",
          expires_at: "2020-01-01T00:00:00.000Z",
          created_at: "2020-01-01T00:00:00.000Z",
        }),
      ],
    })
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.deeplineExecuteTool(oauthContext, {
        toolId: "hubspot_create_contact",
        payload,
      })
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" })
    expect(db.tables.mcp_action_approvals).toHaveLength(2)
    expect(db.tables.mcp_action_approvals.map((row) => row.status).sort()).toEqual([
      "expired",
      "pending",
    ])
    expect(noop).not.toHaveBeenCalled()
  })

  it("execute_tool rejects pending, mismatched, expired, or replayed approvals before the provider call", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const noop = vi.fn()
    vi.stubGlobal("fetch", noop)
    const payload = { email: "different@acme.com" }
    const cases = [
      approvalRow(payload, { status: "pending" }),
      approvalRow(payload, {
        oauth_grant_id: "00000000-0000-4000-8000-000000000098",
      }),
      approvalRow(payload, { expires_at: "2020-01-01T00:00:00.000Z" }),
      approvalRow(payload, { status: "executed" }),
      approvalRow({ email: "approved@acme.com" }),
    ]

    for (const approval of cases) {
      const db = new FakeSupabase({
        integration_accounts: dbWithKey().tables.integration_accounts,
        mcp_action_approvals: [approval],
      })
      const repo = new SignalSurfRepository(db as never)
      const originalStatus = approval.status

      await expect(
        repo.deeplineExecuteTool(oauthContext, {
          toolId: "hubspot_create_contact",
          approvalRequestId: "00000000-0000-4000-8000-000000000777",
          payload,
        })
      ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" })
      expect(db.tables.mcp_action_approvals[0].status).toBe(originalStatus)
    }
    expect(noop).not.toHaveBeenCalled()
  })

  it("execute_tool rejects non-OAuth credentials even when an approval id is supplied", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const noop = vi.fn()
    vi.stubGlobal("fetch", noop)
    const db = dbWithKey()
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.deeplineExecuteTool(context, {
        toolId: "hubspot_create_contact",
        approvalRequestId: "00000000-0000-4000-8000-000000000777",
        payload: { email: "jane@acme.com" },
      })
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" })
    expect(db.rpcCalls).toHaveLength(0)
    expect(noop).not.toHaveBeenCalled()
  })

  it("execute_tool returns non-OK Deepline envelopes with the provider result", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    stubFetch({
      status: "failed",
      toolResponse: { raw: { error: "provider rejected payload" } },
    })
    const payload = { email: "bad" }
    const db = new FakeSupabase({
      integration_accounts: dbWithKey().tables.integration_accounts,
      mcp_action_approvals: [approvalRow(payload)],
    })
    const repo = new SignalSurfRepository(db as never)
    await expect(
      repo.deeplineExecuteTool(oauthContext, {
        toolId: "hubspot_create_contact",
        approvalRequestId: "00000000-0000-4000-8000-000000000777",
        payload,
      })
    ).resolves.toMatchObject({
      toolId: "hubspot_create_contact",
      ok: false,
      status: "failed",
      result: { error: "provider rejected payload" },
    })
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      status: "failed",
      error: "Deepline returned status failed",
    })
  })

  it("marks unknown provider outcomes ambiguous and never makes the approval replayable", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const fetchMock = vi.fn(async () => {
      throw new Error("socket closed after dispatch")
    })
    vi.stubGlobal("fetch", fetchMock)
    const payload = { email: "jane@acme.com" }
    const db = new FakeSupabase({
      integration_accounts: dbWithKey().tables.integration_accounts,
      mcp_action_approvals: [approvalRow(payload)],
    })
    const repo = new SignalSurfRepository(db as never)

    await expect(
      repo.deeplineExecuteTool(oauthContext, {
        toolId: "hubspot_create_contact",
        approvalRequestId: "00000000-0000-4000-8000-000000000777",
        payload,
      })
    ).rejects.toMatchObject({ code: "EXTERNAL_ACTION_AMBIGUOUS" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(db.tables.mcp_action_approvals[0]).toMatchObject({
      status: "ambiguous",
      error: "socket closed after dispatch",
    })

    await expect(
      repo.deeplineExecuteTool(oauthContext, {
        toolId: "hubspot_create_contact",
        approvalRequestId: "00000000-0000-4000-8000-000000000777",
        payload,
      })
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("allows only one concurrent caller to claim an approved action", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const fetchMock = stubFetch({
      status: "completed",
      toolResponse: { raw: { id: "contact_123" } },
    })
    const payload = { email: "jane@acme.com" }
    const db = new FakeSupabase({
      integration_accounts: dbWithKey().tables.integration_accounts,
      mcp_action_approvals: [approvalRow(payload)],
    })
    const repo = new SignalSurfRepository(db as never)
    const execute = () =>
      repo.deeplineExecuteTool(oauthContext, {
        toolId: "hubspot_create_contact",
        approvalRequestId: "00000000-0000-4000-8000-000000000777",
        payload,
      })

    const results = await Promise.allSettled([execute(), execute()])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1
    )
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(db.tables.mcp_action_approvals[0].status).toBe("executed")
  })

  it("fails clearly when Deepline is not connected for the product", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    vi.stubEnv("DEEPLINE_API_KEY", "")
    const repo = new SignalSurfRepository(
      new FakeSupabase({ integration_accounts: [] }) as never
    )
    await expect(
      repo.deeplineEnrichContact(context, {
        firstName: "A",
        lastName: "B",
        domain: "b.com",
      })
    ).rejects.toThrow(/not connected/i)
  })

  it("is hard-disabled by the DEEPLINE_DISABLED kill-switch (no network)", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "1")
    const noop = vi.fn()
    vi.stubGlobal("fetch", noop)
    const repo = new SignalSurfRepository(dbWithKey() as never)
    await expect(
      repo.deeplineSearchCompanies(context, { filters: {} })
    ).rejects.toThrow(/disabled/i)
    expect(noop).not.toHaveBeenCalled()
  })

  it("enrich requires a domain or companyName (no wasted paid call)", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    const noop = vi.fn()
    vi.stubGlobal("fetch", noop)
    const repo = new SignalSurfRepository(dbWithKey() as never)
    await expect(
      repo.deeplineEnrichContact(context, { firstName: "A", lastName: "B" })
    ).rejects.toThrow(/domain or companyName/i)
    expect(noop).not.toHaveBeenCalled()
  })
})
