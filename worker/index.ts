// SIG-2671: Cloudflare Worker entry for the hosted SignalSurf MCP.
//
// The MCP is a stateless Express app, so the Worker runs the same
// `createHttpApp` through Cloudflare's Node HTTP server support
// (`nodejs_compat`). Configuration comes from wrangler vars and secrets,
// exactly the variables `loadConfig` reads on any other host. It is loaded on
// the first request, so a missing secret answers 503 instead of failing the
// upload's startup validation.
import { createServer } from "node:http"

import { httpServerHandler } from "cloudflare:node"
import { env } from "cloudflare:workers"

import { loadConfig } from "../src/config.js"
import { createHttpApp } from "../src/http.js"

const PORT = 8080

let app: ReturnType<typeof createHttpApp> | undefined

createServer((req, res) => {
  if (!app) {
    try {
      app = createHttpApp(
        loadConfig({
          ...process.env,
          ...(env as unknown as Record<string, string | undefined>),
          SIGNALSURF_MCP_TRANSPORT: "http",
          SIGNALSURF_MCP_PORT: String(PORT),
        })
      )
    } catch (error) {
      console.error(
        "[signalsurf-mcp] configuration unavailable:",
        error instanceof Error ? error.message : String(error)
      )
      res.statusCode = 503
      res.setHeader("content-type", "application/json; charset=utf-8")
      res.end(
        JSON.stringify({
          ok: false,
          error: "SignalSurf MCP is not configured.",
          code: "CONFIG_ERROR",
        })
      )
      return
    }
  }
  app(req, res)
}).listen(PORT)

export default httpServerHandler({ port: PORT })
