import type { SignalSurfContext, SupabaseLike } from "./types.js"
import { UserFacingError } from "./errors.js"

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const DOMAIN_PREFIXES = ["my", "go", "use", "try", "get", "the", "join", "hey", "with", "meet"]
const DOMAIN_SUFFIXES = ["mail", "hq", "team", "hub", "app", "inbox", "mailer", "outreach"]

export type InfrastructureInput = {
  productId?: string
  excludedDomainIds?: string[]
  excludedAccountIds?: string[]
}

export type CapacityInput = InfrastructureInput & {
  recipients: number
  touchesPerRecipient?: number
  sendingDays: number
  dailyLimitPerMailbox?: number
  utilizationPercent?: number
  mailboxesPerDomain?: number
  custom?: { additionalMailboxes: number; additionalDomains: number }
}

export type DomainSearchInput = {
  productId?: string
  domains?: string[]
  seed?: string
  count?: number
  exclude?: string[]
  infrastructureClass?: "standard" | "isolated"
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringMap(value: unknown): Record<string, string | number | boolean> {
  const record = cleanRecord(value)
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string | number | boolean] =>
      ["string", "number", "boolean"].includes(typeof entry[1])
    )
  )
}

async function rows(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string
): Promise<Record<string, unknown>[]> {
  const result = await query
  if (result.error)
    throw new UserFacingError(`${label} is unavailable.`, {
      code: "SENDER_INFRASTRUCTURE_UNAVAILABLE",
      status: 503,
    })
  return Array.isArray(result.data)
    ? result.data.map(cleanRecord)
    : result.data
      ? [cleanRecord(result.data)]
      : []
}

function providerKind(value: unknown) {
  const provider = String(value ?? "").toUpperCase()
  if (provider.includes("LINKEDIN")) return "linkedin"
  if (provider.includes("INSTAGRAM")) return "instagram"
  if (
    provider.includes("GOOGLE") ||
    provider.includes("GMAIL") ||
    provider.includes("MAIL") ||
    provider.includes("OUTLOOK")
  )
    return "email"
  return "unknown"
}

function activeManagedMailbox(row: Record<string, unknown>) {
  return row.desired_state !== "retired" && row.lifecycle_status !== "retired"
}

function fallbackMailboxSlots(planKey: string) {
  if (planKey === "enterprise") return 25
  if (planKey === "team") return 10
  return 3
}

export async function inspectSenderInfrastructure(
  db: SupabaseLike,
  context: SignalSurfContext,
  input: InfrastructureInput = {}
) {
  const productId = context.productId
  const excludedDomainIds = new Set(input.excludedDomainIds ?? [])
  const excludedAccountIds = new Set(input.excludedAccountIds ?? [])
  const [domains, mailboxes, warmup, bindings, tools, productRows, grants] = await Promise.all([
    rows(
      db
        .from("managed_email_domains")
        .select(
          "id, domain_name, provider, infrastructure_class, desired_state, provider_status, lifecycle_status, dns_status, dns_reason_codes, dns_observed_at, autorenew_enabled, provider_expires_at, renewal_state, custody_state, updated_at"
        )
        .eq("workspace_id", productId),
      "Managed Domain inventory"
    ),
    rows(
      db
        .from("managed_email_mailboxes")
        .select(
          "id, domain_id, email_address, provider, infrastructure_class, desired_state, provider_status, lifecycle_status, infrastructure_status, transport_status, real_send_status, synthetic_warmup_status, health_status, campaign_eligibility_status, readiness_reason_codes, readiness_source_observed_at, forwarding_status, credential_handoff_status, warmup_connection_status, unipile_account_id, updated_at"
        )
        .eq("workspace_id", productId),
      "Managed mailbox inventory"
    ),
    rows(
      db
        .from("email_sender_warmup_profiles")
        .select(
          "id, unipile_account_id, managed_mailbox_id, email_address, provider_connection_status, warmup_mode, warmup_daily_limit, maintenance_enabled, automated_sending_enabled, automated_daily_limit, warmup_started_at, verified_warmup_days, heat_score, heat_score_observed_at, placement_primary_percent, placement_promotions_percent, placement_spam_percent, placement_missing_percent, placement_observed_at, placement_test_status, placement_test_due_at, updated_at"
        )
        .eq("workspace_id", productId),
      "Warm-up and Placement evidence"
    ),
    rows(
      db
        .from("product_unipile_accounts")
        .select("unipile_account_id, provider, connected_at")
        .eq("workspace_id", productId),
      "Sender bindings"
    ),
    rows(
      db
        .from("product_tools")
        .select("id, user_id, config, updated_at")
        .eq("workspace_id", productId)
        .eq("tool_type", "unipile"),
      "Sender settings"
    ),
    rows(
      db.from("products").select("id, organization_id").eq("id", productId).limit(1),
      "Product billing scope"
    ),
    rows(
      db
        .from("managed_sender_entitlements")
        .select("kind, quantity, capacity_floor, status, starts_at, expires_at")
        .eq("workspace_id", productId)
        .eq("status", "active"),
      "Sender entitlement"
    ),
  ])

  const visibleDomains = domains.filter(
    (domain) => domain.desired_state !== "transferred" && !excludedDomainIds.has(String(domain.id))
  )
  const visibleMailboxes = mailboxes.filter(
    (mailbox) =>
      activeManagedMailbox(mailbox) &&
      !excludedAccountIds.has(String(mailbox.unipile_account_id ?? ""))
  )
  const managedAccountIds = new Set(
    visibleMailboxes
      .map((mailbox) => mailbox.unipile_account_id)
      .filter((value): value is string => typeof value === "string" && !!value)
  )
  const visibleBindings = bindings.filter(
    (binding) => !excludedAccountIds.has(String(binding.unipile_account_id ?? ""))
  )

  const organizationId = String(productRows[0]?.organization_id ?? "")
  const subscriptions = organizationId
    ? await rows(
        db
          .from("subscriptions")
          .select("plan_name, status, current_period_end, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false })
          .limit(1),
        "Billing plan"
      )
    : []
  const planKey = String(subscriptions[0]?.plan_name ?? "individual")
  const catalog = await rows(
    db
      .from("billing_plan_catalog")
      .select(
        "plan_key, managed_mailbox_slots, connected_email_senders, linkedin_senders, instagram_senders"
      )
      .eq("plan_key", planKey)
      .limit(1),
    "Billing plan catalog"
  ).catch(() => [])
  const catalogRow = catalog[0]
  const included = Number(catalogRow?.managed_mailbox_slots ?? fallbackMailboxSlots(planKey))
  const additional = grants
    .filter((grant) => grant.kind === "sender_seat")
    .reduce((sum, grant) => sum + Math.max(0, Number(grant.quantity ?? 0)), 0)
  const dedicatedFloor = grants
    .filter((grant) => grant.kind === "dedicated_infrastructure")
    .reduce((max, grant) => Math.max(max, Number(grant.capacity_floor ?? 0)), 0)
  const emailLimit = Math.max(included + additional, dedicatedFloor)
  const connectedEmailUsed = visibleBindings.filter(
    (binding) =>
      providerKind(binding.provider) === "email" &&
      !managedAccountIds.has(String(binding.unipile_account_id))
  ).length
  const managedEmailUsed = visibleMailboxes.length

  const mergedSettings: Record<string, Record<string, string | number | boolean>> = {}
  for (const tool of tools) {
    const config = cleanRecord(tool.config)
    for (const key of [
      "openTracking",
      "unsubscribe",
      "dailyLimits",
      "sendGapMinutes",
      "sendJitterMinutes",
      "gradualSendingDisabled",
      "linkedinInviteWeekly",
      "linkedinMessageWeekly",
    ]) {
      mergedSettings[key] = {
        ...(mergedSettings[key] ?? {}),
        ...stringMap(config[key]),
      }
    }
    const signatures = cleanRecord(config.signatures)
    mergedSettings.signatureConfigured = {
      ...(mergedSettings.signatureConfigured ?? {}),
      ...Object.fromEntries(
        Object.entries(signatures).map(([accountId, signature]) => [
          accountId,
          typeof signature === "string" && signature.trim().length > 0,
        ])
      ),
    }
  }

  return {
    observedAt: new Date().toISOString(),
    evidence: {
      inventory: "authoritative_database",
      connectedAccountHealth:
        "binding_only; provider connection health requires the in-app live Sender surface",
      currentDailyUsage:
        "unavailable in hosted MCP; capacity planning does not subtract unverified existing capacity",
    },
    domains: visibleDomains.map((domain) => ({
      id: domain.id,
      domainName: domain.domain_name,
      provider: domain.provider,
      infrastructureClass: domain.infrastructure_class,
      desiredState: domain.desired_state,
      providerStatus: domain.provider_status,
      lifecycleStatus: domain.lifecycle_status,
      dnsStatus: domain.dns_status,
      dnsReasonCodes: domain.dns_reason_codes,
      dnsObservedAt: domain.dns_observed_at,
      autorenewEnabled: domain.autorenew_enabled,
      expiresAt: domain.provider_expires_at,
      renewalState: domain.renewal_state,
      custodyState: domain.custody_state,
      updatedAt: domain.updated_at,
    })),
    mailboxes: visibleMailboxes.map((mailbox) => ({
      id: mailbox.id,
      domainId: mailbox.domain_id,
      emailAddress: mailbox.email_address,
      provider: mailbox.provider,
      infrastructureClass: mailbox.infrastructure_class,
      desiredState: mailbox.desired_state,
      providerStatus: mailbox.provider_status,
      lifecycleStatus: mailbox.lifecycle_status,
      infrastructureStatus: mailbox.infrastructure_status,
      transportStatus: mailbox.transport_status,
      realSendStatus: mailbox.real_send_status,
      syntheticWarmupStatus: mailbox.synthetic_warmup_status,
      healthStatus: mailbox.health_status,
      campaignEligibilityStatus: mailbox.campaign_eligibility_status,
      readinessReasonCodes: mailbox.readiness_reason_codes,
      readinessObservedAt: mailbox.readiness_source_observed_at,
      forwardingStatus: mailbox.forwarding_status,
      credentialHandoffStatus: mailbox.credential_handoff_status,
      warmupConnectionStatus: mailbox.warmup_connection_status,
      accountId: mailbox.unipile_account_id,
      updatedAt: mailbox.updated_at,
    })),
    connectedAccounts: visibleBindings.map((binding) => ({
      accountId: binding.unipile_account_id,
      provider: binding.provider,
      channel: providerKind(binding.provider),
      connectionStatus: "bound_unverified",
      connectedAt: binding.connected_at,
    })),
    warmupAndPlacement: warmup.filter((profile) => {
      const accountId = String(profile.unipile_account_id ?? "")
      return !accountId || !excludedAccountIds.has(accountId)
    }),
    senderSettings: mergedSettings,
    entitlement: {
      planKey,
      email: {
        used: managedEmailUsed + connectedEmailUsed,
        limit: emailLimit,
        remaining: Math.max(0, emailLimit - managedEmailUsed - connectedEmailUsed),
      },
      managedEmail: { used: managedEmailUsed, included },
      connectedEmail: {
        used: connectedEmailUsed,
        planLimit: Number(catalogRow?.connected_email_senders ?? 0),
      },
      linkedin: {
        used: visibleBindings.filter((binding) => providerKind(binding.provider) === "linkedin")
          .length,
        planLimit: Number(catalogRow?.linkedin_senders ?? 0),
      },
      instagram: {
        used: visibleBindings.filter((binding) => providerKind(binding.provider) === "instagram")
          .length,
        planLimit: Number(catalogRow?.instagram_senders ?? 0),
      },
      managedDomains: { used: visibleDomains.length, limit: null },
      additionalSenderSeats: additional,
      dedicatedCapacityFloor: dedicatedFloor,
    },
  }
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new UserFacingError(`${label} must be a positive integer.`, {
      code: "INVALID_CAPACITY_INPUT",
      status: 400,
    })
  return value
}

export async function planSenderCapacity(
  db: SupabaseLike,
  context: SignalSurfContext,
  input: CapacityInput
) {
  const recipients = positiveInteger(input.recipients, "recipients")
  const touches = positiveInteger(input.touchesPerRecipient ?? 3, "touchesPerRecipient")
  const sendingDays = positiveInteger(input.sendingDays, "sendingDays")
  const dailyLimit = positiveInteger(input.dailyLimitPerMailbox ?? 30, "dailyLimitPerMailbox")
  const utilizationPercent = input.utilizationPercent ?? 80
  if (utilizationPercent < 1 || utilizationPercent > 100)
    throw new UserFacingError("utilizationPercent must be between 1 and 100.", {
      code: "INVALID_CAPACITY_INPUT",
      status: 400,
    })
  const mailboxesPerDomain = positiveInteger(input.mailboxesPerDomain ?? 3, "mailboxesPerDomain")
  const infrastructure = await inspectSenderInfrastructure(db, context, input)
  const plannedMessages = recipients * touches
  const targetDailyMessages = Math.ceil(plannedMessages / sendingDays)
  const effectiveMailboxDaily = dailyLimit * (utilizationPercent / 100)
  const requiredMailboxes = Math.ceil(targetDailyMessages / effectiveMailboxDaily)
  const requiredDomains = Math.ceil(requiredMailboxes / mailboxesPerDomain)
  const existingUsableMailboxes = infrastructure.mailboxes.filter(
    (mailbox) => mailbox.campaignEligibilityStatus === "eligible"
  ).length
  const additionalMailboxes = requiredMailboxes
  const additionalDomains = requiredDomains
  const custom = input.custom
    ? {
        additionalMailboxes: Math.max(0, input.custom.additionalMailboxes),
        additionalDomains: Math.max(0, input.custom.additionalDomains),
      }
    : null

  return {
    assumptions: {
      recipients,
      touchesPerRecipient: touches,
      sendingDays,
      dailyLimitPerMailbox: dailyLimit,
      utilizationPercent,
      mailboxesPerDomain,
      excludedDomainIds: input.excludedDomainIds ?? [],
      excludedAccountIds: input.excludedAccountIds ?? [],
    },
    definitions: {
      touchesPerRecipient:
        "Worst-case planned messages per recipient, including follow-ups; replies and stops are not deducted.",
      sendingDays:
        "Sending days available, not elapsed calendar days. Extending the timeline reduces the required capacity.",
      dailyLimitPerMailbox: "Editable planning default, not a provider or product limit.",
      utilizationPercent:
        "Editable safety factor for uneven delivery windows, ramping and operational headroom.",
      mailboxesPerDomain:
        "Editable planning ratio, not a quota. A higher number reduces domain count but concentrates reputation risk.",
    },
    formulas: {
      plannedMessages: `${recipients} × ${touches} = ${plannedMessages}`,
      targetDailyMessages: `ceil(${plannedMessages} ÷ ${sendingDays}) = ${targetDailyMessages}`,
      effectiveMailboxDaily: `${dailyLimit} × ${utilizationPercent}% = ${effectiveMailboxDaily}`,
      requiredMailboxes: `ceil(${targetDailyMessages} ÷ ${effectiveMailboxDaily}) = ${requiredMailboxes}`,
      requiredDomains: `ceil(${requiredMailboxes} ÷ ${mailboxesPerDomain}) = ${requiredDomains}`,
    },
    rounding:
      "Daily volume, mailbox count and domain count round up so the plan does not understate worst-case demand.",
    liveFacts: infrastructure,
    comparisons: {
      useExisting: {
        usableManagedMailboxes: existingUsableMailboxes,
        creditedDailyCapacity: 0,
        meetsTarget: false,
        note: "Hosted MCP cannot verify current provider health and daily usage, so it shows existing inventory but conservatively credits zero capacity. Open the in-app Sender planner for live subtraction.",
      },
      meetTarget: {
        totalMailboxes: requiredMailboxes,
        totalDomains: requiredDomains,
        additionalMailboxes,
        additionalDomains,
      },
      custom,
    },
    pricing: {
      domainAnnualMinor: null,
      mailboxMonthlyMinor: null,
      currency: "USD",
      domainPriceSource:
        "Use search_sender_domains for exact current annual retail prices for concrete candidates.",
      mailboxPriceSource:
        "Recurring sender-seat price is unavailable in hosted MCP; open the secure in-app capacity card for the current Stripe price.",
    },
    observedAt: new Date().toISOString(),
  }
}

function seedLabel(value: string | undefined) {
  if (!value?.trim()) return null
  const raw = value.trim().toLowerCase()
  const hostname = raw.replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? raw
  const first = hostname.includes(".") ? hostname.split(".")[0] : hostname
  const label = first.replace(/[^a-z0-9]/g, "")
  return label || null
}

function generatedDomains(seed: string, count: number, excluded: Set<string>) {
  const templates = [
    ...DOMAIN_PREFIXES.map((prefix) => `${prefix}${seed}`),
    ...DOMAIN_SUFFIXES.map((suffix) => `${seed}${suffix}`),
    ...DOMAIN_PREFIXES.flatMap((prefix) =>
      DOMAIN_SUFFIXES.map((suffix) => `${prefix}${seed}${suffix}`)
    ),
  ]
  const result: string[] = []
  for (const label of templates) {
    const domain = `${label}.com`
    if (excluded.has(domain)) continue
    excluded.add(domain)
    result.push(domain)
    if (result.length >= count) break
  }
  return result
}

function warnings(domain: string) {
  const label = domain.split(".")[0] ?? ""
  return [
    ...(label.includes("-") ? ["hyphen"] : []),
    ...(/\d/.test(label) ? ["digit"] : []),
    ...(label.length > 20 ? ["length"] : []),
    ...(!domain.endsWith(".com") ? ["nonComEnding"] : []),
  ]
}

function providerItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = cleanRecord(value)
  for (const key of ["items", "data", "results", "domains"]) {
    if (Array.isArray(record[key])) return record[key]
  }
  throw new Error("Domain provider response does not match the expected contract")
}

function retailPrice(providerMinor: number) {
  return Math.ceil(Math.max(providerMinor + 500, providerMinor * 1.25) / 100) * 100
}

export async function searchSenderDomains(input: DomainSearchInput) {
  if ((input.infrastructureClass ?? "standard") !== "standard")
    throw new UserFacingError(
      "Hosted MCP currently quotes the standard managed Email setup only; open the in-app secure infrastructure card for isolated setup.",
      { code: "INFRASTRUCTURE_CLASS_UNAVAILABLE", status: 409 }
    )
  const apiKey = process.env.MAILFORGE_API_KEY?.trim()
  if (!apiKey)
    throw new UserFacingError(
      "Live managed Domain availability is not configured on this hosted MCP deployment.",
      { code: "DOMAIN_AVAILABILITY_UNAVAILABLE", status: 503 }
    )
  const requested = [...new Set((input.domains ?? []).map((value) => value.trim().toLowerCase()))]
  if (requested.some((domain) => !DOMAIN_PATTERN.test(domain)))
    throw new UserFacingError("Every requested Domain must be a valid public hostname.", {
      code: "INVALID_DOMAIN",
      status: 400,
    })
  const count = Math.max(0, Math.min(10, input.count ?? 5))
  const seed = seedLabel(input.seed)
  const excluded = new Set([
    ...requested,
    ...(input.exclude ?? []).map((value) => value.trim().toLowerCase()),
    ...(seed ? [`${seed}.com`] : []),
  ])
  const generated = seed ? generatedDomains(seed, count * 3, excluded) : []
  const candidates = [...requested, ...generated].slice(0, 100)
  if (candidates.length === 0)
    return {
      seed,
      requested: [],
      suggested: [],
      observedAt: new Date().toISOString(),
    }
  const baseUrl = (process.env.MAILFORGE_API_BASE_URL ?? "https://api.mailforge.ai/public").replace(
    /\/+$/,
    ""
  )
  const response = await fetch(`${baseUrl}/check-domain-availability-bulk`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: apiKey,
      "X-Source": "signalsurf-mcp",
    },
    body: JSON.stringify({ domains: candidates }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new UserFacingError("Live Domain availability could not be loaded.", {
      code: "DOMAIN_AVAILABILITY_UNAVAILABLE",
      status: response.status >= 500 ? 503 : 409,
    })
  const items = providerItems(await response.json())
  const quotes = new Map(
    items.map((item) => {
      const record = cleanRecord(item)
      const domain = String(
        record.domain ?? record.domainName ?? record.domain_name ?? ""
      ).toLowerCase()
      const available =
        typeof record.available === "boolean" ? record.available : record.isAvailable === true
      const providerMinor =
        typeof record.priceMinor === "number"
          ? record.priceMinor
          : typeof record.price_minor === "number"
            ? record.price_minor
            : typeof record.price === "number"
              ? Math.round(record.price * 100)
              : null
      const currency = String(record.currency ?? record.currencyCode ?? "USD").toUpperCase()
      const exact =
        available &&
        currency === "USD" &&
        providerMinor !== null &&
        Number.isSafeInteger(providerMinor) &&
        providerMinor >= 0
      return [
        domain,
        {
          domain,
          available,
          priceMinor: exact ? retailPrice(providerMinor) : null,
          currency: exact ? "USD" : null,
          purchasable: exact,
          pending: response.status === 202,
          warnings: warnings(domain),
        },
      ] as const
    })
  )
  const present = (domain: string) =>
    quotes.get(domain) ?? {
      domain,
      available: false,
      priceMinor: null,
      currency: null,
      purchasable: false,
      pending: true,
      warnings: warnings(domain),
    }
  return {
    seed,
    requested: requested.map(present),
    suggested: generated
      .map(present)
      .filter((quote) => quote.purchasable)
      .slice(0, count),
    priceDefinition:
      "Exact annual customer retail price: max(provider cost + USD 5.00, provider cost × 1.25), rounded up to the next whole USD, computed per Domain.",
    observedAt: new Date().toISOString(),
  }
}
