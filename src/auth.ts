import { createHash, timingSafeEqual } from "node:crypto"

import type { AppConfig, TokenEntry } from "./config.js"
import {
  type McpCapability,
  grantedCapabilitiesForScopes,
  requiredScopesForCapability,
  scopesGrantCapability,
} from "./capabilities.js"
import type { AccessRole, SignalSurfContext } from "./types.js"
import { UserFacingError } from "./errors.js"

const roleRank: Record<AccessRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}

function matchesToken(entry: TokenEntry, token: string): boolean {
  const incomingHash = sha256Hex(token)
  if (entry.tokenSha256 && safeEqualHex(entry.tokenSha256, incomingHash)) {
    return true
  }
  if (entry.token) {
    return safeEqualHex(sha256Hex(entry.token), incomingHash)
  }
  return false
}

function contextFromTokenEntry(entry: TokenEntry): SignalSurfContext {
  return {
    productId: entry.productId,
    userId: entry.userId,
    role: entry.role,
    tokenName: entry.name,
    scopes: entry.scopes,
  }
}

export type DatabaseTokenResolver = {
  resolveMcpToken: (
    token: string,
    metadata?: { ip?: string | null; resource?: string | null }
  ) => Promise<SignalSurfContext | null>
}

export function resolveTokenContext(
  config: Pick<AppConfig, "authDisabled" | "directContext" | "tokenEntries">,
  token: string | undefined
): SignalSurfContext {
  if (config.authDisabled) {
    if (!config.directContext) {
      throw new UserFacingError(
        "SIGNALSURF_MCP_AUTH_DISABLED requires SIGNALSURF_MCP_PRODUCT_ID",
        { code: "CONFIG_ERROR", status: 500 }
      )
    }
    return config.directContext
  }

  if (!token) {
    throw new UserFacingError("Missing MCP bearer token", {
      code: "UNAUTHORIZED",
      status: 401,
    })
  }

  const entry = config.tokenEntries.find((candidate) =>
    matchesToken(candidate, token)
  )
  if (!entry) {
    throw new UserFacingError("Invalid MCP bearer token", {
      code: "UNAUTHORIZED",
      status: 401,
    })
  }
  return contextFromTokenEntry(entry)
}

export async function resolveHttpTokenContext(
  config: Pick<
    AppConfig,
    "authDisabled" | "directContext" | "tokenEntries" | "authMode"
  >,
  token: string | undefined,
  databaseResolver: DatabaseTokenResolver,
  metadata?: { ip?: string | null; resource?: string | null }
): Promise<SignalSurfContext> {
  if (config.authMode !== "database") {
    return resolveTokenContext(config, token)
  }

  if (config.authDisabled) {
    return resolveTokenContext(config, token)
  }

  if (!token) {
    throw new UserFacingError("Missing MCP bearer token", {
      code: "UNAUTHORIZED",
      status: 401,
    })
  }

  const context = await databaseResolver.resolveMcpToken(token, metadata)
  if (!context) {
    throw new UserFacingError("Invalid MCP bearer token", {
      code: "UNAUTHORIZED",
      status: 401,
    })
  }
  return context
}

export function resolveStdioContext(config: AppConfig): SignalSurfContext {
  if (config.stdioToken || !config.directContext || config.authDisabled) {
    return resolveTokenContext(config, config.stdioToken)
  }
  return config.directContext
}

export function parseBearerToken(
  header: string | string[] | undefined
): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  if (!value) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1]
}

export function assertCanRead(context: SignalSurfContext): void {
  if (roleRank[context.role] < roleRank.viewer) {
    throw new UserFacingError("Token does not have read access", {
      code: "FORBIDDEN",
      status: 403,
    })
  }
}

export function assertCanWrite(context: SignalSurfContext): void {
  if (roleRank[context.role] < roleRank.editor) {
    throw new UserFacingError("Token does not have write access", {
      code: "FORBIDDEN",
      status: 403,
    })
  }
}

function requiredRoleForCapability(capability: McpCapability): AccessRole {
  return capability.endsWith(".read") ? "viewer" : "editor"
}

export function canUseCapability(
  context: SignalSurfContext,
  capability: McpCapability
): boolean {
  const requiredRole = requiredRoleForCapability(capability)
  if (roleRank[context.role] < roleRank[requiredRole]) return false
  if (context.scopes === undefined) return true
  if (context.scopes.length === 0) return false
  return scopesGrantCapability(context.scopes, capability)
}

export function assertCanUseCapability(
  context: SignalSurfContext,
  capability: McpCapability
): void {
  if (canUseCapability(context, capability)) return

  const requiredRole = requiredRoleForCapability(capability)
  if (roleRank[context.role] < roleRank[requiredRole]) {
    throw new UserFacingError(
      requiredRole === "viewer"
        ? "Token does not have read access"
        : "Token does not have write access",
      {
        code: "FORBIDDEN",
        status: 403,
      }
    )
  }

  throw new UserFacingError(
    `Token scope does not allow SignalSurf MCP capability: ${capability}`,
    {
      code: "INSUFFICIENT_SCOPE",
      status: 403,
      details: {
        oauthError: "insufficient_scope",
        requiredScopes: requiredScopesForCapability(capability),
      },
    }
  )
}

export function listContextCapabilities(
  context: SignalSurfContext
): McpCapability[] {
  if (context.scopes !== undefined) {
    return grantedCapabilitiesForScopes(context.scopes).filter((capability) =>
      canUseCapability(context, capability)
    )
  }
  return context.role === "viewer"
    ? ["context.read", "surf_points.read", "tables.read"]
    : [
        "context.read",
        "surf_points.read",
        "surf_points.write",
        "surf_points.delete",
        "tables.read",
        "tables.write",
        "tables.delete",
      ]
}
