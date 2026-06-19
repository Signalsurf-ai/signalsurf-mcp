export type RunConditionPredicate =
  | "has_value"
  | "is_empty"
  | "equals"
  | "not_equals"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"

export type RunCondition = {
  column: string
  predicate: RunConditionPredicate
  value?: string | number | Array<string | number> | null
}

export const RUN_CONDITION_PREDICATES: readonly RunConditionPredicate[] = [
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
]

const COMPARISON_PREDICATES: ReadonlySet<RunConditionPredicate> = new Set([
  "equals",
  "not_equals",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
])

export function runConditionNeedsValue(
  predicate: RunConditionPredicate
): boolean {
  return COMPARISON_PREDICATES.has(predicate)
}

function cellHasValue(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    !(Array.isArray(value) && value.length === 0)
  )
}

function norm(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function scalarEquals(left: unknown, right: unknown): boolean {
  const leftNumber = asNumber(left)
  const rightNumber = asNumber(right)
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber
  }
  return norm(left) === norm(right)
}

function compareEquals(cell: unknown, value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.some((entry) => scalarEquals(cell, entry))
  if (Array.isArray(cell)) return cell.some((entry) => scalarEquals(entry, value))
  return scalarEquals(cell, value)
}

function compareContains(cell: unknown, value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(cell)) {
    return cell.some((entry) => norm(entry) === norm(value))
  }
  return norm(cell).includes(norm(value))
}

function compareNumeric(
  predicate: "gt" | "gte" | "lt" | "lte",
  cell: unknown,
  value: unknown
): boolean {
  const cellNumber = asNumber(cell)
  const valueNumber = asNumber(value)
  if (cellNumber === null || valueNumber === null) return false
  switch (predicate) {
    case "gt":
      return cellNumber > valueNumber
    case "gte":
      return cellNumber >= valueNumber
    case "lt":
      return cellNumber < valueNumber
    case "lte":
      return cellNumber <= valueNumber
  }
}

function compareIn(cell: unknown, value: unknown): boolean {
  const list =
    value === null || value === undefined
      ? []
      : Array.isArray(value)
      ? value
      : [value]
  if (list.length === 0) return false
  if (Array.isArray(cell)) {
    return cell.some((entry) =>
      list.some((candidate) => scalarEquals(entry, candidate))
    )
  }
  return list.some((candidate) => scalarEquals(cell, candidate))
}

export function evaluateRunCondition(
  condition: RunCondition | null | undefined,
  entryData: Record<string, unknown> | null | undefined
): boolean {
  if (!condition?.column) return true
  const cell = (entryData ?? {})[condition.column]

  if (runConditionNeedsValue(condition.predicate)) {
    const value = condition.value
    const missing =
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0)
    if (missing) return false
  }

  switch (condition.predicate) {
    case "has_value":
      return cellHasValue(cell)
    case "is_empty":
      return !cellHasValue(cell)
    case "equals":
      return compareEquals(cell, condition.value)
    case "not_equals":
      return !compareEquals(cell, condition.value)
    case "contains":
      return compareContains(cell, condition.value)
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return compareNumeric(condition.predicate, cell, condition.value)
    case "in":
      return compareIn(cell, condition.value)
    default:
      return true
  }
}

export function parseRunCondition(raw: unknown): RunCondition | null {
  if (!raw || typeof raw !== "object") return null
  const input = raw as Record<string, unknown>
  const column = typeof input.column === "string" ? input.column.trim() : ""
  if (!column) return null
  const predicate = input.predicate as RunConditionPredicate
  if (!RUN_CONDITION_PREDICATES.includes(predicate)) return null
  return {
    column,
    predicate,
    value: (input.value as RunCondition["value"]) ?? null,
  }
}
