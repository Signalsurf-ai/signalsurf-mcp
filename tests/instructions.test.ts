import { describe, expect, it } from "vitest"
import { SERVER_INSTRUCTIONS } from "../src/server.js"

describe("SERVER_INSTRUCTIONS", () => {
  it("tells agents to resolve ids before id-typed params", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/get_context/)
    expect(SERVER_INSTRUCTIONS).toMatch(/list_tables/)
    expect(SERVER_INSTRUCTIONS).toMatch(/never pass.*null/i)
  })

  it("points at every guided prompt and the enrichment context tool", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/enrich_table/)
    expect(SERVER_INSTRUCTIONS).toMatch(/set_up_surf_point/)
    expect(SERVER_INSTRUCTIONS).toMatch(/build_lead_list/)
    expect(SERVER_INSTRUCTIONS).toMatch(/get_enrichment_context/)
  })
})
