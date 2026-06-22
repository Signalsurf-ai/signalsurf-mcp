import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js"

import {
  assertCanUseCapability,
  authorizedProductIds,
  authorizedProducts,
  canUseCapability,
  listContextCapabilities,
  resolveProductContext,
} from "./auth.js"
import {
  PUBLIC_MCP_TOOLS,
  PUBLIC_MCP_TOOL_NAMES,
  requiredCapabilitiesForTool,
  type PublicMcpToolName,
} from "./capabilities.js"
import { jsonResource, runJsonTool } from "./mcp-results.js"
import { SignalSurfRepository } from "./repository.js"
import {
  archiveAccountListProfileSchema,
  attachSurfPointToolSchema,
  createSurfPointSourceSchema,
  createProductSchema,
  createSurfPointSchema,
  createTableSchema,
  createTableRowSchema,
  addDatabaseFieldSchema,
  cancelSurfJobSchema,
  createRelationFieldSchema,
  deleteSurfPointSourceSchema,
  deleteSurfPointSchema,
  deleteTableSchema,
  deleteTableRowsSchema,
  detachSurfPointToolSchema,
  getBrandContextSchema,
  getSurfPointSchema,
  getSurfJobSchema,
  getTableRowSchema,
  listAccountListProfilesSchema,
  listDatabasesSchema,
  listDatabaseViewsSchema,
  listDatabaseFieldsSchema,
  listProductToolsSchema,
  listSurfPointSourcesSchema,
  listSurfPointToolsSchema,
  listWebhookPayloadSamplesSchema,
  previewImportMappingSchema,
  removeDatabaseFieldSchema,
  listSurfJobsSchema,
  listSurfPointsSchema,
  readTableSchema,
  readTableViewSchema,
  replayWebhookPayloadSchema,
  runSurfPointSchema,
  saveAccountListProfileSchema,
  deeplineSearchPeopleSchema,
  deeplineSearchCompaniesSchema,
  deeplineEnrichContactSchema,
  deeplineSearchCatalogSchema,
  deeplineExecuteToolSchema,
  setSurfPointSourceActiveSchema,
  enableQuickSurfSchema,
  disableQuickSurfSchema,
  listQuickSurfSchema,
  runQuickSurfSchema,
  updateDatabaseFieldSchema,
  updateSurfPointSourceSchema,
  toolOutputSchema,
  updateSurfPointSchema,
  updateTableSchema,
  updateTableRowSchema,
  waitForSurfJobSchema,
} from "./schemas.js"
import type { SignalSurfContext } from "./types.js"

export type CreateServerOptions = {
  context: SignalSurfContext
  repository: SignalSurfRepository
}

export async function createSignalSurfMcpServer(
  options: CreateServerOptions
): Promise<McpServer> {
  const { context, repository } = options
  // OAuth/database tokens resolve product names during token resolution; static
  // env tokens do not. Resolve them once here so every response (get_context and
  // the signalsurf://context resource) reports real names instead of raw UUIDs.
  if (!context.products?.length) {
    try {
      const resolved = await repository.resolveProductContexts(
        authorizedProductIds(context)
      )
      if (resolved.length) context.products = resolved
    } catch {
      // Name resolution is best-effort; fall back to UUID display on failure.
    }
  }
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
        "Use these tools to work with SignalSurf products authorized for this MCP token. Call get_context first; choose products by products[].name and pass products[].productId to every product-scoped tool call when multiple products are authorized.",
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
      outputSchema: toolOutputSchema,
    }
    return inputSchema ? { ...config, inputSchema } : config
  }

  function assertToolAllowed(name: PublicMcpToolName) {
    for (const capability of requiredCapabilitiesForTool(name)) {
      assertCanUseCapability(context, capability)
    }
  }

  function toolContext(args: any): SignalSurfContext {
    return resolveProductContext(
      context,
      typeof args?.productId === "string" ? args.productId : undefined
    )
  }

  function registerPublicTool(
    name: PublicMcpToolName,
    inputSchema: any,
    handler: (args: any) => Promise<any>
  ) {
    server.registerTool(name, toolConfig(name, inputSchema), handler)
  }

  registerPublicTool("get_context", undefined, async () =>
    runJsonTool(async () => {
      assertToolAllowed("get_context")
      const productIds = authorizedProductIds(context)
      const products = authorizedProducts(context)
      return {
        productId: context.productId,
        productIds,
        products,
        userId: context.userId ?? null,
        role: context.role,
        tokenName: context.tokenName ?? null,
        scopes: context.scopes ?? null,
        capabilities: {
          effective: listContextCapabilities(context),
          tools: Object.fromEntries(
            PUBLIC_MCP_TOOL_NAMES.map((toolName) => [
              toolName,
              requiredCapabilitiesForTool(toolName).every((capability) =>
                canUseCapability(context, capability)
              ),
            ])
          ),
          read: canUseCapability(context, "context.read"),
          execute:
            canUseCapability(context, "surf_points.execute") ||
            canUseCapability(context, "deepline.execute"),
          write:
            canUseCapability(context, "products.write") ||
            canUseCapability(context, "surf_points.execute") ||
            canUseCapability(context, "surf_points.write") ||
            canUseCapability(context, "surf_points.delete") ||
            canUseCapability(context, "tables.write") ||
            canUseCapability(context, "tables.delete") ||
            canUseCapability(context, "schemas.write") ||
            canUseCapability(context, "sources.write") ||
            canUseCapability(context, "account_lists.write") ||
            canUseCapability(context, "deepline.enrich") ||
            canUseCapability(context, "deepline.execute"),
        },
      }
    })
  )

  registerPublicTool(
    "get_brand_context",
    getBrandContextSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("get_brand_context")
        return repository.getBrandContext(toolContext(args))
      })
  )

  registerPublicTool("create_product", createProductSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("create_product")
      return repository.createProduct(context, args)
    })
  )

  registerPublicTool(
    "list_surf_points",
    listSurfPointsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_surf_points")
        return repository.listSurfPoints(toolContext(args), args)
      })
  )

  registerPublicTool("get_surf_point", getSurfPointSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("get_surf_point")
      return repository.getSurfPoint(toolContext(args), args.surfPointId)
    })
  )

  registerPublicTool(
    "create_surf_point",
    createSurfPointSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("create_surf_point")
        return repository.createSurfPoint(toolContext(args), args)
      })
  )

  registerPublicTool(
    "update_surf_point",
    updateSurfPointSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_surf_point")
        return repository.updateSurfPoint(toolContext(args), args)
      })
  )

  registerPublicTool("run_surf_point", runSurfPointSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("run_surf_point")
      return repository.runSurfPoint(toolContext(args), args)
    })
  )

  registerPublicTool("get_surf_job", getSurfJobSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("get_surf_job")
      return repository.getSurfJob(toolContext(args), args.jobId)
    })
  )

  registerPublicTool(
    "wait_for_surf_job",
    waitForSurfJobSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("wait_for_surf_job")
        return repository.waitForSurfJob(toolContext(args), args)
      })
  )

  registerPublicTool("list_surf_jobs", listSurfJobsSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("list_surf_jobs")
      return repository.listSurfJobs(toolContext(args), args)
    })
  )

  registerPublicTool(
    "cancel_surf_job",
    cancelSurfJobSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("cancel_surf_job")
        return repository.cancelSurfJob(toolContext(args), args.jobId)
      })
  )

  registerPublicTool(
    "delete_surf_point",
    deleteSurfPointSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("delete_surf_point")
        return repository.deleteSurfPoints(toolContext(args), args.surfPointIds)
      })
  )

  registerPublicTool("list_databases", listDatabasesSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("list_databases")
      return repository.listDatabases(toolContext(args), args)
    })
  )

  registerPublicTool("create_table", createTableSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("create_table")
      return repository.createTable(toolContext(args), args)
    })
  )

  registerPublicTool("update_table", updateTableSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("update_table")
      return repository.updateTable(toolContext(args), args)
    })
  )

  registerPublicTool("delete_table", deleteTableSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("delete_table")
      return repository.deleteTables(toolContext(args), args.databaseIds)
    })
  )

  registerPublicTool(
    "list_database_views",
    listDatabaseViewsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_database_views")
        return repository.listDatabaseViews(toolContext(args), args.databaseId)
      })
  )

  registerPublicTool("read_table", readTableSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("read_table")
      return repository.readTable(toolContext(args), args)
    })
  )

  registerPublicTool(
    "read_table_view",
    readTableViewSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("read_table_view")
        return repository.readTableView(toolContext(args), args)
      })
  )

  registerPublicTool("get_table_row", getTableRowSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("get_table_row")
      return repository.getTableRow(toolContext(args), args.rowId)
    })
  )

  registerPublicTool(
    "create_table_row",
    createTableRowSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("create_table_row")
        return repository.createTableRow(toolContext(args), args)
      })
  )

  registerPublicTool(
    "update_table_row",
    updateTableRowSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_table_row")
        return repository.updateTableRow(toolContext(args), args)
      })
  )

  registerPublicTool(
    "delete_table_rows",
    deleteTableRowsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("delete_table_rows")
        return repository.deleteTableRows(toolContext(args), args.rowIds)
      })
  )

  registerPublicTool(
    "list_database_fields",
    listDatabaseFieldsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_database_fields")
        return repository.listDatabaseFields(toolContext(args), args.databaseId)
      })
  )

  registerPublicTool(
    "add_database_field",
    addDatabaseFieldSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("add_database_field")
        return repository.addDatabaseField(toolContext(args), args)
      })
  )

  registerPublicTool(
    "update_database_field",
    updateDatabaseFieldSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_database_field")
        return repository.updateDatabaseField(toolContext(args), args)
      })
  )

  registerPublicTool(
    "remove_database_field",
    removeDatabaseFieldSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("remove_database_field")
        return repository.removeDatabaseField(toolContext(args), args)
      })
  )

  registerPublicTool(
    "create_relation_field",
    createRelationFieldSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("create_relation_field")
        return repository.createRelationField(toolContext(args), args)
      })
  )

  registerPublicTool(
    "list_surf_point_sources",
    listSurfPointSourcesSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_surf_point_sources")
        return repository.listSurfPointSources(
          toolContext(args),
          args.surfPointId
        )
      })
  )

  registerPublicTool(
    "create_surf_point_source",
    createSurfPointSourceSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("create_surf_point_source")
        return repository.createSurfPointSource(toolContext(args), args)
      })
  )

  registerPublicTool(
    "update_surf_point_source",
    updateSurfPointSourceSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_surf_point_source")
        return repository.updateSurfPointSource(toolContext(args), args)
      })
  )

  registerPublicTool(
    "delete_surf_point_source",
    deleteSurfPointSourceSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("delete_surf_point_source")
        return repository.deleteSurfPointSource(toolContext(args), args)
      })
  )

  registerPublicTool(
    "set_surf_point_source_active",
    setSurfPointSourceActiveSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("set_surf_point_source_active")
        return repository.setSurfPointSourceActive(toolContext(args), args)
      })
  )

  registerPublicTool(
    "list_webhook_payload_samples",
    listWebhookPayloadSamplesSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_webhook_payload_samples")
        return repository.listWebhookPayloadSamples(toolContext(args), args)
      })
  )

  registerPublicTool(
    "preview_import_mapping",
    previewImportMappingSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("preview_import_mapping")
        return repository.previewImportMapping(toolContext(args), args)
      })
  )

  registerPublicTool(
    "replay_webhook_payload",
    replayWebhookPayloadSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("replay_webhook_payload")
        return repository.replayWebhookPayload(toolContext(args), args)
      })
  )

  registerPublicTool(
    "enable_quick_surf",
    enableQuickSurfSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("enable_quick_surf")
        return repository.enableQuickSurf(toolContext(args), args)
      })
  )

  registerPublicTool(
    "disable_quick_surf",
    disableQuickSurfSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("disable_quick_surf")
        return repository.disableQuickSurf(toolContext(args), args)
      })
  )

  registerPublicTool("list_quick_surf", listQuickSurfSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("list_quick_surf")
      return repository.listQuickSurf(toolContext(args), args)
    })
  )

  registerPublicTool("run_quick_surf", runQuickSurfSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("run_quick_surf")
      return repository.runQuickSurf(toolContext(args), args)
    })
  )

  registerPublicTool(
    "list_product_tools",
    listProductToolsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_product_tools")
        return repository.listProductTools(toolContext(args), args)
      })
  )

  registerPublicTool(
    "list_surf_point_tools",
    listSurfPointToolsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_surf_point_tools")
        return repository.listSurfPointTools(
          toolContext(args),
          args.surfPointId
        )
      })
  )

  registerPublicTool(
    "attach_surf_point_tool",
    attachSurfPointToolSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("attach_surf_point_tool")
        return repository.attachSurfPointTool(toolContext(args), args)
      })
  )

  registerPublicTool(
    "detach_surf_point_tool",
    detachSurfPointToolSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("detach_surf_point_tool")
        return repository.detachSurfPointTool(toolContext(args), args)
      })
  )

  registerPublicTool(
    "list_account_list_profiles",
    listAccountListProfilesSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_account_list_profiles")
        return repository.listAccountListProfiles(toolContext(args), args)
      })
  )

  registerPublicTool(
    "save_account_list_profile",
    saveAccountListProfileSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("save_account_list_profile")
        return repository.saveAccountListProfile(toolContext(args), args)
      })
  )

  registerPublicTool(
    "archive_account_list_profile",
    archiveAccountListProfileSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("archive_account_list_profile")
        return repository.archiveAccountListProfile(
          toolContext(args),
          args.profileId
        )
      })
  )

  registerPublicTool(
    "deepline_search_people",
    deeplineSearchPeopleSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("deepline_search_people")
        return repository.deeplineSearchPeople(toolContext(args), args)
      })
  )

  registerPublicTool(
    "deepline_search_companies",
    deeplineSearchCompaniesSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("deepline_search_companies")
        return repository.deeplineSearchCompanies(toolContext(args), args)
      })
  )

  registerPublicTool(
    "deepline_enrich_contact",
    deeplineEnrichContactSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("deepline_enrich_contact")
        return repository.deeplineEnrichContact(toolContext(args), args)
      })
  )

  registerPublicTool(
    "deepline_search_catalog",
    deeplineSearchCatalogSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("deepline_search_catalog")
        return repository.deeplineSearchCatalog(toolContext(args), args)
      })
  )

  registerPublicTool(
    "deepline_execute_tool",
    deeplineExecuteToolSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("deepline_execute_tool")
        return repository.deeplineExecuteTool(toolContext(args), args)
      })
  )
}

function registerResources(
  server: McpServer,
  repository: SignalSurfRepository,
  context: SignalSurfContext
) {
  const contextProductIds = authorizedProductIds(context)
  const contextProducts = authorizedProducts(context)

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
        productIds: contextProductIds,
        products: contextProducts,
        userId: context.userId ?? null,
        role: context.role,
        tokenName: context.tokenName ?? null,
        scopes: context.scopes ?? null,
        capabilities: listContextCapabilities(context),
      })
    }
  )

  if (contextProductIds.length > 1) return

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
        await repository.listSurfPoints(resolveProductContext(context), {
          limit: 200,
        })
      )
    }
  )

  server.registerResource(
    "signalsurf_surf_point",
    new ResourceTemplate("signalsurf://surf-points/{surfPointId}", {
      list: async () => {
        if (!canUseCapability(context, "surf_points.read")) {
          return { resources: [] }
        }
        const { surfPoints } = await repository.listSurfPoints(
          resolveProductContext(context),
          {
            limit: 200,
          }
        )
        return {
          resources: surfPoints.map(
            (surfPoint: { surfPointId: string; name: string }) => ({
              uri: `signalsurf://surf-points/${surfPoint.surfPointId}`,
              name: `Surf Point: ${surfPoint.name}`,
              title: surfPoint.name,
              description: `SignalSurf surf point ${surfPoint.name}`,
              mimeType: "application/json",
            })
          ),
        }
      },
    }),
    {
      title: "SignalSurf Surf Point",
      description: "One surf point by surfPointId.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      assertCanUseCapability(context, "surf_points.read")
      return jsonResource(
        uri.href,
        await repository.getSurfPoint(
          resolveProductContext(context),
          String(variables.surfPointId ?? "")
        )
      )
    }
  )

  server.registerResource(
    "signalsurf_surf_point_sources",
    new ResourceTemplate("signalsurf://surf-points/{surfPointId}/sources", {
      list: async () => {
        if (
          !canUseCapability(context, "sources.read") ||
          !canUseCapability(context, "surf_points.read")
        ) {
          return { resources: [] }
        }
        const { surfPoints } = await repository.listSurfPoints(
          resolveProductContext(context),
          {
            limit: 200,
          }
        )
        return {
          resources: surfPoints.map(
            (surfPoint: { surfPointId: string; name: string }) => ({
              uri: `signalsurf://surf-points/${surfPoint.surfPointId}/sources`,
              name: `Sources: ${surfPoint.name}`,
              title: `${surfPoint.name} Sources`,
              description: `Safe source metadata for SignalSurf surf point ${surfPoint.name}`,
              mimeType: "application/json",
            })
          ),
        }
      },
    }),
    {
      title: "SignalSurf Surf Point Sources",
      description: "Safe source metadata for one surf point.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      assertCanUseCapability(context, "sources.read")
      return jsonResource(
        uri.href,
        await repository.listSurfPointSources(
          resolveProductContext(context),
          String(variables.surfPointId ?? "")
        )
      )
    }
  )

  server.registerResource(
    "signalsurf_surf_point_tools",
    new ResourceTemplate("signalsurf://surf-points/{surfPointId}/tools", {
      list: async () => {
        if (!canUseCapability(context, "surf_points.read")) {
          return { resources: [] }
        }
        const { surfPoints } = await repository.listSurfPoints(
          resolveProductContext(context),
          {
            limit: 200,
          }
        )
        return {
          resources: surfPoints.map(
            (surfPoint: { surfPointId: string; name: string }) => ({
              uri: `signalsurf://surf-points/${surfPoint.surfPointId}/tools`,
              name: `Tools: ${surfPoint.name}`,
              title: `${surfPoint.name} Tools`,
              description: `Tool ids attached to SignalSurf surf point ${surfPoint.name}`,
              mimeType: "application/json",
            })
          ),
        }
      },
    }),
    {
      title: "SignalSurf Surf Point Tools",
      description: "Tool ids attached to one surf point.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      assertCanUseCapability(context, "surf_points.read")
      return jsonResource(
        uri.href,
        await repository.listSurfPointTools(
          resolveProductContext(context),
          String(variables.surfPointId ?? "")
        )
      )
    }
  )

  server.registerResource(
    "signalsurf_product_tools",
    "signalsurf://product-tools",
    {
      title: "SignalSurf Product Tools",
      description: "Safe product tool metadata for the current product.",
      mimeType: "application/json",
    },
    async (uri) => {
      assertCanUseCapability(context, "surf_points.read")
      return jsonResource(
        uri.href,
        await repository.listProductTools(resolveProductContext(context), {
          limit: 200,
        })
      )
    }
  )

  server.registerResource(
    "signalsurf_account_list_profiles",
    "signalsurf://account-list-profiles",
    {
      title: "SignalSurf Account List ICP Profiles",
      description: "Reusable Account List / ICP Builder profiles.",
      mimeType: "application/json",
    },
    async (uri) => {
      assertCanUseCapability(context, "account_lists.read")
      return jsonResource(
        uri.href,
        await repository.listAccountListProfiles(
          resolveProductContext(context),
          {
            includeArchived: true,
            limit: 100,
          }
        )
      )
    }
  )

  server.registerResource(
    "signalsurf_surf_jobs",
    "signalsurf://surf-jobs",
    {
      title: "SignalSurf Surf Jobs",
      description: "Recent surf point execution jobs for the current product.",
      mimeType: "application/json",
    },
    async (uri) => {
      assertCanUseCapability(context, "surf_points.read")
      return jsonResource(
        uri.href,
        await repository.listSurfJobs(resolveProductContext(context), {
          limit: 100,
        })
      )
    }
  )

  server.registerResource(
    "signalsurf_surf_job",
    new ResourceTemplate("signalsurf://surf-jobs/{jobId}", {
      list: async () => {
        if (!canUseCapability(context, "surf_points.read")) {
          return { resources: [] }
        }
        const { jobs } = await repository.listSurfJobs(
          resolveProductContext(context),
          {
            limit: 100,
          }
        )
        return {
          resources: jobs.map((job: { jobId: string; status: string }) => ({
            uri: `signalsurf://surf-jobs/${job.jobId}`,
            name: `Surf Job: ${job.jobId}`,
            title: `Surf Job ${job.jobId}`,
            description: `SignalSurf surf job with status ${job.status}`,
            mimeType: "application/json",
          })),
        }
      },
    }),
    {
      title: "SignalSurf Surf Job",
      description: "One surf point execution job by job id.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      assertCanUseCapability(context, "surf_points.read")
      return jsonResource(
        uri.href,
        await repository.getSurfJob(
          resolveProductContext(context),
          String(variables.jobId ?? "")
        )
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
      assertCanUseCapability(context, "tables.read")
      return jsonResource(
        uri.href,
        await repository.listDatabases(resolveProductContext(context), {
          limit: 200,
        })
      )
    }
  )

  server.registerResource(
    "signalsurf_database_rows",
    new ResourceTemplate("signalsurf://databases/{databaseId}/rows", {
      list: async () => {
        if (!canUseCapability(context, "tables.read")) {
          return { resources: [] }
        }
        const { databases } = await repository.listDatabases(
          resolveProductContext(context),
          {
            limit: 200,
          }
        )
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
        await repository.readTable(resolveProductContext(context), {
          databaseId,
          limit: 100,
        })
      )
    }
  )
}
