const encoder = new TextEncoder()

export const MCP_ACCESS_TOKEN_TYPE = "signalsurf-mcp+jwt"
export const MCP_ACCESS_TOKEN_ALGORITHM = "HS256"
export const MCP_SERVICE_DELEGATION_PATH = "/api/mcp/service-delegation"

export type McpAccessRole = "viewer" | "editor" | "owner"

export type McpAccessTokenClaims = {
  iss: string
  aud: string
  sub: string
  iat: number
  exp: number
  jti: string
  clientId: string
  grantId: string
  workspaceIds: string[]
  scopes: string[]
  role: McpAccessRole
}

function base64UrlEncode(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function normalizeUrl(value: string): string {
  const url = new URL(value)
  url.hash = ""
  url.search = ""
  return url.toString().replace(/\/+$/, "")
}

export function mcpServiceDelegationAudience(issuer: string): string {
  return normalizeUrl(new URL(MCP_SERVICE_DELEGATION_PATH, issuer).toString())
}

async function signingKey(secret: string, usage: Array<"sign" | "verify">) {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error(
      "SignalSurf MCP access-token secret must be at least 32 bytes"
    )
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage
  )
}

function parseClaims(value: unknown): McpAccessTokenClaims | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const claims = value as Record<string, unknown>
  if (
    typeof claims.iss !== "string" ||
    typeof claims.aud !== "string" ||
    typeof claims.sub !== "string" ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number" ||
    typeof claims.jti !== "string" ||
    typeof claims.clientId !== "string" ||
    typeof claims.grantId !== "string" ||
    !Array.isArray(claims.workspaceIds) ||
    !claims.workspaceIds.every((item) => typeof item === "string") ||
    claims.workspaceIds.length === 0 ||
    !Array.isArray(claims.scopes) ||
    !claims.scopes.every((item) => typeof item === "string") ||
    !["viewer", "editor", "owner"].includes(String(claims.role))
  ) {
    return null
  }
  return claims as McpAccessTokenClaims
}

export async function signMcpAccessToken(input: {
  secret: string
  claims: McpAccessTokenClaims
}): Promise<string> {
  const header = base64UrlEncode(
    JSON.stringify({
      alg: MCP_ACCESS_TOKEN_ALGORITHM,
      typ: MCP_ACCESS_TOKEN_TYPE,
    })
  )
  const payload = base64UrlEncode(JSON.stringify(input.claims))
  const signingInput = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(input.secret, ["sign"]),
    encoder.encode(signingInput)
  )
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

export async function verifyMcpAccessToken(input: {
  token: string
  secret: string
  issuer: string
  audience: string
  now?: number
}): Promise<McpAccessTokenClaims | null> {
  const parts = input.token.split(".")
  if (parts.length !== 3) return null
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  try {
    const header = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encodedHeader!))
    ) as Record<string, unknown>
    if (
      header.alg !== MCP_ACCESS_TOKEN_ALGORITHM ||
      header.typ !== MCP_ACCESS_TOKEN_TYPE
    ) {
      return null
    }
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(input.secret, ["verify"]),
      base64UrlDecode(encodedSignature!),
      encoder.encode(`${encodedHeader}.${encodedPayload}`)
    )
    if (!valid) return null
    const claims = parseClaims(
      JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload!)))
    )
    if (!claims) return null
    const now = input.now ?? Math.floor(Date.now() / 1000)
    if (
      normalizeUrl(claims.iss) !== normalizeUrl(input.issuer) ||
      normalizeUrl(claims.aud) !== normalizeUrl(input.audience) ||
      claims.iat > now + 30 ||
      claims.exp <= now
    ) {
      return null
    }
    return claims
  } catch {
    return null
  }
}
