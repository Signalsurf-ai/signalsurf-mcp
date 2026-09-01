import type { SignalSurfContext, SupabaseLike } from "./types.js"
import { UserFacingError } from "./errors.js"

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

export type SenderDomainControlPlaneOptions = {
  workspaceId: string
  authorizationServerUrl?: string
  accessToken?: string
  fetchImpl?: typeof fetch
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringMap(value: unknown): Record<string, string | number | boolean> {
  const record = cleanRecord(value)
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string | number | boolean] =>
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

function nonNegativeNumber(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function activeAt(row: Record<string, unknown>, observedAtMs: number): boolean {
  const startsAt =
    typeof row.starts_at === "string" ? Date.parse(row.starts_at) : null
  const expiresAt =
    typeof row.expires_at === "string" ? Date.parse(row.expires_at) : null
  return (
    (startsAt === null ||
      (Number.isFinite(startsAt) && startsAt <= observedAtMs)) &&
    (expiresAt === null ||
      (Number.isFinite(expiresAt) && expiresAt > observedAtMs))
  )
}

export async function inspectSenderInfrastructure(
  db: SupabaseLike,
  context: SignalSurfContext,
  input: InfrastructureInput = {}
) {
  const productId = context.productId
  const excludedDomainIds = new Set(input.excludedDomainIds ?? [])
  const excludedAccountIds = new Set(input.excludedAccountIds ?? [])
  const [domains, mailboxes, warmup, bindings, tools, productRows, grants] =
    await Promise.all([
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
        db
          .from("products")
          .select("id, organization_id")
          .eq("id", productId)
          .limit(1),
        "Product billing scope"
      ),
      rows(
        db
          .from("managed_sender_entitlements")
          .select(
            "kind, quantity, capacity_floor, status, starts_at, expires_at"
          )
          .eq("workspace_id", productId)
          .eq("status", "active"),
        "Sender entitlement"
      ),
    ])

  const visibleDomains = domains.filter(
    (domain) =>
      domain.desired_state !== "transferred" &&
      !excludedDomainIds.has(String(domain.id))
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
    (binding) =>
      !excludedAccountIds.has(String(binding.unipile_account_id ?? ""))
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
  const planKey =
    typeof subscriptions[0]?.plan_name === "string"
      ? subscriptions[0].plan_name
      : null
  const catalog = planKey
    ? await rows(
        db
          .from("billing_plan_catalog")
          .select(
            "plan_key, managed_mailbox_slots, connected_email_senders, linkedin_senders, instagram_senders"
          )
          .eq("plan_key", planKey)
          .limit(1),
        "Billing plan catalog"
      ).catch(() => [])
    : []
  const catalogRow = catalog[0]
  const included = nonNegativeNumber(catalogRow?.managed_mailbox_slots)
  const observedAtMs = Date.now()
  const activeGrants = grants.filter((grant) => activeAt(grant, observedAtMs))
  const additional = activeGrants
    .filter((grant) => grant.kind === "sender_seat")
    .reduce((sum, grant) => sum + Math.max(0, Number(grant.quantity ?? 0)), 0)
  const dedicatedFloor = activeGrants
    .filter((grant) => grant.kind === "dedicated_infrastructure")
    .reduce((max, grant) => Math.max(max, Number(grant.capacity_floor ?? 0)), 0)
  const emailLimit =
    included === null
      ? dedicatedFloor > 0
        ? dedicatedFloor
        : null
      : Math.max(included + additional, dedicatedFloor)
  const connectedEmailUsed = visibleBindings.filter(
    (binding) =>
      providerKind(binding.provider) === "email" &&
      !managedAccountIds.has(String(binding.unipile_account_id))
  ).length
  const managedEmailUsed = visibleMailboxes.length

  const mergedSettings: Record<
    string,
    Record<string, string | number | boolean>
  > = {}
  const orderedTools = [...tools].sort((a, b) => {
    const aOwn = Boolean(context.userId) && a.user_id === context.userId
    const bOwn = Boolean(context.userId) && b.user_id === context.userId
    if (aOwn !== bOwn) return aOwn ? 1 : -1
    const byUpdatedAt = String(a.updated_at ?? "").localeCompare(
      String(b.updated_at ?? "")
    )
    if (byUpdatedAt !== 0) return byUpdatedAt
    return String(a.id ?? "").localeCompare(String(b.id ?? ""))
  })
  for (const tool of orderedTools) {
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
        remaining:
          emailLimit === null
            ? null
            : Math.max(0, emailLimit - managedEmailUsed - connectedEmailUsed),
      },
      managedEmail: { used: managedEmailUsed, included },
      connectedEmail: {
        used: connectedEmailUsed,
        planLimit: nonNegativeNumber(catalogRow?.connected_email_senders),
      },
      linkedin: {
        used: visibleBindings.filter(
          (binding) => providerKind(binding.provider) === "linkedin"
        ).length,
        planLimit: nonNegativeNumber(catalogRow?.linkedin_senders),
      },
      instagram: {
        used: visibleBindings.filter(
          (binding) => providerKind(binding.provider) === "instagram"
        ).length,
        planLimit: nonNegativeNumber(catalogRow?.instagram_senders),
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
  const touches = positiveInteger(
    input.touchesPerRecipient ?? 3,
    "touchesPerRecipient"
  )
  const sendingDays = positiveInteger(input.sendingDays, "sendingDays")
  const dailyLimit = positiveInteger(
    input.dailyLimitPerMailbox ?? 30,
    "dailyLimitPerMailbox"
  )
  const utilizationPercent = input.utilizationPercent ?? 80
  if (utilizationPercent < 1 || utilizationPercent > 100)
    throw new UserFacingError("utilizationPercent must be between 1 and 100.", {
      code: "INVALID_CAPACITY_INPUT",
      status: 400,
    })
  const mailboxesPerDomain = positiveInteger(
    input.mailboxesPerDomain ?? 3,
    "mailboxesPerDomain"
  )
  const infrastructure = await inspectSenderInfrastructure(db, context, input)
  const plannedMessages = recipients * touches
  const targetDailyMessages = Math.ceil(plannedMessages / sendingDays)
  const effectiveMailboxDaily = dailyLimit * (utilizationPercent / 100)
  const requiredMailboxes = Math.ceil(
    targetDailyMessages / effectiveMailboxDaily
  )
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
    calculationVersion: "sender-capacity-hosted-2026-09-01.v1",
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
      dailyLimitPerMailbox:
        "Editable planning default, not a provider or product limit.",
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
        requiredNewMailboxes: requiredMailboxes,
        requiredNewDomains: requiredDomains,
        additionalMailboxes,
        additionalDomains,
        projectedInventoryAfterPurchase: {
          mailboxes: infrastructure.mailboxes.length + additionalMailboxes,
          domains: infrastructure.domains.length + additionalDomains,
        },
        note: "Because hosted MCP credits zero unverified live capacity, requiredNew and additional are the same conservative purchase quantities. projectedInventoryAfterPurchase adds those quantities to the visible inventory; it is not a claim that existing senders are usable.",
      },
      custom,
    },
    pricing: {
      domainAnnualMinor: null,
      mailboxMonthlyMinor: null,
      currency: "USD",
      domainPriceSource:
        "Hosted MCP exposes live availability only; open the secure in-app Domain card for exact current annual retail prices.",
      mailboxPriceSource:
        "Recurring sender-seat price is unavailable in hosted MCP; open the secure in-app capacity card for the current Stripe price.",
    },
    observedAt: new Date().toISOString(),
  }
}

function availabilityEntries(value: unknown, responsePending: boolean) {
  if (!Array.isArray(value)) {
    throw new UserFacingError(
      "SignalSurf's Domain availability response did not match its public contract.",
      { code: "DOMAIN_AVAILABILITY_UNAVAILABLE", status: 503 }
    )
  }
  return value.map((item) => {
    const record = cleanRecord(item)
    const domain = typeof record.domain === "string" ? record.domain : ""
    if (!domain) {
      throw new UserFacingError(
        "SignalSurf's Domain availability response did not match its public contract.",
        { code: "DOMAIN_AVAILABILITY_UNAVAILABLE", status: 503 }
      )
    }
    const pending = responsePending || record.pending === true
    return {
      domain,
      available:
        pending || typeof record.available !== "boolean"
          ? null
          : record.available,
      priceMinor: null,
      currency: null,
      purchasable: false,
      pending,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.filter(
            (warning): warning is string => typeof warning === "string"
          )
        : [],
    }
  })
}

export async function searchSenderDomains(
  input: DomainSearchInput,
  options?: SenderDomainControlPlaneOptions
) {
  const authorizationServerUrl = options?.authorizationServerUrl?.replace(
    /\/+$/,
    ""
  )
  const accessToken = options?.accessToken?.trim()
  if (!authorizationServerUrl || !accessToken || !options?.workspaceId) {
    throw new UserFacingError(
      "Live managed Domain availability is not configured on this hosted MCP deployment.",
      { code: "DOMAIN_AVAILABILITY_UNAVAILABLE", status: 503 }
    )
  }
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      `${authorizationServerUrl}/api/mcp/sender-domains`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          workspaceId: options.workspaceId,
          domains: input.domains ?? [],
          count: input.count ?? 5,
          ...(input.seed ? { seed: input.seed } : {}),
          exclude: input.exclude ?? [],
          infrastructureClass: input.infrastructureClass ?? "standard",
        }),
        signal: AbortSignal.timeout(30_000),
      }
    )
  } catch {
    throw new UserFacingError("Live Domain availability could not be loaded.", {
      code: "DOMAIN_AVAILABILITY_UNAVAILABLE",
      status: 503,
    })
  }
  if (!response.ok && response.status !== 202) {
    const status =
      response.status === 401 || response.status === 403
        ? response.status
        : response.status >= 500
          ? 503
          : 409
    throw new UserFacingError("Live Domain availability could not be loaded.", {
      code:
        status === 401
          ? "UNAUTHORIZED"
          : status === 403
            ? "FORBIDDEN"
            : "DOMAIN_AVAILABILITY_UNAVAILABLE",
      status,
    })
  }
  let body: Record<string, unknown>
  try {
    body = cleanRecord(await response.json())
  } catch {
    throw new UserFacingError("Live Domain availability could not be loaded.", {
      code: "DOMAIN_AVAILABILITY_UNAVAILABLE",
      status: 503,
    })
  }
  if (body.sender_domain_search !== true) {
    throw new UserFacingError(
      "SignalSurf's Domain availability response did not match its public contract.",
      { code: "DOMAIN_AVAILABILITY_UNAVAILABLE", status: 503 }
    )
  }
  const pending = response.status === 202
  return {
    seed: typeof body.seed === "string" ? body.seed : null,
    requested: availabilityEntries(body.requested, pending),
    suggested: availabilityEntries(body.suggested, pending),
    priceDefinition:
      "Hosted MCP returns live availability only. Exact customer retail prices, plan-credit use, registrant details, and purchase confirmation remain in the secure in-app Domain card.",
    observedAt:
      typeof body.observedAt === "string"
        ? body.observedAt
        : new Date().toISOString(),
  }
}
