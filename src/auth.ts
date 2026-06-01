import { createHash, timingSafeEqual } from "node:crypto"

import type { AppConfig, TokenEntry } from "./config.js"
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
  }
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

export function resolveStdioContext(config: AppConfig): SignalSurfContext {
  if (config.stdioToken || !config.directContext || config.authDisabled) {
    return resolveTokenContext(config, config.stdioToken)
  }
  return config.directContext
}

export function parseBearerToken(header: string | string[] | undefined): string | undefined {
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
