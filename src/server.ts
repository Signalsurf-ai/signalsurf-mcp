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
import { PROMPT_CATALOG, registerPrompts } from "./prompts.js"
import { SignalSurfRepository } from "./repository.js"
import { searchCapabilities } from "./tool-search.js"
import {
  createWorkflowSourceSchema,
  createProductSchema,
  createWorkflowSchema,
  createTableSchema,
  createTableRowSchema,
  addDatabaseFieldSchema,
  cancelSurfJobSchema,
  createRelationFieldSchema,
  deleteWorkflowSourceSchema,
  deleteWorkflowSchema,
  deleteTableSchema,
  deleteTableRowsSchema,
  editWorkflowFlowsSchema,
  createCampaignSchema,
  findCapabilitiesSchema,
  getBrandContextSchema,
  getEnrichmentContextSchema,
  getNodeUpstreamContextSchema,
  getWorkflowSchema,
  testWorkflowNodeSchema,
  getSurfJobSchema,
  getTableRowSchema,
  listDatabasesSchema,
  listDatabaseViewsSchema,
  listDatabaseFieldsSchema,
  listProductToolsSchema,
  listWorkflowSourcesSchema,
  listWorkflowToolsSchema,
  removeDatabaseFieldSchema,
  listSurfJobsSchema,
  listWorkflowsSchema,
  readTableSchema,
  readTableViewSchema,
  runWorkflowSchema,
  deeplineSearchPeopleSchema,
  deeplineSearchCompaniesSchema,
  deeplineEnrichContactSchema,
  deeplineSearchCatalogSchema,
  deeplineExecuteToolSchema,
  instagramContentSearchSchema,
  enableQuickSurfSchema,
  disableQuickSurfSchema,
  listQuickSurfSchema,
  runQuickSurfSchema,
  updateDatabaseFieldSchema,
  updateWorkflowSourceSchema,
  toolOutputSchema,
  updateWorkflowSchema,
  updateTableSchema,
  updateTableRowsSchema,
  waitForSurfJobSchema,
  PUBLIC_MCP_TOOL_SCHEMAS,
} from "./schemas.js"
import type { SignalSurfContext } from "./types.js"

export type CreateServerOptions = {
  context: SignalSurfContext
  repository: SignalSurfRepository
}

export const SERVER_INSTRUCTIONS = `SignalSurf MCP — operating manual.

Golden rule: call get_context FIRST. Resolve real ids before any id-typed parameter — productId from get_context (when multiple products), databaseId from list_tables, workflowId from list_workflows. Never pass a null or guessed id.

Execution model: enrichment runs on the SignalSurf server brain via Quick Surf and Workflows. Your job is to set up, trigger, and poll — not to fill cells by hand unless explicitly asked.

I want to… →
- Not sure which tool or prompt fits → call find_capabilities(query) to search by intent.
- Enrich a whole table → use the enrich_table prompt; it scripts get_enrichment_context → enable_quick_surf → run_quick_surf(scope="all") → wait_for_surf_job.
- Set up a new Workflow → use the set_up_workflow prompt.
- Build a lead list with Deepline → use the build_lead_list prompt.
- Build a multi-step / branching Workflow → a Workflow is a node graph (Flow V2). Call describe_node_types first, then edit_workflow_flows (atomic); get_node_upstream_context before mapping create_row fields.
- Build a contact-list email drip → use create_campaign (do not hand-wire it); pass a connected Unipile mailbox id.
- Decide what to write into a column → call get_enrichment_context(databaseId[, fieldKey]) for brand context, schema, popular existing values, and field conventions.
- Run or monitor a Workflow → run_workflow, then list_surf_jobs / wait_for_surf_job.
- Inspect data → list_tables, read_table, list_database_fields.

When multiple products are authorized, pass products[].productId (from get_context) on every product-scoped call.`

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
        prompts: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  )

  registerResources(server, repository, context)
  registerTools(server, repository, context)
  registerPrompts(server)
  return server
}

function registerTools(
  server: McpServer,
  repository: SignalSurfRepository,
  context: SignalSurfContext
) {
  const registeredTools = new Set<PublicMcpToolName>()

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
    if (inputSchema !== PUBLIC_MCP_TOOL_SCHEMAS[name]) {
      throw new Error(
        `Public MCP tool ${name} was registered with a non-canonical input schema.`
      )
    }
    if (registeredTools.has(name)) {
      throw new Error(`Public MCP tool ${name} was registered more than once.`)
    }
    registeredTools.add(name)
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
            canUseCapability(context, "workflows.execute") ||
            canUseCapability(context, "deepline.execute"),
          write:
            canUseCapability(context, "products.write") ||
            canUseCapability(context, "workflows.execute") ||
            canUseCapability(context, "workflows.write") ||
            canUseCapability(context, "workflows.delete") ||
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

  registerPublicTool(
    "get_enrichment_context",
    getEnrichmentContextSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("get_enrichment_context")
        return repository.getEnrichmentContext(toolContext(args), {
          databaseId: args.databaseId,
          fieldKey: args.fieldKey,
        })
      })
  )

  registerPublicTool(
    "find_capabilities",
    findCapabilitiesSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("find_capabilities")
        const tools = PUBLIC_MCP_TOOL_NAMES.filter(
          (name) =>
            name !== "find_capabilities" &&
            canUseCapability(context, PUBLIC_MCP_TOOLS[name].requiredCapability)
        ).map((name) => ({
          name,
          title: PUBLIC_MCP_TOOLS[name].title,
          description: PUBLIC_MCP_TOOLS[name].description,
        }))
        return searchCapabilities(
          typeof args?.query === "string" ? args.query : "",
          { tools, prompts: PROMPT_CATALOG }
        )
      })
  )

  registerPublicTool("create_product", createProductSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("create_product")
      return repository.createProduct(context, args)
    })
  )

  registerPublicTool(
    "list_workflows",
    listWorkflowsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_workflows")
        return repository.listWorkflows(toolContext(args), args)
      })
  )

  registerPublicTool("get_workflow", getWorkflowSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("get_workflow")
      return repository.getWorkflow(toolContext(args), args.workflowId)
    })
  )

  registerPublicTool(
    "create_workflow",
    createWorkflowSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("create_workflow")
        return repository.createWorkflow(toolContext(args), args)
      })
  )

  registerPublicTool(
    "update_workflow",
    updateWorkflowSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_workflow")
        return repository.updateWorkflow(toolContext(args), args)
      })
  )

  registerPublicTool("run_workflow", runWorkflowSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("run_workflow")
      return repository.runWorkflow(toolContext(args), args)
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
    "delete_workflow",
    deleteWorkflowSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("delete_workflow")
        return repository.deleteWorkflows(toolContext(args), args.workflowIds)
      })
  )

  registerPublicTool("describe_node_types", undefined, async () =>
    runJsonTool(async () => {
      assertToolAllowed("describe_node_types")
      return repository.describeNodeTypes()
    })
  )

  registerPublicTool(
    "edit_workflow_flows",
    editWorkflowFlowsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("edit_workflow_flows")
        return repository.applyFlowEdits(toolContext(args), {
          workflowId: args.workflowId,
          edits: args.edits,
        })
      })
  )

  registerPublicTool(
    "get_node_upstream_context",
    getNodeUpstreamContextSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("get_node_upstream_context")
        return repository.getNodeUpstreamContext(toolContext(args), {
          workflowId: args.workflowId,
          nodeId: args.nodeId,
        })
      })
  )

  registerPublicTool(
    "create_campaign",
    createCampaignSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("create_campaign")
        return repository.createCampaign(toolContext(args), {
          workflowId: args.workflowId,
          contactTableId: args.contactTableId,
          recipientField: args.recipientField,
          mailbox: args.mailbox,
          steps: args.steps,
        })
      })
  )

  registerPublicTool(
    "test_workflow_node",
    testWorkflowNodeSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("test_workflow_node")
        return repository.testWorkflowNode(toolContext(args), {
          workflowId: args.workflowId,
          nodeId: args.nodeId,
          sampleText: args.sampleText,
        })
      })
  )

  registerPublicTool("list_tables", listDatabasesSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("list_tables")
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
    "list_table_views",
    listDatabaseViewsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_table_views")
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
    "update_table_rows",
    updateTableRowsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_table_rows")
        return repository.updateTableRows(toolContext(args), args)
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
    "list_table_fields",
    listDatabaseFieldsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_table_fields")
        return repository.listDatabaseFields(toolContext(args), args.databaseId)
      })
  )

  registerPublicTool(
    "add_table_field",
    addDatabaseFieldSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("add_table_field")
        return repository.addDatabaseField(toolContext(args), args)
      })
  )

  registerPublicTool(
    "update_table_field",
    updateDatabaseFieldSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_table_field")
        return repository.updateDatabaseField(toolContext(args), args)
      })
  )

  registerPublicTool(
    "remove_table_field",
    removeDatabaseFieldSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("remove_table_field")
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
    "list_signals",
    listWorkflowSourcesSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_signals")
        return repository.listWorkflowSources(
          toolContext(args),
          args.workflowId
        )
      })
  )

  registerPublicTool(
    "create_signal",
    createWorkflowSourceSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("create_signal")
        return repository.createWorkflowSource(toolContext(args), args)
      })
  )

  registerPublicTool(
    "update_signal",
    updateWorkflowSourceSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("update_signal")
        return repository.updateWorkflowSource(toolContext(args), args)
      })
  )

  registerPublicTool(
    "delete_signal",
    deleteWorkflowSourceSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("delete_signal")
        return repository.deleteWorkflowSource(toolContext(args), args)
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

  registerPublicTool(
    "list_quick_surf",
    listQuickSurfSchema,
    async (args: any) =>
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
    "list_workflow_tools",
    listWorkflowToolsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_workflow_tools")
        return repository.listWorkflowTools(
          toolContext(args),
          args.workflowId
        )
      })
  )

  registerPublicTool(
    "search_instagram_content",
    instagramContentSearchSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("search_instagram_content")
        return repository.searchInstagramContent(toolContext(args), args)
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

  const missingTools = PUBLIC_MCP_TOOL_NAMES.filter(
    (name) => !registeredTools.has(name)
  )
  if (missingTools.length > 0) {
    throw new Error(
      `Public MCP registry is missing executable handlers: ${missingTools.join(
        ", "
      )}`
    )
  }
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
    "signalsurf_workflows",
    "signalsurf://workflows",
    {
      title: "SignalSurf Workflows",
      description: "Non-deleted Workflows for the current product.",
      mimeType: "application/json",
    },
    async (uri) => {
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.listWorkflows(resolveProductContext(context), {
          limit: 200,
        })
      )
    }
  )

  server.registerResource(
    "signalsurf_workflow",
    new ResourceTemplate("signalsurf://workflows/{workflowId}", {
      list: async () => {
        if (!canUseCapability(context, "workflows.read")) {
          return { resources: [] }
        }
        const { workflows } = await repository.listWorkflows(
          resolveProductContext(context),
          {
            limit: 200,
          }
        )
        return {
          resources: workflows.map(
            (workflow: { workflowId: string; name: string }) => ({
              uri: `signalsurf://workflows/${workflow.workflowId}`,
              name: `Workflow: ${workflow.name}`,
              title: workflow.name,
              description: `SignalSurf Workflow ${workflow.name}`,
              mimeType: "application/json",
            })
          ),
        }
      },
    }),
    {
      title: "SignalSurf Workflow",
      description: "One Workflow by workflowId.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.getWorkflow(
          resolveProductContext(context),
          String(variables.workflowId ?? "")
        )
      )
    }
  )

  server.registerResource(
    "signalsurf_workflow_sources",
    new ResourceTemplate("signalsurf://workflows/{workflowId}/sources", {
      list: async () => {
        if (
          !canUseCapability(context, "sources.read") ||
          !canUseCapability(context, "workflows.read")
        ) {
          return { resources: [] }
        }
        const { workflows } = await repository.listWorkflows(
          resolveProductContext(context),
          {
            limit: 200,
          }
        )
        return {
          resources: workflows.map(
            (workflow: { workflowId: string; name: string }) => ({
              uri: `signalsurf://workflows/${workflow.workflowId}/sources`,
              name: `Sources: ${workflow.name}`,
              title: `${workflow.name} Sources`,
              description: `Safe source metadata for SignalSurf Workflow ${workflow.name}`,
              mimeType: "application/json",
            })
          ),
        }
      },
    }),
    {
      title: "SignalSurf Workflow Sources",
      description: "Safe source metadata for one Workflow.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      assertCanUseCapability(context, "sources.read")
      return jsonResource(
        uri.href,
        await repository.listWorkflowSources(
          resolveProductContext(context),
          String(variables.workflowId ?? "")
        )
      )
    }
  )

  server.registerResource(
    "signalsurf_workflow_tools",
    new ResourceTemplate("signalsurf://workflows/{workflowId}/tools", {
      list: async () => {
        if (!canUseCapability(context, "workflows.read")) {
          return { resources: [] }
        }
        const { workflows } = await repository.listWorkflows(
          resolveProductContext(context),
          {
            limit: 200,
          }
        )
        return {
          resources: workflows.map(
            (workflow: { workflowId: string; name: string }) => ({
              uri: `signalsurf://workflows/${workflow.workflowId}/tools`,
              name: `Tools: ${workflow.name}`,
              title: `${workflow.name} Tools`,
              description: `Tool ids attached to SignalSurf Workflow ${workflow.name}`,
              mimeType: "application/json",
            })
          ),
        }
      },
    }),
    {
      title: "SignalSurf Workflow Tools",
      description: "Tool ids attached to one Workflow.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.listWorkflowTools(
          resolveProductContext(context),
          String(variables.workflowId ?? "")
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
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.listProductTools(resolveProductContext(context), {
          limit: 200,
        })
      )
    }
  )

  server.registerResource(
    "signalsurf_surf_jobs",
    "signalsurf://surf-jobs",
    {
      title: "SignalSurf Surf Jobs",
      description: "Recent Workflow execution jobs for the current product.",
      mimeType: "application/json",
    },
    async (uri) => {
      assertCanUseCapability(context, "workflows.read")
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
        if (!canUseCapability(context, "workflows.read")) {
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
      description: "One Workflow execution job by job id.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      assertCanUseCapability(context, "workflows.read")
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
