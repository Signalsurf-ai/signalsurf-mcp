import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AmbiguousInstagramContentDispatchError,
  buildInstagramContentSearchPlan,
  dispatchInstagramContentSearch,
  normalizeInstagramContentSearch,
} from "../src/instagram-content.js"

describe("Instagram Content Search provider contract", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("builds the bounded route and exact three-credits-per-page ceiling", () => {
    expect(
      buildInstagramContentSearchPlan({
        query: "KATSEYE fan fashion",
        pages: 2,
      })
    ).toEqual({
      path: "/instagram/posts/search?q=KATSEYE+fan+fashion&pages=2&get_sentiment=false",
      credits: 6,
      input: { query: "KATSEYE fan fashion", pages: 2 },
    })
  })

  it("keeps post evidence and deduplicates platform accounts", () => {
    const result = normalizeInstagramContentSearch({
      data: {
        posts: [
          {
            id: "p1",
            shortcode: "abc",
            caption: "KATSEYE inspired outfit",
            createdAt: "2026-07-20T10:00:00Z",
            likeCount: 42,
            commentCount: 3,
            author: { username: "fan.style", fullName: "Fan Style" },
          },
          {
            id: "p2",
            shortcode: "def",
            author: { username: "@fan.style", fullName: "Fan Style" },
          },
        ],
        pages: 1,
        count: 2,
      },
    })

    expect(result).toMatchObject({
      coverage: "instagram_content",
      pages: 1,
      count: 2,
    })
    expect(result.posts[0]).toMatchObject({
      url: "https://www.instagram.com/p/abc/",
      authorHandle: "fan.style",
    })
    expect(result.creators).toEqual([
      {
        name: "Fan Style",
        platform: "instagram",
        platformAccount: "fan.style",
        profileUrl: "https://www.instagram.com/fan.style/",
        followers: null,
      },
    ])
  })

  it("rejects an incomplete queue acknowledgement", () => {
    expect(() => normalizeInstagramContentSearch({ queued: true })).toThrow(
      /queued/i
    )
  })

  it("marks transport failures as ambiguous after dispatch starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("socket closed"))
    )

    await expect(
      dispatchInstagramContentSearch(
        buildInstagramContentSearchPlan({ query: "KATSEYE" }),
        "test-key"
      )
    ).rejects.toBeInstanceOf(AmbiguousInstagramContentDispatchError)
  })
})
