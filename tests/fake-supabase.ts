import { randomUUID } from "node:crypto"

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
    if (name === "create_product_for_mcp") {
      const userId = args.p_user_id as string | undefined
      const productName = String(args.p_name ?? "").trim()
      if (!userId) return { data: null, error: { message: "user id required" } }
      if (!productName)
        return { data: null, error: { message: "product name required" } }

      let organizationId = args.p_organization_id as string | undefined
      if (!organizationId) {
        const member = this.tables.organization_members?.find(
          (row) => row.user_id === userId
        )
        organizationId = member?.organization_id
      }
      if (!organizationId) {
        organizationId = randomUUID()
        this.tables.organizations ??= []
        this.tables.organizations.push({
          id: organizationId,
          owner_id: userId,
          name: "Personal Workspace",
          created_at: "rpc-created",
          updated_at: "rpc-created",
        })
      }

      const membership = this.tables.organization_members?.find(
        (row) => row.organization_id === organizationId && row.user_id === userId
      )
      if (args.p_organization_id && !["owner", "editor"].includes(membership?.role)) {
        return { data: null, error: { message: "organization access denied" } }
      }

      const product = {
        id: randomUUID(),
        organization_id: organizationId,
        owner_id: userId,
        name: productName,
        created_at: "rpc-created",
        updated_at: "rpc-created",
      }
      this.tables.products ??= []
      this.tables.products.push(product)

      this.upsertRow(
        "organization_members",
        {
          organization_id: organizationId,
          user_id: userId,
          role: "owner",
          updated_at: "rpc-created",
        },
        ["organization_id", "user_id"]
      )
      this.upsertRow(
        "product_members",
        {
          product_id: product.id,
          user_id: userId,
          role: "owner",
          display_order: args.p_display_order ?? 0,
          updated_at: "rpc-created",
        },
        ["product_id", "user_id"]
      )
      this.upsertRow(
        "product_goals",
        {
          product_id: product.id,
          user_id: userId,
          updated_at: "rpc-created",
        },
        ["product_id"]
      )

      return { data: product, error: null }
    }
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

  upsertRow(table: string, value: Row, conflictKeys: string[]) {
    if (!this.tables[table]) this.tables[table] = []
    const rows = this.tables[table]
    const existing = rows.find((row) =>
      conflictKeys.every((key) => row[key] === value[key])
    )
    if (existing) {
      Object.assign(existing, clone(value))
      return existing
    }
    const inserted = clone(value)
    rows.push(inserted)
    return inserted
  }
}

class FakeQuery implements PromiseLike<any> {
  private filters: Array<(row: Row) => boolean> = []
  private op:
    | { type: "select"; count?: "exact" }
    | { type: "insert"; values: Row | Row[] }
    | { type: "upsert"; values: Row | Row[]; conflictKeys: string[] }
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

  upsert(values: Row | Row[], options?: { onConflict?: string }) {
    const conflictKeys =
      options?.onConflict
        ?.split(",")
        .map((key) => key.trim())
        .filter(Boolean) ?? ["id"]
    this.op = { type: "upsert", values, conflictKeys }
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

    if (this.op.type === "upsert") {
      const values = Array.isArray(this.op.values) ? this.op.values : [this.op.values]
      const conflictKeys = this.op.conflictKeys
      const upserted = values.map((value) =>
        this.db.upsertRow(this.table, value, conflictKeys)
      )
      return this.finalize(upserted)
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
