import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"

import {
  assertCanUseCapability,
  canUseCapability,
  listContextCapabilities,
} from "./auth.js"
import {
  PUBLIC_MCP_TOOLS,
  PUBLIC_MCP_TOOL_NAMES,
  type PublicMcpToolName,
} from "./capabilities.js"
import { jsonResource, runJsonTool } from "./mcp-results.js"
import { SignalSurfRepository } from "./repository.js"
import {
  createSurfPointSchema,
  createTableRowSchema,
  deleteSurfPointSchema,
  deleteTableRowsSchema,
  getTableRowSchema,
  listDatabasesSchema,
  listSurfPointsSchema,
  readTableSchema,
  updateSurfPointSchema,
  updateTableRowSchema,
} from "./schemas.js"
import type { SignalSurfContext } from "./types.js"

export type CreateServerOptions = {
  context: SignalSurfContext
  repository: SignalSurfRepository
}

export function createSignalSurfMcpServer(options: CreateServerOptions): McpServer {
  const { context, repository } = options
  const server = new McpServer(
    {
      name: "signalsurf-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
      instructions:
        "Use these tools to work with the SignalSurf product bound to this MCP token. Do not assume access to other products.",
    }
  )

  registerResources(server, repository, context)
  registerTools(server, repository, context)
  return server
}

function registerTools(
  server: McpServer,
  repository: SignalSurfRepository,
  context: SignalSurfContext
) {
  function toolConfig(name: PublicMcpToolName, inputSchema?: any) {
    const definition = PUBLIC_MCP_TOOLS[name]
    const config = {
      title: definition.title,
      description: definition.description,
      annotations: definition.annotations,
    }
    return inputSchema ? { ...config, inputSchema } : config
  }

  function assertToolAllowed(name: PublicMcpToolName) {
    assertCanUseCapability(context, PUBLIC_MCP_TOOLS[name].requiredCapability)
  }

  function registerPublicTool(
    name: PublicMcpToolName,
    inputSchema: any,
    handler: (args: any) => Promise<any>
  ) {
    if (!canUseCapability(context, PUBLIC_MCP_TOOLS[name].requiredCapability)) {
      return
    }
    server.registerTool(name, toolConfig(name, inputSchema), handler)
  }

  registerPublicTool(
    "get_context",
    undefined,
    async () =>
      runJsonTool(async () => {
        assertToolAllowed("get_context")
        return {
          productId: context.productId,
          userId: context.userId ?? null,
          role: context.role,
          tokenName: context.tokenName ?? null,
          scopes: context.scopes ?? null,
          capabilities: {
            effective: listContextCapabilities(context),
            tools: Object.fromEntries(
              PUBLIC_MCP_TOOL_NAMES.map((toolName) => [
                toolName,
                canUseCapability(
                  context,
                  PUBLIC_MCP_TOOLS[toolName].requiredCapability
                ),
              ])
            ),
            read: canUseCapability(context, "context.read"),
            write:
              canUseCapability(context, "surf_points.write") ||
              canUseCapability(context, "surf_points.delete") ||
              canUseCapability(context, "tables.write") ||
              canUseCapability(context, "tables.delete"),
          },
        }
      })
  )

  registerPublicTool(
    "list_surf_points",
    listSurfPointsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_surf_points")
        return repository.listSurfPoints(context, args)
      })
  )

  registerPublicTool(
    "create_surf_point",
    createSurfPointSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("create_surf_point")
        return repository.createSurfPoint(context, args)
      })
  )

  registerPublicTool(
    "update_surf_point",
    updateSurfPointSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_surf_point")
        return repository.updateSurfPoint(context, args)
      })
  )

  registerPublicTool(
    "delete_surf_point",
    deleteSurfPointSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("delete_surf_point")
        return repository.deleteSurfPoints(context, args.surfPointIds)
      })
  )

  registerPublicTool(
    "list_databases",
    listDatabasesSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_databases")
        return repository.listDatabases(context, args)
      })
  )

  registerPublicTool(
    "read_table",
    readTableSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("read_table")
        return repository.readTable(context, args)
      })
  )

  registerPublicTool(
    "get_table_row",
    getTableRowSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("get_table_row")
        return repository.getTableRow(context, args.rowId)
      })
  )

  registerPublicTool(
    "create_table_row",
    createTableRowSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("create_table_row")
        return repository.createTableRow(context, args)
      })
  )

  registerPublicTool(
    "update_table_row",
    updateTableRowSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_table_row")
        return repository.updateTableRow(context, args)
      })
  )

  registerPublicTool(
    "delete_table_rows",
    deleteTableRowsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("delete_table_rows")
        return repository.deleteTableRows(context, args.rowIds)
      })
  )
}

function registerResources(
  server: McpServer,
  repository: SignalSurfRepository,
  context: SignalSurfContext
) {
  if (canUseCapability(context, "context.read")) {
    server.registerResource(
      "signalsurf_context",
      "signalsurf://context",
      {
        title: "SignalSurf MCP Context",
        description: "Product and role context for this MCP connection.",
        mimeType: "application/json",
      },
      async (uri) => {
        assertCanUseCapability(context, "context.read")
        return jsonResource(uri.href, {
          productId: context.productId,
          userId: context.userId ?? null,
          role: context.role,
          tokenName: context.tokenName ?? null,
          scopes: context.scopes ?? null,
          capabilities: listContextCapabilities(context),
        })
      }
    )
  }

  if (canUseCapability(context, "surf_points.read")) {
    server.registerResource(
      "signalsurf_surf_points",
      "signalsurf://surf-points",
      {
        title: "SignalSurf Surf Points",
        description: "Non-deleted surf points for the current product.",
        mimeType: "application/json",
      },
      async (uri) => {
        assertCanUseCapability(context, "surf_points.read")
        return jsonResource(
          uri.href,
          await repository.listSurfPoints(context, { limit: 200 })
        )
      }
    )
  }

  if (canUseCapability(context, "tables.read")) {
    server.registerResource(
      "signalsurf_databases",
      "signalsurf://databases",
      {
        title: "SignalSurf Databases",
        description: "Databases/tables for the current product.",
        mimeType: "application/json",
      },
      async (uri) => {
        assertCanUseCapability(context, "tables.read")
        return jsonResource(
          uri.href,
          await repository.listDatabases(context, { limit: 200 })
        )
      }
    )

    server.registerResource(
      "signalsurf_database_rows",
      new ResourceTemplate("signalsurf://databases/{databaseId}/rows", {
        list: async () => {
          assertCanUseCapability(context, "tables.read")
          const { databases } = await repository.listDatabases(context, {
            limit: 200,
          })
          return {
            resources: databases.map(
              (database: { databaseId: string; name: string }) => ({
                uri: `signalsurf://databases/${database.databaseId}/rows`,
                name: `Rows: ${database.name}`,
                title: `${database.name} Rows`,
                description: `Rows for SignalSurf database ${database.name}`,
                mimeType: "application/json",
              })
            ),
          }
        },
      }),
      {
        title: "SignalSurf Database Rows",
        description:
          "Rows for one SignalSurf database. Use the databaseId template variable.",
        mimeType: "application/json",
      },
      async (uri, variables) => {
        assertCanUseCapability(context, "tables.read")
        const databaseId = String(variables.databaseId ?? "")
        return jsonResource(
          uri.href,
          await repository.readTable(context, { databaseId, limit: 100 })
        )
      }
    )
  }
}
