import hostedToolCatalog from "./hosted-tool-catalog.json" with { type: "json" }
import webToolCatalog from "./web-tool-catalog.json" with { type: "json" }

export type SignalSurfMcpToolRegistryEntry = {
  name: string
  title: string
  description: string
  domain: string
  executionOwner: "hosted-mcp" | "signalsurf-web"
  requiredCapabilities: readonly string[]
  requiredScopes: readonly string[]
  requiredWorkspaceRole: "member" | "admin"
  approval: "none" | "operation" | "always"
  inputSchema: Record<string, unknown>
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
  workspaceCapability?: "objects" | "lists" | "listening"
}

export const SIGNALSURF_HOSTED_MCP_TOOL_REGISTRY =
  hostedToolCatalog as readonly SignalSurfMcpToolRegistryEntry[]

const webRegistry = webToolCatalog.map((tool) => ({
  ...tool,
  executionOwner: "signalsurf-web" as const,
  requiredCapabilities: [] as readonly string[],
  approval: tool.approval ?? ("none" as const),
})) as readonly SignalSurfMcpToolRegistryEntry[]

/** Portable public contract shared by hosted MCP, CLI, and Plugin clients. */
export const SIGNALSURF_MCP_TOOL_REGISTRY = [
  ...SIGNALSURF_HOSTED_MCP_TOOL_REGISTRY,
  ...webRegistry,
] as const satisfies readonly SignalSurfMcpToolRegistryEntry[]

const duplicateNames = SIGNALSURF_MCP_TOOL_REGISTRY.filter(
  (tool, index, tools) =>
    tools.findIndex((candidate) => candidate.name === tool.name) !== index
).map((tool) => tool.name)
if (duplicateNames.length > 0) {
  throw new Error(
    `SignalSurf MCP registry contains duplicate tools: ${duplicateNames.join(", ")}`
  )
}

export function signalSurfMcpRegistryTool(name: string) {
  return SIGNALSURF_MCP_TOOL_REGISTRY.find((tool) => tool.name === name)
}
