import { z } from "zod"

const DEFAULT_BASE_URL = "https://api.bycrawl.com"
const CREDIT_COST_PER_PAGE = 3
export const DEFAULT_INSTAGRAM_CONTENT_TIMEOUT_MS = 120_000

const inputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    pages: z.number().int().min(1).max(10).default(1).optional(),
  })
  .strict()

export type InstagramContentSearchPlan = {
  path: string
  credits: number
  input: { query: string; pages: number }
}

export function buildInstagramContentSearchPlan(
  rawInput: unknown
): InstagramContentSearchPlan {
  const parsed = inputSchema.parse(rawInput)
  const pages = parsed.pages ?? 1
  const params = new URLSearchParams({
    q: parsed.query,
    pages: String(pages),
    get_sentiment: "false",
  })
  return {
    path: `/instagram/posts/search?${params.toString()}`,
    credits: pages * CREDIT_COST_PER_PAGE,
    input: { query: parsed.query, pages },
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function normalizeInstagramContentSearch(raw: unknown) {
  const root = record(raw)
  if (!root) throw new Error("Instagram Content Search returned invalid data.")
  if (root.queued === true && !record(root.data)) {
    throw new Error("Instagram Content Search is still queued.")
  }
  const data = record(root.data) ?? root
  const rawPosts = Array.isArray(data.posts) ? data.posts : []
  const posts = rawPosts.flatMap((value) => {
    const post = record(value)
    const author = record(post?.author)
    const authorHandle = string(
      author?.username ?? post?.authorUsername
    )?.replace(/^@/, "")
    if (!post || !authorHandle) return []
    const shortcode = string(post.shortcode)
    const explicitUrl = string(post.url)
    return [
      {
        id: string(post.id) ?? shortcode,
        url:
          explicitUrl ??
          (shortcode ? `https://www.instagram.com/p/${shortcode}/` : null),
        caption: string(post.caption),
        publishedAt: string(
          post.createdAt ?? post.timestamp ?? post.publishedAt
        ),
        likeCount: number(post.likeCount ?? post.likes),
        commentCount: number(post.commentCount ?? post.comments),
        authorHandle,
        authorName: string(author?.fullName ?? post.authorName),
      },
    ]
  })
  const creatorByHandle = new Map<
    string,
    {
      name: string
      platform: "instagram"
      platformAccount: string
      profileUrl: string
      followers: null
    }
  >()
  for (const post of posts) {
    const key = post.authorHandle.toLowerCase()
    if (!creatorByHandle.has(key)) {
      creatorByHandle.set(key, {
        name: post.authorName ?? post.authorHandle,
        platform: "instagram",
        platformAccount: post.authorHandle,
        profileUrl: `https://www.instagram.com/${post.authorHandle}/`,
        followers: null,
      })
    }
  }
  return {
    coverage: "instagram_content" as const,
    pages: number(data.pages),
    count: number(data.count) ?? posts.length,
    posts,
    creators: [...creatorByHandle.values()],
  }
}

export class AmbiguousInstagramContentDispatchError extends Error {
  constructor(cause?: unknown) {
    super("Instagram Content Search outcome is still being reconciled.", {
      cause,
    })
    this.name = "AmbiguousInstagramContentDispatchError"
  }
}

export function isInstagramContentSearchDisabled(): boolean {
  return ["1", "true", "yes", "on"].includes(
    (process.env.BYCRAWL_DISABLED ?? "").trim().toLowerCase()
  )
}

export function instagramContentBaseUrl(): string {
  return (process.env.BYCRAWL_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

export async function dispatchInstagramContentSearch(
  plan: InstagramContentSearchPlan,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_INSTAGRAM_CONTENT_TIMEOUT_MS
): Promise<{ response: Response; raw: unknown }> {
  let response: Response
  try {
    response = await fetchImpl(`${instagramContentBaseUrl()}${plan.path}`, {
      headers: { Accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new AmbiguousInstagramContentDispatchError(error)
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    raw = null
  }
  return { response, raw }
}
