import type {
  AccessRole,
  DatabaseRow,
  EntryRow,
  JsonRecord,
  SignalSurfContext,
  SupabaseLike,
  SurfPointRow,
} from "./types.js"
import {
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

type ListDatabasesInput = {
  includeSystem?: boolean
  limit?: number
}

type ReadTableInput = {
  databaseId: string
  limit?: number
  offset?: number
  orderBy?: "created_at" | "updated_at"
  ascending?: boolean
  dataContains?: JsonRecord
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
      role: row.role,
      tokenName: row.name ?? undefined,
    }
  }

  private async resolveMcpOAuthToken(
    token: string,
    metadata: { ip?: string | null; resource?: string | null }
  ): Promise<SignalSurfContext | null> {
    const { data, error } = await this.db
      .from("mcp_oauth_tokens")
      .select(
        "id, client_id, user_id, product_id, scope, resource, access_token_expires_at, revoked_at"
      )
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

    const scopes = parseStoredScopes(row.scope)
    if (
      scopes.length === 0 ||
      scopes.some((scope) => !isSupportedMcpScope(scope))
    ) {
      return null
    }

    return {
      productId: row.product_id,
      userId: row.user_id,
      role: scopesImplyWriteAccess(scopes) ? "editor" : "viewer",
      tokenName: client.client_name
        ? `OAuth: ${client.client_name}`
        : "OAuth MCP client",
      scopes,
    }
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

  async readTable(context: SignalSurfContext, input: ReadTableInput) {
    await this.assertDatabaseBelongsToProduct(context, input.databaseId)

    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
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
      .single()
    requireNoDbError(error, "Failed to fetch surf point")
    return data as SurfPointRow
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
