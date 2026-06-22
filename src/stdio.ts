import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { resolveStdioContext } from "./auth.js"
import type { AppConfig } from "./config.js"
import { SignalSurfRepository } from "./repository.js"
import { createSignalSurfMcpServer } from "./server.js"
import { createSupabaseClient } from "./supabase.js"

export async function startStdioServer(config: AppConfig): Promise<void> {
  const context = resolveStdioContext(config)
  const repository = new SignalSurfRepository(createSupabaseClient(config))
  const server = await createSignalSurfMcpServer({ context, repository })
  await server.connect(new StdioServerTransport())
}
