import { describe, expect, it } from "vitest"
import { aggregatePopularValues } from "../src/popular-values.js"

describe("aggregatePopularValues", () => {
  const entries = [
    { data: { tags: ["ai", "saas"], name: "Acme" } },
    { data: { tags: ["ai", "fintech"], name: "Beta" } },
    { data: { tags: ["ai"], name: "Gamma" } },
    { data: { tags: "not-an-array", name: "Delta" } },
  ]

  it("counts string array values per field and sorts by count desc", () => {
    const result = aggregatePopularValues(entries, ["tags", "name"], 10)
    expect(result.tags).toEqual([
      { value: "ai", count: 3 },
      { value: "fintech", count: 1 },
      { value: "saas", count: 1 },
    ])
  })

  it("omits fields that never hold a string array", () => {
    const result = aggregatePopularValues(entries, ["tags", "name"], 10)
    expect(result.name).toBeUndefined()
  })

  it("caps results at topN", () => {
    const many = [{ data: { tags: ["a", "b", "c", "d"] } }]
    const result = aggregatePopularValues(many, ["tags"], 2)
    expect(result.tags).toHaveLength(2)
  })
})
