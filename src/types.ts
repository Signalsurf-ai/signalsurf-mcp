export type AccessRole = "viewer" | "editor" | "owner"

export type SignalSurfProductContext = {
  productId: string
  name: string
  organizationId?: string | null
  organizationName?: string | null
}

export type SignalSurfContext = {
  productId: string
  productIds?: string[]
  products?: SignalSurfProductContext[]
  userId?: string
  role: AccessRole
  tokenName?: string
  scopes?: string[]
  authKind?: "env" | "manual" | "oauth"
  oauthTokenId?: string
}

export type JsonRecord = Record<string, unknown>

export type SurfPointRow = {
  id: string
  product_id: string
  name: string
  description: string | null
  is_default: boolean
  is_active: boolean
  show_ai_dashboard: boolean
  icon: string | null
  color: string | null
  database_ids: string[] | null
  relevance_threshold: number | null
  prompt_template: string | null
  scoring_rubric: string | null
  surf_prompt: string | null
  tool_config: JsonRecord | null
  variables: JsonRecord | null
  config: JsonRecord | null
  folder_id: string | null
  display_order: number | null
  created_at: string
  updated_at: string | null
  deleted_at?: string | null
}

export type DatabaseRow = {
  id: string
  product_id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  schema: unknown
  item_type: string | null
  system_type: string | null
  view_configs: JsonRecord | null
  folder_id?: string | null
  display_order: number
  created_at: string
  updated_at: string
}

export type EntryRow = {
  id: string
  playbook_id: string | null
  database_id: string | null
  data: JsonRecord
  data_cached?: JsonRecord
  note: string | null
  origin: string
  origin_ref: string | null
  entry_key_hash: string | null
  raw_signal_id: string | null
  triggered: boolean
  created_at: string
  updated_at: string
}

export type SupabaseLike = {
  from: (table: string) => any
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown
    error: { message: string; code?: string } | null
  }>
}
