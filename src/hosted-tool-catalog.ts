import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
import type { SignalSurfMcpToolRegistryEntry } from "@signalsurf/mcp-contract/registry"
import { z } from "zod"

import {
  PUBLIC_MCP_TOOLS,
  PUBLIC_MCP_TOOL_NAMES,
  requiredCapabilitiesForTool,
  requiredScopesForCapability,
  type McpCapability,
  type PublicMcpToolName,
} from "./capabilities.js"
import { PUBLIC_MCP_TOOL_SCHEMAS } from "./schemas.js"

const LISTENING_SIGNAL_TOOLS = new Set<PublicMcpToolName>([
  "list_signals",
  "create_signal",
  "update_signal",
  "delete_signal",
])

function hostedDomain(
  name: PublicMcpToolName,
  capabilities: readonly McpCapability[]
): string {
  if (LISTENING_SIGNAL_TOOLS.has(name)) return "listening"
  const capability = capabilities[0]
  if (!capability || capability === "context.read") return "workspace"
  if (capability.startsWith("workflows.")) return "workflows"
  if (capability.startsWith("campaigns.")) return "campaigns"
  if (
    capability.startsWith("tables.") ||
    capability.startsWith("schemas.") ||
    capability.startsWith("sources.")
  )
    return "tables"
  if (
    capability.startsWith("lists.") ||
    capability.startsWith("account_lists.")
  )
    return "lists"
  if (capability.startsWith("objects.") || capability.startsWith("records."))
    return "objects"
  if (capability.startsWith("deepline.")) return "deepline"
  if (capability.startsWith("sender_infrastructure."))
    return "sender_infrastructure"
  if (capability.startsWith("creator_discovery.")) return "creator_discovery"
  return capability.split(".", 1)[0] ?? "workspace"
}

const HOSTED_APPROVAL_TOOLS = new Set<PublicMcpToolName>([
  "search_instagram_content",
  "deepline_search_people",
  "deepline_search_companies",
  "deepline_enrich_contact",
  "deepline_execute_tool",
])

export function buildHostedToolCatalog(): SignalSurfMcpToolRegistryEntry[] {
  return PUBLIC_MCP_TOOL_NAMES.map((name) => {
    const definition = PUBLIC_MCP_TOOLS[name]
    const requiredCapabilities = requiredCapabilitiesForTool(name)
    const rawShape = PUBLIC_MCP_TOOL_SCHEMAS[name]
    const inputSchema = toJsonSchemaCompat(z.object(rawShape ?? {}), {
      pipeStrategy: "input",
    }) as Record<string, unknown>
    return {
      name,
      title: definition.title,
      description: definition.description,
      domain: hostedDomain(name, requiredCapabilities),
      executionOwner: "hosted-mcp",
      requiredCapabilities,
      requiredScopes: [
        ...new Set(
          requiredCapabilities.flatMap((capability) =>
            requiredScopesForCapability(capability)
          )
        ),
      ],
      requiredWorkspaceRole: "member",
      approval: HOSTED_APPROVAL_TOOLS.has(name) ? "operation" : "none",
      inputSchema,
      annotations: definition.annotations,
    }
  })
}
