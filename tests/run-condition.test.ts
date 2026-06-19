import { describe, expect, it } from "vitest"

import {
  evaluateRunCondition,
  parseRunCondition,
  runConditionNeedsValue,
  type RunCondition,
} from "../src/run-condition.js"

const row = (data: Record<string, unknown>) => data

describe("evaluateRunCondition", () => {
  it("opens the gate when the condition is missing or has no column", () => {
    expect(evaluateRunCondition(null, { a: 1 })).toBe(true)
    expect(evaluateRunCondition(undefined, { a: 1 })).toBe(true)
    expect(
      evaluateRunCondition({ column: "", predicate: "has_value" }, { a: 1 })
    ).toBe(true)
  })

  it("supports presence predicates", () => {
    const hasValue: RunCondition = {
      column: "industry",
      predicate: "has_value",
    }
    expect(evaluateRunCondition(hasValue, row({ industry: "SaaS" }))).toBe(
      true
    )
    expect(evaluateRunCondition(hasValue, row({ industry: "" }))).toBe(false)
    expect(evaluateRunCondition(hasValue, row({ industry: null }))).toBe(false)
    expect(evaluateRunCondition(hasValue, row({ industry: [] }))).toBe(false)
    expect(evaluateRunCondition(hasValue, row({}))).toBe(false)

    const isEmpty: RunCondition = { column: "industry", predicate: "is_empty" }
    expect(evaluateRunCondition(isEmpty, row({ industry: "SaaS" }))).toBe(
      false
    )
    expect(evaluateRunCondition(isEmpty, row({ industry: "" }))).toBe(true)
    expect(evaluateRunCondition(isEmpty, row({}))).toBe(true)
  })

  it("supports string, numeric, and array equality", () => {
    expect(
      evaluateRunCondition(
        { column: "industry", predicate: "equals", value: "saas" },
        row({ industry: " SaaS " })
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "employees", predicate: "equals", value: 50 },
        row({ employees: "50" })
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "tags", predicate: "equals", value: "b2b" },
        row({ tags: ["B2B", "SaaS"] })
      )
    ).toBe(true)
  })

  it("supports not_equals while failing closed on missing comparison values", () => {
    expect(
      evaluateRunCondition(
        { column: "industry", predicate: "not_equals", value: "SaaS" },
        row({ industry: "Fintech" })
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "industry", predicate: "not_equals", value: "SaaS" },
        row({ industry: "SaaS" })
      )
    ).toBe(false)
    expect(
      evaluateRunCondition(
        { column: "industry", predicate: "not_equals" },
        row({ industry: "SaaS" })
      )
    ).toBe(false)
  })

  it("supports contains for strings and arrays", () => {
    expect(
      evaluateRunCondition(
        { column: "title", predicate: "contains", value: "engineer" },
        row({ title: "Senior Backend Engineer" })
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "tags", predicate: "contains", value: "saas" },
        row({ tags: ["SaaS", "B2B"] })
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "title", predicate: "contains", value: "" },
        row({ title: "Engineer" })
      )
    ).toBe(false)
  })

  it("supports numeric comparisons and rejects non-numeric comparisons", () => {
    const data = row({ employees: "50" })
    expect(
      evaluateRunCondition(
        { column: "employees", predicate: "gt", value: 49 },
        data
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "employees", predicate: "gte", value: 50 },
        data
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "employees", predicate: "lt", value: 51 },
        data
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "employees", predicate: "lte", value: 50 },
        data
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "employees", predicate: "gt", value: 50 },
        data
      )
    ).toBe(false)
    expect(
      evaluateRunCondition(
        { column: "employees", predicate: "gt", value: 10 },
        row({ employees: "many" })
      )
    ).toBe(false)
  })

  it("supports in for scalar and array cells", () => {
    expect(
      evaluateRunCondition(
        { column: "industry", predicate: "in", value: ["SaaS", "Fintech"] },
        row({ industry: "fintech" })
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "industry", predicate: "in", value: "SaaS" },
        row({ industry: "SaaS" })
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "tags", predicate: "in", value: ["b2b", "edu"] },
        row({ tags: ["B2B"] })
      )
    ).toBe(true)
    expect(
      evaluateRunCondition(
        { column: "industry", predicate: "in", value: [] },
        row({ industry: "SaaS" })
      )
    ).toBe(false)
  })

  it("fails open on unknown predicates from newer clients", () => {
    expect(
      evaluateRunCondition(
        { column: "x", predicate: "regex" as never },
        row({ x: "y" })
      )
    ).toBe(true)
  })
})

describe("runConditionNeedsValue", () => {
  it("is true for comparison predicates and false for presence predicates", () => {
    expect(runConditionNeedsValue("has_value")).toBe(false)
    expect(runConditionNeedsValue("is_empty")).toBe(false)
    expect(runConditionNeedsValue("equals")).toBe(true)
    expect(runConditionNeedsValue("gt")).toBe(true)
    expect(runConditionNeedsValue("in")).toBe(true)
  })
})

describe("parseRunCondition", () => {
  it("parses valid condition blobs", () => {
    expect(
      parseRunCondition({
        column: "industry",
        predicate: "equals",
        value: "SaaS",
      })
    ).toEqual({ column: "industry", predicate: "equals", value: "SaaS" })
    expect(
      parseRunCondition({ column: "email", predicate: "has_value" })
    ).toEqual({ column: "email", predicate: "has_value", value: null })
  })

  it("returns null for malformed input", () => {
    expect(parseRunCondition(null)).toBeNull()
    expect(parseRunCondition({ predicate: "equals" })).toBeNull()
    expect(parseRunCondition({ column: "x", predicate: "nope" })).toBeNull()
    expect(
      parseRunCondition({ column: "  ", predicate: "has_value" })
    ).toBeNull()
  })
})
