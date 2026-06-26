import { describe, expect, it, vi } from "vitest"
import { SignalSurfRepository } from "../src/repository.js"

function makeRepo() {
  const repo = Object.create(
    SignalSurfRepository.prototype
  ) as SignalSurfRepository
  ;(repo as any).getDatabaseAndValidateProduct = vi.fn(async () => ({
    id: "db-1",
    schema: {
      fields: [
        { key: "tags", type: "multi_select" },
        { key: "name", type: "text" },
      ],
      relations: [{ source: "db-1", type: "works_at", target: "db-2" }],
    },
  }))
  ;(repo as any).getBrandContext = vi.fn(async () => ({
    brandContext: { brandName: "Acme" },
  }))
  ;(repo as any).db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({
              data: [
                { data: { tags: ["ai", "saas"] } },
                { data: { tags: ["ai"] } },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
  }
  return repo
}

const ctx = { productId: "p1", role: "viewer" } as any

describe("getEnrichmentContext", () => {
  it("bundles brand, schema, relations, conventions, and popular values", async () => {
    const repo = makeRepo()
    const result = await repo.getEnrichmentContext(ctx, { databaseId: "db-1" })
    expect(result.databaseId).toBe("db-1")
    expect(result.brand).toEqual({ brandName: "Acme" })
    expect(result.table.fields).toHaveLength(2)
    expect(result.relations).toEqual([
      { source: "db-1", type: "works_at", target: "db-2" },
    ])
    expect(result.conventions).toContain("Field conventions")
    expect(result.popularValues.tags[0]).toEqual({ value: "ai", count: 2 })
  })

  it("throws 400 listing valid field keys when fieldKey is unknown", async () => {
    const repo = makeRepo()
    await expect(
      repo.getEnrichmentContext(ctx, { databaseId: "db-1", fieldKey: "ghost" })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      repo.getEnrichmentContext(ctx, { databaseId: "db-1", fieldKey: "ghost" })
    ).rejects.toThrow(/tags/)
  })
})
