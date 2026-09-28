import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js"

import {
  assertCanUseCapability,
  authorizedWorkspaceIds,
  authorizedWorkspaces,
  canUseCapability,
  listContextCapabilities,
  resolveWorkspaceContext,
} from "./auth.js"
import type { PublicMcpToolName } from "./capabilities.js"
import { UserFacingError } from "./errors.js"
import { jsonErrorResult, jsonResource, runJsonTool } from "./mcp-results.js"
import { registerPrompts, workspaceVisiblePromptCatalog } from "./prompts.js"
import { SignalSurfRepository } from "./repository.js"
import {
  PUBLIC_MCP_TOOL_SCHEMAS,
  addDatabaseFieldSchema,
  cancelSurfJobSchema,
  createCampaignSchema,
  createRelationFieldSchema,
  createTableRowSchema,
  createTableSchema,
  createWorkflowSchema,
  createWorkflowSourceSchema,
  deeplineEnrichContactSchema,
  deeplineExecuteToolSchema,
  deeplineSearchCatalogSchema,
  deeplineSearchCompaniesSchema,
  deeplineSearchPeopleSchema,
  deleteTableRowsSchema,
  deleteTableSchema,
  deleteWorkflowSchema,
  deleteWorkflowSourceSchema,
  disableEnrichSchema,
  editWorkflowFlowsSchema,
  enableEnrichSchema,
  findCapabilitiesSchema,
  getBrandContextSchema,
  getEnrichmentContextSchema,
  getNodeUpstreamContextSchema,
  getSurfJobSchema,
  getTableRowSchema,
  getWorkflowSchema,
  getWorkspaceContextSchema,
  inspectSenderInfrastructureSchema,
  instagramContentSearchSchema,
  listDatabaseFieldsSchema,
  listDatabaseViewsSchema,
  listDatabasesSchema,
  listEnrichSchema,
  listSurfJobsSchema,
  listWorkflowSourcesSchema,
  listWorkflowToolsSchema,
  listWorkflowsSchema,
  listWorkspaceToolsSchema,
  planSenderCapacitySchema,
  readTableSchema,
  readTableViewSchema,
  removeDatabaseFieldSchema,
  runEnrichSchema,
  runWorkflowSchema,
  searchSenderDomainsSchema,
  testWorkflowNodeSchema,
  toolOutputSchema,
  updateDatabaseFieldSchema,
  updateTableRowsSchema,
  updateTableSchema,
  updateWorkflowSchema,
  updateWorkflowSourceSchema,
  waitForSurfJobSchema,
} from "./schemas.js"
import { installPaginatedToolList } from "./tool-list-pagination.js"
import {
  SIGNALSURF_HOSTED_MCP_TOOL_NAMES,
  SIGNALSURF_MCP_TOOL_REGISTRY,
  signalSurfHostedMcpRegistryTool,
} from "./tool-registry.js"
import { searchCapabilities } from "./tool-search.js"
import type { SignalSurfContext } from "./types.js"
import {
  SignalSurfWebExecutionClient,
  createSignalSurfWebExecutionSurface,
  type SignalSurfWebExecutionClientOptions,
} from "./web-execution.js"
import {
  WORKSPACE_CAPABILITIES,
  assertWorkspaceToolAllowed,
  isToolVisibleAcrossWorkspaces,
  projectMcpCapabilitiesForWorkspace,
  workspaceCapabilityEnabled,
  workspaceCapabilityForTool,
  workspaceToolAllowed,
} from "./workspace-capabilities.js"
import { buildWorkspaceContext } from "./workspace-context.js"

export type CreateServerOptions = {
  context: SignalSurfContext
  repository: SignalSurfRepository
  /** Authenticated Web execution boundary for Project collaboration tools. */
  webExecution?: SignalSurfWebExecutionClientOptions
  /** Public connector icon; omit it when the current HTTP origin cannot serve it. */
  iconUrl?: string
  /** Serve only the initialize handshake; later stateless requests build handlers. */
  initializeOnly?: boolean
  /** Build deterministic discovery without loading workspace application state. */
  discoveryOnly?: boolean
}

export const SERVER_INSTRUCTIONS = `SignalSurf MCP — operating manual.

Golden rule: call get_workspace_context FIRST. Resolve real ids before any id-typed parameter — workspaceId from get_workspace_context (when multiple workspaces), databaseId from list_tables, workflowId from list_workflows. Never pass a null or guessed id.

Execution model: enrichment runs on the SignalSurf server brain via Enrich and Workflows. Your job is to set up, trigger, and poll — not to fill cells by hand unless explicitly asked.

I want to… →
- Not sure which tool or prompt fits → call find_capabilities(query) to search by intent.
- Enrich a whole table → use the enrich_table prompt; it scripts get_enrichment_context → enable_enrich → run_enrich(scope="all") → wait_for_surf_job.
- Set up a new Workflow → use the set_up_workflow prompt.
- Build a lead list with Deepline → use the build_lead_list prompt.
- Build a multi-step / branching Workflow → a Workflow is a node graph (Flow V2). Call describe_node_types first, then edit_workflow_flows (atomic); get_node_upstream_context before mapping create_row fields.
- Build a contact-list email drip → use create_campaign (do not hand-wire it); pass a connected Unipile mailbox id.
- Decide what to write into a column → call get_enrichment_context(databaseId[, fieldKey]) for brand context, schema, popular existing values, and field conventions.
- Run or monitor a Workflow → run_workflow, then list_surf_jobs / wait_for_surf_job.
- Inspect data → list_tables, read_table, list_table_fields.
- Plan or inspect sender infrastructure → inspect_sender_infrastructure, then plan_sender_capacity; use search_sender_domains for live Domain availability. Exact pricing, purchases, registrant details, and secrets stay in the secure SignalSurf app.

When multiple workspaces are authorized, pass workspaces[].workspaceId (from get_workspace_context) on every workspace-scoped call.`

export function workspaceProjectedServerInstructions(
  context: SignalSurfContext
): string {
  const sections = ["SignalSurf MCP — operating manual."]
  const canUseTool = (name: PublicMcpToolName) =>
    signalSurfHostedMcpRegistryTool(name).requiredCapabilities.every(
      (capability) => canUseCapability(context, capability)
    )
  if (canUseTool("get_workspace_context")) {
    sections.push(
      "Golden rule: call get_workspace_context FIRST. Resolve real ids before any id-typed parameter; never pass a null or guessed id.",
      "Not sure which available capability fits → call find_capabilities(query)."
    )
  }
  if (canUseTool("list_tables")) {
    sections.push(
      "For available Table work, resolve databaseId with list_tables before reading or changing rows, fields, views, or Enrich configuration.",
      "Use the enrich_table prompt for guided whole-column enrichment and get_enrichment_context before choosing column instructions."
    )
  }
  if (canUseTool("create_workflow")) {
    sections.push(
      "For available Workflow work, resolve workflowId with list_workflows; use set_up_workflow for guided setup and poll jobs after execution."
    )
  }
  if (canUseTool("create_campaign")) {
    sections.push(
      "For available Campaign work, use create_campaign instead of hand-wiring a sending flow."
    )
  }
  if (
    authorizedWorkspaceIds(context).length > 1 &&
    canUseTool("get_workspace_context")
  ) {
    sections.push(
      "When multiple workspaces are authorized, pass workspaces[].workspaceId from get_workspace_context on every workspace-scoped call."
    )
  }
  return sections.join("\n\n")
}

export async function createSignalSurfMcpServer(
  options: CreateServerOptions
): Promise<McpServer> {
  const { context, repository } = options
  const webExecutionClient = new SignalSurfWebExecutionClient(
    options.webExecution ?? {
      delegationToken: undefined,
    }
  )
  const webExecutionSurface = createSignalSurfWebExecutionSurface({
    client: webExecutionClient,
    scopes: context.scopes,
    role: context.role,
    tools: SIGNALSURF_MCP_TOOL_REGISTRY.filter(
      (tool) => tool.executionOwner === "signalsurf-web"
    ),
  })
  // Initialize only needs declared protocol capabilities and instructions.
  // Stateless follow-up requests build the authorized handlers they consume.
  const initializeOnly = options.initializeOnly === true
  // OAuth/database tokens resolve workspace names during token resolution; static
  // env tokens do not. Resolve them once here so every response (get_workspace_context and
  // the signalsurf://context resource) reports real names instead of raw UUIDs.
  if (
    !initializeOnly &&
    !options.discoveryOnly &&
    !context.workspaces?.length
  ) {
    try {
      const resolved = await repository.resolveWorkspaceContexts(
        authorizedWorkspaceIds(context)
      )
      if (resolved.length) context.workspaces = resolved
    } catch {
      // Name resolution is best-effort; fall back to UUID display on failure.
    }
  }
  // Connector bootstrap has a short end-to-end deadline. The Project catalog
  // and product capability projection are independent, so do not serialize
  // their remote reads. Initialize deliberately uses the complete static role
  // contract above instead of making an optional publisher round trip.
  const workspaceCapabilities = await (initializeOnly || options.discoveryOnly
    ? Promise.resolve(context.workspaceCapabilitiesByWorkspaceId ?? {})
    : context.workspaceCapabilitiesByWorkspaceId
      ? Promise.resolve(context.workspaceCapabilitiesByWorkspaceId)
      : loadRepositoryCapabilities(repository, authorizedWorkspaceIds(context)))
  context.workspaceCapabilitiesByWorkspaceId = workspaceCapabilities
  const server = new McpServer(
    {
      name: "signalsurf-mcp",
      title: "SignalSurf",
      version: "0.1.0",
      ...(options.iconUrl
        ? {
            icons: [
              {
                src: options.iconUrl,
                mimeType: "image/png",
                sizes: ["180x180"],
              },
            ],
          }
        : {}),
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
      instructions: `${webExecutionSurface.instructions}\n\n${workspaceProjectedServerInstructions(context)}`,
    }
  )

  if (initializeOnly) return server

  registerResources(server, repository, context)
  registerTools(
    server,
    repository,
    context,
    webExecutionClient,
    webExecutionSurface.capabilities
  )
  webExecutionSurface.register(server, SIGNALSURF_HOSTED_MCP_TOOL_NAMES)
  registerPrompts(server, {
    tables: true,
    workflows: true,
  })
  installPaginatedToolList(server)
  return server
}

async function loadRepositoryCapabilities(
  repository: SignalSurfRepository,
  workspaceIds: readonly string[]
) {
  if (typeof repository.loadWorkspaceCapabilities === "function") {
    return repository.loadWorkspaceCapabilities(workspaceIds)
  }
  return Object.fromEntries(
    workspaceIds.map((workspaceId) => [
      workspaceId,
      [...WORKSPACE_CAPABILITIES],
    ])
  )
}

function registerTools(
  server: McpServer,
  repository: SignalSurfRepository,
  context: SignalSurfContext,
  webExecutionClient: SignalSurfWebExecutionClient,
  additionalCapabilities: Array<{
    name: string
    title: string
    description: string
    requiredScopes: readonly string[]
    readOnly: boolean
    workspaceCapability?: "objects" | "lists" | "listening"
    requiredWorkspaceRole: "member" | "admin"
  }> = []
) {
  const registeredTools = new Set<PublicMcpToolName>()
  const visibleToolNames = [...SIGNALSURF_HOSTED_MCP_TOOL_NAMES]
  const visibleToolNameSet = new Set(visibleToolNames)
  const visiblePromptCatalog = workspaceVisiblePromptCatalog({
    tables: isToolVisibleAcrossWorkspaces(context, "list_tables"),
    workflows: isToolVisibleAcrossWorkspaces(context, "create_workflow"),
  })

  function toolConfig(name: PublicMcpToolName, inputSchema?: any) {
    const definition = signalSurfHostedMcpRegistryTool(name)
    const config = {
      title: definition.title,
      description: definition.description,
      annotations: definition.annotations,
      outputSchema: toolOutputSchema,
    }
    return inputSchema ? { ...config, inputSchema } : config
  }

  function assertToolAllowed(name: PublicMcpToolName) {
    for (const capability of signalSurfHostedMcpRegistryTool(name)
      .requiredCapabilities) {
      assertCanUseCapability(context, capability)
    }
  }

  function toolContext(args: any): SignalSurfContext {
    return resolveWorkspaceContext(
      context,
      typeof args?.workspaceId === "string" ? args.workspaceId : undefined
    )
  }

  function registerPublicTool(
    name: PublicMcpToolName,
    inputSchema: any,
    handler: (args: any) => Promise<any>
  ) {
    if (!visibleToolNameSet.has(name)) return
    const registryTool = signalSurfHostedMcpRegistryTool(name)
    const schemaMatches = inputSchema === PUBLIC_MCP_TOOL_SCHEMAS[name]
    if (!schemaMatches) {
      throw new Error(
        `Public MCP tool ${name} was registered with a non-canonical input schema.`
      )
    }
    if (registeredTools.has(name)) {
      throw new Error(`Public MCP tool ${name} was registered more than once.`)
    }
    registeredTools.add(name)
    server.registerTool(
      name,
      toolConfig(name, inputSchema),
      async (args: any) => {
        try {
          if (typeof repository.revalidateContext === "function") {
            await repository.revalidateContext(context)
          }
          if (typeof repository.loadWorkspaceCapabilities === "function") {
            context.workspaceCapabilitiesByWorkspaceId =
              await repository.loadWorkspaceCapabilities(
                authorizedWorkspaceIds(context)
              )
          }
        } catch (error) {
          return jsonErrorResult(error)
        }
        try {
          for (const capability of registryTool.requiredCapabilities) {
            assertCanUseCapability(context, capability)
          }
        } catch (error) {
          return jsonErrorResult(error)
        }
        if (
          workspaceCapabilityForTool(name) !== null &&
          (!registryTool.annotations.readOnlyHint ||
            registryTool.annotations.openWorldHint)
        ) {
          try {
            const selectedContext = toolContext(args)
            assertWorkspaceToolAllowed(selectedContext, name)
          } catch (error) {
            return jsonErrorResult(error)
          }
        }
        return handler(args)
      }
    )
  }

  registerPublicTool(
    "get_workspace_context",
    getWorkspaceContextSchema,
    async (args) =>
      runJsonTool(async () => {
        assertToolAllowed("get_workspace_context")
        const workspaceId =
          typeof args?.workspaceId === "string"
            ? toolContext(args).workspaceId
            : context.workspaceId
        return buildWorkspaceContext({
          context,
          repository,
          webExecutionClient,
          workspaceId,
        })
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
        const selectedContext = toolContext(args)
        const memberAccess = await webExecutionClient.getWorkspaceMemberAccess(
          selectedContext.workspaceId
        )
        const tools = [
          ...visibleToolNames
            .filter((name) => {
              const definition = signalSurfHostedMcpRegistryTool(name)
              return (
                name !== "find_capabilities" &&
                definition.requiredCapabilities.every((capability) =>
                  canUseCapability(context, capability)
                ) &&
                (definition.annotations.readOnlyHint &&
                !definition.annotations.openWorldHint
                  ? true
                  : workspaceToolAllowed(selectedContext, name))
              )
            })
            .map((name) => {
              const definition = signalSurfHostedMcpRegistryTool(name)
              return {
                name,
                title: definition.title,
                description: definition.description,
              }
            }),
          ...additionalCapabilities
            .filter(
              (capability) =>
                (context.scopes === undefined ||
                  capability.requiredScopes.every((scope) =>
                    context.scopes?.includes(scope)
                  )) &&
                (capability.readOnly || context.role !== "viewer") &&
                (memberAccess === "member" || memberAccess === "admin") &&
                (capability.requiredWorkspaceRole !== "admin" ||
                  memberAccess === "admin") &&
                (!capability.workspaceCapability ||
                  workspaceCapabilityEnabled(
                    selectedContext,
                    capability.workspaceCapability
                  ))
            )
            .map(({ name, title, description }) => ({
              name,
              title,
              description,
            })),
        ]
        return searchCapabilities(
          typeof args?.query === "string" ? args.query : "",
          { tools, prompts: visiblePromptCatalog }
        )
      })
  )

  registerPublicTool("list_workflows", listWorkflowsSchema, async (args: any) =>
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
          name: args.name,
          goal: args.goal,
          description: args.description,
          audienceDatabaseId: args.audienceDatabaseId,
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

  registerPublicTool("enable_enrich", enableEnrichSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("enable_enrich")
      return repository.enableEnrich(toolContext(args), args)
    })
  )

  registerPublicTool("disable_enrich", disableEnrichSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("disable_enrich")
      return repository.disableEnrich(toolContext(args), args)
    })
  )

  registerPublicTool("list_enrich", listEnrichSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("list_enrich")
      return repository.listEnrich(toolContext(args), args)
    })
  )

  registerPublicTool("run_enrich", runEnrichSchema, async (args: any) =>
    runJsonTool(async () => {
      assertToolAllowed("run_enrich")
      return repository.runEnrich(toolContext(args), args)
    })
  )

  registerPublicTool(
    "list_workspace_tools",
    listWorkspaceToolsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_workspace_tools")
        return repository.listWorkspaceTools(toolContext(args), args)
      })
  )

  registerPublicTool(
    "list_workflow_tools",
    listWorkflowToolsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("list_workflow_tools")
        return repository.listWorkflowTools(toolContext(args), args.workflowId)
      })
  )

  registerPublicTool(
    "inspect_sender_infrastructure",
    inspectSenderInfrastructureSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("inspect_sender_infrastructure")
        return repository.inspectSenderInfrastructure(toolContext(args), args)
      })
  )

  registerPublicTool(
    "plan_sender_capacity",
    planSenderCapacitySchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("plan_sender_capacity")
        return repository.planSenderCapacity(toolContext(args), args)
      })
  )

  registerPublicTool(
    "search_sender_domains",
    searchSenderDomainsSchema,
    async (args: any) =>
      runJsonTool(async () => {
        assertToolAllowed("search_sender_domains")
        return repository.searchSenderDomains(toolContext(args), args)
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

  const missingTools = visibleToolNames.filter(
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
  const contextWorkspaceIds = authorizedWorkspaceIds(context)

  async function revalidateResourceContext() {
    if (typeof repository.revalidateContext === "function") {
      await repository.revalidateContext(context)
    }
    context.workspaceCapabilitiesByWorkspaceId =
      await loadRepositoryCapabilities(
        repository,
        authorizedWorkspaceIds(context)
      )
  }

  server.registerResource(
    "signalsurf_context",
    "signalsurf://context",
    {
      title: "SignalSurf MCP Context",
      description: "Workspace and role context for this MCP connection.",
      mimeType: "application/json",
    },
    async (uri) => {
      await revalidateResourceContext()
      assertCanUseCapability(context, "context.read")
      return jsonResource(uri.href, {
        workspaceId: context.workspaceId,
        workspaceIds: authorizedWorkspaceIds(context),
        workspaces: authorizedWorkspaces(context),
        userId: context.userId ?? null,
        role: context.role,
        tokenName: context.tokenName ?? null,
        scopes: context.scopes ?? null,
        capabilities: projectMcpCapabilitiesForWorkspace(
          context,
          listContextCapabilities(context)
        ),
      })
    }
  )

  if (contextWorkspaceIds.length > 1) return

  server.registerResource(
    "signalsurf_workflows",
    "signalsurf://workflows",
    {
      title: "SignalSurf Workflows",
      description: "Non-deleted Workflows for the current workspace.",
      mimeType: "application/json",
    },
    async (uri) => {
      await revalidateResourceContext()
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.listWorkflows(resolveWorkspaceContext(context), {
          limit: 200,
        })
      )
    }
  )

  server.registerResource(
    "signalsurf_workflow",
    new ResourceTemplate("signalsurf://workflows/{workflowId}", {
      list: async () => {
        await revalidateResourceContext()
        if (!canUseCapability(context, "workflows.read")) {
          return { resources: [] }
        }
        const { workflows } = await repository.listWorkflows(
          resolveWorkspaceContext(context),
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
      await revalidateResourceContext()
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.getWorkflow(
          resolveWorkspaceContext(context),
          String(variables.workflowId ?? "")
        )
      )
    }
  )

  server.registerResource(
    "signalsurf_workflow_sources",
    new ResourceTemplate("signalsurf://workflows/{workflowId}/sources", {
      list: async () => {
        await revalidateResourceContext()
        if (
          !canUseCapability(context, "sources.read") ||
          !canUseCapability(context, "workflows.read")
        ) {
          return { resources: [] }
        }
        const { workflows } = await repository.listWorkflows(
          resolveWorkspaceContext(context),
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
      await revalidateResourceContext()
      assertCanUseCapability(context, "sources.read")
      return jsonResource(
        uri.href,
        await repository.listWorkflowSources(
          resolveWorkspaceContext(context),
          String(variables.workflowId ?? "")
        )
      )
    }
  )

  server.registerResource(
    "signalsurf_workflow_tools",
    new ResourceTemplate("signalsurf://workflows/{workflowId}/tools", {
      list: async () => {
        await revalidateResourceContext()
        if (!canUseCapability(context, "workflows.read")) {
          return { resources: [] }
        }
        const { workflows } = await repository.listWorkflows(
          resolveWorkspaceContext(context),
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
      await revalidateResourceContext()
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.listWorkflowTools(
          resolveWorkspaceContext(context),
          String(variables.workflowId ?? "")
        )
      )
    }
  )

  server.registerResource(
    "signalsurf_workspace_tools",
    "signalsurf://workspace-tools",
    {
      title: "SignalSurf Workspace Tools",
      description: "Safe workspace tool metadata for the current workspace.",
      mimeType: "application/json",
    },
    async (uri) => {
      await revalidateResourceContext()
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.listWorkspaceTools(resolveWorkspaceContext(context), {
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
      description: "Recent Workflow execution jobs for the current workspace.",
      mimeType: "application/json",
    },
    async (uri) => {
      await revalidateResourceContext()
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.listSurfJobs(resolveWorkspaceContext(context), {
          limit: 100,
        })
      )
    }
  )

  server.registerResource(
    "signalsurf_surf_job",
    new ResourceTemplate("signalsurf://surf-jobs/{jobId}", {
      list: async () => {
        await revalidateResourceContext()
        if (!canUseCapability(context, "workflows.read")) {
          return { resources: [] }
        }
        const { jobs } = await repository.listSurfJobs(
          resolveWorkspaceContext(context),
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
      await revalidateResourceContext()
      assertCanUseCapability(context, "workflows.read")
      return jsonResource(
        uri.href,
        await repository.getSurfJob(
          resolveWorkspaceContext(context),
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
      description: "Databases/tables for the current workspace.",
      mimeType: "application/json",
    },
    async (uri) => {
      await revalidateResourceContext()
      assertCanUseCapability(context, "tables.read")
      return jsonResource(
        uri.href,
        await repository.listDatabases(resolveWorkspaceContext(context), {
          limit: 200,
        })
      )
    }
  )

  server.registerResource(
    "signalsurf_database_rows",
    new ResourceTemplate("signalsurf://databases/{databaseId}/rows", {
      list: async () => {
        await revalidateResourceContext()
        if (!canUseCapability(context, "tables.read")) {
          return { resources: [] }
        }
        const { databases } = await repository.listDatabases(
          resolveWorkspaceContext(context),
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
      await revalidateResourceContext()
      assertCanUseCapability(context, "tables.read")
      const databaseId = String(variables.databaseId ?? "")
      return jsonResource(
        uri.href,
        await repository.readTable(resolveWorkspaceContext(context), {
          databaseId,
          limit: 100,
        })
      )
    }
  )
}
