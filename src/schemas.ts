import { z } from "zod"

export const uuidSchema = z.string().uuid()
export const jsonObjectSchema = z.record(z.string(), z.unknown())
const productTargetSchema = {
  productId: uuidSchema.optional(),
}

export const listSurfPointsSchema = {
  ...productTargetSchema,
  includeInactive: z.boolean().default(true).optional(),
  limit: z.number().int().min(1).max(200).default(100).optional(),
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

export const deleteSurfPointSchema = {
  ...productTargetSchema,
  surfPointIds: z.array(uuidSchema).min(1).max(50),
}

export const listDatabasesSchema = {
  ...productTargetSchema,
  includeSystem: z.boolean().default(false).optional(),
  limit: z.number().int().min(1).max(200).default(100).optional(),
}

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
