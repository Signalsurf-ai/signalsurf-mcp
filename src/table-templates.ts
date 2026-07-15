import type { JsonRecord } from "./types.js";

export const PUBLIC_TABLE_TEMPLATES = [
  "outbound_accounts",
  "contacts",
] as const;

export type PublicTableTemplate = (typeof PUBLIC_TABLE_TEMPLATES)[number];

type PublicTableTemplateDefinition = {
  description: string;
  color: string;
  itemType: string;
  schema: JsonRecord;
  viewConfigs: JsonRecord;
};

const OUTBOUND_ACCOUNT_SCHEMA: JsonRecord = {
  template_key: "outbound_accounts",
  schema_version: 3,
  database_kind: "outbound.account_list",
  required_fields: ["company", "status"],
  stable_entry_keys: ["domain"],
  report_fields: [
    "company",
    "website",
    "industry",
    "employee_count",
    "funding_stage",
    "latest_round_date",
    "tech_stack",
    "active_job_count",
    "hiring_signal",
    "fit_score",
    "status",
    "fit_reason",
  ],
  migration_note:
    "Schema v3 is the company/account baseline for outbound: identify accounts, preserve structured technology and hiring data, enrich buying context, score ICP fit, and hand human-qualified rows to people/contact discovery. New templates omit tier; pre-existing legacy tier fields remain additive and are not an eligibility source. Contact readiness, campaign state, replies, and meetings belong to contact or campaign tables.",
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
      key: "source",
      type: "string",
      label: "Source",
      description:
        "Human-readable source that introduced this company, such as YC, a portfolio, imported list, or provider result.",
    },
    {
      key: "source_url",
      type: "url",
      label: "Source URL",
      description:
        "Source page, search result, directory row, portfolio page, or provider record URL that introduced this account.",
    },
    {
      key: "evidence_url",
      type: "url",
      label: "Evidence URL",
      description:
        "Best proof URL supporting a fit, stage, signal, or qualification claim.",
    },
    {
      key: "evidence",
      role: "summary",
      type: "string",
      label: "Evidence",
      description:
        "Short explanation of the proof behind this row and any qualification signals.",
    },
    {
      key: "observed_at",
      role: "timestamp",
      type: "date",
      label: "Observed At",
      description: "When the account or supporting evidence was observed.",
    },
    {
      key: "confidence",
      role: "score",
      type: "number",
      label: "Confidence",
      description:
        "0-1 confidence in the row based on source quality and evidence completeness.",
    },
    {
      key: "segment",
      role: "category",
      type: "string",
      label: "Segment",
      description:
        "ICP segment this account belongs to, copied from the interpreted ICP or row-level evidence.",
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
      key: "employee_count",
      type: "number",
      label: "Employees",
      description: "Latest defensible employee count used for qualification.",
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
      key: "active_job_count",
      type: "number",
      label: "Active Jobs",
      description:
        "Current open-job count returned by the licensed company-data provider.",
    },
    {
      key: "hiring_signal",
      type: "string",
      label: "Hiring Signal",
      description:
        "Hiring, team-building, or role-opening evidence relevant to the ICP.",
    },
    {
      key: "target_buyer",
      type: "string",
      label: "Target Buyer",
      description:
        "Likely buyer persona or department to find after the account is qualified.",
    },
    {
      key: "offer_angle",
      type: "string",
      label: "Offer Angle",
      description:
        "Reason this account should care about the offer being sold.",
    },
    {
      key: "fit_score",
      role: "score",
      type: "number",
      label: "Fit Score",
      description:
        "1-10 ICP fit score. Prefer Quick Surf for reusable scoring across rows.",
    },
    {
      key: "fit_reason",
      type: "string",
      label: "Fit Reason",
      description: "Concise evidence-based explanation for the fit score.",
    },
    {
      key: "risk_reason",
      type: "string",
      label: "Risk Reason",
      description:
        "Known risk, disqualification concern, stale evidence, or missing information.",
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
    {
      key: "reviewed_by",
      type: "string",
      label: "Reviewed By",
      description: "User id of the reviewer who approved or rejected this row.",
    },
    {
      key: "reviewed_at",
      role: "timestamp",
      type: "datetime",
      label: "Reviewed At",
      description: "When the latest approval or rejection was recorded.",
    },
    {
      key: "review_reason",
      type: "string",
      label: "Review Reason",
      description: "Human reason for the latest approval or rejection.",
    },
    {
      key: "owner",
      type: "string",
      label: "Owner",
      description: "Person or team responsible for this account.",
    },
    {
      key: "notes",
      type: "string",
      label: "Notes",
      description: "Free-form human notes for account review.",
    },
    {
      key: "rejection_reason",
      type: "string",
      label: "Rejection Reason",
      description: "Why this account was rejected or disqualified.",
    },
  ],
  primary_field: "company",
  subtitle_field: "fit_reason",
  time_field: "observed_at",
  link_field: "website",
};

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
  table_hidden_columns: [
    "output.domain",
    "output.location",
    "output.company_size",
    "output.linkedin_url",
    "output.source",
    "output.source_url",
    "output.evidence_url",
    "output.evidence",
    "output.observed_at",
    "output.confidence",
    "output.segment",
    "output.hiring_signal",
    "output.target_buyer",
    "output.offer_angle",
    "output.risk_reason",
    "output.owner",
    "output.notes",
    "output.rejection_reason",
    "output.reviewed_by",
    "output.reviewed_at",
    "output.review_reason",
  ],
  sort_key: "fit_score",
  sort_direction: "desc",
  board: { group_field: "status" },
};

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
};

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
};

const TABLE_TEMPLATES: Record<
  PublicTableTemplate,
  PublicTableTemplateDefinition
> = {
  outbound_accounts: {
    description:
      "Company account list for outbound: ICP scoring, human qualification, and account lifecycle.",
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
};

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function mergeFields(templateSchema: JsonRecord, customSchema?: JsonRecord) {
  const templateFields = Array.isArray(templateSchema.fields)
    ? templateSchema.fields
    : [];
  const templateKeys = new Set(
    templateFields
      .map((field) => recordValue(field)?.key)
      .filter((key): key is string => typeof key === "string"),
  );
  const additiveFields = Array.isArray(customSchema?.fields)
    ? customSchema.fields.filter((field) => {
        const key = recordValue(field)?.key;
        return typeof key !== "string" || !templateKeys.has(key);
      })
    : [];
  return [...templateFields, ...additiveFields];
}

function mergeViewConfigs(
  templateViewConfigs: JsonRecord,
  customViewConfigs?: JsonRecord,
): JsonRecord {
  const templateViews = Array.isArray(templateViewConfigs.saved_views)
    ? templateViewConfigs.saved_views
    : [];
  const templateViewIds = new Set(
    templateViews
      .map((view) => recordValue(view)?.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const additiveViews = Array.isArray(customViewConfigs?.saved_views)
    ? customViewConfigs.saved_views.filter((view) => {
        const id = recordValue(view)?.id;
        return typeof id !== "string" || !templateViewIds.has(id);
      })
    : [];

  return {
    ...customViewConfigs,
    ...templateViewConfigs,
    saved_views: [...templateViews, ...additiveViews],
  };
}

export function applyPublicTableTemplate(
  template: PublicTableTemplate,
  customSchema?: JsonRecord,
  customViewConfigs?: JsonRecord,
) {
  const definition = TABLE_TEMPLATES[template];
  const schema = {
    ...customSchema,
    ...definition.schema,
    fields: mergeFields(definition.schema, customSchema),
  };
  const viewConfigs = mergeViewConfigs(
    definition.viewConfigs,
    customViewConfigs,
  );

  if (template === "outbound_accounts") {
    const hasLegacyTier = Array.isArray(schema.fields)
      ? schema.fields.some((field) => recordValue(field)?.key === "tier")
      : false;
    const hiddenColumns = Array.isArray(viewConfigs.table_hidden_columns)
      ? viewConfigs.table_hidden_columns
      : [];
    const savedViews = Array.isArray(viewConfigs.saved_views)
      ? viewConfigs.saved_views.filter(
          (view) => recordValue(view)?.id !== "tiering",
        )
      : [];

    return {
      description: definition.description,
      color: definition.color,
      itemType: definition.itemType,
      schema,
      viewConfigs: {
        ...viewConfigs,
        saved_views: savedViews,
        ...(hasLegacyTier
          ? {
              table_hidden_columns: Array.from(
                new Set([...hiddenColumns, "output.tier"]),
              ),
            }
          : {}),
      },
    };
  }

  return {
    description: definition.description,
    color: definition.color,
    itemType: definition.itemType,
    schema,
    viewConfigs,
  };
}
