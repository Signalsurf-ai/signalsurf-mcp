import { describe, expect, it } from "vitest"

import { PUBLIC_MCP_TOOL_NAMES } from "../src/capabilities.js"
import { buildHostedToolCatalog } from "../src/hosted-tool-catalog.js"
import { SIGNALSURF_MCP_TOOL_REGISTRY } from "../src/tool-registry.js"

describe("SignalSurf MCP tool registry", () => {
  it("classifies every hosted and Web-delegated public tool once", () => {
    const names = SIGNALSURF_MCP_TOOL_REGISTRY.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    expect(
      SIGNALSURF_MCP_TOOL_REGISTRY.filter(
        (tool) => tool.executionOwner === "hosted-mcp"
      ).map((tool) => tool.name)
    ).toEqual(PUBLIC_MCP_TOOL_NAMES)
    expect(
      SIGNALSURF_MCP_TOOL_REGISTRY.find((tool) => tool.name === "create_record")
    ).toMatchObject({
      domain: "records",
      executionOwner: "signalsurf-web",
      requiredWorkspaceRole: "admin",
    })
    expect(
      SIGNALSURF_MCP_TOOL_REGISTRY.find((tool) => tool.name === "list_signals")
    ).toMatchObject({ domain: "listening" })
    expect(
      SIGNALSURF_MCP_TOOL_REGISTRY.find((tool) => tool.name === "create_signal")
    ).toMatchObject({ domain: "listening" })
    expect(
      SIGNALSURF_MCP_TOOL_REGISTRY.find((tool) => tool.name === "enable_enrich")
    ).toMatchObject({ domain: "tables" })
    for (const tool of SIGNALSURF_MCP_TOOL_REGISTRY) {
      expect(tool.domain).not.toBe("")
      expect(tool.inputSchema).toBeTruthy()
      expect(["none", "operation", "always"]).toContain(tool.approval)
      if (tool.executionOwner === "hosted-mcp") {
        expect(tool.requiredScopes.length).toBeGreaterThan(0)
      }
    }
    expect(
      SIGNALSURF_MCP_TOOL_REGISTRY.filter(
        (tool) =>
          tool.executionOwner === "hosted-mcp" && tool.approval !== "none"
      ).map((tool) => tool.name)
    ).toEqual([
      "deepline_search_people",
      "search_instagram_content",
      "deepline_search_companies",
      "deepline_enrich_contact",
      "deepline_execute_tool",
    ])
    expect(
      SIGNALSURF_MCP_TOOL_REGISTRY.find(
        (tool) => tool.name === "delete_workflow"
      )?.approval
    ).toBe("none")
  })

  it("keeps the portable hosted catalog synchronized with runtime schemas", () => {
    expect(
      SIGNALSURF_MCP_TOOL_REGISTRY.filter(
        (tool) => tool.executionOwner === "hosted-mcp"
      )
    ).toEqual(buildHostedToolCatalog())
  })
})
