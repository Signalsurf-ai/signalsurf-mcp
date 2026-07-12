type JsonRecord = Record<string, unknown>

type Condition = {
  field: string
  type: string
  value: string | number | boolean | string[]
}

type ConditionGroup = {
  op: "and" | "or"
  conditions: Array<Condition | ConditionGroup>
}

const COMPANY_FIELDS = [
  "crustdata_company_id",
  "basic_info.name",
  "basic_info.primary_domain",
  "basic_info.website",
  "basic_info.professional_network_url",
  "basic_info.company_type",
  "basic_info.year_founded",
  "basic_info.employee_count_range",
  "basic_info.markets",
  "funding.total_investment_usd",
  "funding.last_round_amount_usd",
  "funding.last_fundraise_date",
  "funding.last_round_type",
  "funding.investors",
  "headcount.total",
  "hiring.openings_count",
  "taxonomy.professional_network_industry",
  "taxonomy.categories",
] as const

const PERSON_FIELDS = [
  "crustdata_person_id",
  "basic_profile.name",
  "basic_profile.current_title",
  "basic_profile.location",
  "social_handles.professional_network_identifier.profile_url",
  "experience.employment_details.current",
  "contact.has_business_email",
] as const

const COUNTRY_ISO3: Record<string, string> = {
  australia: "AUS",
  au: "AUS",
  canada: "CAN",
  ca: "CAN",
  france: "FRA",
  germany: "DEU",
  india: "IND",
  ireland: "IRL",
  israel: "ISR",
  japan: "JPN",
  singapore: "SGP",
  taiwan: "TWN",
  tw: "TWN",
  "united kingdom": "GBR",
  uk: "GBR",
  gb: "GBR",
  "united states": "USA",
  "united states of america": "USA",
  us: "USA",
}

const SENIORITY_VALUES: Record<string, string> = {
  owner: "Owner / Partner",
  founder: "Owner / Partner",
  cxo: "CXO",
  "c-suite": "CXO",
  "c suite": "CXO",
  c_suite: "CXO",
  vp: "Vice President",
  "vice president": "Vice President",
  head: "Director",
  director: "Director",
  manager: "Experienced Manager",
  senior: "Senior",
  entry: "Entry Level",
  ic: "Entry Level",
}

const APOLLO_SENIORITY_VALUES: Record<string, string> = {
  owner: "owner",
  founder: "founder",
  cxo: "c_suite",
  "c-suite": "c_suite",
  "c suite": "c_suite",
  c_suite: "c_suite",
  vp: "vp",
  "vice president": "vp",
  head: "head",
  director: "director",
  manager: "manager",
  senior: "senior",
  entry: "entry",
  ic: "entry",
}

const FUNCTION_VALUES: Record<string, string> = {
  sales: "Sales",
  marketing: "Marketing",
  growth: "Marketing",
  revops: "Operations",
  "revenue operations": "Operations",
  operations: "Operations",
  product: "Product Management",
  engineering: "Engineering",
  "customer success": "Customer Success and Support",
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function strings(value: unknown): string[] {
  const values = typeof value === "string" ? [value] : value
  if (!Array.isArray(values)) return []
  return Array.from(
    new Set(
      values
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function mapped(values: string[], mapping: Record<string, string>): string[] {
  return Array.from(
    new Set(values.map((value) => mapping[value.toLowerCase()]).filter(Boolean))
  )
}

function condition(
  field: string,
  type: string,
  value: Condition["value"]
): Condition {
  return { field, type, value }
}

function group(
  op: ConditionGroup["op"],
  values: Array<Condition | ConditionGroup | null>
): ConditionGroup | undefined {
  const conditions = values.filter(
    (value): value is Condition | ConditionGroup => value !== null
  )
  return conditions.length ? { op, conditions } : undefined
}

function clean(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item == null) return false
      if (typeof item === "string") return Boolean(item.trim())
      if (Array.isArray(item)) return item.length > 0
      return true
    })
  )
}

function normalizeCountry(value: string): string {
  const trimmed = value.trim()
  if (/^[a-z]{3}$/i.test(trimmed)) return trimmed.toUpperCase()
  return COUNTRY_ISO3[trimmed.toLowerCase().replaceAll("-", " ")] ?? trimmed
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
}

function numericRanges(
  canonical: unknown,
  legacyRanges: unknown
): Array<{ min?: number; max?: number }> {
  if (Array.isArray(canonical)) {
    return canonical
      .map(record)
      .map((range) => ({
        min: typeof range.min === "number" ? range.min : undefined,
        max: typeof range.max === "number" ? range.max : undefined,
      }))
      .filter((value) => value.min !== undefined || value.max !== undefined)
  }
  const range = record(canonical)
  const min = typeof range.min === "number" ? range.min : undefined
  const max = typeof range.max === "number" ? range.max : undefined
  if (min !== undefined || max !== undefined) return [{ min, max }]

  return strings(legacyRanges)
    .map((value) => {
      const [rawMin, rawMax] = value.split(",")
      const parsedMin = Number(rawMin)
      const parsedMax = Number(rawMax)
      return {
        min: Number.isFinite(parsedMin) ? parsedMin : undefined,
        max: Number.isFinite(parsedMax) ? parsedMax : undefined,
      }
    })
    .filter((value) => value.min !== undefined || value.max !== undefined)
}

function rangeConditions(
  field: string,
  range: { min?: number; max?: number } | undefined
): Array<Condition | null> {
  if (!range) return []
  return [
    range.min === undefined ? null : condition(field, "=>", range.min),
    range.max === undefined ? null : condition(field, "=<", range.max),
  ]
}

function rangeFilter(
  field: string,
  ranges: Array<{ min?: number; max?: number }>
): Condition | ConditionGroup | null {
  const groups = ranges
    .map((range) => group("and", rangeConditions(field, range)))
    .filter((value): value is ConditionGroup => Boolean(value))
  if (groups.length === 0) return null
  return groups.length === 1 ? groups[0] : group("or", groups) ?? null
}

const COMPANY_FILTER_KEYS = new Set([
  "company",
  "keywords",
  "industries",
  "locations",
  "excludeLocations",
  "domains",
  "employeeCount",
  "employeeRanges",
  "fundingStages",
  "q_organization_keyword_tags",
  "q_organization_name",
  "q_organization_domains_list",
  "organization_locations",
  "organization_not_locations",
  "organization_num_employees_ranges",
  "funding_stages",
])
const CRUSTDATA_COMPANY_FILTER_KEYS = new Set([
  ...COMPANY_FILTER_KEYS,
  "technologies",
  "activeJobCount",
])
const PEOPLE_FILTER_KEYS = new Set([
  "company",
  "people",
  "titles",
  "seniorities",
  "functions",
  "locations",
  "employerLocations",
  "employerEmployeeCount",
  "emailStatuses",
  "includeSimilarTitles",
  "person_titles",
  "person_seniorities",
  "person_locations",
  "organization_locations",
  "organization_num_employees_ranges",
  "q_organization_domains_list",
  "contact_email_status",
  "include_similar_titles",
  "q_keywords",
])

function assertSupportedKeys(
  filters: JsonRecord,
  allowed: Set<string>,
  nestedKey: "company" | "people"
) {
  const unsupported = Object.keys(filters).filter((key) => !allowed.has(key))
  const nested = record(filters[nestedKey])
  const nestedUnsupported = Object.keys(nested).filter(
    (key) => !allowed.has(key)
  )
  if (unsupported.length || nestedUnsupported.length) {
    throw new Error(
      `Unsupported Deepline ${nestedKey} filters: ${[
        ...unsupported,
        ...nestedUnsupported.map((key) => `${nestedKey}.${key}`),
      ].join(", ")}`
    )
  }
}

function apolloEmployeeRanges(canonical: unknown, legacy: unknown): string[] {
  const explicit = strings(legacy)
  if (explicit.length) return explicit
  return numericRanges(canonical, undefined).map(
    (range) => `${range.min ?? 1},${range.max ?? 1_000_000}`
  )
}

function apolloPayload(
  filters: JsonRecord,
  kind: "people" | "companies",
  limit: number
): JsonRecord {
  if (kind === "companies") {
    assertSupportedKeys(filters, COMPANY_FILTER_KEYS, "company")
    const company = { ...filters, ...record(filters.company) }
    return clean({
      q_organization_keyword_tags:
        company.q_organization_keyword_tags ?? company.keywords,
      q_organization_name: company.q_organization_name,
      q_organization_domains_list:
        company.q_organization_domains_list ?? company.domains,
      organization_locations:
        company.organization_locations ?? company.locations,
      organization_not_locations:
        company.organization_not_locations ?? company.excludeLocations,
      organization_num_employees_ranges: apolloEmployeeRanges(
        company.employeeRanges ?? company.employeeCount,
        company.organization_num_employees_ranges
      ),
      funding_stages: company.funding_stages ?? company.fundingStages,
      per_page: limit,
    })
  }

  assertSupportedKeys(filters, PEOPLE_FILTER_KEYS, "people")
  assertSupportedKeys(record(filters.company), COMPANY_FILTER_KEYS, "company")
  const people = { ...filters, ...record(filters.people) }
  const company = record(filters.company)
  return clean({
    person_titles: people.person_titles ?? people.titles,
    include_similar_titles:
      people.include_similar_titles ?? people.includeSimilarTitles,
    person_seniorities:
      people.person_seniorities ??
      mapped(strings(people.seniorities), APOLLO_SENIORITY_VALUES),
    person_locations: people.person_locations ?? people.locations,
    organization_locations:
      people.organization_locations ??
      people.employerLocations ??
      company.locations,
    organization_num_employees_ranges: apolloEmployeeRanges(
      people.employerEmployeeCount ??
        company.employeeRanges ??
        company.employeeCount,
      people.organization_num_employees_ranges
    ),
    q_organization_domains_list:
      people.q_organization_domains_list ?? company.domains,
    contact_email_status: people.contact_email_status ?? people.emailStatuses,
    q_keywords:
      people.q_keywords ?? (strings(company.keywords).join(" ") || undefined),
    per_page: limit,
  })
}

function crustdataCompanyPayload(filters: JsonRecord, limit: number) {
  assertSupportedKeys(filters, CRUSTDATA_COMPANY_FILTER_KEYS, "company")
  const company = { ...filters, ...record(filters.company) }
  const keywords = strings(
    company.keywords ?? company.q_organization_keyword_tags
  )
  const industries = strings(company.industries)
  const companyNames = strings(company.q_organization_name)
  const locations = strings(
    company.locations ?? company.organization_locations
  ).map(normalizeCountry)
  const excludeLocations = strings(
    company.excludeLocations ?? company.organization_not_locations
  ).map(normalizeCountry)
  const domains = strings(
    company.domains ?? company.q_organization_domains_list
  ).map(normalizeDomain)
  const employeeCount = numericRanges(
    company.employeeRanges ?? company.employeeCount,
    company.organization_num_employees_ranges
  )
  const fundingStages = strings(
    company.fundingStages ?? company.funding_stages
  ).map((value) => value.toLowerCase().replace(/[\s-]+/g, "_"))
  const technologies = strings(company.technologies)
  const activeJobCount = numericRanges(company.activeJobCount, undefined)

  const filtersGroup = group("and", [
    keywords.length
      ? group(
          "or",
          keywords.flatMap((keyword) => [
            condition("taxonomy.professional_network_industry", "(.)", keyword),
            condition("taxonomy.categories", "(.)", keyword),
          ])
        ) ?? null
      : null,
    industries.length
      ? condition("taxonomy.professional_network_industry", "in", industries)
      : null,
    companyNames.length
      ? group(
          "or",
          companyNames.map((name) => condition("basic_info.name", "(.)", name))
        ) ?? null
      : null,
    locations.length ? condition("locations.country", "in", locations) : null,
    excludeLocations.length
      ? condition("locations.country", "not_in", excludeLocations)
      : null,
    domains.length
      ? condition("basic_info.primary_domain", "in", domains)
      : null,
    technologies.length
      ? condition("technographics.technologies.name", "in", technologies)
      : null,
    rangeFilter("headcount.total", employeeCount),
    rangeFilter("hiring.openings_count", activeJobCount),
    fundingStages.length
      ? condition("funding.last_round_type", "in", fundingStages)
      : null,
  ])

  return clean({
    filters: filtersGroup,
    fields: [...COMPANY_FIELDS],
    sorts: [{ column: "headcount.total", order: "desc" }],
    limit,
  })
}

function crustdataPeoplePayload(filters: JsonRecord, limit: number) {
  assertSupportedKeys(filters, PEOPLE_FILTER_KEYS, "people")
  assertSupportedKeys(record(filters.company), COMPANY_FILTER_KEYS, "company")
  const people = { ...filters, ...record(filters.people) }
  const company = record(filters.company)
  const titles = strings(people.titles ?? people.person_titles)
  const seniorities = mapped(
    strings(people.seniorities ?? people.person_seniorities),
    SENIORITY_VALUES
  )
  const functions = mapped(strings(people.functions), FUNCTION_VALUES)
  const locations = strings(people.locations ?? people.person_locations)
  const employerLocations = strings(
    people.employerLocations ??
      people.organization_locations ??
      company.locations
  ).map(normalizeCountry)
  const domains = strings(
    company.domains ?? people.q_organization_domains_list
  ).map(normalizeDomain)
  const employeeCount = numericRanges(
    people.employerEmployeeCount ??
      company.employeeRanges ??
      company.employeeCount,
    people.organization_num_employees_ranges
  )
  const emailStatuses = strings(
    people.emailStatuses ?? people.contact_email_status
  )
  const includeSimilarTitles =
    people.includeSimilarTitles ?? people.include_similar_titles
  const keywords = strings(people.q_keywords)

  const titleFilter = titles.length
    ? includeSimilarTitles === false
      ? condition("experience.employment_details.current.title", "in", titles)
      : group(
          "or",
          titles.map((title) =>
            condition(
              "experience.employment_details.current.title",
              "(.)",
              title
            )
          )
        )
    : undefined

  const filtersGroup = group("and", [
    titleFilter ?? null,
    keywords.length
      ? group(
          "or",
          keywords.flatMap((keyword) => [
            condition(
              "experience.employment_details.current.title",
              "(.)",
              keyword
            ),
            condition(
              "experience.employment_details.current.company_name",
              "(.)",
              keyword
            ),
          ])
        ) ?? null
      : null,
    seniorities.length
      ? condition(
          "experience.employment_details.current.seniority_level",
          "in",
          seniorities
        )
      : null,
    functions.length
      ? condition(
          "experience.employment_details.current.function_category",
          "in",
          functions
        )
      : null,
    locations.length
      ? group(
          "or",
          locations.map((location) =>
            condition("basic_profile.location.full_location", "(.)", location)
          )
        ) ?? null
      : null,
    employerLocations.length
      ? condition(
          "experience.employment_details.current.company_headquarters_country",
          "in",
          employerLocations
        )
      : null,
    domains.length
      ? condition(
          "experience.employment_details.current.company_website_domain",
          "in",
          domains
        )
      : null,
    emailStatuses.some((status) => status.toLowerCase() === "verified")
      ? condition(
          "experience.employment_details.current.business_email_verified",
          "=",
          true
        )
      : null,
    rangeFilter(
      "experience.employment_details.current.company_headcount_latest",
      employeeCount
    ),
  ])

  return clean({
    filters: filtersGroup,
    fields: [...PERSON_FIELDS],
    limit,
  })
}

export function buildDeeplineSearchPayload(
  toolId: string,
  kind: "people" | "companies",
  filters: JsonRecord = {},
  limit = 10
): JsonRecord {
  if (toolId.startsWith("apollo_")) return apolloPayload(filters, kind, limit)
  return kind === "people"
    ? crustdataPeoplePayload(filters, limit)
    : crustdataCompanyPayload(filters, limit)
}

export function deeplineSearchPayloadHasConstraint(
  payload: JsonRecord
): boolean {
  if (payload.filters && typeof payload.filters === "object") return true
  const metadataKeys = new Set(["fields", "sorts", "limit", "per_page"])
  return Object.keys(payload).some((key) => !metadataKeys.has(key))
}
