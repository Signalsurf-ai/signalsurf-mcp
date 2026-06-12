import { afterEach, describe, expect, it, vi } from "vitest"

import { SignalSurfRepository } from "../src/repository.js"
import type { SignalSurfContext } from "../src/types.js"
import { FakeSupabase } from "./fake-supabase.js"

const context: SignalSurfContext = {
  productId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000010",
  role: "editor",
  tokenName: "test-agent",
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
    const repo = new SignalSurfRepository(dbWithKey() as never)
    const res = await repo.deeplineExecuteTool(context, {
      toolId: "hubspot_create_contact",
      payload: {
        email: "jane@acme.com",
        note: "",
        metadata: { nullable: null },
      },
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
  })

  it("execute_tool returns non-OK Deepline envelopes with the provider result", async () => {
    vi.stubEnv("DEEPLINE_DISABLED", "")
    stubFetch({
      status: "failed",
      toolResponse: { raw: { error: "provider rejected payload" } },
    })
    const repo = new SignalSurfRepository(dbWithKey() as never)
    await expect(
      repo.deeplineExecuteTool(context, {
        toolId: "hubspot_create_contact",
        payload: { email: "bad" },
      })
    ).resolves.toMatchObject({
      toolId: "hubspot_create_contact",
      ok: false,
      status: "failed",
      result: { error: "provider rejected payload" },
    })
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
