import type { McpCapability, PublicMcpToolName } from "./capabilities.js"
import { UserFacingError } from "./errors.js"
import type { SignalSurfContext, SupabaseLike } from "./types.js"

export const WORKSPACE_CAPABILITIES = [
  "tables",
  "objects",
  "lists",
  "workflows",
  "campaigns",
  "listening",
  "inbox",
  "meetings",
  "content",
] as const

export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number]
export type WorkspaceCapabilitiesByProduct = Record<
  string,
  readonly WorkspaceCapability[]
>

const WORKSPACE_CAPABILITY_SET = new Set<string>(WORKSPACE_CAPABILITIES)

const WORKFLOW_TOOLS = new Set<PublicMcpToolName>([
  "list_workflows",
  "get_workflow",
  "create_workflow",
  "update_workflow",
  "run_workflow",
  "get_surf_job",
  "wait_for_surf_job",
  "list_surf_jobs",
  "cancel_surf_job",
  "delete_workflow",
  "describe_node_types",
  "edit_workflow_flows",
  "get_node_upstream_context",
  "test_workflow_node",
  "list_signals",
  "create_signal",
  "update_signal",
  "delete_signal",
  "list_workflow_tools",
])

const WORKFLOW_CREATE_TOOLS = new Set<PublicMcpToolName>([
  "create_workflow",
  "describe_node_types",
])

const TABLE_TOOLS = new Set<PublicMcpToolName>([
  "get_enrichment_context",
  "list_tables",
  "create_table",
  "update_table",
  "delete_table",
  "list_table_views",
  "read_table",
  "read_table_view",
  "get_table_row",
  "create_table_row",
  "update_table_rows",
  "delete_table_rows",
  "list_table_fields",
  "add_table_field",
  "update_table_field",
  "remove_table_field",
  "create_relation_field",
  "enable_enrich",
  "disable_enrich",
  "list_enrich",
  "run_enrich",
])

const SENDER_INFRASTRUCTURE_TOOLS = new Set<PublicMcpToolName>([
  "inspect_sender_infrastructure",
  "plan_sender_capacity",
  "search_sender_domains",
])

export function workspaceCapabilityForTool(
  toolName: PublicMcpToolName
): WorkspaceCapability | null {
  if (WORKFLOW_TOOLS.has(toolName)) return "workflows"
  if (TABLE_TOOLS.has(toolName)) return "tables"
  if (SENDER_INFRASTRUCTURE_TOOLS.has(toolName)) return "inbox"
  if (toolName === "create_campaign") return "campaigns"
  return null
}

type WorkspaceToolRequirement =
  | { allOf: readonly WorkspaceCapability[] }
  | { anyOf: readonly WorkspaceCapability[] }

function workspaceCapabilityRequirementForTool(
  toolName: PublicMcpToolName
): WorkspaceToolRequirement | null {
  if (WORKFLOW_CREATE_TOOLS.has(toolName)) return { allOf: ["workflows"] }
  if (WORKFLOW_TOOLS.has(toolName)) {
    // Generic Workflow tools may resolve an ordinary Workflow or a Listening.
    // Repository methods recheck the concrete row before returning or mutating.
    return { anyOf: ["workflows", "listening"] }
  }
  if (toolName === "create_table") return { allOf: ["tables"] }
  if (TABLE_TOOLS.has(toolName)) {
    // These generic tools resolve the concrete database at execution time.
    // Visibility is shared, but authorization is still exact per resource.
    return { anyOf: ["tables", "objects", "listening"] }
  }
  if (toolName === "create_campaign") return { allOf: ["campaigns"] }
  if (SENDER_INFRASTRUCTURE_TOOLS.has(toolName)) {
    return { allOf: ["inbox"] }
  }
  return null
}

function requirementAllowed(
  enabled: readonly string[],
  requirement: WorkspaceToolRequirement
): boolean {
  return "allOf" in requirement
    ? requirement.allOf.every((capability) => enabled.includes(capability))
    : requirement.anyOf.some((capability) => enabled.includes(capability))
}

export function resolveEffectiveWorkspaceCapabilities(
  defaults: readonly unknown[],
  overrides: readonly { capability_key: unknown; enabled: unknown }[]
): WorkspaceCapability[] {
  const enabled = new Set(
    defaults.filter(
      (value): value is WorkspaceCapability =>
        typeof value === "string" && WORKSPACE_CAPABILITY_SET.has(value)
    )
  )
  for (const override of overrides) {
    if (
      typeof override.capability_key !== "string" ||
      !WORKSPACE_CAPABILITY_SET.has(override.capability_key) ||
      typeof override.enabled !== "boolean"
    ) {
      continue
    }
    if (override.enabled)
      enabled.add(override.capability_key as WorkspaceCapability)
    else enabled.delete(override.capability_key as WorkspaceCapability)
  }
  return WORKSPACE_CAPABILITIES.filter((capability) => enabled.has(capability))
}

function isRollingSchemaMiss(error: { code?: string } | null | undefined) {
  return error?.code === "42P01" || error?.code === "42703"
}

function capabilitiesWithOverrides(
  productIds: readonly string[],
  overrides: readonly {
    product_id: string
    capability_key: unknown
    enabled: unknown
  }[]
): WorkspaceCapabilitiesByProduct {
  return Object.fromEntries(
    productIds.map((productId) => [
      productId,
      resolveEffectiveWorkspaceCapabilities(
        WORKSPACE_CAPABILITIES,
        overrides.filter((row) => row.product_id === productId)
      ),
    ])
  )
}

export async function loadWorkspaceCapabilities(
  db: SupabaseLike,
  productIds: readonly string[]
): Promise<WorkspaceCapabilitiesByProduct> {
  const allEnabled = Object.fromEntries(
    productIds.map((productId) => [productId, [...WORKSPACE_CAPABILITIES]])
  )
  if (productIds.length === 0) return allEnabled

  const [productsResult, overridesResult] = await Promise.all([
    db
      .from("products")
      .select("id, organization_id")
      .in("id", [...productIds]),
    db
      .from("product_capability_overrides")
      .select("product_id, capability_key, enabled")
      .in("product_id", [...productIds]),
  ])
  if (isRollingSchemaMiss(overridesResult.error)) return allEnabled
  if (productsResult.error || overridesResult.error) {
    throw new Error("Workspace capabilities are unavailable")
  }

  const products = (productsResult.data ?? []) as Array<{
    id: string
    organization_id: string
  }>
  const overrideRows = (overridesResult.data ?? []) as Array<{
    product_id: string
    capability_key: unknown
    enabled: unknown
  }>
  const organizationIds = [
    ...new Set(products.map((row) => row.organization_id)),
  ]
  const subscriptionsResult = await db
    .from("subscriptions")
    .select("organization_id, plan_name, created_at")
    .in("organization_id", organizationIds)
    .in("status", ["active", "trialing"])
    .or("current_period_end.is.null,current_period_end.gte.now()")
    .order("created_at", { ascending: false })
  if (isRollingSchemaMiss(subscriptionsResult.error)) {
    return capabilitiesWithOverrides(productIds, overrideRows)
  }
  if (subscriptionsResult.error) {
    throw new Error("Workspace capabilities are unavailable")
  }
  const planByOrganization = new Map<string, string>()
  for (const row of (subscriptionsResult.data ?? []) as Array<{
    organization_id: string
    plan_name: string | null
  }>) {
    if (!planByOrganization.has(row.organization_id) && row.plan_name) {
      planByOrganization.set(row.organization_id, row.plan_name)
    }
  }
  const planKeys = [...new Set(["individual", ...planByOrganization.values()])]
  const plansResult = await db
    .from("billing_plan_catalog")
    .select("plan_key, workspace_capabilities")
    .in("plan_key", planKeys)
  if (isRollingSchemaMiss(plansResult.error)) {
    return capabilitiesWithOverrides(productIds, overrideRows)
  }
  if (plansResult.error) {
    throw new Error("Workspace capabilities are unavailable")
  }
  const defaultsByPlan = new Map<string, readonly unknown[]>(
    (
      (plansResult.data ?? []) as Array<{
        plan_key: string
        workspace_capabilities: unknown
      }>
    ).map((row) => [
      row.plan_key,
      Array.isArray(row.workspace_capabilities)
        ? row.workspace_capabilities
        : WORKSPACE_CAPABILITIES,
    ])
  )
  const overridesByProduct = new Map<
    string,
    Array<{ capability_key: unknown; enabled: unknown }>
  >()
  for (const row of overrideRows) {
    const rows = overridesByProduct.get(row.product_id) ?? []
    rows.push(row)
    overridesByProduct.set(row.product_id, rows)
  }

  const productById = new Map(products.map((product) => [product.id, product]))
  return Object.fromEntries(
    productIds.map((productId) => {
      const product = productById.get(productId)
      if (!product) {
        return [
          productId,
          resolveEffectiveWorkspaceCapabilities(
            WORKSPACE_CAPABILITIES,
            overridesByProduct.get(productId) ?? []
          ),
        ]
      }
      const planKey =
        planByOrganization.get(product.organization_id) ?? "individual"
      return [
        productId,
        resolveEffectiveWorkspaceCapabilities(
          defaultsByPlan.get(planKey) ?? WORKSPACE_CAPABILITIES,
          overridesByProduct.get(product.id) ?? []
        ),
      ]
    })
  )
}

export function isToolVisibleAcrossProducts(
  context: SignalSurfContext,
  toolName: PublicMcpToolName
): boolean {
  const requirement = workspaceCapabilityRequirementForTool(toolName)
  if (!requirement) return true
  const productIds = context.productIds?.length
    ? context.productIds
    : [context.productId]
  return productIds.every((productId) =>
    requirementAllowed(
      context.workspaceCapabilitiesByProduct?.[productId] ??
        WORKSPACE_CAPABILITIES,
      requirement
    )
  )
}

export function assertWorkspaceToolAllowed(
  context: SignalSurfContext,
  toolName: PublicMcpToolName
): void {
  const requirement = workspaceCapabilityRequirementForTool(toolName)
  if (!requirement) return
  const enabled =
    context.workspaceCapabilitiesByProduct?.[context.productId] ??
    WORKSPACE_CAPABILITIES
  if (requirementAllowed(enabled, requirement)) return
  console.warn("[mcp] Workspace capability denied", {
    productId: context.productId,
    requirement,
    toolName,
  })
  throw new UserFacingError(
    "This operation is unavailable in the current Workspace.",
    { code: "FORBIDDEN", status: 403 }
  )
}

export function workspaceCapabilityEnabled(
  context: SignalSurfContext,
  capability: WorkspaceCapability
): boolean {
  return (
    context.workspaceCapabilitiesByProduct?.[context.productId] ??
    WORKSPACE_CAPABILITIES
  ).includes(capability)
}

function workspaceCapabilitiesForMcpCapability(
  capability: McpCapability
): readonly WorkspaceCapability[] {
  if (capability.startsWith("campaigns.")) return ["campaigns"]
  if (
    capability.startsWith("workflows.") ||
    capability.startsWith("sources.")
  ) {
    return ["workflows", "listening"]
  }
  if (capability.startsWith("tables.") || capability.startsWith("schemas.")) {
    return ["tables", "objects", "listening"]
  }
  if (capability.startsWith("account_lists.")) return ["lists"]
  if (capability.startsWith("sender_infrastructure.")) return ["inbox"]
  return []
}

export function projectMcpCapabilitiesForWorkspace(
  context: SignalSurfContext,
  capabilities: readonly McpCapability[]
): McpCapability[] {
  const productIds = context.productIds?.length
    ? context.productIds
    : [context.productId]
  return capabilities.filter((capability) => {
    const required = workspaceCapabilitiesForMcpCapability(capability)
    if (required.length === 0) return true
    return productIds.every((productId) =>
      required.some((workspaceCapability) =>
        (
          context.workspaceCapabilitiesByProduct?.[productId] ??
          WORKSPACE_CAPABILITIES
        ).includes(workspaceCapability)
      )
    )
  })
}
