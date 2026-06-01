type Row = Record<string, any>

type TableStore = Record<string, Row[]>
type FakeDbError = { message: string; code?: string }
type FakeSupabaseOptions = {
  rpcErrors?: Record<string, FakeDbError>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function matches(row: Row, filters: Array<(row: Row) => boolean>): boolean {
  return filters.every((filter) => filter(row))
}

function containsJson(target: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      return false
    }
    return Object.entries(expected).every(([key, value]) =>
      containsJson((target as Row)[key], value)
    )
  }
  return target === expected
}

export class FakeSupabase {
  readonly tables: TableStore
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

  constructor(
    seed: TableStore,
    private readonly options: FakeSupabaseOptions = {}
  ) {
    this.tables = clone(seed)
  }

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = []
    return new FakeQuery(this, table)
  }

  async rpc(name: string, args: Record<string, unknown> = {}) {
    this.rpcCalls.push({ name, args })
    const configuredError = this.options.rpcErrors?.[name]
    if (configuredError) return { data: null, error: configuredError }
    if (name === "update_entry_with_source") {
      const row = this.tables.entries.find((entry) => entry.id === args.p_entry_id)
      if (!row) return { data: null, error: { message: "Entry not found" } }
      row.data = clone(args.p_data)
      row.updated_at = "rpc-updated"
      return { data: null, error: null }
    }
    if (name === "update_entry_note_with_source") {
      const row = this.tables.entries.find((entry) => entry.id === args.p_entry_id)
      if (!row) return { data: null, error: { message: "Entry not found" } }
      row.note = args.p_note
      row.updated_at = "rpc-updated"
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }
}

class FakeQuery implements PromiseLike<any> {
  private filters: Array<(row: Row) => boolean> = []
  private op:
    | { type: "select"; count?: "exact" }
    | { type: "insert"; values: Row | Row[] }
    | { type: "update"; values: Row }
    | { type: "delete"; count?: "exact" } = { type: "select" }
  private singleMode: "single" | "maybeSingle" | null = null
  private limitValue: number | null = null
  private rangeValue: { from: number; to: number } | null = null
  private orderSpecs: Array<{ key: string; ascending: boolean }> = []

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string
  ) {}

  select(_columns?: string, options?: { count?: "exact" }) {
    if (this.op.type === "select") {
      this.op = { type: "select", count: options?.count }
    }
    return this
  }

  insert(values: Row | Row[]) {
    this.op = { type: "insert", values }
    return this
  }

  update(values: Row) {
    this.op = { type: "update", values }
    return this
  }

  delete(options?: { count?: "exact" }) {
    this.op = { type: "delete", count: options?.count }
    return this
  }

  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value)
    return this
  }

  neq(key: string, value: unknown) {
    this.filters.push((row) => row[key] !== value)
    return this
  }

  is(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value)
    return this
  }

  in(key: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[key]))
    return this
  }

  contains(key: string, value: Row) {
    this.filters.push((row) => {
      const target = row[key] ?? {}
      return containsJson(target, value)
    })
    return this
  }

  order(key: string, options: { ascending?: boolean } = {}) {
    this.orderSpecs.push({ key, ascending: options.ascending ?? true })
    return this
  }

  limit(value: number) {
    this.limitValue = value
    return this
  }

  range(from: number, to: number) {
    this.rangeValue = { from, to }
    return this
  }

  single() {
    this.singleMode = "single"
    return this
  }

  maybeSingle() {
    this.singleMode = "maybeSingle"
    return this
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    const rows = this.db.tables[this.table]
    if (this.op.type === "insert") {
      const values = Array.isArray(this.op.values) ? this.op.values : [this.op.values]
      const inserted = values.map((value) => clone(value))
      rows.push(...inserted)
      return this.finalize(inserted)
    }

    const matching = rows.filter((row) => matches(row, this.filters))
    if (this.op.type === "update") {
      for (const row of matching) Object.assign(row, clone(this.op.values))
      return this.finalize(matching)
    }

    if (this.op.type === "delete") {
      const matchingIds = new Set(matching.map((row) => row.id))
      this.db.tables[this.table] = rows.filter((row) => !matchingIds.has(row.id))
      return {
        data: null,
        error: null,
        count: this.op.count === "exact" ? matchingIds.size : null,
      }
    }

    return this.finalize(matching, matching.length)
  }

  private finalize(inputRows: Row[], totalBeforePagination = inputRows.length) {
    let rows = clone(inputRows)
    for (const spec of [...this.orderSpecs].reverse()) {
      rows.sort((left, right) => {
        const cmp = String(left[spec.key] ?? "").localeCompare(
          String(right[spec.key] ?? "")
        )
        return spec.ascending ? cmp : -cmp
      })
    }
    if (this.rangeValue) {
      rows = rows.slice(this.rangeValue.from, this.rangeValue.to + 1)
    } else if (this.limitValue != null) {
      rows = rows.slice(0, this.limitValue)
    }

    if (this.singleMode) {
      const row = rows[0] ?? null
      if (!row && this.singleMode === "single") {
        return { data: null, error: { message: "No rows" } }
      }
      return { data: row, error: null }
    }
    return {
      data: rows,
      error: null,
      count:
        this.op.type === "select" && this.op.count === "exact"
          ? totalBeforePagination
          : rows.length,
    }
  }
}
