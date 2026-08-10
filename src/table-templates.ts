import type { JsonRecord } from "./types.js"

export const PUBLIC_TABLE_TEMPLATES = ["outbound_accounts", "contacts"] as const

export type PublicTableTemplate = (typeof PUBLIC_TABLE_TEMPLATES)[number]

type PublicTableTemplateDefinition = {
  description: string
  color: string
  itemType: string
  schema: JsonRecord
  viewConfigs: JsonRecord
}

const OUTBOUND_ACCOUNT_SCHEMA: JsonRecord = {
  template_key: "outbound_accounts",
  schema_version: 3,
  database_kind: "outbound.account_list",
  required_fields: ["company", "status"],
  stable_entry_keys: ["domain"],
  report_fields: [
    "company",
    "website",
    "linkedin_url",
    "location",
    "industry",
    "company_size",
    "funding_stage",
    "latest_round_date",
    "tech_stack",
    "fit_score",
    "status",
    "fit_reason",
  ],
  migration_note:
    "Schema v3 is the provider-first account baseline: preserve returned identity, firmographic, funding, and explicitly requested technology facts; use fit_score as the only automated account-fit judgment and status as the directly editable eligibility decision. New templates omit tier; legacy Tier remains hidden and non-automatable. Provider provenance remains outside the default table schema.",
  fields: [
    {
      key: "company",
      role: "title",
      type: "string",
      label: "Company",
      description: "Canonical company or account name.",
      is_primary: true,
    },
    {
      key: "domain",
      type: "string",
      label: "Domain",
      description:
        "Stable company domain used for deduplication when available.",
      is_entry_key: true,
      is_unique: true,
      ai_enabled: true,
    },
    {
      key: "website",
      role: "link",
      type: "url",
      label: "Website",
      description: "Official company website.",
    },
    {
      key: "linkedin_url",
      type: "url",
      label: "LinkedIn",
      description: "Canonical LinkedIn company page or profile URL.",
    },
    {
      key: "location",
      type: "string",
      label: "Location",
      description: "Headquarters or primary target geography.",
    },
    {
      key: "industry",
      type: "string",
      label: "Industry",
      description: "Industry or product category.",
    },
    {
      key: "company_size",
      type: "string",
      label: "Company Size",
      description: "Employee, revenue, or customer size band.",
    },
    {
      key: "funding_stage",
      type: "enum",
      label: "Funding Stage",
      options: [
        "unknown",
        "bootstrapped",
        "pre_seed",
        "seed",
        "series_a",
        "series_b",
        "series_c_plus",
        "public",
        "private_equity",
        "acquired",
      ],
      description:
        "Latest known company stage or funding band used for outbound qualification.",
    },
    {
      key: "tech_stack",
      type: "array",
      label: "Tech Stack",
      description:
        "Relevant technologies, platforms, CRMs, sequencers, or ecosystem integrations detected for this account.",
    },
    {
      key: "latest_round_date",
      role: "timestamp",
      type: "date",
      label: "Latest Round",
      description:
        "Announcement or close date of the latest known funding round.",
    },
    {
      key: "fit_score",
      role: "score",
      type: "number",
      label: "Fit Score",
      description:
        "1-10 ICP fit score. Prefer Enrich for reusable scoring across rows.",
    },
    {
      key: "fit_reason",
      type: "string",
      label: "Fit Reason",
      description: "Concise evidence-based explanation for the fit score.",
    },
    {
      key: "status",
      role: "status",
      type: "enum",
      label: "Status",
      options: ["new", "researching", "qualified", "rejected"],
      description:
        "Account qualification state. People discovery, contact readiness, campaign replies, and meetings belong to contact or campaign records after the account is qualified.",
    },
  ],
  primary_field: "company",
  subtitle_field: "fit_reason",
  time_field: "latest_round_date",
  link_field: "website",
}

const OUTBOUND_ACCOUNT_VIEW_CONFIGS: JsonRecord = {
  default_view: "table",
  saved_views: [
    { id: "default", name: "Accounts", viewType: "table", isDefault: true },
    {
      id: "lifecycle",
      name: "Lifecycle",
      viewType: "board",
      groupByKey: "status",
    },
  ],
  table_column_order: [
    "output.company",
    "output.domain",
    "output.website",
    "output.linkedin_url",
    "output.location",
    "output.industry",
    "output.company_size",
    "output.funding_stage",
    "output.latest_round_date",
    "output.tech_stack",
    "output.fit_score",
    "output.fit_reason",
    "output.status",
  ],
  table_column_visibility_mode: "auto_provider_facts",
  table_hidden_columns: [
    "output.domain",
    "output.linkedin_url",
    "output.location",
    "output.industry",
    "output.company_size",
    "output.funding_stage",
    "output.latest_round_date",
    "output.tech_stack",
  ],
  sort_key: "fit_score",
  sort_direction: "desc",
  board: { group_field: "status" },
}

const LEGACY_OUTBOUND_ACCOUNT_FIELD_KEYS = new Set([
  "source",
  "source_url",
  "evidence_url",
  "evidence",
  "observed_at",
  "confidence",
  "segment",
  "employee_count",
  "active_job_count",
  "hiring_signal",
  "target_buyer",
  "offer_angle",
  "tier",
  "risk_reason",
  "reviewed_by",
  "reviewed_at",
  "review_reason",
  "owner",
  "notes",
  "rejection_reason",
  "template_email",
])

const CONTACT_SCHEMA: JsonRecord = {
  template_key: "contacts",
  fields: [
    {
      key: "name",
      role: "title",
      type: "string",
      label: "Name",
      description: "Full display name of the contact.",
    },
    {
      key: "handle",
      type: "string",
      label: "Handle",
      description:
        "Primary social handle or username, without @, used to match signals.",
    },
    {
      key: "profile_url",
      role: "link",
      type: "url",
      label: "Profile URL",
      description: "Canonical social profile URL.",
    },
    {
      key: "linkedin_url",
      type: "url",
      label: "LinkedIn URL",
      contact_platform: "linkedin",
      description:
        "LinkedIn profile URL used for inbox pairing and campaign targets.",
    },
    {
      key: "email",
      type: "email",
      label: "Email",
      description: "Primary email address.",
    },
    {
      key: "phone",
      type: "phone",
      label: "Phone",
      description: "Primary phone number; E.164 preferred.",
    },
    {
      key: "company",
      role: "detail",
      type: "string",
      label: "Company",
      description: "Current employer or company name.",
    },
    {
      key: "title",
      type: "string",
      label: "Title",
      description: "Current job title at the company.",
    },
    {
      key: "channel",
      role: "category",
      type: "enum",
      label: "Channel",
      options: [
        "LINE",
        "Email",
        "Instagram",
        "X",
        "Threads",
        "LinkedIn",
        "WhatsApp",
      ],
      description: "Primary communication channel.",
    },
    {
      key: "tags",
      role: "tag",
      type: "array",
      label: "Tags",
      description: "Free-form contact labels.",
    },
    {
      key: "notes",
      type: "string",
      label: "Notes",
      description: "Free-form notes and history.",
    },
    {
      key: "last_contacted_at",
      type: "date",
      label: "Last Contacted",
      description: "Last time the user or system contacted this person.",
    },
    {
      key: "draft",
      type: "string",
      label: "Draft",
      description: "Reply draft pending for this contact.",
    },
  ],
  primary_field: "name",
  subtitle_field: "company",
  link_field: "profile_url",
}

const CONTACT_VIEW_CONFIGS: JsonRecord = {
  default_view: "table",
  saved_views: [
    {
      id: "default",
      name: "Directory",
      viewType: "table",
      isDefault: true,
    },
    { id: "feed", name: "Gallery", viewType: "feed" },
    { id: "board", name: "By Channel", viewType: "board" },
  ],
  board: { group_field: "channel" },
}

const TABLE_TEMPLATES: Record<
  PublicTableTemplate,
  PublicTableTemplateDefinition
> = {
  outbound_accounts: {
    description:
      "Provider-first company account list for outbound: ICP scoring, directly editable eligibility status, and account lifecycle.",
    color: "#0F766E",
    itemType: "outbound_account",
    schema: OUTBOUND_ACCOUNT_SCHEMA,
    viewConfigs: OUTBOUND_ACCOUNT_VIEW_CONFIGS,
  },
  contacts: {
    description:
      "Conversations with people: email, history, and AI-drafted replies.",
    color: "#F59E0B",
    itemType: "contact",
    schema: CONTACT_SCHEMA,
    viewConfigs: CONTACT_VIEW_CONFIGS,
  },
}

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function mergeFields(templateSchema: JsonRecord, customSchema?: JsonRecord) {
  const templateFields = Array.isArray(templateSchema.fields)
    ? templateSchema.fields
    : []
  const templateKeys = new Set(
    templateFields
      .map((field) => recordValue(field)?.key)
      .filter((key): key is string => typeof key === "string")
  )
  const additiveFields = Array.isArray(customSchema?.fields)
    ? customSchema.fields.filter((field) => {
        const key = recordValue(field)?.key
        return typeof key !== "string" || !templateKeys.has(key)
      })
    : []
  return [...templateFields, ...additiveFields]
}

function normalizeLegacyOutboundAccountFields(fields: unknown[]) {
  return fields.map((field) => {
    const record = recordValue(field)
    if (record?.key !== "tier") return field
    return {
      ...record,
      enrich: false,
      ai_enabled: false,
      sources: [],
    }
  })
}

function isCanonicalLegacyTieringView(view: unknown): boolean {
  const record = recordValue(view)
  return (
    record?.id === "tiering" &&
    record.name === "Tiering" &&
    record.viewType === "chart" &&
    record.groupByKey == null
  )
}

function mergeViewConfigs(
  templateViewConfigs: JsonRecord,
  customViewConfigs?: JsonRecord
): JsonRecord {
  const templateViews = Array.isArray(templateViewConfigs.saved_views)
    ? templateViewConfigs.saved_views
    : []
  const templateViewIds = new Set(
    templateViews
      .map((view) => recordValue(view)?.id)
      .filter((id): id is string => typeof id === "string")
  )
  const additiveViews = Array.isArray(customViewConfigs?.saved_views)
    ? customViewConfigs.saved_views.filter((view) => {
        const id = recordValue(view)?.id
        return typeof id !== "string" || !templateViewIds.has(id)
      })
    : []

  return {
    ...customViewConfigs,
    ...templateViewConfigs,
    saved_views: [...templateViews, ...additiveViews],
  }
}

export function applyPublicTableTemplate(
  template: PublicTableTemplate,
  customSchema?: JsonRecord,
  customViewConfigs?: JsonRecord
) {
  const definition = TABLE_TEMPLATES[template]
  const schema = {
    ...customSchema,
    ...definition.schema,
    fields:
      template === "outbound_accounts"
        ? normalizeLegacyOutboundAccountFields(
            mergeFields(definition.schema, customSchema)
          )
        : mergeFields(definition.schema, customSchema),
  }
  const viewConfigs = mergeViewConfigs(
    definition.viewConfigs,
    customViewConfigs
  )

  if (template === "outbound_accounts") {
    const legacyFieldKeys = Array.isArray(schema.fields)
      ? schema.fields.flatMap((field) => {
          const key = recordValue(field)?.key
          return typeof key === "string" &&
            LEGACY_OUTBOUND_ACCOUNT_FIELD_KEYS.has(key)
            ? [key]
            : []
        })
      : []
    const hiddenColumns = Array.isArray(viewConfigs.table_hidden_columns)
      ? viewConfigs.table_hidden_columns
      : []
    const savedViews = Array.isArray(viewConfigs.saved_views)
      ? viewConfigs.saved_views.filter(
          (view) => !isCanonicalLegacyTieringView(view)
        )
      : []

    return {
      description: definition.description,
      color: definition.color,
      itemType: definition.itemType,
      schema,
      viewConfigs: {
        ...viewConfigs,
        saved_views: savedViews,
        table_hidden_columns: Array.from(
          new Set([
            ...hiddenColumns,
            ...legacyFieldKeys.map((key) => `output.${key}`),
          ])
        ),
      },
    }
  }

  return {
    description: definition.description,
    color: definition.color,
    itemType: definition.itemType,
    schema,
    viewConfigs,
  }
}
