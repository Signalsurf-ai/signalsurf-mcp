import { z } from "zod"

export const uuidSchema = z.string().uuid()
export const jsonObjectSchema = z.record(z.string(), z.unknown())
const productTargetSchema = {
  productId: uuidSchema.optional(),
}

// Deepline curated capabilities. Search tools take an Apollo-shaped `filters`
// object passed through to Deepline (apollo_search_people / apollo_company_search
// accepted fields, e.g. person_titles, person_seniorities, person_locations,
// organization_num_employees_ranges, q_keywords / q_organization_keyword_tags,
// organization_locations). Enrich takes name + domain/company (leadmagic).
export const deeplineSearchPeopleSchema = {
  ...productTargetSchema,
  filters: jsonObjectSchema.optional(),
  limit: z.number().int().min(1).max(25).default(10).optional(),
}

export const deeplineSearchCompaniesSchema = {
  ...productTargetSchema,
  filters: jsonObjectSchema.optional(),
  limit: z.number().int().min(1).max(25).default(10).optional(),
}

export const deeplineEnrichContactSchema = {
  ...productTargetSchema,
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  domain: z.string().trim().max(255).optional(),
  companyName: z.string().trim().max(255).optional(),
}

export const deeplineSearchCatalogSchema = {
  ...productTargetSchema,
  query: z.string().trim().max(200).default("").optional(),
  limit: z.number().int().min(1).max(50).default(25).optional(),
}

export const deeplineExecuteToolSchema = {
  ...productTargetSchema,
  toolId: z.string().trim().min(1).max(200),
  payload: jsonObjectSchema.default({}).optional(),
}

export const sourceTypeSchema = z.enum([
  "platform",
  "custom-pull",
  "rss",
  "webhook",
  "web-monitor",
  "github",
  "coingecko",
  "hackernews",
  "producthunt",
  "item-created",
  "item-updated",
  "manual-trigger",
  "on-schedule",
])

export const toolOutputSchema = {
  ok: z.boolean(),
  data: z.unknown().optional(),
}

export const createProductSchema = {
  name: z.string().trim().min(1).max(100),
  organizationId: uuidSchema.optional(),
  displayOrder: z.number().int().min(0).max(100000).default(0).optional(),
}

export const getBrandContextSchema = {
  ...productTargetSchema,
}

export const listSurfPointsSchema = {
  ...productTargetSchema,
  includeInactive: z.boolean().default(true).optional(),
  limit: z.number().int().min(1).max(200).default(100).optional(),
}

export const getSurfPointSchema = {
  ...productTargetSchema,
  surfPointId: uuidSchema,
}

export const createSurfPointSchema = {
  ...productTargetSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  color: z.string().trim().max(20).default("#5599FF").optional(),
  icon: z.string().trim().max(50).default("folder.fill").optional(),
  folderId: uuidSchema.nullish(),
  databaseIds: z.array(uuidSchema).optional(),
  promptTemplate: z.string().max(10000).optional(),
  scoringRubric: z.string().max(10000).optional(),
  surfPrompt: z.string().max(10000).optional(),
  relevanceThreshold: z.number().int().min(1).max(10).nullish(),
  isActive: z.boolean().default(true).optional(),
  showAiDashboard: z.boolean().default(true).optional(),
  variables: jsonObjectSchema.optional(),
  toolConfig: jsonObjectSchema.optional(),
  viewConfigs: jsonObjectSchema.optional(),
  config: jsonObjectSchema.optional(),
}

export const updateSurfPointSchema = {
  ...productTargetSchema,
  surfPointId: uuidSchema,
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  color: z.string().trim().max(20).optional(),
  icon: z.string().trim().max(50).optional(),
  folderId: uuidSchema.nullable().optional(),
  databaseIds: z.array(uuidSchema).optional(),
  promptTemplate: z.string().max(10000).nullable().optional(),
  scoringRubric: z.string().max(10000).nullable().optional(),
  surfPrompt: z.string().max(10000).nullable().optional(),
  relevanceThreshold: z.number().int().min(1).max(10).nullable().optional(),
  isActive: z.boolean().optional(),
  showAiDashboard: z.boolean().optional(),
  variables: jsonObjectSchema.nullable().optional(),
  variablesPatch: jsonObjectSchema.optional(),
  toolConfig: jsonObjectSchema.nullable().optional(),
  toolConfigPatch: jsonObjectSchema.optional(),
  viewConfigs: jsonObjectSchema.nullable().optional(),
  config: jsonObjectSchema.nullable().optional(),
  configPatch: jsonObjectSchema.optional(),
}

export const runSurfPointSchema = {
  ...productTargetSchema,
  surfPointId: uuidSchema,
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  allowInactive: z.boolean().default(false).optional(),
  dedupePending: z.boolean().default(true).optional(),
}

export const getSurfJobSchema = {
  ...productTargetSchema,
  jobId: uuidSchema,
}

export const waitForSurfJobSchema = {
  ...productTargetSchema,
  jobId: uuidSchema,
  timeoutMs: z.number().int().min(0).max(120000).default(30000).optional(),
  pollIntervalMs: z.number().int().min(100).max(10000).default(1000).optional(),
}

export const listSurfJobsSchema = {
  ...productTargetSchema,
  surfPointId: uuidSchema.optional(),
  status: z.string().trim().min(1).max(50).optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
}

export const cancelSurfJobSchema = {
  ...productTargetSchema,
  jobId: uuidSchema,
}

// ─── Quick Surf (per-column enrichment) ──────────────────────────────────────
// A hidden surf point bound to one database column (target_field). enable/disable
// manage the binding; run queues per-row brain enrichment jobs.
const quickSurfColumnTarget = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  fieldKey: z.string().trim().min(1).max(100),
}

const runConditionSchema = z.object({
  column: z.string().trim().min(1).max(100),
  predicate: z.enum([
    "has_value",
    "is_empty",
    "equals",
    "not_equals",
    "contains",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
  ]),
  value: z
    .union([
      z.string(),
      z.number(),
      z.array(z.union([z.string(), z.number()])),
    ])
    .nullish(),
})

export const enableQuickSurfSchema = {
  ...quickSurfColumnTarget,
  whatToDo: z.string().trim().min(1).max(10000),
  auto: z.enum(["off", "on_created"]).optional(),
  runCondition: runConditionSchema.optional(),
}

export const disableQuickSurfSchema = {
  ...quickSurfColumnTarget,
}

export const listQuickSurfSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
}

export const runQuickSurfSchema = {
  ...quickSurfColumnTarget,
  scope: z.enum(["first10", "first100", "all"]).optional(),
  entryId: uuidSchema.optional(),
  entryIds: z.array(uuidSchema).min(1).max(1000).optional(),
}

export const deleteSurfPointSchema = {
  ...productTargetSchema,
  surfPointIds: z.array(uuidSchema).min(1).max(50),
}

export const listDatabasesSchema = {
  ...productTargetSchema,
  includeSystem: z.boolean().default(false).optional(),
  limit: z.number().int().min(1).max(200).default(100).optional(),
}

export const createTableSchema = {
  ...productTargetSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullish(),
  icon: z.string().trim().max(50).nullish(),
  color: z.string().trim().max(20).nullish(),
  schema: jsonObjectSchema.optional(),
  itemType: z.string().trim().max(100).nullish(),
  viewConfigs: jsonObjectSchema.optional(),
  folderId: uuidSchema.nullish(),
  displayOrder: z.number().int().min(0).max(100000).default(0).optional(),
}

export const updateTableSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  icon: z.string().trim().max(50).nullable().optional(),
  color: z.string().trim().max(20).nullable().optional(),
  schema: jsonObjectSchema.nullable().optional(),
  schemaPatch: jsonObjectSchema.optional(),
  itemType: z.string().trim().max(100).nullable().optional(),
  viewConfigs: jsonObjectSchema.nullable().optional(),
  folderId: uuidSchema.nullable().optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
}

export const deleteTableSchema = {
  ...productTargetSchema,
  databaseIds: z.array(uuidSchema).min(1).max(50),
}

const tableFilterSchema = z.object({
  field: z.string().trim().min(1).max(100),
  op: z.enum([
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
  ]),
  value: z.unknown().optional(),
})

const tableSortSchema = z.object({
  field: z.string().trim().min(1).max(100),
  direction: z.enum(["asc", "desc"]).default("asc").optional(),
})

export const readTableSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  limit: z.number().int().min(1).max(200).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
  orderBy: z
    .enum(["created_at", "updated_at"])
    .default("created_at")
    .optional(),
  ascending: z.boolean().default(false).optional(),
  dataContains: jsonObjectSchema.optional(),
  filters: z.array(tableFilterSchema).max(25).optional(),
  filterLogic: z.enum(["and", "or"]).default("and").optional(),
  sorts: z.array(tableSortSchema).max(5).optional(),
  scanLimit: z.number().int().min(1).max(5000).default(1000).optional(),
}

export const listDatabaseViewsSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
}

export const readTableViewSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  viewId: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(200).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
  filters: z.array(tableFilterSchema).max(25).optional(),
  filterLogic: z.enum(["and", "or"]).default("and").optional(),
  sorts: z.array(tableSortSchema).max(5).optional(),
  scanLimit: z.number().int().min(1).max(5000).default(1000).optional(),
}

export const getTableRowSchema = {
  ...productTargetSchema,
  rowId: uuidSchema,
}

export const createTableRowSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  data: jsonObjectSchema,
  playbookId: uuidSchema.nullish(),
  note: z.string().max(500000).nullish(),
}

export const updateTableRowSchema = {
  ...productTargetSchema,
  rowId: uuidSchema,
  databaseId: uuidSchema.optional(),
  data: jsonObjectSchema.optional(),
  dataPatch: jsonObjectSchema.optional(),
  note: z.string().max(500000).nullable().optional(),
  playbookId: uuidSchema.nullable().optional(),
}

export const deleteTableRowsSchema = {
  ...productTargetSchema,
  rowIds: z.array(uuidSchema).min(1).max(100),
}

const databaseFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    type: z.string().trim().min(1).max(100),
    label: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .catchall(z.unknown())

export const listDatabaseFieldsSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
}

export const getEnrichmentContextSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  fieldKey: z.string().min(1).max(100).optional(),
}

export const findCapabilitiesSchema = {
  query: z.string().max(200).optional(),
}

export const addDatabaseFieldSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  field: databaseFieldSchema,
}

export const updateDatabaseFieldSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  fieldKey: z.string().trim().min(1).max(100),
  patch: jsonObjectSchema,
}

export const removeDatabaseFieldSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  fieldKey: z.string().trim().min(1).max(100),
}

export const createRelationFieldSchema = {
  ...productTargetSchema,
  databaseId: uuidSchema,
  key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  label: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  targetDatabaseId: uuidSchema,
  relationType: z.string().trim().max(100).default("item_ref").optional(),
  displayField: z.string().trim().max(100).optional(),
}

export const listSurfPointSourcesSchema = {
  ...productTargetSchema,
  surfPointId: uuidSchema,
}

export const createSurfPointSourceSchema = {
  ...productTargetSchema,
  surfPointId: uuidSchema,
  sourceType: sourceTypeSchema,
  name: z.string().trim().min(1).max(200).optional(),
  config: jsonObjectSchema.optional(),
  dataSchema: jsonObjectSchema.optional(),
  isActive: z.boolean().default(true).optional(),
  replaceExisting: z.boolean().default(false).optional(),
}

export const updateSurfPointSourceSchema = {
  ...productTargetSchema,
  sourceId: uuidSchema,
  sourceType: sourceTypeSchema.optional(),
  name: z.string().trim().min(1).max(200).nullable().optional(),
  isActive: z.boolean().optional(),
  config: jsonObjectSchema.optional(),
  pullConfig: jsonObjectSchema.nullable().optional(),
  pullConfigPatch: jsonObjectSchema.optional(),
  metadata: jsonObjectSchema.nullable().optional(),
  metadataPatch: jsonObjectSchema.optional(),
  dataSchema: jsonObjectSchema.nullable().optional(),
  replaceExisting: z.boolean().default(false).optional(),
}

export const deleteSurfPointSourceSchema = {
  ...productTargetSchema,
  sourceId: uuidSchema.optional(),
  sourceIds: z.array(uuidSchema).min(1).max(50).optional(),
}

export const listProductToolsSchema = {
  ...productTargetSchema,
  includeDisabled: z.boolean().default(false).optional(),
  limit: z.number().int().min(1).max(200).default(100).optional(),
}

export const listSurfPointToolsSchema = {
  ...productTargetSchema,
  surfPointId: uuidSchema,
}

const numericRangeSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .passthrough()

const dateRangeSchema = z
  .object({
    min: z.string().optional(),
    max: z.string().optional(),
  })
  .passthrough()

const companyIcpFiltersSchema = z
  .object({
    keywords: z.array(z.string()).optional(),
    industries: z.array(z.string()).optional(),
    companyTypes: z.array(z.string()).optional(),
    companyAttributes: z.array(z.string()).optional(),
    technologies: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    excludeLocations: z.array(z.string()).optional(),
    excludeDomains: z.array(z.string()).optional(),
    excludeCompanyNames: z.array(z.string()).optional(),
    excludeLinkedinUrls: z.array(z.string()).optional(),
    domains: z.array(z.string()).optional(),
    employeeCount: numericRangeSchema.optional(),
    employeeRanges: z.array(numericRangeSchema).optional(),
    annualRevenueUsd: numericRangeSchema.optional(),
    fundingRaisedUsd: numericRangeSchema.optional(),
    latestFundingUsd: numericRangeSchema.optional(),
    latestFundingDate: dateRangeSchema.optional(),
    fundingStages: z.array(z.string()).optional(),
    foundedYear: numericRangeSchema.optional(),
    hiringTitles: z.array(z.string()).optional(),
    hiringLocations: z.array(z.string()).optional(),
    activeJobCount: numericRangeSchema.optional(),
  })
  .passthrough()

const personIcpFiltersSchema = z
  .object({
    titles: z.array(z.string()).optional(),
    seniorities: z.array(z.string()).optional(),
    functions: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    includeSimilarTitles: z.boolean().optional(),
    emailStatuses: z.array(z.string()).optional(),
    employerLocations: z.array(z.string()).optional(),
    employerEmployeeCount: numericRangeSchema.optional(),
    employerAnnualRevenueUsd: numericRangeSchema.optional(),
    excludeNames: z.array(z.string()).optional(),
    excludeLinkedinUrls: z.array(z.string()).optional(),
  })
  .passthrough()

const liveSignalFiltersSchema = z
  .object({
    queries: z.array(z.string()).optional(),
    bycrawlEndpointIds: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    includeLinkedIn: z.boolean().optional(),
    includeDirectories: z.boolean().optional(),
    includeJobBoards: z.boolean().optional(),
  })
  .passthrough()

const accountListProfileSourceSchema = z.enum([
  "manual",
  "ai_draft",
  "onboarding",
])

const profileExampleListSchema = z.array(z.string().trim().min(1)).max(25)

export const accountListSchema = z
  .object({
    enabled: z.boolean().optional(),
    providers: z
      .array(z.enum(["apollo", "crunchbase", "pdl", "bycrawl"]))
      .optional(),
    previewLimit: z.number().int().min(1).max(1000).optional(),
    company: companyIcpFiltersSchema.optional(),
    people: personIcpFiltersSchema.optional(),
    liveSignals: liveSignalFiltersSchema.optional(),
  })
  .passthrough()

export const listAccountListProfilesSchema = {
  ...productTargetSchema,
  includeArchived: z.boolean().default(false).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
}

export const saveAccountListProfileSchema = {
  ...productTargetSchema,
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional().nullable(),
  source: accountListProfileSourceSchema.default("manual").optional(),
  accountList: accountListSchema,
  aiPrompt: z.string().trim().max(4000).optional().nullable(),
  aiSummary: z.string().trim().max(1200).optional().nullable(),
  sampleAccounts: profileExampleListSchema.optional(),
  rejectAccounts: profileExampleListSchema.optional(),
}

export const archiveAccountListProfileSchema = {
  ...productTargetSchema,
  profileId: uuidSchema,
}
