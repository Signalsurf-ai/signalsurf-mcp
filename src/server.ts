import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"

import { assertCanRead, assertCanWrite } from "./auth.js"
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
  server.registerTool(
    "get_context",
    {
      title: "Get SignalSurf MCP Context",
      description:
        "Return the product, user, role, and capability context bound to this MCP connection.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      runJsonTool(async () => {
        assertCanRead(context)
        return {
          productId: context.productId,
          userId: context.userId ?? null,
          role: context.role,
          tokenName: context.tokenName ?? null,
          capabilities: {
            read: true,
            write: context.role === "editor" || context.role === "owner",
          },
        }
      })
  )

  server.registerTool(
    "list_surf_points",
    {
      title: "List Surf Points",
      description:
        "List SignalSurf surf points for the current product. Soft-deleted rows are never returned; pass includeInactive=false to hide paused surf points.",
      inputSchema: listSurfPointsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanRead(context)
        return repository.listSurfPoints(context, args)
      })
  )

  server.registerTool(
    "create_surf_point",
    {
      title: "Create Surf Point",
      description:
        "Create a surf point/playbook in the current product. Pass databaseIds when the product has multiple databases.",
      inputSchema: createSurfPointSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanWrite(context)
        return repository.createSurfPoint(context, args)
      })
  )

  server.registerTool(
    "update_surf_point",
    {
      title: "Update Surf Point",
      description:
        "Modify surf point metadata, prompt fields, target databases, and JSON config for the current product.",
      inputSchema: updateSurfPointSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanWrite(context)
        return repository.updateSurfPoint(context, args)
      })
  )

  server.registerTool(
    "delete_surf_point",
    {
      title: "Delete Surf Point",
      description:
        "Soft-delete one or more surf points in the current product and cancel pending jobs. This does not hard-delete historical rows.",
      inputSchema: deleteSurfPointSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanWrite(context)
        return repository.deleteSurfPoints(context, args.surfPointIds)
      })
  )

  server.registerTool(
    "list_databases",
    {
      title: "List Databases",
      description:
        "List product databases/tables available to this MCP token. System databases are hidden unless includeSystem is true.",
      inputSchema: listDatabasesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanRead(context)
        return repository.listDatabases(context, args)
      })
  )

  server.registerTool(
    "read_table",
    {
      title: "Read Table",
      description:
        "Read rows from a SignalSurf database/table in the current product. Supports pagination and exact JSON containment filters.",
      inputSchema: readTableSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanRead(context)
        return repository.readTable(context, args)
      })
  )

  server.registerTool(
    "get_table_row",
    {
      title: "Get Table Row",
      description: "Read one table row by rowId after verifying product scope.",
      inputSchema: getTableRowSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanRead(context)
        return repository.getTableRow(context, args.rowId)
      })
  )

  server.registerTool(
    "create_table_row",
    {
      title: "Create Table Row",
      description:
        "Create a row/item in a SignalSurf database/table after verifying it belongs to the current product.",
      inputSchema: createTableRowSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanWrite(context)
        return repository.createTableRow(context, args)
      })
  )

  server.registerTool(
    "update_table_row",
    {
      title: "Update Table Row",
      description:
        "Modify a row/item. Use dataPatch for shallow field updates or data to replace the row data object.",
      inputSchema: updateTableRowSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanWrite(context)
        return repository.updateTableRow(context, args)
      })
  )

  server.registerTool(
    "delete_table_rows",
    {
      title: "Delete Table Rows",
      description:
        "Delete one or more table rows/items after verifying every row belongs to the current product.",
      inputSchema: deleteTableRowsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runJsonTool(async () => {
        assertCanWrite(context)
        return repository.deleteTableRows(context, args.rowIds)
      })
  )
}

function registerResources(
  server: McpServer,
  repository: SignalSurfRepository,
  context: SignalSurfContext
) {
  server.registerResource(
    "signalsurf_context",
    "signalsurf://context",
    {
      title: "SignalSurf MCP Context",
      description: "Product and role context for this MCP connection.",
      mimeType: "application/json",
    },
    async (uri) => {
      assertCanRead(context)
      return jsonResource(uri.href, {
        productId: context.productId,
        userId: context.userId ?? null,
        role: context.role,
        tokenName: context.tokenName ?? null,
      })
    }
  )

  server.registerResource(
    "signalsurf_surf_points",
    "signalsurf://surf-points",
    {
      title: "SignalSurf Surf Points",
      description: "Non-deleted surf points for the current product.",
      mimeType: "application/json",
    },
    async (uri) => {
      assertCanRead(context)
      return jsonResource(
        uri.href,
        await repository.listSurfPoints(context, { limit: 200 })
      )
    }
  )

  server.registerResource(
    "signalsurf_databases",
    "signalsurf://databases",
    {
      title: "SignalSurf Databases",
      description: "Databases/tables for the current product.",
      mimeType: "application/json",
    },
    async (uri) => {
      assertCanRead(context)
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
        assertCanRead(context)
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
      assertCanRead(context)
      const databaseId = String(variables.databaseId ?? "")
      return jsonResource(
        uri.href,
        await repository.readTable(context, { databaseId, limit: 100 })
      )
    }
  )
}
