import { z } from "zod"

export const uuidSchema = z.string().uuid()
export const jsonObjectSchema = z.record(z.string(), z.unknown())
const productTargetSchema = {
  productId: uuidSchema.optional(),
}

export const toolOutputSchema = {
  ok: z.boolean(),
  data: z.unknown().optional(),
}

export const createProductSchema = {
  name: z.string().trim().min(1).max(100),
  organizationId: uuidSchema.optional(),
  displayOrder: z.number().int().min(0).max(100000).default(0).optional(),
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

export const setSurfPointSourceActiveSchema = {
  ...productTargetSchema,
  sourceId: uuidSchema,
  isActive: z.boolean(),
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

export const attachSurfPointToolSchema = {
  ...productTargetSchema,
  surfPointId: uuidSchema,
  toolId: uuidSchema,
}

export const detachSurfPointToolSchema = {
  ...productTargetSchema,
  surfPointId: uuidSchema,
  toolId: uuidSchema,
}

const numericRangeSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
})

const dateRangeSchema = z.object({
  min: z.string().optional(),
  max: z.string().optional(),
})

const companyIcpFiltersSchema = z.object({
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

const personIcpFiltersSchema = z.object({
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

const liveSignalFiltersSchema = z.object({
  queries: z.array(z.string()).optional(),
  bycrawlEndpointIds: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  includeLinkedIn: z.boolean().optional(),
  includeDirectories: z.boolean().optional(),
  includeJobBoards: z.boolean().optional(),
})

const accountListProfileSourceSchema = z.enum([
  "manual",
  "ai_draft",
  "onboarding",
])

const profileExampleListSchema = z.array(z.string().trim().min(1)).max(25)

export const accountListSchema = z.object({
  enabled: z.boolean().optional(),
  providers: z
    .array(z.enum(["apollo", "crunchbase", "pdl", "bycrawl"]))
    .optional(),
  previewLimit: z.number().int().min(1).max(1000).optional(),
  company: companyIcpFiltersSchema.optional(),
  people: personIcpFiltersSchema.optional(),
  liveSignals: liveSignalFiltersSchema.optional(),
})

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
