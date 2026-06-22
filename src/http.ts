import type { Server } from "node:http"
import { isIP } from "node:net"

import express from "express"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"

import {
  canUseCapability,
  parseBearerToken,
  resolveHttpTokenContext,
} from "./auth.js"
import {
  MCP_DEFAULT_RESOURCE_SCOPES,
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
  createRepository?: () => SignalSurfRepository
}

class McpJsonParseError extends Error {
  constructor() {
    super("Malformed MCP JSON request body")
    this.name = "McpJsonParseError"
  }
}

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

function getProtectedResourceMetadataUrl(config: AppConfig): string {
  return `${new URL(config.resourceUrl).origin}/.well-known/oauth-protected-resource`
}

function getWwwAuthenticateHeader(config: AppConfig): string {
  const parts = ['Bearer realm="signalsurf-mcp"']
  if (config.authorizationServerUrl) {
    parts.push(
      `resource_metadata="${getProtectedResourceMetadataUrl(config)}"`,
      `scope="${MCP_DEFAULT_RESOURCE_SCOPES.join(" ")}"`
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
    parts.push(
      `resource_metadata="${getProtectedResourceMetadataUrl(config)}"`
    )
  }
  return parts.join(", ")
}

async function readJsonBody(req: express.Request): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new McpJsonParseError()
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
    try {
      const repository =
        dependencies.createRepository?.() ??
        new SignalSurfRepository(createSupabaseClient(config))
      const context = await resolveHttpTokenContext(
        config,
        parseBearerToken(req.headers.authorization),
        repository,
        {
          ip: getClientIp(req, config.trustProxy),
          resource: config.resourceUrl,
        }
      )
      const parsedBody = await readJsonBody(req)
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

      const server = await createSignalSurfMcpServer({ context, repository })
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      res.on("close", () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, parsedBody)
    } catch (error) {
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
        scopes_supported: MCP_RESOURCE_SCOPES,
        bearer_methods_supported: ["header"],
      })
    }
  )

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
