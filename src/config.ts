import { z } from "zod"

import type { AccessRole, SignalSurfContext } from "./types.js"
import { UserFacingError } from "./errors.js"

const roleSchema = z.enum(["viewer", "editor", "owner"]).default("viewer")

const tokenEntrySchema = z
  .object({
    name: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    tokenSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    productId: z.string().uuid(),
    userId: z.string().uuid().optional(),
    role: roleSchema,
  })
  .refine((entry) => !!entry.token || !!entry.tokenSha256, {
    message: "Each token entry needs token or tokenSha256",
  })

export type TokenEntry = z.infer<typeof tokenEntrySchema>

export type AppConfig = {
  supabaseUrl: string
  supabaseServiceRoleKey: string
  transport: "stdio" | "http"
  authMode: "env" | "database"
  trustProxy: boolean
  host: string
  port: number
  path: string
  resourceUrl: string
  authorizationServerUrl?: string
  allowedHosts: string[]
  authDisabled: boolean
  stdioToken?: string
  directContext?: SignalSurfContext
  tokenEntries: TokenEntry[]
}

function readBool(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase())
}

function parseTokens(raw: string | undefined): TokenEntry[] {
  if (!raw?.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new UserFacingError(
      `SIGNALSURF_MCP_TOKENS must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { code: "CONFIG_ERROR", status: 500 }
    )
  }
  const arraySchema = z.array(tokenEntrySchema)
  const result = arraySchema.safeParse(parsed)
  if (!result.success) {
    throw new UserFacingError(result.error.message, {
      code: "CONFIG_ERROR",
      status: 500,
    })
  }
  return result.data
}

function parseAllowedHosts(raw: string | undefined, host: string): string[] {
  if (raw?.trim()) {
    return [
      ...new Set(
        raw
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      ),
    ]
  }

  const normalizedHost = host.toLowerCase()
  if (
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "localhost" ||
    normalizedHost === "::1" ||
    normalizedHost === "[::1]"
  ) {
    return ["127.0.0.1", "localhost", "::1"]
  }
  if (
    normalizedHost === "0.0.0.0" ||
    normalizedHost === "::" ||
    normalizedHost === "[::]"
  ) {
    return ["127.0.0.1", "localhost", "::1"]
  }
  return [normalizedHost]
}

function normalizeUrl(
  value: string | undefined,
  envName: string
): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value)
    url.hash = ""
    url.search = ""
    return url.toString().replace(/\/+$/, "")
  } catch (error) {
    throw new UserFacingError(
      `${envName} must be an absolute URL: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { code: "CONFIG_ERROR", status: 500 }
    )
  }
}

function buildDirectContext(
  env: NodeJS.ProcessEnv
): SignalSurfContext | undefined {
  const productId = env.SIGNALSURF_MCP_PRODUCT_ID
  if (!productId) return undefined

  const parsed = z
    .object({
      productId: z.string().uuid(),
      userId: z.string().uuid().optional(),
      role: roleSchema.default("editor"),
      tokenName: z.string().optional(),
    })
    .safeParse({
      productId,
      userId: env.SIGNALSURF_MCP_USER_ID || undefined,
      role: env.SIGNALSURF_MCP_ROLE || "editor",
      tokenName: "direct-env",
    })

  if (!parsed.success) {
    throw new UserFacingError(parsed.error.message, {
      code: "CONFIG_ERROR",
      status: 500,
    })
  }
  return parsed.data
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const supabaseUrl =
    env.SIGNALSURF_SUPABASE_URL ??
    env.SUPABASE_URL ??
    env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey =
    env.SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new UserFacingError(
      "Missing SIGNALSURF_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL",
      { code: "CONFIG_ERROR", status: 500 }
    )
  }
  if (!supabaseServiceRoleKey) {
    throw new UserFacingError(
      "Missing SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY",
      { code: "CONFIG_ERROR", status: 500 }
    )
  }

  const transportResult = z
    .enum(["stdio", "http"])
    .safeParse((env.SIGNALSURF_MCP_TRANSPORT ?? "stdio").toLowerCase())
  if (!transportResult.success) {
    throw new UserFacingError(
      "SIGNALSURF_MCP_TRANSPORT must be either stdio or http",
      { code: "CONFIG_ERROR", status: 500 }
    )
  }
  const authModeResult = z
    .enum(["env", "database"])
    .safeParse((env.SIGNALSURF_MCP_AUTH_MODE ?? "env").toLowerCase())
  if (!authModeResult.success) {
    throw new UserFacingError(
      "SIGNALSURF_MCP_AUTH_MODE must be either env or database",
      { code: "CONFIG_ERROR", status: 500 }
    )
  }
  const platformPort = env.PORT?.trim() || undefined
  const configuredPort = env.SIGNALSURF_MCP_PORT?.trim() || undefined
  const portResult = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .safeParse(platformPort ?? configuredPort ?? "3333")
  if (!portResult.success) {
    throw new UserFacingError(
      "PORT or SIGNALSURF_MCP_PORT must be a valid TCP port",
      {
        code: "CONFIG_ERROR",
        status: 500,
      }
    )
  }

  const host =
    env.SIGNALSURF_MCP_HOST ?? (platformPort ? "0.0.0.0" : "127.0.0.1")
  const path = env.SIGNALSURF_MCP_PATH ?? "/mcp"
  const defaultResourceUrl = `http://${host}:${portResult.data}${path}`
  const configuredResourceUrl = normalizeUrl(
    env.SIGNALSURF_MCP_RESOURCE_URL,
    "SIGNALSURF_MCP_RESOURCE_URL"
  )
  const configuredAuthorizationServerUrl = normalizeUrl(
    env.SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL,
    "SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL"
  )
  const hasExplicitAllowedHosts = Boolean(
    env.SIGNALSURF_MCP_ALLOWED_HOSTS?.trim()
  )

  const config = {
    supabaseUrl,
    supabaseServiceRoleKey,
    transport: transportResult.data,
    authMode: authModeResult.data,
    trustProxy: readBool(env.SIGNALSURF_MCP_TRUST_PROXY),
    host,
    port: portResult.data,
    path,
    resourceUrl: configuredResourceUrl ?? defaultResourceUrl,
    authorizationServerUrl: configuredAuthorizationServerUrl,
    allowedHosts: parseAllowedHosts(env.SIGNALSURF_MCP_ALLOWED_HOSTS, host),
    authDisabled: readBool(env.SIGNALSURF_MCP_AUTH_DISABLED),
    stdioToken: env.SIGNALSURF_MCP_TOKEN,
    directContext: buildDirectContext(env),
    tokenEntries: parseTokens(env.SIGNALSURF_MCP_TOKENS),
  }

  if (config.transport === "http" && config.authDisabled) {
    throw new UserFacingError(
      "SIGNALSURF_MCP_AUTH_DISABLED is only allowed for stdio transport.",
      { code: "CONFIG_ERROR", status: 500 }
    )
  }
  if (config.transport === "stdio" && config.authMode === "database") {
    throw new UserFacingError(
      "SIGNALSURF_MCP_AUTH_MODE=database is only supported for HTTP transport.",
      { code: "CONFIG_ERROR", status: 500 }
    )
  }
  if (config.authMode === "database") {
    if (!configuredResourceUrl) {
      throw new UserFacingError(
        "SIGNALSURF_MCP_RESOURCE_URL is required when SIGNALSURF_MCP_AUTH_MODE=database.",
        { code: "CONFIG_ERROR", status: 500 }
      )
    }
    if (!configuredAuthorizationServerUrl) {
      throw new UserFacingError(
        "SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL is required when SIGNALSURF_MCP_AUTH_MODE=database.",
        { code: "CONFIG_ERROR", status: 500 }
      )
    }
    if (!hasExplicitAllowedHosts) {
      throw new UserFacingError(
        "SIGNALSURF_MCP_ALLOWED_HOSTS is required when SIGNALSURF_MCP_AUTH_MODE=database.",
        { code: "CONFIG_ERROR", status: 500 }
      )
    }
  }

  return config
}

export function assertValidRole(role: AccessRole): AccessRole {
  return roleSchema.parse(role)
}
