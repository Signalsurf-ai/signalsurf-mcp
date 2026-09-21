type Row = Record<string, any>

type TableStore = Record<string, Row[]>
type FakeDbError = { message: string; code?: string }
type FakeSupabaseOptions = {
  rpcErrors?: Record<string, FakeDbError>
  tableErrors?: Record<string, FakeDbError>
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

  tableError(table: string): FakeDbError | undefined {
    return this.options.tableErrors?.[table]
  }

  async rpc(name: string, args: Record<string, unknown> = {}) {
    this.rpcCalls.push({ name, args })
    const configuredError = this.options.rpcErrors?.[name]
    if (configuredError) return { data: null, error: configuredError }
    // SIG-2385 replaced `product_goals` with workspace memory behind this RPC.
    if (name === "get_workspace_brand_profile") {
      const profile = this.tables.workspace_brand_profiles?.find(
        (row) => row.workspace_id === args.p_workspace_id
      )
      if (!profile) return { data: null, error: null }
      const { workspace_id: _workspaceId, ...fields } = profile
      return { data: fields, error: null }
    }
    if (name === "update_entry_with_source") {
      const row = this.tables.entries.find(
        (entry) => entry.id === args.p_entry_id
      )
      if (!row) return { data: null, error: { message: "Entry not found" } }
      row.data = clone(args.p_data)
      row.updated_at = "rpc-updated"
      return { data: null, error: null }
    }
    if (name === "update_entry_note_with_source") {
      const row = this.tables.entries.find(
        (entry) => entry.id === args.p_entry_id
      )
      if (!row) return { data: null, error: { message: "Entry not found" } }
      row.note = args.p_note
      row.updated_at = "rpc-updated"
      return { data: null, error: null }
    }
    if (name === "update_entries_with_source_batch") {
      const entries =
        (args.p_entries as Array<{ entry_id: string; data: unknown }>) ?? []
      for (const entry of entries) {
        const row = this.tables.entries.find((e) => e.id === entry.entry_id)
        if (!row) continue
        row.data = clone(entry.data)
        row.updated_at = "rpc-updated"
      }
      return { data: null, error: null }
    }
    if (name === "enqueue_enrich_jobs") {
      const queued: Row[] = []
      const skippedPending: Row[] = []
      this.tables.raw_signals ??= []
      this.tables.surf_jobs ??= []
      for (const entry of (args.p_entries as Row[]) ?? []) {
        const activeJob = this.tables.surf_jobs.find((job) => {
          if (
            job.source_id !== args.p_source_id ||
            job.workspace_id !== args.p_workspace_id ||
            !["pending", "processing"].includes(job.status)
          ) {
            return false
          }
          const signal = this.tables.raw_signals.find(
            (row) => row.id === job.payload?.raw_signal_id
          )
          return (
            signal?.data?.entry_id === entry.entry_id &&
            signal?.data?.target_field === args.p_target_field
          )
        })
        if (activeJob) {
          skippedPending.push({
            entry_id: entry.entry_id,
            raw_signal_id: activeJob.payload.raw_signal_id,
            job_id: activeJob.id,
          })
          continue
        }
        const rawSignal = {
          id: entry.raw_signal_id,
          source_id: args.p_source_id,
          status: "pending",
          data: {
            event_type: "manual_trigger",
            triggered_by: args.p_triggered_by,
            source_id: args.p_source_id,
            target_field: args.p_target_field,
            preserve_existing: args.p_preserve_existing,
            entry_id: entry.entry_id,
            entry_data: entry.entry_data ?? null,
            database_id: entry.database_id,
          },
        }
        const job = {
          id: entry.job_id,
          job_type: "analyze",
          status: "pending",
          priority: 50,
          attempt_count: 0,
          max_attempts: 3,
          workspace_id: args.p_workspace_id,
          user_id: args.p_user_id,
          source_id: args.p_source_id,
          workflow_id: args.p_workflow_id,
          payload: {
            raw_signal_id: entry.raw_signal_id,
            workflow_id: args.p_workflow_id,
            target_field: args.p_target_field,
            triggered_by: args.p_triggered_by,
          },
        }
        this.tables.raw_signals.push(rawSignal)
        this.tables.surf_jobs.push(job)
        queued.push({
          entry_id: entry.entry_id,
          raw_signal_id: entry.raw_signal_id,
          job,
        })
      }
      return {
        data: { queued, skipped_pending: skippedPending },
        error: null,
      }
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
    const conflictKeys = options?.onConflict
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

  gt(key: string, value: unknown) {
    this.filters.push((row) => row[key] > value)
    return this
  }

  lte(key: string, value: unknown) {
    this.filters.push((row) => row[key] <= value)
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

  overlaps(key: string, values: unknown[]) {
    this.filters.push(
      (row) =>
        Array.isArray(row[key]) &&
        row[key].some((value: unknown) => values.includes(value))
    )
    return this
  }

  or(_filter: string) {
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
    const configuredError = this.db.tableError(this.table)
    if (configuredError) return { data: null, error: configuredError }
    const rows = this.db.tables[this.table]
    if (this.op.type === "insert") {
      const values = Array.isArray(this.op.values)
        ? this.op.values
        : [this.op.values]
      const inserted = values.map((value) => clone(value))
      rows.push(...inserted)
      return this.finalize(inserted)
    }

    if (this.op.type === "upsert") {
      const values = Array.isArray(this.op.values)
        ? this.op.values
        : [this.op.values]
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
      this.db.tables[this.table] = rows.filter(
        (row) => !matchingIds.has(row.id)
      )
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
