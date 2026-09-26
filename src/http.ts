import type { Server } from "node:http"
import { isIP } from "node:net"

import express from "express"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import {
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js"

import {
  canUseCapability,
  parseBearerToken,
  resolveHttpTokenContext,
} from "./auth.js"
import {
  MCP_DEFAULT_RESOURCE_SCOPES,
  MCP_DM_SCOPE,
  MCP_RESOURCE_SCOPES,
  PUBLIC_MCP_TOOLS,
  requiredCapabilitiesForTool,
  requiredScopesForCapability,
  type PublicMcpToolName,
} from "./capabilities.js"
import type { AppConfig } from "./config.js"
import { errorToObject, UserFacingError } from "./errors.js"
import { SignalSurfRepository } from "./repository.js"
import { createSignalSurfMcpServer } from "./server.js"
import { createSupabaseClient } from "./supabase.js"
import type { SignalSurfContext } from "./types.js"

export type HttpServerDependencies = {
  createRepository?: (options: {
    authorizationServerUrl?: string
    accessToken?: string
  }) => SignalSurfRepository
  /** Test seam for the Surfer session relay; production uses global fetch. */
  /** SIG-2681: injected transport for the Direct Message capability relay. */
  directMessageFetch?: typeof fetch
  /** Test seam for the bounded pre-auth compatibility probe reader. */
  preauthDiscoveryTimeoutMs?: number
}

class McpJsonParseError extends Error {
  constructor() {
    super("Malformed MCP JSON request body")
    this.name = "McpJsonParseError"
  }
}

class McpPreauthReadTimeoutError extends Error {
  constructor() {
    super("Timed out reading MCP discovery probe")
    this.name = "McpPreauthReadTimeoutError"
  }
}

const MAX_PREAUTH_DISCOVERY_BYTES = 8 * 1024
const PREAUTH_DISCOVERY_TIMEOUT_MS = 2_000
const STATELESS_NOOP_NOTIFICATIONS = new Set([
  "notifications/initialized",
  "notifications/cancelled",
])

function normalizeHostHeader(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]")
    return end > 0 ? trimmed.slice(1, end) : null
  }
  return trimmed.split(":")[0] || null
}

function hostAllowed(
  header: string | undefined,
  allowedHosts: string[]
): boolean {
  const host = normalizeHostHeader(header)
  if (!host) return false
  return allowedHosts.map((item) => item.toLowerCase()).includes(host)
}

function normalizeIp(value: string | undefined | null): string | null {
  const candidate = value?.trim()
  return candidate && isIP(candidate) ? candidate : null
}

function getClientIp(req: express.Request, trustProxy: boolean): string | null {
  return normalizeIp(trustProxy ? req.ip : req.socket.remoteAddress)
}

function requestOriginMatchesTarget(
  req: express.Request,
  target: URL,
  trustProxy: boolean
): boolean {
  let authority = req.headers.host
  if (trustProxy) {
    const forwardedHost = req.headers["x-forwarded-host"]
    authority = Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : (forwardedHost ?? authority)
  }
  authority = authority?.split(",", 1)[0]?.trim()
  const protocol = req.protocol
  if (!authority || (protocol !== "http" && protocol !== "https")) return false
  try {
    return new URL(`${protocol}://${authority}`).origin === target.origin
  } catch {
    return false
  }
}

function getProtectedResourceMetadataUrl(config: AppConfig): string {
  return `${new URL(config.resourceUrl).origin}/.well-known/oauth-protected-resource`
}

function getWwwAuthenticateHeader(config: AppConfig): string {
  const parts = ['Bearer realm="signalsurf-mcp"']
  if (config.authorizationServerUrl) {
    parts.push(
      `resource_metadata="${getProtectedResourceMetadataUrl(config)}"`,
      `scope="${[MCP_DM_SCOPE, ...MCP_DEFAULT_RESOURCE_SCOPES].join(" ")}"`
    )
  }
  return parts.join(", ")
}

function quoteAuthParam(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function getInsufficientScopeHeader(
  config: AppConfig,
  requiredScopes: readonly string[],
  description: string
): string {
  const parts = [
    'Bearer realm="signalsurf-mcp"',
    'error="insufficient_scope"',
    `scope="${quoteAuthParam(requiredScopes.join(" "))}"`,
    `error_description="${quoteAuthParam(description)}"`,
  ]
  if (config.authorizationServerUrl) {
    parts.push(`resource_metadata="${getProtectedResourceMetadataUrl(config)}"`)
  }
  return parts.join(", ")
}

async function readJsonBody(
  req: express.Request,
  maxBytes?: number,
  timeoutMs?: number
): Promise<unknown> {
  const read = async () => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.byteLength
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        throw new UserFacingError("MCP discovery probe body is too large.", {
          code: "PAYLOAD_TOO_LARGE",
          status: 413,
        })
      }
      chunks.push(buffer)
    }
    const text = Buffer.concat(chunks).toString("utf8")
    if (!text.trim()) return undefined
    try {
      return JSON.parse(text)
    } catch {
      throw new McpJsonParseError()
    }
  }

  if (timeoutMs === undefined) return read()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new McpPreauthReadTimeoutError()),
          timeoutMs
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function getKnownToolName(message: unknown): PublicMcpToolName | null {
  if (!isRecord(message) || message.method !== "tools/call") return null
  const params = message.params
  if (!isRecord(params) || typeof params.name !== "string") return null
  return params.name in PUBLIC_MCP_TOOLS
    ? (params.name as PublicMcpToolName)
    : null
}

function findInsufficientScopeRequest(
  context: SignalSurfContext,
  body: unknown
): { toolName: PublicMcpToolName; requiredScopes: readonly string[] } | null {
  const messages = Array.isArray(body) ? body : [body]
  for (const message of messages) {
    const toolName = getKnownToolName(message)
    if (!toolName) continue
    const missingCapabilities = requiredCapabilitiesForTool(toolName).filter(
      (capability) => !canUseCapability(context, capability)
    )
    if (missingCapabilities.length === 0) continue
    if (context.scopes === undefined) continue
    return {
      toolName,
      requiredScopes: [
        ...new Set(
          missingCapabilities.flatMap((capability) =>
            requiredScopesForCapability(capability)
          )
        ),
      ],
    }
  }
  return null
}

function requiresDirectMessageTools(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body]
  return messages.some((message) => {
    if (!isRecord(message)) return false
    if (message.method === "tools/list") return true
    if (message.method !== "tools/call") return false
    const params = message.params
    return (
      isRecord(params) &&
      typeof params.name === "string" &&
      (params.name === "find_capabilities" ||
        !(params.name in PUBLIC_MCP_TOOLS))
    )
  })
}

function isInitializeRequest(body: unknown): boolean {
  return isRecord(body) && body.method === "initialize"
}

function firstHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function hasMcpPostMediaHeaders(req: express.Request): boolean {
  const accept = firstHeaderValue(req.headers.accept)
  const contentType = firstHeaderValue(req.headers["content-type"])
  return (
    accept?.includes("application/json") === true &&
    accept.includes("text/event-stream") &&
    contentType?.includes("application/json") === true
  )
}

function shouldReadPreauthDiscoveryProbe(req: express.Request): boolean {
  if (!hasMcpPostMediaHeaders(req)) return false
  const protocolVersion = firstHeaderValue(
    req.headers["mcp-protocol-version"]
  )
  if (
    !protocolVersion ||
    SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)
  ) {
    return false
  }
  if (firstHeaderValue(req.headers["mcp-method"]) !== "server/discover") {
    return false
  }
  const contentLength = Number(firstHeaderValue(req.headers["content-length"]))
  return (
    Number.isSafeInteger(contentLength) &&
    contentLength > 0 &&
    contentLength <= MAX_PREAUTH_DISCOVERY_BYTES
  )
}

function shouldReadPreauthNoopNotification(req: express.Request): boolean {
  if (!hasMcpPostMediaHeaders(req)) return false
  const protocolVersion = firstHeaderValue(
    req.headers["mcp-protocol-version"]
  )
  const method = firstHeaderValue(req.headers["mcp-method"])
  if (
    !protocolVersion ||
    !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion) ||
    !method ||
    !STATELESS_NOOP_NOTIFICATIONS.has(method)
  ) {
    return false
  }
  const contentLength = Number(firstHeaderValue(req.headers["content-length"]))
  return (
    Number.isSafeInteger(contentLength) &&
    contentLength > 0 &&
    contentLength <= MAX_PREAUTH_DISCOVERY_BYTES
  )
}

function isUnsupportedDiscoveryProbe(body: unknown): boolean {
  const parsed = JSONRPCRequestSchema.safeParse(body)
  return parsed.success && parsed.data.method === "server/discover"
}

function isStatelessNoopNotification(
  body: unknown,
  methodHeader: string | string[] | undefined
): boolean {
  if (!isRecord(body) || Object.hasOwn(body, "id")) return false
  const parsed = JSONRPCNotificationSchema.safeParse(body)
  const method = firstHeaderValue(methodHeader)
  return (
    parsed.success &&
    parsed.data.method === method &&
    STATELESS_NOOP_NOTIFICATIONS.has(parsed.data.method)
  )
}

function rejectUnsupportedDiscoveryProbe(
  res: express.Response,
  protocolVersionHeader: string | string[] | undefined
): void {
  const protocolVersion = firstHeaderValue(protocolVersionHeader)
  res.status(400).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: `Bad Request: Unsupported protocol version: ${protocolVersion} (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`,
    },
    id: null,
  })
}

export function createHttpApp(
  config: AppConfig,
  dependencies: HttpServerDependencies = {}
) {
  const app = express()
  app.set("trust proxy", config.trustProxy)

  app.use((req, res, next) => {
    if (!hostAllowed(req.headers.host, config.allowedHosts)) {
      res.status(403).json({
        ok: false,
        error: "Host header is not allowed for this MCP server.",
        code: "FORBIDDEN_HOST",
      })
      return
    }
    next()
  })

  app.post(config.path, async (req, res) => {
    const requestId = crypto.randomUUID()
    let phase = "resolve_token"
    res.setHeader("X-SignalSurf-Request-Id", requestId)
    try {
      // Modern clients probe legacy servers with server/discover before
      // falling back to initialize. The legacy SDK's answer is invariant and
      // discloses no member state, so reject it before remote token resolution.
      // This avoids spending one full authorization round trip on a request
      // that the transport must reject regardless of the bearer token.
      let parsedBody: unknown
      let preauthBodyRead = false
      let preauthParseFailed = false
      const protocolVersionHeader = req.headers["mcp-protocol-version"]
      const preauthDiscoveryProbe = shouldReadPreauthDiscoveryProbe(req)
      const preauthNoopNotification =
        shouldReadPreauthNoopNotification(req)
      if (preauthDiscoveryProbe || preauthNoopNotification) {
        phase = "read_request"
        preauthBodyRead = true
        try {
          parsedBody = await readJsonBody(
            req,
            MAX_PREAUTH_DISCOVERY_BYTES,
            dependencies.preauthDiscoveryTimeoutMs ??
              PREAUTH_DISCOVERY_TIMEOUT_MS
          )
        } catch (error) {
          if (!(error instanceof McpJsonParseError)) throw error
          preauthParseFailed = true
        }
        if (
          !preauthParseFailed &&
          preauthDiscoveryProbe &&
          isUnsupportedDiscoveryProbe(parsedBody)
        ) {
          rejectUnsupportedDiscoveryProbe(res, protocolVersionHeader)
          return
        }
        if (
          !preauthParseFailed &&
          preauthNoopNotification &&
          isStatelessNoopNotification(parsedBody, req.headers["mcp-method"])
        ) {
          res.status(202).end()
          return
        }
      }
      phase = "resolve_token"
      const accessToken = parseBearerToken(req.headers.authorization)
      const repository =
        dependencies.createRepository?.({
          authorizationServerUrl: config.authorizationServerUrl,
          accessToken,
        }) ??
        new SignalSurfRepository(createSupabaseClient(config), {
          authorizationServerUrl: config.authorizationServerUrl,
          accessToken,
        })
      const context = await resolveHttpTokenContext(
        config,
        accessToken,
        repository,
        {
          ip: getClientIp(req, config.trustProxy),
          resource: config.resourceUrl,
        }
      )
      if (!preauthBodyRead) {
        phase = "read_request"
        parsedBody = await readJsonBody(req)
      } else if (preauthParseFailed) {
        throw new McpJsonParseError()
      }
      const insufficientScope = findInsufficientScopeRequest(
        context,
        parsedBody
      )
      if (insufficientScope) {
        const error = new UserFacingError(
          `Token scope does not allow SignalSurf MCP tool: ${insufficientScope.toolName}`,
          {
            code: "INSUFFICIENT_SCOPE",
            status: 403,
            details: {
              oauthError: "insufficient_scope",
              requiredScopes: insufficientScope.requiredScopes,
              toolName: insufficientScope.toolName,
            },
          }
        )
        res.setHeader(
          "WWW-Authenticate",
          getInsufficientScopeHeader(
            config,
            insufficientScope.requiredScopes,
            error.message
          )
        )
        res.status(403).json(errorToObject(error))
        return
      }

      phase = "compose_capabilities"
      const authorizationIconUrl = config.authorizationServerUrl
        ? new URL(
            "/apple-touch-icon.png",
            config.authorizationServerUrl
          )
        : undefined
      const server = await createSignalSurfMcpServer({
        context,
        repository,
        includeDirectMessageTools: requiresDirectMessageTools(parsedBody),
        initializeOnly: isInitializeRequest(parsedBody),
        iconUrl:
          !authorizationIconUrl ||
          authorizationIconUrl.origin === new URL(config.resourceUrl).origin ||
          requestOriginMatchesTarget(
            req,
            authorizationIconUrl,
            config.trustProxy
          )
            ? undefined
            : authorizationIconUrl.toString(),
        surferSession: {
          baseUrl: config.authorizationServerUrl,
          accessToken,
          fetch: dependencies.directMessageFetch,
        },
      })
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      res.on("close", () => {
        void transport.close()
        void server.close()
      })
      phase = "handle_mcp_request"
      await server.connect(transport)
      await transport.handleRequest(req, res, parsedBody)
    } catch (error) {
      if (error instanceof McpPreauthReadTimeoutError) {
        res.setHeader("Connection", "close")
        res.once("finish", () => req.destroy())
        res.status(408).end()
        return
      }
      if (error instanceof McpJsonParseError) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error",
          },
          id: null,
        })
        return
      }

      console.error("SignalSurf MCP request failed", {
        requestId,
        phase,
        failure: errorToObject(error),
      })
      const status = error instanceof UserFacingError ? error.status : 500
      if (status === 401) {
        res.setHeader("WWW-Authenticate", getWwwAuthenticateHeader(config))
      }
      res.status(status).json(errorToObject(error))
    }
  })

  app.get(
    /^\/\.well-known\/oauth-protected-resource(?:\/.*)?$/,
    (_req, res) => {
      if (!config.authorizationServerUrl) {
        res.status(404).json({
          ok: false,
          error:
            "OAuth protected resource metadata is not configured for this MCP server.",
        })
        return
      }

      res.setHeader("Cache-Control", "no-store")
      res.json({
        resource: config.resourceUrl,
        authorization_servers: [config.authorizationServerUrl],
        scopes_supported: [MCP_DM_SCOPE, ...MCP_RESOURCE_SCOPES],
        bearer_methods_supported: ["header"],
      })
    }
  )

  app.get(["/favicon.ico", "/apple-touch-icon.png"], (req, res) => {
    if (!config.authorizationServerUrl) {
      res.status(404).end()
      return
    }
    const target = new URL(
      "/apple-touch-icon.png",
      config.authorizationServerUrl
    )
    if (
      target.origin === new URL(config.resourceUrl).origin ||
      requestOriginMatchesTarget(req, target, config.trustProxy)
    ) {
      res.status(404).end()
      return
    }
    res.setHeader("Cache-Control", "public, max-age=3600")
    res.redirect(302, target.toString())
  })

  app.get(config.path, (_req, res) => {
    res.status(405).json({
      ok: false,
      error:
        "This server uses stateless Streamable HTTP. Send MCP JSON-RPC requests with POST.",
    })
  })

  app.delete(config.path, (_req, res) => {
    res.status(405).json({
      ok: false,
      error: "This server is stateless; there is no session to delete.",
    })
  })

  return app
}

export async function startHttpServer(config: AppConfig): Promise<Server> {
  const app = createHttpApp(config)
  const listener = await new Promise<Server>((resolve) => {
    const server = app.listen(config.port, config.host, () => resolve(server))
  })

  console.error(
    `SignalSurf MCP listening at http://${config.host}:${config.port}${config.path}`
  )
  return listener
}
