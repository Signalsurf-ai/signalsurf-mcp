import { createHash, timingSafeEqual } from "node:crypto"
import {
  mcpServiceDelegationAudience,
  signMcpAccessToken,
  verifyMcpAccessToken,
} from "@signalsurf/mcp-contract"

import {
  grantedCapabilitiesForScopes,
  requiredScopesForCapability,
  scopesGrantCapability,
  type McpCapability,
} from "./capabilities.js"
import type { AppConfig, TokenEntry } from "./config.js"
import { UserFacingError } from "./errors.js"
import type {
  AccessRole,
  SignalSurfContext,
  SignalSurfWorkspaceContext,
} from "./types.js"

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
  const workspaceId = entry.workspaceId ?? entry.workspaceIds![0]!
  const context: SignalSurfContext = {
    workspaceId,
    userId: entry.userId,
    role: entry.role,
    tokenName: entry.name,
    scopes: entry.scopes,
  }
  if (entry.workspaceIds?.length) {
    // Keep the primary workspaceId inside the authorized list so a mixed
    // { workspaceId, workspaceIds } config can never advertise a primary workspace
    // that is not actually authorized.
    context.workspaceIds = [...new Set([workspaceId, ...entry.workspaceIds])]
  }
  return context
}

export function resolveTokenContext(
  config: Pick<AppConfig, "authDisabled" | "directContext" | "tokenEntries">,
  token: string | undefined
): SignalSurfContext {
  if (config.authDisabled) {
    if (!config.directContext) {
      throw new UserFacingError(
        "SIGNALSURF_MCP_AUTH_DISABLED requires SIGNALSURF_MCP_WORKSPACE_ID",
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
    | "authDisabled"
    | "directContext"
    | "tokenEntries"
    | "authMode"
    | "accessTokenSecret"
    | "authorizationServerUrl"
    | "resourceUrl"
  >,
  token: string | undefined,
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

  const claims =
    config.accessTokenSecret && config.authorizationServerUrl
      ? await verifyMcpAccessToken({
          token,
          secret: config.accessTokenSecret,
          issuer: config.authorizationServerUrl,
          audience: metadata?.resource ?? config.resourceUrl,
        })
      : null
  if (!claims) {
    throw new UserFacingError("Invalid MCP bearer token", {
      code: "UNAUTHORIZED",
      status: 401,
    })
  }
  return {
    workspaceId: claims.workspaceIds[0]!,
    workspaceIds: claims.workspaceIds,
    userId: claims.sub,
    role: claims.role,
    tokenName: `OAuth: ${claims.clientId}`,
    scopes: claims.scopes,
    authKind: "oauth",
    oauthTokenId: claims.jti,
    oauthGrantId: claims.grantId,
    oauthClientId: claims.clientId,
    oauthAccessTokenExpiresAt: claims.exp,
  }
}

export async function issueMcpServiceDelegation(
  config: Pick<AppConfig, "accessTokenSecret" | "authorizationServerUrl">,
  context: SignalSurfContext,
  now = Math.floor(Date.now() / 1000)
): Promise<string | undefined> {
  if (
    context.authKind !== "oauth" ||
    !config.accessTokenSecret ||
    !config.authorizationServerUrl ||
    !context.userId ||
    !context.oauthTokenId ||
    !context.oauthGrantId ||
    !context.oauthClientId ||
    !context.oauthAccessTokenExpiresAt ||
    context.oauthAccessTokenExpiresAt <= now
  ) {
    return undefined
  }
  return signMcpAccessToken({
    secret: config.accessTokenSecret,
    claims: {
      iss: config.authorizationServerUrl,
      aud: mcpServiceDelegationAudience(config.authorizationServerUrl),
      sub: context.userId,
      iat: now,
      exp: Math.min(context.oauthAccessTokenExpiresAt, now + 60),
      jti: context.oauthTokenId,
      clientId: context.oauthClientId,
      grantId: context.oauthGrantId,
      workspaceIds: context.workspaceIds ?? [context.workspaceId],
      scopes: context.scopes ?? [],
      role: context.role,
    },
  })
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
    ? [
        "context.read",
        "workflows.read",
        "tables.read",
        "schemas.read",
        "sources.read",
        "account_lists.read",
        "creator_discovery.read",
        "deepline.read",
        "sender_infrastructure.read",
      ]
    : [
        "context.read",
        "workflows.read",
        "workflows.write",
        "workflows.execute",
        "workflows.delete",
        "campaigns.write",
        "tables.read",
        "tables.write",
        "tables.delete",
        "schemas.read",
        "schemas.write",
        "sources.read",
        "sources.write",
        "account_lists.read",
        "account_lists.write",
        "creator_discovery.read",
        "deepline.read",
        "deepline.enrich",
        "deepline.execute",
        "sender_infrastructure.read",
      ]
}

export function authorizedWorkspaceIds(context: SignalSurfContext): string[] {
  const ids = context.workspaceIds?.length
    ? context.workspaceIds
    : [context.workspaceId]
  return [...new Set(ids.filter(Boolean))]
}

export function authorizedWorkspaces(
  context: SignalSurfContext
): SignalSurfWorkspaceContext[] {
  const workspaceIds = authorizedWorkspaceIds(context)
  const workspacesById = new Map(
    (context.workspaces ?? []).map((workspace) => [
      workspace.workspaceId,
      workspace,
    ])
  )

  return workspaceIds.map((workspaceId) => {
    const workspace = workspacesById.get(workspaceId)
    return {
      workspaceId,
      name: workspace?.name?.trim() || workspaceId,
      organizationId: workspace?.organizationId ?? null,
      organizationName: workspace?.organizationName ?? null,
    }
  })
}

export function resolveWorkspaceContext(
  context: SignalSurfContext,
  requestedWorkspaceId?: string
): SignalSurfContext {
  const workspaceIds = authorizedWorkspaceIds(context)
  const workspaces = authorizedWorkspaces(context)
  if (!requestedWorkspaceId) {
    if (workspaceIds.length > 1) {
      throw new UserFacingError(
        "workspaceId is required because this MCP connection can access multiple SignalSurf workspaces.",
        { code: "BAD_REQUEST", status: 400 }
      )
    }
    return {
      ...context,
      workspaceId: workspaceIds[0]!,
      workspaceIds,
      workspaces,
    }
  }

  if (!workspaceIds.includes(requestedWorkspaceId)) {
    throw new UserFacingError(
      "This MCP connection is not authorized for the requested workspace.",
      { code: "FORBIDDEN", status: 403 }
    )
  }

  return {
    ...context,
    workspaceId: requestedWorkspaceId,
    workspaceIds,
    workspaces,
  }
}
