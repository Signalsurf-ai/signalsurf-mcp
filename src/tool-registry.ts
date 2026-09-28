import {
  SIGNALSURF_HOSTED_MCP_TOOL_REGISTRY,
  SIGNALSURF_MCP_TOOL_REGISTRY,
  signalSurfMcpRegistryTool as portableRegistryTool,
  type SignalSurfMcpToolRegistryEntry,
} from "@signalsurf/mcp-contract/registry"

import type { McpCapability, PublicMcpToolName } from "./capabilities.js"

export { SIGNALSURF_HOSTED_MCP_TOOL_REGISTRY, SIGNALSURF_MCP_TOOL_REGISTRY }
export type { SignalSurfMcpToolRegistryEntry }

export const SIGNALSURF_HOSTED_MCP_TOOL_NAMES =
  SIGNALSURF_HOSTED_MCP_TOOL_REGISTRY.map(
    (tool) => tool.name as PublicMcpToolName
  )

type ServerRegistryEntry = Omit<
  SignalSurfMcpToolRegistryEntry,
  "requiredCapabilities"
> & { requiredCapabilities: readonly McpCapability[] }

export function signalSurfMcpRegistryTool(name: string) {
  return portableRegistryTool(name) as ServerRegistryEntry | undefined
}

export function signalSurfHostedMcpRegistryTool(name: PublicMcpToolName) {
  return SIGNALSURF_HOSTED_MCP_TOOL_REGISTRY.find(
    (tool) => tool.name === name
  )! as ServerRegistryEntry & {
    name: PublicMcpToolName
  }
}
