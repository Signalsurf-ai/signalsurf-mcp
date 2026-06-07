import { createHash, randomUUID } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"

import type {
  AccessRole,
  DatabaseRow,
  EntryRow,
  JsonRecord,
  SignalSurfContext,
  SignalSurfProductContext,
  SupabaseLike,
  SurfPointRow,
} from "./types.js"
import {
  grantedCapabilitiesForScopes,
  isSupportedMcpScope,
  parseStoredScopes,
  scopesImplyWriteAccess,
} from "./capabilities.js"
import { sha256Hex } from "./auth.js"
import { UserFacingError } from "./errors.js"

type ListSurfPointsInput = {
  includeInactive?: boolean
  limit?: number
}

type CreateProductInput = {
  name: string
  organizationId?: string
  displayOrder?: number
}

type CreateSurfPointInput = {
  name: string
  description?: string
  color?: string
  icon?: string
  folderId?: string | null
  databaseIds?: string[]
  promptTemplate?: string
  scoringRubric?: string
  surfPrompt?: string
  relevanceThreshold?: number | null
  isActive?: boolean
  showAiDashboard?: boolean
  variables?: JsonRecord
  toolConfig?: JsonRecord
  viewConfigs?: JsonRecord
  config?: JsonRecord
}

type UpdateSurfPointInput = {
  surfPointId: string
  name?: string
  description?: string | null
  color?: string
  icon?: string
  folderId?: string | null
  databaseIds?: string[]
  promptTemplate?: string | null
  scoringRubric?: string | null
  surfPrompt?: string | null
  relevanceThreshold?: number | null
  isActive?: boolean
  showAiDashboard?: boolean
  variables?: JsonRecord | null
  variablesPatch?: JsonRecord
  toolConfig?: JsonRecord | null
  toolConfigPatch?: JsonRecord
  viewConfigs?: JsonRecord | null
  config?: JsonRecord | null
  configPatch?: JsonRecord
}

type RunSurfPointInput = {
  surfPointId: string
  idempotencyKey?: string
  allowInactive?: boolean
  dedupePending?: boolean
}

type ListProductToolsInput = {
  includeDisabled?: boolean
  limit?: number
}

type ListSurfJobsInput = {
  surfPointId?: string
  status?: string
  limit?: number
  offset?: number
}

type WaitForSurfJobInput = {
  jobId: string
  timeoutMs?: number
  pollIntervalMs?: number
}

type TableFilterOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "contains"
  | "starts_with"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "array_contains"
  | "relation_is"
  | "relation_in"

type TableFilterInput = {
  field: string
  op: TableFilterOperator
  value?: unknown
}

type TableSortInput = {
  field: string
  direction?: "asc" | "desc"
}

type ListDatabasesInput = {
  includeSystem?: boolean
  limit?: number
}

type CreateTableInput = {
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  schema?: JsonRecord
  itemType?: string | null
  viewConfigs?: JsonRecord
  folderId?: string | null
  displayOrder?: number
}

type UpdateTableInput = {
  databaseId: string
  name?: string
  description?: string | null
  icon?: string | null
  color?: string | null
  schema?: JsonRecord | null
  schemaPatch?: JsonRecord
  itemType?: string | null
  viewConfigs?: JsonRecord | null
  folderId?: string | null
  displayOrder?: number
}

type ReadTableInput = {
  databaseId: string
  limit?: number
  offset?: number
  orderBy?: "created_at" | "updated_at"
  ascending?: boolean
  dataContains?: JsonRecord
  filters?: TableFilterInput[]
  filterLogic?: "and" | "or"
  sorts?: TableSortInput[]
  scanLimit?: number
}

type ReadTableViewInput = {
  databaseId: string
  viewId: string
  limit?: number
  offset?: number
  filters?: TableFilterInput[]
  filterLogic?: "and" | "or"
  sorts?: TableSortInput[]
  scanLimit?: number
}

type AddDatabaseFieldInput = {
  databaseId: string
  field: JsonRecord
}

type UpdateDatabaseFieldInput = {
  databaseId: string
  fieldKey: string
  patch: JsonRecord
}

type RemoveDatabaseFieldInput = {
  databaseId: string
  fieldKey: string
}

type CreateRelationFieldInput = {
  databaseId: string
  key: string
  label?: string
  description?: string
  targetDatabaseId: string
  relationType?: string
  displayField?: string
}

type SetSurfPointSourceActiveInput = {
  sourceId: string
  isActive: boolean
}

type SurfPointToolInput = {
  surfPointId: string
  toolId: string
}

type McpTokenRow = {
  id: string
  product_id: string
  created_by: string | null
  name: string | null
  role: AccessRole
  revoked_at: string | null
}

type McpOAuthTokenRow = {
  id: string
  client_id: string
  user_id: string
  product_id: string
  product_ids?: string[] | null
  scope: string
  resource: string
  access_token_expires_at: string
  revoked_at: string | null
}

type McpOAuthClientRow = {
  client_id: string
  client_name: string | null
  revoked_at: string | null
}

type ProductContextRow = {
  id: string
  name: string | null
  organization_id?: string | null
}

type ProductRow = {
  id: string
  name: string
  organization_id: string
  owner_id: string
  created_at?: string | null
  updated_at?: string | null
}

type ProductOwnerRow = {
  owner_id?: string | null
}

type OrganizationContextRow = {
  id: string
  name: string | null
}

type SurfJobRow = {
  id: string
  product_id?: string | null
  user_id?: string | null
  run_id?: string | null
  playbook_id: string
  source_id?: string | null
  job_type?: string | null
  status: string
  priority?: number | null
  attempt_count?: number | null
  max_attempts?: number | null
  payload?: JsonRecord | null
  result?: JsonRecord | null
  created_at?: string | null
  updated_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  worker_id?: string | null
  locked_until?: string | null
  last_error?: string | null
}

type SourceRow = {
  id: string
  playbook_id: string
  user_id?: string | null
  name?: string | null
  type?: string | null
  pull_config?: JsonRecord | null
  metadata?: JsonRecord | null
  is_active?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

type ProductToolRow = {
  id: string
  product_id: string
  playbook_id?: string | null
  tool_type: string
  config?: JsonRecord | null
  is_enabled?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

type CreateTableRowInput = {
  databaseId: string
  data: JsonRecord
  playbookId?: string | null
  note?: string | null
}

type UpdateTableRowInput = {
  rowId: string
  databaseId?: string
  data?: JsonRecord
  dataPatch?: JsonRecord
  note?: string | null
  playbookId?: string | null
}

const SURF_POINT_COLUMNS = [
  "id",
  "product_id",
  "name",
  "description",
  "is_default",
  "is_active",
  "show_ai_dashboard",
  "icon",
  "color",
  "database_ids",
  "relevance_threshold",
  "prompt_template",
  "scoring_rubric",
  "surf_prompt",
  "tool_config",
  "variables",
  "config",
  "folder_id",
  "display_order",
  "created_at",
  "updated_at",
  "deleted_at",
].join(", ")

const DATABASE_COLUMNS = [
  "id",
  "product_id",
  "name",
  "description",
  "icon",
  "color",
  "schema",
  "item_type",
  "system_type",
  "view_configs",
  "folder_id",
  "display_order",
  "created_at",
  "updated_at",
].join(", ")

const ENTRY_COLUMNS = [
  "id",
  "playbook_id",
  "database_id",
  "data",
  "data_cached",
  "note",
  "origin",
  "origin_ref",
  "entry_key_hash",
  "raw_signal_id",
  "triggered",
  "created_at",
  "updated_at",
].join(", ")

const SOURCE_COLUMNS = [
  "id",
  "playbook_id",
  "user_id",
  "name",
  "type",
  "pull_config",
  "metadata",
  "is_active",
  "created_at",
  "updated_at",
].join(", ")

const PRODUCT_TOOL_COLUMNS = [
  "id",
  "product_id",
  "playbook_id",
  "tool_type",
  "config",
  "is_enabled",
  "created_at",
  "updated_at",
].join(", ")

function joinPromptSections(
  rubric: string | null | undefined,
  surf: string | null | undefined
): string | null {
  const rubricText = (rubric ?? "").trim()
  const surfText = (surf ?? "").trim()
  if (!rubricText && !surfText) return null
  const parts: string[] = []
  if (rubricText) parts.push(`## Scoring Rubric\n\n${rubricText}`)
  if (surfText) parts.push(surfText)
  return parts.join("\n\n")
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== ""
      )
    ),
  ]
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function oauthTokenProductIds(row: McpOAuthTokenRow): string[] {
  return uniqueIds([row.product_id, ...(row.product_ids ?? [])].filter(Boolean))
}

function idempotentSurfJobId(
  context: SignalSurfContext,
  surfPointId: string,
  sourceId: string,
  idempotencyKey: string
): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`${context.productId}:${surfPointId}:${sourceId}:${idempotencyKey}`)
      .digest("hex")
      .slice(0, 32),
    "hex"
  )
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

function requireNoDbError(
  error: { message: string; code?: string } | null | undefined,
  message: string
): void {
  if (error) {
    throw new UserFacingError(`${message}: ${error.message}`, {
      code: "DATABASE_ERROR",
      status: 500,
    })
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function withoutLegacyToolRouting(config: JsonRecord): JsonRecord {
  const {
    tool_modes: _toolModes,
    trigger_tools: _triggerTools,
    ...rest
  } = config
  return rest
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function buildSourceSnapshot(source: SourceRow) {
  const pullConfig = asRecord(source.pull_config)
  const metadata = asRecord(source.metadata)
  return {
    name: readTrimmedString(source.name),
    type: readTrimmedString(source.type),
    endpoint_id: readTrimmedString(pullConfig.endpoint_id),
    url: readTrimmedString(pullConfig.url),
    format: readTrimmedString(pullConfig.format),
    provider: readTrimmedString(metadata.provider),
  }
}

function isTerminalSurfJobStatus(status: string): boolean {
  return ![
    "pending",
    "queued",
    "running",
    "processing",
    "in_progress",
  ].includes(status.trim().toLowerCase())
}

export class SignalSurfRepository {
  constructor(private readonly db: SupabaseLike) {}

  async resolveMcpToken(
    token: string,
    metadata: { ip?: string | null; resource?: string | null } = {}
  ): Promise<SignalSurfContext | null> {
    const { data, error } = await this.db
      .from("mcp_tokens")
      .select("id, product_id, created_by, name, role, revoked_at")
      .eq("token_sha256", sha256Hex(token))
      .is("revoked_at", null)
      .maybeSingle()

    requireNoDbError(error, "Failed to resolve MCP token")
    if (!data) {
      return this.resolveMcpOAuthToken(token, metadata)
    }

    const row = data as McpTokenRow
    if (!["viewer", "editor", "owner"].includes(row.role)) {
      throw new UserFacingError("MCP token has an invalid role", {
        code: "CONFIG_ERROR",
        status: 500,
      })
    }

    const update: Record<string, unknown> = {
      last_used_at: new Date().toISOString(),
    }
    if (metadata.ip) update.last_used_ip = metadata.ip

    const { error: updateError } = await this.db
      .from("mcp_tokens")
      .update(update)
      .eq("id", row.id)

    if (updateError) {
      console.error(
        `Failed to update MCP token usage metadata: ${updateError.message}`
      )
    }

    return {
      productId: row.product_id,
      products: await this.resolveProductContexts([row.product_id]),
      role: row.role,
      tokenName: row.name ?? undefined,
      authKind: "manual",
    }
  }

  private async resolveMcpOAuthToken(
    token: string,
    metadata: { ip?: string | null; resource?: string | null }
  ): Promise<SignalSurfContext | null> {
    const { data, error } = await this.db
      .from("mcp_oauth_tokens")
      .select("*")
      .eq("access_token_sha256", sha256Hex(token))
      .is("revoked_at", null)
      .maybeSingle()

    requireNoDbError(error, "Failed to resolve MCP OAuth token")
    if (!data) return null

    const row = data as McpOAuthTokenRow
    if (metadata.resource && row.resource !== metadata.resource) {
      return null
    }
    if (new Date(row.access_token_expires_at).getTime() <= Date.now()) {
      return null
    }

    const { data: clientData, error: clientError } = await this.db
      .from("mcp_oauth_clients")
      .select("client_id, client_name, revoked_at")
      .eq("client_id", row.client_id)
      .is("revoked_at", null)
      .maybeSingle()

    requireNoDbError(clientError, "Failed to resolve MCP OAuth client")
    const client = clientData as McpOAuthClientRow | null
    if (!client) return null

    const update: Record<string, unknown> = {
      last_used_at: new Date().toISOString(),
    }
    if (metadata.ip) update.last_used_ip = metadata.ip

    const { error: updateError } = await this.db
      .from("mcp_oauth_tokens")
      .update(update)
      .eq("id", row.id)

    if (updateError) {
      console.error(
        `Failed to update MCP OAuth token usage metadata: ${updateError.message}`
      )
    }

    const scopes = parseStoredScopes(row.scope).filter(isSupportedMcpScope)
    if (grantedCapabilitiesForScopes(scopes).length === 0) {
      return null
    }
    const productIds = oauthTokenProductIds(row)

    return {
      productId: row.product_id,
      productIds,
      products: await this.resolveProductContexts(productIds),
      userId: row.user_id,
      role: scopesImplyWriteAccess(scopes) ? "editor" : "viewer",
      tokenName: client.client_name
        ? `OAuth: ${client.client_name}`
        : "OAuth MCP client",
      scopes,
      authKind: "oauth",
      oauthTokenId: row.id,
    }
  }

  private async resolveProductContexts(
    productIds: string[]
  ): Promise<SignalSurfProductContext[]> {
    const uniqueProductIds = uniqueIds(productIds.filter(Boolean))
    if (uniqueProductIds.length === 0) return []

    const { data, error } = await this.db
      .from("products")
      .select("id, name, organization_id")
      .in("id", uniqueProductIds)

    requireNoDbError(error, "Failed to resolve SignalSurf product names")

    const products = (data ?? []) as ProductContextRow[]
    const productsById = new Map(
      products.map((product) => [product.id, product])
    )
    const organizationIds = uniqueIds(
      products
        .map((product) => product.organization_id)
        .filter((id): id is string => Boolean(id))
    )
    const organizationsById = await this.resolveOrganizationsById(
      organizationIds
    )

    return uniqueProductIds.map((productId) => {
      const product = productsById.get(productId)
      const organizationId = product?.organization_id ?? null
      const organization = organizationId
        ? organizationsById.get(organizationId)
        : null

      return {
        productId,
        name: product?.name?.trim() || productId,
        organizationId,
        organizationName: organization?.name ?? null,
      }
    })
  }

  private async resolveOrganizationsById(
    organizationIds: string[]
  ): Promise<Map<string, OrganizationContextRow>> {
    if (organizationIds.length === 0) return new Map()

    const { data, error } = await this.db
      .from("organizations")
      .select("id, name")
      .in("id", organizationIds)

    requireNoDbError(error, "Failed to resolve SignalSurf workspace names")

    return new Map(
      ((data ?? []) as OrganizationContextRow[]).map((organization) => [
        organization.id,
        organization,
      ])
    )
  }

  private async resolveProductOwnerId(
    context: SignalSurfContext
  ): Promise<string | null> {
    const { data, error } = await this.db
      .from("products")
      .select("owner_id")
      .eq("id", context.productId)
      .maybeSingle()
    requireNoDbError(error, "Failed to resolve product owner")
    return ((data as ProductOwnerRow | null)?.owner_id as string | null) ?? null
  }

  async createProduct(context: SignalSurfContext, input: CreateProductInput) {
    if (context.authKind !== "oauth" || !context.oauthTokenId) {
      throw new UserFacingError(
        "create_product requires a hosted OAuth MCP connection so the active grant can be expanded to the new product.",
        { code: "BAD_REQUEST", status: 400 }
      )
    }
    if (!context.userId) {
      throw new UserFacingError(
        "create_product requires an authenticated SignalSurf user.",
        { code: "FORBIDDEN", status: 403 }
      )
    }

    const currentProduct = (context.products ?? []).find(
      (product) => product.productId === context.productId
    )
    const organizationId =
      input.organizationId ?? currentProduct?.organizationId ?? null

    const { data, error } = await this.db.rpc("create_product_for_mcp", {
      p_user_id: context.userId,
      p_name: input.name.trim(),
      p_organization_id: organizationId,
      p_display_order: input.displayOrder ?? 0,
    })

    requireNoDbError(error, "Failed to create product")
    if (!data) {
      throw new UserFacingError("Failed to create product.", {
        code: "DATABASE_ERROR",
        status: 500,
      })
    }

    const product = data as ProductRow
    const productContexts = await this.resolveProductContexts([product.id])
    const productContext = productContexts[0] ?? {
      productId: product.id,
      name: product.name,
      organizationId: product.organization_id,
      organizationName: null,
    }

    const productIds = await this.expandOAuthGrantProducts(context, product.id)
    upsertContextProduct(context, productContext, productIds)

    return {
      product: formatProduct(product, productContext),
      productId: product.id,
      productIds,
      products: context.products ?? [productContext],
    }
  }

  private async expandOAuthGrantProducts(
    context: SignalSurfContext,
    productId: string
  ): Promise<string[]> {
    const productIds = uniqueIds([
      context.productId,
      ...(context.productIds ?? []),
      productId,
    ])
    const { error } = await this.db
      .from("mcp_oauth_tokens")
      .update({
        product_ids: productIds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", context.oauthTokenId)
    requireNoDbError(error, "Failed to expand OAuth product grant")
    return productIds
  }

  async listSurfPoints(
    context: SignalSurfContext,
    input: ListSurfPointsInput = {}
  ) {
    let query = this.db
      .from("playbooks")
      .select(SURF_POINT_COLUMNS)
      .eq("product_id", context.productId)
      .is("deleted_at", null)

    if (input.includeInactive === false) {
      query = query.eq("is_active", true)
    }

    const { data, error } = await query
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(input.limit ?? 100)

    requireNoDbError(error, "Failed to list surf points")
    return {
      surfPoints: (data ?? []).map(formatSurfPoint),
      totalCount: data?.length ?? 0,
    }
  }

  async getSurfPoint(context: SignalSurfContext, surfPointId: string) {
    const surfPoint = await this.getSurfPointForUpdate(context, surfPointId)
    return { surfPoint: formatSurfPoint(surfPoint) }
  }

  async listProductTools(
    context: SignalSurfContext,
    input: ListProductToolsInput = {}
  ) {
    let query = this.db
      .from("product_tools")
      .select(PRODUCT_TOOL_COLUMNS)
      .eq("product_id", context.productId)

    if (input.includeDisabled !== true) query = query.eq("is_enabled", true)

    const { data, error } = await query
      .order("created_at", { ascending: true })
      .limit(input.limit ?? 100)

    requireNoDbError(error, "Failed to list product tools")
    const tools = (data ?? []) as ProductToolRow[]
    return {
      tools: tools.map(formatProductTool),
      totalCount: tools.length,
    }
  }

  async createSurfPoint(
    context: SignalSurfContext,
    input: CreateSurfPointInput
  ) {
    const databaseIds = await this.resolveDatabaseIds(
      context,
      input.databaseIds
    )
    const promptTemplate =
      input.promptTemplate ??
      joinPromptSections(input.scoringRubric, input.surfPrompt) ??
      undefined

    const insertData: Record<string, unknown> = {
      product_id: context.productId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      is_default: false,
      is_active: input.isActive ?? true,
      show_ai_dashboard: input.showAiDashboard ?? true,
      color: input.color ?? "#5599FF",
      icon: input.icon ?? "folder.fill",
      database_ids: databaseIds,
      variables: input.variables ?? {},
      tool_config: input.toolConfig ?? {},
      view_configs: input.viewConfigs ?? {},
      config: input.config ?? {},
    }

    if (input.folderId !== undefined) insertData.folder_id = input.folderId
    if (input.folderId) {
      await this.assertFolderBelongsToProduct(context, input.folderId)
    }
    if (promptTemplate !== undefined)
      insertData.prompt_template = promptTemplate
    if (input.scoringRubric !== undefined)
      insertData.scoring_rubric = input.scoringRubric
    if (input.surfPrompt !== undefined)
      insertData.surf_prompt = input.surfPrompt
    if (input.relevanceThreshold !== undefined)
      insertData.relevance_threshold = input.relevanceThreshold

    const { data, error } = await this.db
      .from("playbooks")
      .insert(insertData)
      .select(SURF_POINT_COLUMNS)
      .single()

    if (error?.code === "23505") {
      const existing = await this.findSurfPointByName(context, input.name)
      throw new UserFacingError(
        `Surf point "${input.name}" already exists for this product${
          existing ? ` (id: ${existing.id})` : ""
        }. Use update_surf_point or choose a different name.`,
        { code: "CONFLICT", status: 409 }
      )
    }
    requireNoDbError(error, "Failed to create surf point")
    return { surfPoint: formatSurfPoint(data as SurfPointRow) }
  }

  async updateSurfPoint(
    context: SignalSurfContext,
    input: UpdateSurfPointInput
  ) {
    await this.assertSurfPointBelongsToProduct(context, input.surfPointId)
    if (input.folderId) {
      await this.assertFolderBelongsToProduct(context, input.folderId)
    }
    if (input.variables !== undefined && input.variablesPatch !== undefined) {
      throw new UserFacingError(
        "Pass either variables or variablesPatch, not both.",
        {
          code: "BAD_REQUEST",
          status: 400,
        }
      )
    }
    if (input.toolConfig !== undefined && input.toolConfigPatch !== undefined) {
      throw new UserFacingError(
        "Pass either toolConfig or toolConfigPatch, not both.",
        {
          code: "BAD_REQUEST",
          status: 400,
        }
      )
    }
    if (input.config !== undefined && input.configPatch !== undefined) {
      throw new UserFacingError(
        "Pass either config or configPatch, not both.",
        {
          code: "BAD_REQUEST",
          status: 400,
        }
      )
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (input.name !== undefined) updateData.name = input.name.trim()
    if (input.description !== undefined)
      updateData.description = input.description?.trim() || null
    if (input.color !== undefined) updateData.color = input.color
    if (input.icon !== undefined) updateData.icon = input.icon
    if (input.folderId !== undefined) updateData.folder_id = input.folderId
    if (input.databaseIds !== undefined) {
      updateData.database_ids = await this.resolveDatabaseIds(
        context,
        input.databaseIds
      )
    }
    if (input.isActive !== undefined) updateData.is_active = input.isActive
    if (input.showAiDashboard !== undefined)
      updateData.show_ai_dashboard = input.showAiDashboard
    if (input.relevanceThreshold !== undefined)
      updateData.relevance_threshold = input.relevanceThreshold
    if (input.promptTemplate !== undefined)
      updateData.prompt_template = input.promptTemplate
    if (input.scoringRubric !== undefined)
      updateData.scoring_rubric = input.scoringRubric
    if (input.surfPrompt !== undefined)
      updateData.surf_prompt = input.surfPrompt
    if (input.viewConfigs !== undefined)
      updateData.view_configs = input.viewConfigs

    const needsExisting =
      input.variablesPatch !== undefined ||
      input.toolConfigPatch !== undefined ||
      input.configPatch !== undefined ||
      ((input.scoringRubric !== undefined || input.surfPrompt !== undefined) &&
        input.promptTemplate === undefined)

    const existing = needsExisting
      ? await this.getSurfPointForUpdate(context, input.surfPointId)
      : null

    if (input.variables !== undefined) updateData.variables = input.variables
    if (input.variablesPatch !== undefined) {
      updateData.variables = {
        ...asRecord(existing?.variables),
        ...input.variablesPatch,
      }
    }
    if (input.toolConfig !== undefined)
      updateData.tool_config = input.toolConfig
    if (input.toolConfigPatch !== undefined) {
      updateData.tool_config = {
        ...asRecord(existing?.tool_config),
        ...input.toolConfigPatch,
      }
    }
    if (input.config !== undefined) updateData.config = input.config
    if (input.configPatch !== undefined) {
      updateData.config = {
        ...asRecord(existing?.config),
        ...input.configPatch,
      }
    }

    if (
      (input.scoringRubric !== undefined || input.surfPrompt !== undefined) &&
      input.promptTemplate === undefined
    ) {
      const finalRubric =
        input.scoringRubric !== undefined
          ? input.scoringRubric
          : (existing?.scoring_rubric ?? null)
      const finalSurf =
        input.surfPrompt !== undefined
          ? input.surfPrompt
          : (existing?.surf_prompt ?? null)
      updateData.prompt_template = joinPromptSections(finalRubric, finalSurf)
    }

    const changedKeys = Object.keys(updateData).filter(
      (key) => key !== "updated_at"
    )
    if (changedKeys.length === 0) {
      throw new UserFacingError("No fields to update.", {
        code: "BAD_REQUEST",
        status: 400,
      })
    }

    const { data, error } = await this.db
      .from("playbooks")
      .update(updateData)
      .eq("id", input.surfPointId)
      .eq("product_id", context.productId)
      .is("deleted_at", null)
      .select(SURF_POINT_COLUMNS)
      .single()

    if (error?.code === "23505") {
      throw new UserFacingError("A surf point with this name already exists.", {
        code: "CONFLICT",
        status: 409,
      })
    }
    requireNoDbError(error, "Failed to update surf point")

    if (input.isActive !== undefined) {
      const { error: sourceError } = await this.db
        .from("sources")
        .update({
          is_active: input.isActive,
          updated_at: new Date().toISOString(),
        })
        .eq("playbook_id", input.surfPointId)
      requireNoDbError(
        errorOrNull(sourceError),
        "Failed to cascade source state"
      )
    }

    return {
      surfPoint: formatSurfPoint(data as SurfPointRow),
      changedFields: changedKeys,
    }
  }

  async runSurfPoint(context: SignalSurfContext, input: RunSurfPointInput) {
    const surfPoint = await this.getSurfPointRunTarget(
      context,
      input.surfPointId
    )
    if (!surfPoint.is_active && !input.allowInactive) {
      throw new UserFacingError(
        "Surf point is inactive. Pass allowInactive=true to queue it intentionally.",
        { code: "BAD_REQUEST", status: 400 }
      )
    }

    const { data: sourceData, error: sourceError } = await this.db
      .from("sources")
      .select(SOURCE_COLUMNS)
      .eq("playbook_id", input.surfPointId)
      .eq("type", "pull")
      .eq("is_active", true)

    requireNoDbError(sourceError, "Failed to list active surf point sources")
    const sources = (sourceData ?? []) as SourceRow[]
    if (sources.length === 0) {
      throw new UserFacingError(
        "No active pull sources found for this surf point.",
        { code: "BAD_REQUEST", status: 400 }
      )
    }

    const sourceIds = sources.map((source) => source.id)
    const userId =
      context.userId ??
      (await this.resolveProductOwnerId(context)) ??
      sources.find((source) => source.user_id)?.user_id
    if (!userId) {
      throw new UserFacingError(
        "Cannot queue surf point run because no job user could be resolved.",
        { code: "CONFIG_ERROR", status: 500 }
      )
    }

    const existingJobsBySourceId = new Map<string, SurfJobRow>()
    if (input.dedupePending !== false) {
      const { data: existingJobs, error: existingError } = await this.db
        .from("surf_jobs")
        .select("*")
        .eq("job_type", "extract")
        .in("source_id", sourceIds)
        .in("status", ["pending", "processing"])

      requireNoDbError(existingError, "Failed to check active surf jobs")
      for (const job of (existingJobs ?? []) as SurfJobRow[]) {
        if (job.source_id && !existingJobsBySourceId.has(job.source_id)) {
          existingJobsBySourceId.set(job.source_id, job)
        }
      }
    }

    if (input.idempotencyKey) {
      const deterministicIds = sources.map((source) =>
        idempotentSurfJobId(
          context,
          input.surfPointId,
          source.id,
          input.idempotencyKey!
        )
      )
      const { data: idempotentJobs, error: idempotentError } = await this.db
        .from("surf_jobs")
        .select("*")
        .in("id", deterministicIds)
      requireNoDbError(idempotentError, "Failed to check idempotent surf jobs")
      for (const job of (idempotentJobs ?? []) as SurfJobRow[]) {
        if (job.source_id && !existingJobsBySourceId.has(job.source_id)) {
          existingJobsBySourceId.set(job.source_id, job)
        }
      }
    }

    const sourcesToQueue = sources.filter(
      (source) => !existingJobsBySourceId.has(source.id)
    )
    if (sourcesToQueue.length === 0) {
      const jobs = [...existingJobsBySourceId.values()].map(formatSurfJob)
      return {
        job: jobs[0] ?? null,
        jobs,
        enqueued: false,
        enqueuedCount: 0,
        skippedCount: sources.length,
        reason: input.idempotencyKey
          ? "idempotency_or_active_jobs_exist"
          : "active_jobs_exist",
      }
    }

    const runId = randomUUID()
    const traceId = randomUUID()
    const jobInserts = sourcesToQueue.map((source) => ({
      id: input.idempotencyKey
        ? idempotentSurfJobId(
            context,
            input.surfPointId,
            source.id,
            input.idempotencyKey
          )
        : randomUUID(),
      product_id: context.productId,
      user_id: userId,
      playbook_id: input.surfPointId,
      job_type: "extract",
      status: "pending",
      priority: 1,
      source_id: source.id,
      payload: {
        source_id: source.id,
        run_id: runId,
        trace_id: traceId,
        triggered_by: "mcp",
        source_snapshot: buildSourceSnapshot(source),
      },
      max_attempts: 3,
    }))

    const { data, error } = await this.db
      .from("surf_jobs")
      .insert(jobInserts)
      .select("*")

    requireNoDbError(error, "Failed to queue surf point run")
    const queuedJobs = ((data ?? []) as SurfJobRow[]).map(formatSurfJob)
    const skippedJobs = [...existingJobsBySourceId.values()].map(formatSurfJob)
    const jobs = [...queuedJobs, ...skippedJobs]
    return {
      job: jobs[0] ?? null,
      jobs,
      enqueued: true,
      enqueuedCount: queuedJobs.length,
      skippedCount: skippedJobs.length,
      runId,
      traceId,
      sourceIdsQueued: sourcesToQueue.map((source) => source.id),
    }
  }

  async getSurfJob(context: SignalSurfContext, jobId: string) {
    const job = await this.getSurfJobAndValidateProduct(context, jobId)
    return { job: formatSurfJob(job) }
  }

  async waitForSurfJob(
    context: SignalSurfContext,
    input: WaitForSurfJobInput
  ) {
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 30000, 0), 120000)
    const pollIntervalMs = Math.min(
      Math.max(input.pollIntervalMs ?? 1000, 100),
      10000
    )
    const startedAt = Date.now()
    const deadline = startedAt + timeoutMs
    let polls = 0

    while (true) {
      polls += 1
      const job = await this.getSurfJobAndValidateProduct(context, input.jobId)
      const formattedJob = formatSurfJob(job)
      const terminal = isTerminalSurfJobStatus(job.status)
      if (terminal) {
        return {
          job: formattedJob,
          terminal: true,
          timedOut: false,
          polls,
          elapsedMs: Date.now() - startedAt,
        }
      }

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        return {
          job: formattedJob,
          terminal: false,
          timedOut: true,
          polls,
          elapsedMs: Date.now() - startedAt,
        }
      }

      await sleep(Math.min(pollIntervalMs, remainingMs))
    }
  }

  async listSurfJobs(
    context: SignalSurfContext,
    input: ListSurfJobsInput = {}
  ) {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const surfPointIds = input.surfPointId
      ? [input.surfPointId]
      : await this.listProductSurfPointIds(context)

    if (input.surfPointId) {
      await this.assertSurfPointInProduct(context, input.surfPointId)
    }
    if (surfPointIds.length === 0) {
      return { jobs: [], totalCount: 0, limit, offset }
    }

    let query = this.db
      .from("surf_jobs")
      .select("*", { count: "exact" })
      .in("playbook_id", surfPointIds)

    if (input.status) query = query.eq("status", input.status)

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    requireNoDbError(error, "Failed to list surf jobs")
    return {
      jobs: ((data ?? []) as SurfJobRow[]).map(formatSurfJob),
      totalCount: count ?? data?.length ?? 0,
      limit,
      offset,
    }
  }

  async cancelSurfJob(context: SignalSurfContext, jobId: string) {
    const existing = await this.getSurfJobAndValidateProduct(context, jobId)
    if (existing.status !== "pending") {
      throw new UserFacingError(
        "Only pending surf jobs can be cancelled through MCP.",
        { code: "BAD_REQUEST", status: 400 }
      )
    }

    const now = new Date().toISOString()
    const { data, error } = await this.db
      .from("surf_jobs")
      .update({
        status: "failed",
        last_error: "Cancelled by MCP",
        completed_at: now,
      })
      .eq("id", jobId)
      .eq("status", "pending")
      .select("*")
      .single()

    requireNoDbError(error, "Failed to cancel surf job")
    return {
      job: formatSurfJob(data as SurfJobRow),
      cancelled: true,
    }
  }

  async deleteSurfPoints(context: SignalSurfContext, surfPointIds: string[]) {
    const ids = uniqueIds(surfPointIds)
    const existing = await this.getSurfPointsByIds(context, ids)
    if (existing.length !== ids.length) {
      throw new UserFacingError(
        "One or more surf points were not found or are already deleted.",
        { code: "NOT_FOUND", status: 404 }
      )
    }

    const now = new Date().toISOString()
    const { data, error } = await this.db
      .from("playbooks")
      .update({ deleted_at: now, updated_at: now })
      .eq("product_id", context.productId)
      .is("deleted_at", null)
      .in("id", ids)
      .select("id, name")

    requireNoDbError(error, "Failed to delete surf points")

    const { error: cancelError } = await this.db
      .from("surf_jobs")
      .update({
        status: "failed",
        last_error: "Playbook deleted",
        completed_at: now,
      })
      .in("playbook_id", ids)
      .eq("status", "pending")
    requireNoDbError(errorOrNull(cancelError), "Failed to cancel pending jobs")

    if (context.userId) {
      const { data: prefs } = await this.db
        .from("user_preferences")
        .select("current_playbook_id")
        .eq("user_id", context.userId)
        .maybeSingle()
      if (
        prefs?.current_playbook_id &&
        ids.includes(prefs.current_playbook_id)
      ) {
        const replacement = await this.findFirstActiveSurfPoint(context, ids)
        const { error: prefsError } = await this.db
          .from("user_preferences")
          .update({
            current_playbook_id: replacement?.id ?? null,
            updated_at: now,
          })
          .eq("user_id", context.userId)
        requireNoDbError(
          errorOrNull(prefsError),
          "Failed to update current surf point preference"
        )
      }
    }

    return {
      deletedSurfPoints: (data ?? []) as Array<{ id: string; name: string }>,
      count: data?.length ?? 0,
    }
  }

  async listDatabases(
    context: SignalSurfContext,
    input: ListDatabasesInput = {}
  ) {
    let query = this.db
      .from("databases")
      .select(DATABASE_COLUMNS)
      .eq("product_id", context.productId)

    if (!input.includeSystem) query = query.is("system_type", null)

    const { data, error } = await query
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(input.limit ?? 100)

    requireNoDbError(error, "Failed to list databases")
    return {
      databases: (data ?? []).map(formatDatabase),
      totalCount: data?.length ?? 0,
    }
  }

  async createTable(context: SignalSurfContext, input: CreateTableInput) {
    if (input.folderId) {
      await this.assertDatabaseFolderBelongsToProduct(context, input.folderId)
    }
    const schema = input.schema ?? { fields: [] }
    await this.validateDatabaseSchemaReferences(context, schema)

    const now = new Date().toISOString()
    const { data, error } = await this.db
      .from("databases")
      .insert({
        id: randomUUID(),
        product_id: context.productId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        schema,
        item_type: input.itemType?.trim() || null,
        system_type: null,
        view_configs: input.viewConfigs ?? {},
        folder_id: input.folderId ?? null,
        display_order: input.displayOrder ?? 0,
        created_at: now,
        updated_at: now,
      })
      .select(DATABASE_COLUMNS)
      .single()

    if (error?.code === "23505") {
      throw new UserFacingError("A table with this name already exists.", {
        code: "CONFLICT",
        status: 409,
      })
    }
    requireNoDbError(error, "Failed to create table")
    return { database: formatDatabase(data as DatabaseRow) }
  }

  async updateTable(context: SignalSurfContext, input: UpdateTableInput) {
    const existing = await this.getDatabaseAndValidateProduct(
      context,
      input.databaseId
    )
    if (input.schema !== undefined && input.schemaPatch !== undefined) {
      throw new UserFacingError("Pass either schema or schemaPatch, not both.", {
        code: "BAD_REQUEST",
        status: 400,
      })
    }
    if (input.folderId) {
      await this.assertDatabaseFolderBelongsToProduct(context, input.folderId)
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (input.name !== undefined) updateData.name = input.name.trim()
    if (input.description !== undefined)
      updateData.description = input.description?.trim() || null
    if (input.icon !== undefined) updateData.icon = input.icon
    if (input.color !== undefined) updateData.color = input.color
    if (input.itemType !== undefined)
      updateData.item_type = input.itemType?.trim() || null
    if (input.viewConfigs !== undefined) updateData.view_configs = input.viewConfigs
    if (input.folderId !== undefined) updateData.folder_id = input.folderId
    if (input.displayOrder !== undefined)
      updateData.display_order = input.displayOrder

    if (input.schema !== undefined) {
      const nextSchema = input.schema ?? {}
      await this.validateDatabaseSchemaReferences(context, nextSchema)
      updateData.schema = nextSchema
    }
    if (input.schemaPatch !== undefined) {
      const nextSchema = { ...asRecord(existing.schema), ...input.schemaPatch }
      await this.validateDatabaseSchemaReferences(context, nextSchema)
      updateData.schema = nextSchema
    }

    const changedKeys = Object.keys(updateData).filter(
      (key) => key !== "updated_at"
    )
    if (changedKeys.length === 0) {
      throw new UserFacingError("No fields to update.", {
        code: "BAD_REQUEST",
        status: 400,
      })
    }

    const { data, error } = await this.db
      .from("databases")
      .update(updateData)
      .eq("id", input.databaseId)
      .eq("product_id", context.productId)
      .select(DATABASE_COLUMNS)
      .single()

    if (error?.code === "23505") {
      throw new UserFacingError("A table with this name already exists.", {
        code: "CONFLICT",
        status: 409,
      })
    }
    requireNoDbError(error, "Failed to update table")
    return {
      database: formatDatabase(data as DatabaseRow),
      changedFields: changedKeys,
    }
  }

  async readTable(context: SignalSurfContext, input: ReadTableInput) {
    await this.assertDatabaseBelongsToProduct(context, input.databaseId)

    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const hasAdvancedQuery =
      (input.filters?.length ?? 0) > 0 || (input.sorts?.length ?? 0) > 0

    if (hasAdvancedQuery) {
      return this.readTableWithAdvancedQuery(input)
    }

    let query = this.db
      .from("entries")
      .select(ENTRY_COLUMNS, { count: "exact" })
      .eq("database_id", input.databaseId)

    if (input.dataContains && Object.keys(input.dataContains).length > 0) {
      query = query.contains("data", input.dataContains)
    }

    const { data, error, count } = await query
      .order(input.orderBy ?? "created_at", {
        ascending: input.ascending ?? false,
      })
      .range(offset, offset + limit - 1)

    requireNoDbError(error, "Failed to read table")
    return {
      rows: (data ?? []).map(formatEntry),
      totalCount: count ?? data?.length ?? 0,
      limit,
      offset,
    }
  }

  async listDatabaseViews(context: SignalSurfContext, databaseId: string) {
    const database = await this.getDatabaseAndValidateProduct(
      context,
      databaseId
    )
    return {
      databaseId,
      views: extractSavedViews(database.view_configs),
    }
  }

  async readTableView(
    context: SignalSurfContext,
    input: ReadTableViewInput
  ) {
    const database = await this.getDatabaseAndValidateProduct(
      context,
      input.databaseId
    )
    const views = extractSavedViews(database.view_configs)
    const view = views.find((candidate) => candidate.id === input.viewId)
    if (!view) {
      throw new UserFacingError("Database view not found.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }

    const viewFilters = normalizeSavedViewFilters(view.raw)
    const viewSorts = normalizeSavedViewSorts(database.view_configs, view.raw)
    const filterLogic: "and" | "or" =
      input.filterLogic ?? (view.filterLogic === "or" ? "or" : "and")

    return {
      view,
      ...(await this.readTable(context, {
        databaseId: input.databaseId,
        limit: input.limit,
        offset: input.offset,
        filters: [...viewFilters, ...(input.filters ?? [])],
        filterLogic,
        sorts: input.sorts ?? viewSorts,
        scanLimit: input.scanLimit,
      })),
    }
  }

  private async readTableWithAdvancedQuery(input: ReadTableInput) {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const scanLimit = input.scanLimit ?? 1000
    let query = this.db
      .from("entries")
      .select(ENTRY_COLUMNS, { count: "exact" })
      .eq("database_id", input.databaseId)

    if (input.dataContains && Object.keys(input.dataContains).length > 0) {
      query = query.contains("data", input.dataContains)
    }

    const { data, error, count } = await query
      .order(input.orderBy ?? "created_at", {
        ascending: input.ascending ?? false,
      })
      .range(0, scanLimit - 1)

    requireNoDbError(error, "Failed to read table")

    const rows = (data ?? []) as EntryRow[]
    const filters = input.filters ?? []
    const filterLogic = input.filterLogic ?? "and"
    const filtered = filters.length
      ? rows.filter((row) => rowMatchesTableFilters(row, filters, filterLogic))
      : rows
    const sorted = input.sorts?.length
      ? sortTableRows(filtered, input.sorts)
      : filtered
    const paged = sorted.slice(offset, offset + limit)
    const scannedCount = rows.length
    const sourceTotalCount = count ?? rows.length

    return {
      rows: paged.map(formatEntry),
      totalCount: filtered.length,
      sourceTotalCount,
      scannedCount,
      scanLimit,
      hasMoreToScan: sourceTotalCount > scannedCount,
      limit,
      offset,
      filterLogic,
      filters,
      sorts: input.sorts ?? [],
    }
  }

  async getTableRow(context: SignalSurfContext, rowId: string) {
    const entry = await this.getEntryAndValidateProduct(context, rowId)
    return { row: formatEntry(entry) }
  }

  async createTableRow(context: SignalSurfContext, input: CreateTableRowInput) {
    await this.assertDatabaseBelongsToProduct(context, input.databaseId)
    if (input.playbookId) {
      await this.assertSurfPointCanWriteDatabase(
        context,
        input.playbookId,
        input.databaseId
      )
    }
    await this.validateEntryDataReferences(
      context,
      input.databaseId,
      input.data
    )

    const { data, error } = await this.db
      .from("entries")
      .insert({
        database_id: input.databaseId,
        playbook_id: input.playbookId ?? null,
        data: input.data,
        note: input.note ?? null,
        origin: "mcp",
        origin_ref: context.tokenName ?? null,
        triggered: false,
      })
      .select(ENTRY_COLUMNS)
      .single()

    requireNoDbError(error, "Failed to create table row")
    return { row: formatEntry(data as EntryRow) }
  }

  async updateTableRow(context: SignalSurfContext, input: UpdateTableRowInput) {
    const existing = await this.getEntryAndValidateProduct(context, input.rowId)
    if (input.databaseId && existing.database_id !== input.databaseId) {
      throw new UserFacingError(
        `Row belongs to database ${existing.database_id}, not ${input.databaseId}`,
        { code: "BAD_REQUEST", status: 400 }
      )
    }
    if (input.playbookId) {
      await this.assertSurfPointCanWriteDatabase(
        context,
        input.playbookId,
        existing.database_id as string
      )
    }

    let nextData: JsonRecord | undefined
    if (input.data !== undefined && input.dataPatch !== undefined) {
      throw new UserFacingError("Pass either data or dataPatch, not both.", {
        code: "BAD_REQUEST",
        status: 400,
      })
    }
    if (input.data !== undefined) nextData = input.data
    if (input.dataPatch !== undefined) {
      nextData = { ...asRecord(existing.data), ...input.dataPatch }
    }

    if (nextData !== undefined) {
      await this.validateEntryDataReferences(
        context,
        existing.database_id as string,
        nextData
      )
      const { error } = await this.db.rpc("update_entry_with_source", {
        p_entry_id: input.rowId,
        p_data: nextData,
        p_source: "mcp",
        p_source_ref: context.tokenName ?? null,
      })
      requireNoDbError(error, "Failed to update row data")
    }

    if (input.note !== undefined) {
      const { error } = await this.db.rpc("update_entry_note_with_source", {
        p_entry_id: input.rowId,
        p_note: input.note,
        p_source: "mcp",
        p_source_ref: context.tokenName ?? null,
      })
      requireNoDbError(error, "Failed to update row note")
    }

    const directUpdate: Record<string, unknown> = {}
    if (input.playbookId !== undefined)
      directUpdate.playbook_id = input.playbookId

    if (Object.keys(directUpdate).length > 0) {
      directUpdate.updated_at = new Date().toISOString()
      const { error } = await this.db
        .from("entries")
        .update(directUpdate)
        .eq("id", input.rowId)
      requireNoDbError(error, "Failed to update row metadata")
    }

    const updated = await this.getEntryAndValidateProduct(context, input.rowId)
    return { row: formatEntry(updated) }
  }

  async deleteTableRows(context: SignalSurfContext, rowIds: string[]) {
    const ids = uniqueIds(rowIds)
    const entries = await this.getEntriesAndValidateProduct(context, ids)
    if (entries.length !== ids.length) {
      throw new UserFacingError("One or more rows were not found.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }

    const { error, count } = await this.db
      .from("entries")
      .delete({ count: "exact" })
      .in("id", ids)

    requireNoDbError(error, "Failed to delete rows")
    return { deletedRowIds: ids, count: count ?? ids.length }
  }

  async listDatabaseFields(context: SignalSurfContext, databaseId: string) {
    const database = await this.getDatabaseAndValidateProduct(
      context,
      databaseId
    )
    const schema = asRecord(database.schema)
    return {
      databaseId,
      fields: schemaFields(schema),
      relations: Array.isArray(schema.relations) ? schema.relations : [],
    }
  }

  async addDatabaseField(
    context: SignalSurfContext,
    input: AddDatabaseFieldInput
  ) {
    validateDatabaseField(input.field)
    return this.updateDatabaseSchema(context, input.databaseId, (schema) => {
      const fields = schemaFields(schema)
      assertFieldKeyAvailable(fields, String(input.field.key))
      return {
        ...schema,
        fields: [...fields, input.field],
      }
    })
  }

  async updateDatabaseField(
    context: SignalSurfContext,
    input: UpdateDatabaseFieldInput
  ) {
    return this.updateDatabaseSchema(context, input.databaseId, (schema) => {
      const fields = schemaFields(schema)
      const index = fields.findIndex((field) => field.key === input.fieldKey)
      if (index < 0) {
        throw new UserFacingError("Database field not found.", {
          code: "NOT_FOUND",
          status: 404,
        })
      }
      const nextField = { ...fields[index], ...input.patch }
      validateDatabaseField(nextField)
      if (nextField.key !== input.fieldKey) {
        assertFieldKeyAvailable(fields, String(nextField.key), input.fieldKey)
      }
      const nextFields = [...fields]
      nextFields[index] = nextField
      return {
        ...schema,
        fields: nextFields,
      }
    })
  }

  async removeDatabaseField(
    context: SignalSurfContext,
    input: RemoveDatabaseFieldInput
  ) {
    return {
      removesRowData: false,
      ...(await this.updateDatabaseSchema(context, input.databaseId, (schema) => {
        const fields = schemaFields(schema)
        const nextFields = fields.filter((field) => field.key !== input.fieldKey)
        if (nextFields.length === fields.length) {
          throw new UserFacingError("Database field not found.", {
            code: "NOT_FOUND",
            status: 404,
          })
        }
        return {
          ...schema,
          fields: nextFields,
        }
      })),
    }
  }

  async createRelationField(
    context: SignalSurfContext,
    input: CreateRelationFieldInput
  ) {
    await this.assertDatabaseBelongsToProduct(context, input.targetDatabaseId)
    const field: JsonRecord = {
      key: input.key,
      type: "item_ref",
      label: input.label ?? input.key,
      target_database_id: input.targetDatabaseId,
      relation_type: input.relationType ?? "item_ref",
    }
    if (input.description) field.description = input.description
    if (input.displayField) field.display_field = input.displayField
    return this.addDatabaseField(context, {
      databaseId: input.databaseId,
      field,
    })
  }

  async listSurfPointSources(context: SignalSurfContext, surfPointId: string) {
    await this.assertSurfPointBelongsToProduct(context, surfPointId)

    const { data, error } = await this.db
      .from("sources")
      .select(SOURCE_COLUMNS)
      .eq("playbook_id", surfPointId)
      .order("updated_at", { ascending: false })

    requireNoDbError(error, "Failed to list surf point sources")
    const sources = (data ?? []) as SourceRow[]
    return {
      surfPointId,
      sources: sources.map(formatSource),
      totalCount: sources.length,
    }
  }

  async setSurfPointSourceActive(
    context: SignalSurfContext,
    input: SetSurfPointSourceActiveInput
  ) {
    const { data: existing, error: existingError } = await this.db
      .from("sources")
      .select(SOURCE_COLUMNS)
      .eq("id", input.sourceId)
      .maybeSingle()

    requireNoDbError(existingError, "Failed to read surf point source")
    if (!existing) {
      throw new UserFacingError("Source not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }

    const source = existing as SourceRow
    await this.assertSurfPointBelongsToProduct(context, source.playbook_id)

    const { data, error } = await this.db
      .from("sources")
      .update({
        is_active: input.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.sourceId)
      .select(SOURCE_COLUMNS)
      .single()

    requireNoDbError(error, "Failed to update surf point source")
    return { source: formatSource(data as SourceRow) }
  }

  async listSurfPointTools(context: SignalSurfContext, surfPointId: string) {
    const surfPoint = await this.getSurfPointForUpdate(context, surfPointId)
    const toolIds = uniqueStrings(asRecord(surfPoint.tool_config).auto_tool_ids)
    return {
      surfPointId,
      toolIds,
      totalCount: toolIds.length,
    }
  }

  async attachSurfPointTool(
    context: SignalSurfContext,
    input: SurfPointToolInput
  ) {
    await this.assertProductToolBelongsToProduct(context, input.toolId)
    return this.updateSurfPointToolIds(
      context,
      input.surfPointId,
      (toolIds) =>
        toolIds.includes(input.toolId) ? toolIds : [...toolIds, input.toolId]
    )
  }

  async detachSurfPointTool(
    context: SignalSurfContext,
    input: SurfPointToolInput
  ) {
    await this.assertProductToolBelongsToProduct(context, input.toolId)
    return this.updateSurfPointToolIds(context, input.surfPointId, (toolIds) =>
      toolIds.filter((toolId) => toolId !== input.toolId)
    )
  }

  private async resolveDatabaseIds(
    context: SignalSurfContext,
    databaseIds: string[] | undefined
  ): Promise<string[]> {
    if (databaseIds !== undefined) {
      const ids = uniqueIds(databaseIds)
      await this.assertDatabaseIdsBelongToProduct(context, ids)
      return ids
    }

    const { data, error } = await this.db
      .from("databases")
      .select("id")
      .eq("product_id", context.productId)
      .is("system_type", null)
      .order("display_order", { ascending: true })

    requireNoDbError(error, "Failed to resolve default database")
    const rows = (data ?? []) as Array<{ id: string }>
    if (rows.length === 1) return [rows[0].id]
    if (rows.length > 1) {
      throw new UserFacingError(
        "databaseIds is required because this product has multiple databases.",
        { code: "BAD_REQUEST", status: 400 }
      )
    }
    throw new UserFacingError(
      "databaseIds is required because this product has no user-facing databases. Pass databaseIds: [] only for an intentional action-only surf point.",
      { code: "BAD_REQUEST", status: 400 }
    )
  }

  private async findSurfPointByName(
    context: SignalSurfContext,
    name: string
  ): Promise<{ id: string } | null> {
    const { data, error } = await this.db
      .from("playbooks")
      .select("id")
      .eq("product_id", context.productId)
      .eq("name", name.trim())
      .is("deleted_at", null)
      .maybeSingle()
    requireNoDbError(error, "Failed to check existing surf point")
    return (data as { id: string } | null) ?? null
  }

  private async assertDatabaseIdsBelongToProduct(
    context: SignalSurfContext,
    databaseIds: string[]
  ): Promise<void> {
    if (databaseIds.length === 0) return
    const { data, error } = await this.db
      .from("databases")
      .select("id")
      .eq("product_id", context.productId)
      .in("id", databaseIds)

    requireNoDbError(error, "Failed to validate database access")
    const found = new Set(
      ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
    )
    const missing = databaseIds.filter((id) => !found.has(id))
    if (missing.length > 0) {
      throw new UserFacingError(
        `Database not found or access denied: ${missing.join(", ")}`,
        { code: "NOT_FOUND", status: 404 }
      )
    }
  }

  private async assertDatabaseBelongsToProduct(
    context: SignalSurfContext,
    databaseId: string
  ): Promise<void> {
    await this.assertDatabaseIdsBelongToProduct(context, [databaseId])
  }

  private async validateDatabaseSchemaReferences(
    context: SignalSurfContext,
    schema: JsonRecord
  ): Promise<void> {
    const fields = schemaFields(schema)
    const seenFieldKeys = new Set<string>()
    for (const field of fields) {
      validateDatabaseField(field)
      const key = String(field.key)
      if (seenFieldKeys.has(key)) {
        throw new UserFacingError(`Database field "${key}" already exists.`, {
          code: "CONFLICT",
          status: 409,
        })
      }
      seenFieldKeys.add(key)
      if (field.type !== "item_ref") continue
      const targetDatabaseId = firstString(
        field.target_database_id,
        field.targetDatabaseId
      )
      if (targetDatabaseId) {
        await this.assertDatabaseBelongsToProduct(context, targetDatabaseId)
      }
    }

    const relations = Array.isArray(schema.relations)
      ? (schema.relations as unknown[])
      : []
    for (const relation of relations) {
      const record = asRecord(relation)
      const targetDatabaseId = firstString(
        record.target_database_id,
        record.targetDatabaseId,
        record.database_id,
        record.databaseId
      )
      if (targetDatabaseId) {
        await this.assertDatabaseBelongsToProduct(context, targetDatabaseId)
      }
    }
  }

  private async getDatabaseAndValidateProduct(
    context: SignalSurfContext,
    databaseId: string
  ): Promise<DatabaseRow> {
    const { data, error } = await this.db
      .from("databases")
      .select(DATABASE_COLUMNS)
      .eq("id", databaseId)
      .eq("product_id", context.productId)
      .maybeSingle()
    requireNoDbError(error, "Failed to validate database access")
    if (!data) {
      throw new UserFacingError("Database not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
    return data as DatabaseRow
  }

  private async updateDatabaseSchema(
    context: SignalSurfContext,
    databaseId: string,
    mutate: (schema: JsonRecord) => JsonRecord
  ) {
    const database = await this.getDatabaseAndValidateProduct(
      context,
      databaseId
    )
    const nextSchema = mutate(asRecord(database.schema))
    const { data, error } = await this.db
      .from("databases")
      .update({
        schema: nextSchema,
        updated_at: new Date().toISOString(),
      })
      .eq("id", databaseId)
      .eq("product_id", context.productId)
      .select(DATABASE_COLUMNS)
      .single()

    requireNoDbError(error, "Failed to update database schema")
    return {
      database: formatDatabase(data as DatabaseRow),
      fields: schemaFields(asRecord((data as DatabaseRow).schema)),
    }
  }

  private async assertSurfPointBelongsToProduct(
    context: SignalSurfContext,
    surfPointId: string
  ): Promise<void> {
    const { data, error } = await this.db
      .from("playbooks")
      .select("id")
      .eq("id", surfPointId)
      .eq("product_id", context.productId)
      .is("deleted_at", null)
      .maybeSingle()
    requireNoDbError(error, "Failed to validate surf point access")
    if (!data) {
      throw new UserFacingError("Surf point not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
  }

  private async assertProductToolBelongsToProduct(
    context: SignalSurfContext,
    toolId: string
  ): Promise<void> {
    const { data, error } = await this.db
      .from("product_tools")
      .select("id")
      .eq("id", toolId)
      .eq("product_id", context.productId)
      .maybeSingle()
    requireNoDbError(error, "Failed to validate product tool access")
    if (!data) {
      throw new UserFacingError("Tool not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
  }

  private async assertSurfPointInProduct(
    context: SignalSurfContext,
    surfPointId: string
  ): Promise<void> {
    const { data, error } = await this.db
      .from("playbooks")
      .select("id")
      .eq("id", surfPointId)
      .eq("product_id", context.productId)
      .maybeSingle()
    requireNoDbError(error, "Failed to validate surf point access")
    if (!data) {
      throw new UserFacingError("Surf point not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
  }

  private async listProductSurfPointIds(
    context: SignalSurfContext
  ): Promise<string[]> {
    const { data, error } = await this.db
      .from("playbooks")
      .select("id")
      .eq("product_id", context.productId)
    requireNoDbError(error, "Failed to resolve product surf points")
    return ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
  }

  private async findSurfJobById(jobId: string): Promise<SurfJobRow | null> {
    const { data, error } = await this.db
      .from("surf_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle()
    requireNoDbError(error, "Failed to read surf job")
    return (data as SurfJobRow | null) ?? null
  }

  private async getSurfJobAndValidateProduct(
    context: SignalSurfContext,
    jobId: string
  ): Promise<SurfJobRow> {
    const job = await this.findSurfJobById(jobId)
    if (!job) {
      throw new UserFacingError("Surf job not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
    await this.assertSurfJobBelongsToProduct(context, job)
    return job
  }

  private async assertSurfJobBelongsToProduct(
    context: SignalSurfContext,
    job: SurfJobRow
  ): Promise<void> {
    await this.assertSurfPointInProduct(context, job.playbook_id)
  }

  private async getSurfPointRunTarget(
    context: SignalSurfContext,
    surfPointId: string
  ): Promise<{ id: string; name: string; is_active: boolean }> {
    const { data, error } = await this.db
      .from("playbooks")
      .select("id, name, is_active")
      .eq("id", surfPointId)
      .eq("product_id", context.productId)
      .is("deleted_at", null)
      .maybeSingle()
    requireNoDbError(error, "Failed to validate surf point access")
    if (!data) {
      throw new UserFacingError("Surf point not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
    return data as { id: string; name: string; is_active: boolean }
  }

  private async assertSurfPointCanWriteDatabase(
    context: SignalSurfContext,
    surfPointId: string,
    databaseId: string
  ): Promise<void> {
    const { data, error } = await this.db
      .from("playbooks")
      .select("id, database_ids")
      .eq("id", surfPointId)
      .eq("product_id", context.productId)
      .is("deleted_at", null)
      .maybeSingle()
    requireNoDbError(error, "Failed to validate surf point target databases")
    if (!data) {
      throw new UserFacingError("Surf point not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
    const databaseIds = Array.isArray(data.database_ids)
      ? (data.database_ids as string[])
      : []
    if (!databaseIds.includes(databaseId)) {
      throw new UserFacingError(
        `Surf point ${surfPointId} is not configured to write to database ${databaseId}.`,
        { code: "BAD_REQUEST", status: 400 }
      )
    }
  }

  private async validateEntryDataReferences(
    context: SignalSurfContext,
    databaseId: string,
    data: JsonRecord
  ): Promise<void> {
    const { data: database, error } = await this.db
      .from("databases")
      .select("schema")
      .eq("id", databaseId)
      .eq("product_id", context.productId)
      .single()
    requireNoDbError(error, "Failed to validate entry references")

    const fields = Array.isArray(database?.schema?.fields)
      ? (database.schema.fields as Array<{
          key?: unknown
          type?: unknown
          target_database_id?: unknown
        }>)
      : []

    for (const field of fields) {
      if (field.type !== "item_ref" || typeof field.key !== "string") continue
      const raw = data[field.key]
      if (raw == null) continue

      if (
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        !("entry_id" in raw) ||
        typeof (raw as { entry_id: unknown }).entry_id !== "string"
      ) {
        throw new UserFacingError(
          `Field "${field.key}" must be { database_id, entry_id }`,
          { code: "BAD_REQUEST", status: 400 }
        )
      }

      const value = raw as { database_id?: unknown; entry_id: string }
      const targetDatabaseId =
        typeof field.target_database_id === "string"
          ? field.target_database_id
          : undefined
      if (targetDatabaseId && value.database_id !== targetDatabaseId) {
        throw new UserFacingError(
          `Field "${field.key}" must reference database ${targetDatabaseId}`,
          { code: "BAD_REQUEST", status: 400 }
        )
      }

      const { data: target, error: targetError } = await this.db
        .from("entries")
        .select("id, database_id")
        .eq("id", value.entry_id)
        .maybeSingle()
      requireNoDbError(targetError, "Failed to validate referenced entry")

      if (!target) {
        throw new UserFacingError(
          `Referenced entry ${value.entry_id} not found`,
          {
            code: "BAD_REQUEST",
            status: 400,
          }
        )
      }
      if (!target.database_id) {
        throw new UserFacingError(
          `Referenced entry ${value.entry_id} is missing database scope`,
          { code: "BAD_REQUEST", status: 400 }
        )
      }
      try {
        await this.assertDatabaseBelongsToProduct(context, target.database_id)
      } catch (error) {
        if (error instanceof UserFacingError && error.code === "NOT_FOUND") {
          throw new UserFacingError(
            "Referenced entry not found or access denied.",
            { code: "BAD_REQUEST", status: 400 }
          )
        }
        throw error
      }
      if (value.database_id && target.database_id !== value.database_id) {
        throw new UserFacingError(
          `Referenced entry belongs to database ${target.database_id}, not ${value.database_id}`,
          { code: "BAD_REQUEST", status: 400 }
        )
      }
    }
  }

  private async assertFolderBelongsToProduct(
    context: SignalSurfContext,
    folderId: string
  ): Promise<void> {
    const { data, error } = await this.db
      .from("playbook_folders")
      .select("id")
      .eq("id", folderId)
      .eq("product_id", context.productId)
      .maybeSingle()
    requireNoDbError(error, "Failed to validate surf point folder access")
    if (!data) {
      throw new UserFacingError(
        "Surf point folder not found or access denied.",
        {
          code: "NOT_FOUND",
          status: 404,
        }
      )
    }
  }

  private async assertDatabaseFolderBelongsToProduct(
    context: SignalSurfContext,
    folderId: string
  ): Promise<void> {
    const { data, error } = await this.db
      .from("database_folders")
      .select("id")
      .eq("id", folderId)
      .eq("product_id", context.productId)
      .maybeSingle()
    requireNoDbError(error, "Failed to validate table folder access")
    if (!data) {
      throw new UserFacingError("Table folder not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
  }

  private async getSurfPointsByIds(
    context: SignalSurfContext,
    ids: string[]
  ): Promise<Array<{ id: string; name: string }>> {
    if (ids.length === 0) return []
    const { data, error } = await this.db
      .from("playbooks")
      .select("id, name")
      .eq("product_id", context.productId)
      .is("deleted_at", null)
      .in("id", ids)
    requireNoDbError(error, "Failed to validate surf points")
    return (data ?? []) as Array<{ id: string; name: string }>
  }

  private async getSurfPointForUpdate(
    context: SignalSurfContext,
    id: string
  ): Promise<SurfPointRow> {
    const { data, error } = await this.db
      .from("playbooks")
      .select(SURF_POINT_COLUMNS)
      .eq("id", id)
      .eq("product_id", context.productId)
      .is("deleted_at", null)
      .maybeSingle()
    requireNoDbError(error, "Failed to fetch surf point")
    if (!data) {
      throw new UserFacingError("Surf point not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
    return data as SurfPointRow
  }

  private async updateSurfPointToolIds(
    context: SignalSurfContext,
    surfPointId: string,
    mutate: (toolIds: string[]) => string[]
  ) {
    const existing = await this.getSurfPointForUpdate(context, surfPointId)
    const currentToolConfig = asRecord(existing.tool_config)
    const cleanToolConfig = withoutLegacyToolRouting(currentToolConfig)
    const currentToolIds = uniqueStrings(currentToolConfig.auto_tool_ids)
    const nextToolIds = uniqueStrings(mutate(currentToolIds))

    if (sameStrings(currentToolIds, nextToolIds)) {
      return {
        surfPoint: formatSurfPoint(existing),
        toolIds: currentToolIds,
        changed: false,
      }
    }

    const { data, error } = await this.db
      .from("playbooks")
      .update({
        tool_config: {
          ...cleanToolConfig,
          auto_tool_ids: nextToolIds,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", surfPointId)
      .eq("product_id", context.productId)
      .is("deleted_at", null)
      .select(SURF_POINT_COLUMNS)
      .single()

    requireNoDbError(error, "Failed to update surf point tools")
    return {
      surfPoint: formatSurfPoint(data as SurfPointRow),
      toolIds: nextToolIds,
      changed: true,
    }
  }

  private async findFirstActiveSurfPoint(
    context: SignalSurfContext,
    excludedIds: string[]
  ): Promise<{ id: string } | null> {
    let query = this.db
      .from("playbooks")
      .select("id")
      .eq("product_id", context.productId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("display_order", { ascending: true })
      .limit(1)

    for (const id of excludedIds) query = query.neq("id", id)

    const { data, error } = await query.maybeSingle()
    requireNoDbError(error, "Failed to resolve replacement surf point")
    return (data as { id: string } | null) ?? null
  }

  private async getEntryAndValidateProduct(
    context: SignalSurfContext,
    rowId: string
  ): Promise<EntryRow> {
    const rows = await this.getEntriesAndValidateProduct(context, [rowId])
    const row = rows[0]
    if (!row) {
      throw new UserFacingError("Row not found or access denied.", {
        code: "NOT_FOUND",
        status: 404,
      })
    }
    return row
  }

  private async getEntriesAndValidateProduct(
    context: SignalSurfContext,
    rowIds: string[]
  ): Promise<EntryRow[]> {
    if (rowIds.length === 0) return []
    const { data, error } = await this.db
      .from("entries")
      .select(ENTRY_COLUMNS)
      .in("id", rowIds)
    requireNoDbError(error, "Failed to fetch rows")

    const entries = (data ?? []) as EntryRow[]
    const orphanIds = entries
      .filter((entry) => !entry.database_id)
      .map((entry) => entry.id)
    if (orphanIds.length > 0) {
      throw new UserFacingError(
        `Rows are missing database scope and cannot be accessed through MCP: ${orphanIds.join(
          ", "
        )}`,
        { code: "NOT_FOUND", status: 404 }
      )
    }
    const databaseIds = uniqueIds(
      entries
        .map((entry) => entry.database_id)
        .filter((id): id is string => typeof id === "string")
    )
    try {
      await this.assertDatabaseIdsBelongToProduct(context, databaseIds)
    } catch (error) {
      if (error instanceof UserFacingError && error.code === "NOT_FOUND") {
        throw new UserFacingError("Row not found or access denied.", {
          code: "NOT_FOUND",
          status: 404,
        })
      }
      throw error
    }
    return entries
  }
}

function errorOrNull(
  error: unknown
): { message: string; code?: string } | null {
  if (!error) return null
  if (typeof error === "object" && "message" in error) {
    const record = error as { message: string; code?: string }
    return { message: record.message, code: record.code }
  }
  return { message: String(error) }
}

function upsertContextProduct(
  context: SignalSurfContext,
  product: SignalSurfProductContext,
  productIds: string[]
): void {
  context.productIds = productIds
  const productsById = new Map(
    (context.products ?? []).map((item) => [item.productId, item])
  )
  productsById.set(product.productId, product)
  context.products = productIds.map(
    (productId) =>
      productsById.get(productId) ?? {
        productId,
        name: productId,
        organizationId: null,
        organizationName: null,
      }
  )
}

function extractSavedViews(viewConfigs: JsonRecord | null) {
  const configs = asRecord(viewConfigs)
  const rawViews = Array.isArray(configs.saved_views)
    ? (configs.saved_views as unknown[])
    : []
  const views = rawViews
    .filter((view): view is JsonRecord =>
      Boolean(view && typeof view === "object" && !Array.isArray(view))
    )
    .map((view) => {
      const id =
        typeof view.id === "string" && view.id.trim()
          ? view.id.trim()
          : "default"
      const name =
        typeof view.name === "string" && view.name.trim()
          ? view.name.trim()
          : id
      return {
        id,
        name,
        viewType: typeof view.viewType === "string" ? view.viewType : null,
        isDefault: view.isDefault === true,
        sortKey: typeof view.sort_key === "string" ? view.sort_key : null,
        groupByKey:
          typeof view.groupByKey === "string" ? view.groupByKey : null,
        filterLogic:
          view.filterLogic === "or" || view.filter_logic === "or"
            ? "or"
            : "and",
        filters: normalizeSavedViewFilters(view),
        raw: view,
      }
    })

  if (views.length > 0) return views
  const defaultView =
    typeof configs.default_view === "string" && configs.default_view.trim()
      ? configs.default_view.trim()
      : "default"
  return [
    {
      id: "default",
      name: defaultView,
      viewType: defaultView,
      isDefault: true,
      sortKey: typeof configs.sort_key === "string" ? configs.sort_key : null,
      groupByKey: null,
      filterLogic: "and",
      filters: [],
      raw: configs,
    },
  ]
}

function normalizeSavedViewFilters(raw: JsonRecord): TableFilterInput[] {
  const candidates = [raw.column_filters, raw.filters, raw.filterGroups]
  const filters: TableFilterInput[] = []
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    for (const item of candidate) {
      const record = asRecord(item)
      const field = normalizeFieldKey(
        firstString(record.field, record.key, record.field_key, record.column)
      )
      const op = normalizeFilterOperator(
        firstString(record.op, record.operator, record.comparator)
      )
      if (!field || !op) continue
      const value =
        "value" in record
          ? record.value
          : "values" in record
            ? record.values
            : undefined
      filters.push({ field, op, value })
    }
  }
  return filters
}

function normalizeSavedViewSorts(
  viewConfigs: JsonRecord | null,
  raw: JsonRecord
): TableSortInput[] {
  const configs = asRecord(viewConfigs)
  const rawSorts = Array.isArray(raw.sorts)
    ? raw.sorts
    : Array.isArray(raw.sort)
      ? raw.sort
      : []
  const sorts = rawSorts
    .map((item) => {
      const record = asRecord(item)
      const field = normalizeFieldKey(
        firstString(record.field, record.key, record.field_key, record.column)
      )
      if (!field) return null
      return {
        field,
        direction:
          firstString(record.direction, record.dir)?.toLowerCase() === "desc"
            ? "desc"
            : "asc",
      } as TableSortInput
    })
    .filter((sort): sort is TableSortInput => Boolean(sort))
  if (sorts.length > 0) return sorts

  const sortKey = normalizeFieldKey(firstString(raw.sort_key, configs.sort_key))
  if (!sortKey) return []
  return [
    {
      field: sortKey,
      direction:
        firstString(raw.sort_direction, configs.sort_direction)?.toLowerCase() ===
        "asc"
          ? "asc"
          : "desc",
    },
  ]
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string")
}

function normalizeFilterOperator(
  value: string | undefined
): TableFilterOperator | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return null
  const aliases: Record<string, TableFilterOperator> = {
    "=": "eq",
    "==": "eq",
    equals: "eq",
    is: "eq",
    not: "neq",
    "!=": "neq",
    not_equals: "neq",
    includes: "contains",
    text_contains: "contains",
    before: "lt",
    after: "gt",
    on_or_before: "lte",
    on_or_after: "gte",
    empty: "is_empty",
    not_empty: "is_not_empty",
  }
  const candidate = aliases[normalized] ?? normalized
  return [
    "eq",
    "neq",
    "in",
    "not_in",
    "contains",
    "starts_with",
    "is_empty",
    "is_not_empty",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "array_contains",
    "relation_is",
    "relation_in",
  ].includes(candidate)
    ? (candidate as TableFilterOperator)
    : null
}

function rowMatchesTableFilters(
  row: EntryRow,
  filters: TableFilterInput[],
  logic: "and" | "or"
): boolean {
  const checks = filters.map((filter) => tableFilterMatches(row, filter))
  return logic === "or" ? checks.some(Boolean) : checks.every(Boolean)
}

function tableFilterMatches(row: EntryRow, filter: TableFilterInput): boolean {
  const actual = getTableFieldValue(row, filter.field)
  switch (filter.op) {
    case "eq":
      return valuesEqual(actual, filter.value)
    case "neq":
      return !valuesEqual(actual, filter.value)
    case "in":
      return asArray(filter.value).some((value) => valuesEqual(actual, value))
    case "not_in":
      return !asArray(filter.value).some((value) => valuesEqual(actual, value))
    case "contains":
      return valueContains(actual, filter.value)
    case "starts_with":
      return String(actual ?? "")
        .toLowerCase()
        .startsWith(String(filter.value ?? "").toLowerCase())
    case "is_empty":
      return isEmptyValue(actual)
    case "is_not_empty":
      return !isEmptyValue(actual)
    case "gt":
      return compareValues(actual, filter.value) > 0
    case "gte":
      return compareValues(actual, filter.value) >= 0
    case "lt":
      return compareValues(actual, filter.value) < 0
    case "lte":
      return compareValues(actual, filter.value) <= 0
    case "between": {
      const [min, max] = asArray(filter.value)
      return compareValues(actual, min) >= 0 && compareValues(actual, max) <= 0
    }
    case "array_contains": {
      if (!Array.isArray(actual)) return false
      const expected = asArray(filter.value)
      return expected.every((value) =>
        actual.some((item) => valuesEqual(item, value))
      )
    }
    case "relation_is":
      return valuesEqual(relationEntryId(actual), relationEntryId(filter.value))
    case "relation_in": {
      const id = relationEntryId(actual)
      return asArray(filter.value).some((value) =>
        valuesEqual(id, relationEntryId(value))
      )
    }
  }
}

function sortTableRows(rows: EntryRow[], sorts: TableSortInput[]): EntryRow[] {
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const cmp = compareValues(
        getTableFieldValue(left, sort.field),
        getTableFieldValue(right, sort.field)
      )
      if (cmp !== 0) return sort.direction === "desc" ? -cmp : cmp
    }
    return 0
  })
}

function getTableFieldValue(row: EntryRow, field: string): unknown {
  const normalized = normalizeFieldKey(field)
  const metadata: Record<string, unknown> = {
    id: row.id,
    rowId: row.id,
    itemId: row.id,
    databaseId: row.database_id,
    database_id: row.database_id,
    playbookId: row.playbook_id,
    playbook_id: row.playbook_id,
    note: row.note,
    origin: row.origin,
    originRef: row.origin_ref,
    origin_ref: row.origin_ref,
    entryKeyHash: row.entry_key_hash,
    entry_key_hash: row.entry_key_hash,
    rawSignalId: row.raw_signal_id,
    raw_signal_id: row.raw_signal_id,
    triggered: row.triggered,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  }
  if (normalized.startsWith("meta.")) {
    return metadata[normalized.slice("meta.".length)]
  }
  if (normalized in metadata) return metadata[normalized]
  return asRecord(row.data)[normalized]
}

function normalizeFieldKey(field: string | undefined): string {
  const trimmed = field?.trim() ?? ""
  return trimmed
    .replace(/^output\./, "")
    .replace(/^data\./, "")
    .replace(/^_rel\./, "")
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left == null || right == null) return left == null && right == null
  return String(left).toLowerCase() === String(right).toLowerCase()
}

function valueContains(actual: unknown, expected: unknown): boolean {
  if (actual == null) return false
  if (Array.isArray(actual)) {
    return actual.some((item) => valuesEqual(item, expected))
  }
  if (typeof actual === "object") {
    return JSON.stringify(actual)
      .toLowerCase()
      .includes(String(expected ?? "").toLowerCase())
  }
  return String(actual)
    .toLowerCase()
    .includes(String(expected ?? "").toLowerCase())
}

function compareValues(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0
  if (left == null) return -1
  if (right == null) return 1

  const leftNumber = toFiniteNumber(left)
  const rightNumber = toFiniteNumber(right)
  if (leftNumber != null && rightNumber != null) {
    return leftNumber - rightNumber
  }

  const leftDate = toDateMs(left)
  const rightDate = toDateMs(right)
  if (leftDate != null && rightDate != null) {
    return leftDate - rightDate
  }

  return String(left).localeCompare(String(right), undefined, {
    sensitivity: "base",
    numeric: true,
  })
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toDateMs(value: unknown): number | null {
  if (typeof value !== "string") return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === "string") return value.trim() === ""
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === "object") return Object.keys(value).length === 0
  return false
}

function relationEntryId(value: unknown): unknown {
  const record = asRecord(value)
  return record.entry_id ?? record.entryId ?? value
}

function schemaFields(schema: JsonRecord): JsonRecord[] {
  return Array.isArray(schema.fields)
    ? schema.fields
        .filter((field): field is JsonRecord =>
          Boolean(field && typeof field === "object" && !Array.isArray(field))
        )
        .map((field) => ({ ...field }))
    : []
}

function validateDatabaseField(field: JsonRecord): void {
  const key = field.key
  const type = field.type
  if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new UserFacingError(
      "Database field key must match /^[A-Za-z_][A-Za-z0-9_]*$/.",
      { code: "BAD_REQUEST", status: 400 }
    )
  }
  if (typeof type !== "string" || !type.trim()) {
    throw new UserFacingError("Database field type is required.", {
      code: "BAD_REQUEST",
      status: 400,
    })
  }
}

function assertFieldKeyAvailable(
  fields: JsonRecord[],
  fieldKey: string,
  currentKey?: string
): void {
  const existing = fields.find(
    (field) => field.key === fieldKey && field.key !== currentKey
  )
  if (existing) {
    throw new UserFacingError(`Database field "${fieldKey}" already exists.`, {
      code: "CONFLICT",
      status: 409,
    })
  }
}

function formatSurfPoint(row: SurfPointRow) {
  return {
    id: row.id,
    surfPointId: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    isActive: row.is_active,
    showAiDashboard: row.show_ai_dashboard,
    icon: row.icon,
    color: row.color,
    databaseIds: row.database_ids ?? [],
    relevanceThreshold: row.relevance_threshold,
    promptTemplate: row.prompt_template,
    scoringRubric: row.scoring_rubric,
    surfPrompt: row.surf_prompt,
    toolConfig: row.tool_config ?? {},
    variables: row.variables ?? {},
    config: row.config ?? {},
    folderId: row.folder_id,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function formatSource(row: SourceRow) {
  const pullConfig = asRecord(row.pull_config)
  const metadata = asRecord(row.metadata)
  return {
    id: row.id,
    sourceId: row.id,
    surfPointId: row.playbook_id,
    name: row.name ?? null,
    type: row.type ?? null,
    endpointId: readTrimmedString(pullConfig.endpoint_id),
    schedule: readTrimmedString(pullConfig.schedule),
    url: readTrimmedString(pullConfig.url),
    provider: readTrimmedString(metadata.provider),
    isActive: row.is_active ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function formatSurfJob(row: SurfJobRow) {
  return {
    id: row.id,
    jobId: row.id,
    resourceUri: `signalsurf://surf-jobs/${row.id}`,
    productId: row.product_id ?? null,
    userId: row.user_id ?? null,
    runId: row.run_id ?? null,
    surfPointId: row.playbook_id,
    sourceId: row.source_id ?? null,
    jobType: row.job_type ?? null,
    status: row.status,
    priority: row.priority ?? null,
    attemptCount: row.attempt_count ?? null,
    maxAttempts: row.max_attempts ?? null,
    payload: row.payload ?? null,
    result: row.result ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    workerId: row.worker_id ?? null,
    lockedUntil: row.locked_until ?? null,
    lastError: row.last_error ?? null,
  }
}

function formatProductTool(row: ProductToolRow) {
  const config = asRecord(row.config)
  const displayName =
    readTrimmedString(config.nickname) ??
    readTrimmedString(config.name) ??
    row.tool_type
  return {
    id: row.id,
    toolId: row.id,
    productId: row.product_id,
    surfPointId: row.playbook_id ?? null,
    toolType: row.tool_type,
    name: displayName,
    isEnabled: row.is_enabled ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function formatProduct(
  row: ProductRow,
  productContext?: SignalSurfProductContext
) {
  return {
    id: row.id,
    productId: row.id,
    name: row.name,
    organizationId: productContext?.organizationId ?? row.organization_id,
    organizationName: productContext?.organizationName ?? null,
    ownerId: row.owner_id,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function formatDatabase(row: DatabaseRow) {
  return {
    id: row.id,
    databaseId: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    schema: row.schema,
    itemType: row.item_type,
    systemType: row.system_type,
    viewConfigs: row.view_configs ?? {},
    folderId: row.folder_id ?? null,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function formatEntry(row: EntryRow) {
  return {
    id: row.id,
    rowId: row.id,
    itemId: row.id,
    databaseId: row.database_id,
    playbookId: row.playbook_id,
    data: row.data ?? {},
    note: row.note ?? "",
    origin: row.origin,
    originRef: row.origin_ref,
    entryKeyHash: row.entry_key_hash,
    rawSignalId: row.raw_signal_id,
    triggered: row.triggered,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
