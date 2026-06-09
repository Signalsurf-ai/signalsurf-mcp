export type ImportMappingField = {
  targetField: string
  sourcePath?: string
  template?: string
  defaultValue?: unknown
  transform?: "trim" | "lowercase" | "number" | "date" | "url"
}

export type ImportMappingRule = {
  name: string
  targetDatabaseId: string
  recordsPath: string
  operation: "upsert"
  uniqueKey: {
    sourcePath?: string
    template?: string
    normalize?: "lowercase" | "email" | "url"
  }
  fields: ImportMappingField[]
}

export type ImportMappingV1 = {
  version: "signalsurf.import_mapping.v1"
  mappings: ImportMappingRule[]
}

export type ImportMappingPreviewRow = {
  mappingName: string
  targetDatabaseId: string
  entryKeyHash: string
  data: Record<string, unknown>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readTransform(
  value: unknown
): ImportMappingField["transform"] | null | undefined {
  if (value === undefined) return undefined
  if (
    value === "trim" ||
    value === "lowercase" ||
    value === "number" ||
    value === "date" ||
    value === "url"
  ) {
    return value
  }
  return null
}

function readNormalize(
  value: unknown
): ImportMappingRule["uniqueKey"]["normalize"] | null | undefined {
  if (value === undefined) return undefined
  if (value === "lowercase" || value === "email" || value === "url") {
    return value
  }
  return null
}

export function readImportMappingValue(value: unknown): ImportMappingV1 | null {
  if (!isRecord(value)) return null
  if (value.version !== "signalsurf.import_mapping.v1") return null
  if (!Array.isArray(value.mappings)) return null

  const mappings: ImportMappingRule[] = []
  for (const rawRule of value.mappings) {
    if (!isRecord(rawRule)) return null
    const name = readString(rawRule.name)
    const targetDatabaseId = readString(rawRule.targetDatabaseId)
    const recordsPath = readString(rawRule.recordsPath)
    const uniqueKey = isRecord(rawRule.uniqueKey) ? rawRule.uniqueKey : null
    const rawFields = Array.isArray(rawRule.fields) ? rawRule.fields : null
    if (
      !name ||
      !targetDatabaseId ||
      !recordsPath ||
      rawRule.operation !== "upsert" ||
      !uniqueKey ||
      !rawFields
    ) {
      return null
    }

    const fields: ImportMappingField[] = []
    for (const rawField of rawFields) {
      if (!isRecord(rawField)) return null
      const targetField = readString(rawField.targetField)
      if (!targetField) return null
      const transform = readTransform(rawField.transform)
      if (transform === null) return null
      fields.push({
        targetField,
        sourcePath: readString(rawField.sourcePath) ?? undefined,
        template: readString(rawField.template) ?? undefined,
        defaultValue: rawField.defaultValue,
        transform,
      })
    }

    const normalize = readNormalize(uniqueKey.normalize)
    if (normalize === null) return null

    mappings.push({
      name,
      targetDatabaseId,
      recordsPath,
      operation: "upsert",
      uniqueKey: {
        sourcePath: readString(uniqueKey.sourcePath) ?? undefined,
        template: readString(uniqueKey.template) ?? undefined,
        normalize,
      },
      fields,
    })
  }

  return { version: "signalsurf.import_mapping.v1", mappings }
}

export function readImportMapping(dataSchema: unknown): ImportMappingV1 | null {
  if (!isRecord(dataSchema)) return null
  return readImportMappingValue(dataSchema.import_mapping)
}

function pathSegments(path: string): string[] | null {
  if (!path.startsWith("$")) return null
  const raw = path.slice(1)
  if (!raw) return []
  if (!raw.startsWith(".")) return null
  return raw
    .slice(1)
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function readPathValue(input: unknown, path: string): unknown {
  const segments = pathSegments(path)
  if (!segments) return undefined
  let current = input
  for (const segment of segments) {
    const arrayMatch = segment.match(/^([A-Za-z0-9_ -]+)\[\*\]$/)
    if (arrayMatch) {
      if (!isRecord(current)) return undefined
      const value = current[arrayMatch[1]]
      return Array.isArray(value) ? value : undefined
    }
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

function readRecords(payload: unknown, recordsPath: string): unknown[] {
  const value = readPathValue(payload, recordsPath)
  if (Array.isArray(value)) return value
  if (isRecord(value)) return [value]
  return []
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

function renderTemplate(template: string, record: unknown): string {
  return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const path = key.trim().startsWith("$") ? key.trim() : `$.${key.trim()}`
    return stringifyValue(readPathValue(record, path))
  })
}

function normalizeUrl(value: unknown): string | null {
  const raw = stringifyValue(value).trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  return raw.includes(".") ? `https://${raw}` : raw
}

function normalizeKey(
  value: unknown,
  normalize?: "lowercase" | "email" | "url"
): string {
  let text = stringifyValue(value).trim()
  if (normalize === "lowercase" || normalize === "email") {
    text = text.toLowerCase()
  }
  if (normalize === "url") {
    text = normalizeUrl(text) ?? text
    text = text.toLowerCase()
  }
  return text
}

function transformValue(
  value: unknown,
  transform?: ImportMappingField["transform"]
): unknown {
  if (value === null || value === undefined) return value
  if (transform === "trim") return stringifyValue(value).trim()
  if (transform === "lowercase")
    return stringifyValue(value).trim().toLowerCase()
  if (transform === "number") {
    const parsed = Number(stringifyValue(value))
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (transform === "date") {
    const raw = stringifyValue(value).trim()
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString()
  }
  if (transform === "url") return normalizeUrl(value)
  return value
}

function fieldValue(field: ImportMappingField, record: unknown): unknown {
  let value: unknown
  if (field.template) {
    value = renderTemplate(field.template, record)
  } else if (field.sourcePath) {
    value = readPathValue(record, field.sourcePath)
  } else {
    value = field.defaultValue
  }
  if (
    (value === null || value === undefined || value === "") &&
    field.defaultValue !== undefined
  ) {
    value = field.defaultValue
  }
  return transformValue(value, field.transform)
}

function compactRecord(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== null && item !== undefined && item !== ""
    )
  )
}

export function buildImportMappingPreview(
  mapping: ImportMappingV1,
  payload: unknown
): { rows: ImportMappingPreviewRow[]; warnings: string[] } {
  const rows: ImportMappingPreviewRow[] = []
  const warnings: string[] = []

  for (const rule of mapping.mappings) {
    const records = readRecords(payload, rule.recordsPath)
    if (records.length === 0) {
      warnings.push(
        `Mapping "${rule.name}" found no records at ${rule.recordsPath}.`
      )
      continue
    }

    for (const record of records) {
      const uniqueSource = rule.uniqueKey.template
        ? renderTemplate(rule.uniqueKey.template, record)
        : rule.uniqueKey.sourcePath
          ? readPathValue(record, rule.uniqueKey.sourcePath)
          : null
      const entryKeyHash = normalizeKey(uniqueSource, rule.uniqueKey.normalize)
      if (!entryKeyHash) {
        warnings.push(`Mapping "${rule.name}" skipped a row without a key.`)
        continue
      }

      const data: Record<string, unknown> = {}
      for (const field of rule.fields) {
        data[field.targetField] = fieldValue(field, record)
      }
      rows.push({
        mappingName: rule.name,
        targetDatabaseId: rule.targetDatabaseId,
        entryKeyHash,
        data: compactRecord(data),
      })
    }
  }

  return { rows, warnings }
}

export function importMappingSummary(mapping: ImportMappingV1 | null) {
  if (!mapping) return null
  return {
    version: mapping.version,
    mappingNames: mapping.mappings.map((rule) => rule.name),
    targetDatabaseIds: [
      ...new Set(mapping.mappings.map((rule) => rule.targetDatabaseId)),
    ],
    mappedFieldCount: mapping.mappings.reduce(
      (sum, rule) => sum + rule.fields.length,
      0
    ),
  }
}
