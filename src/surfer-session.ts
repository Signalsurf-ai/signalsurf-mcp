import { randomUUID } from "node:crypto"

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { UserFacingError } from "./errors.js"
import { jsonErrorResult, jsonResult } from "./mcp-results.js"

/**
 * Surfer session mode: a separately selectable hosted MCP surface that relays
 * a member's messages to Surfer (SignalSurf's server-side agent). These tools
 * are intentionally NOT part of PUBLIC_MCP_TOOLS; the public tool contract and
 * Surfer parity registry describe tool mode only.
 */

export const SURFER_SESSION_TOOL_NAMES = [
  "list_surfer_workspaces",
  "message_surfer",
  "read_surfer_session",
  "answer_surfer_confirmation",
  "close_surfer_session",
] as const

export type SurferSessionToolName = (typeof SURFER_SESSION_TOOL_NAMES)[number]

export type SurferSessionToolDefinition = {
  title: string
  description: string
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

const mutatingAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

export const SURFER_SESSION_TOOLS = {
  list_surfer_workspaces: {
    title: "List Surfer workspaces",
    description:
      "List the SignalSurf workspaces this session token may reach, with the member's current access and open-session count in each. Each workspace has its own Surfer; nothing is shared between workspaces. Call this first when the member works in more than one workspace.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  message_surfer: {
    title: "Message Surfer",
    description:
      'Send one member message to Surfer, SignalSurf\'s server-side agent. Omit sessionId to open a new session; pass an existing id to continue it. Waits up to waitSeconds for Surfer\'s reply. When reply.status is "pending", follow nextStep and call read_surfer_session with afterSequence = message.sequence. Retry a failed call with the same occurrenceId to avoid duplicate messages. workspaceId picks the granted workspace whose Surfer to use (see list_surfer_workspaces); omit it only when the token reaches one workspace or sessionId already identifies it.',
    annotations: mutatingAnnotations,
  },
  read_surfer_session: {
    title: "Read Surfer session",
    description:
      "Read a Surfer session: transcript events after a sequence number, current activity, working state, delegated Project Thread work, timers, and pending confirmations/decisions. Omit sessionId to list this token's sessions. This is the only way to confirm Surfer actually did something; a returned tool call is not completion. workspaceId picks the granted workspace whose Surfer to use (see list_surfer_workspaces); omit it only when the token reaches one workspace or sessionId already identifies it.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  answer_surfer_confirmation: {
    title: "Answer Surfer confirmation",
    description:
      'Approve or reject a pending Surfer confirmation, or answer a pending question decision. Use the confirmationId exactly as returned by message_surfer or read_surfer_session ("op:<uuid>" or "decision:<uuid>"). decision approves or rejects op: confirmations and operation-approval decisions; a question decision needs answer as { answers: [{ fieldId, value }] } with one entry per field from read_surfer_session (value: an option id, or an array of ids for multi_select; a string for text; a boolean for confirmation). Provide exactly one of decision or answer. workspaceId picks the granted workspace whose Surfer to use (see list_surfer_workspaces); omit it only when the token reaches one workspace or sessionId already identifies it.',
    annotations: mutatingAnnotations,
  },
  close_surfer_session: {
    title: "Close Surfer session",
    description:
      "Close a Surfer session when the member is done. Idempotent; closing an already-closed session returns it unchanged. A scheduled follow-up moves to the member's Direct Message; if that Direct Message already has one, droppedTimerCount reports the follow-up that was not moved. workspaceId picks the granted workspace whose Surfer to use (see list_surfer_workspaces); omit it only when the token reaches one workspace or sessionId already identifies it.",
    annotations: mutatingAnnotations,
  },
} as const satisfies Record<SurferSessionToolName, SurferSessionToolDefinition>

export const SURFER_SESSION_INSTRUCTIONS = `SignalSurf MCP — Surfer session mode.

You are relaying a SignalSurf member's messages to Surfer, SignalSurf's server-side agent. Surfer plans and delegates real work into Project Threads; you are an input device, not the coordinator.

- If the member works in more than one workspace, call list_surfer_workspaces and pass workspaceId; each workspace has its own Surfer and nothing is shared between them.
- Use message_surfer to talk to Surfer.
- Use read_surfer_session to see the transcript, pending confirmations, and delegated work.
- Use answer_surfer_confirmation to approve, reject, or answer pending items.
- Use close_surfer_session when done.

Never claim work is complete because a call returned; read the session to confirm.`

const uuidSchema = z.string().uuid()

const workspaceIdField = uuidSchema.nullable().optional()

export const listSurferWorkspacesSchema = z.object({}).strict()

export const messageSurferSchema = z
  .object({
    workspaceId: workspaceIdField,
    sessionId: uuidSchema.nullable().optional(),
    message: z.string().min(1).max(12000),
    occurrenceId: uuidSchema.optional(),
    waitSeconds: z.number().int().min(0).max(50).default(25),
    clientLabel: z.string().min(1).max(80).optional(),
  })
  .strict()

export const readSurferSessionSchema = z
  .object({
    workspaceId: workspaceIdField,
    sessionId: uuidSchema.nullable().optional(),
    afterSequence: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()

export const answerSurferConfirmationSchema = z
  .object({
    workspaceId: workspaceIdField,
    sessionId: uuidSchema,
    confirmationId: z.string().min(1),
    decision: z.enum(["approve", "reject"]).optional(),
    answer: z.record(z.unknown()).optional(),
    occurrenceId: uuidSchema.optional(),
  })
  .strict()

export const closeSurferSessionSchema = z
  .object({
    workspaceId: workspaceIdField,
    sessionId: uuidSchema,
  })
  .strict()

export const SURFER_SESSION_TOOL_SCHEMAS = {
  list_surfer_workspaces: listSurferWorkspacesSchema,
  message_surfer: messageSurferSchema,
  read_surfer_session: readSurferSessionSchema,
  answer_surfer_confirmation: answerSurferConfirmationSchema,
  close_surfer_session: closeSurferSessionSchema,
} as const satisfies Record<SurferSessionToolName, z.ZodTypeAny>

export type SurferSessionAction =
  | "workspaces"
  | "message"
  | "read"
  | "answer_confirmation"
  | "close"

export const SURFER_SESSION_UNAVAILABLE = "SURFER_SESSION_UNAVAILABLE"

export type SurferSessionClientOptions = {
  baseUrl?: string
  accessToken?: string
  fetch?: typeof fetch
  /** Upper bound on one relay request; must exceed the longest waitSeconds. */
  timeoutMs?: number
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function unavailable(message: string, details?: JsonRecord): UserFacingError {
  return new UserFacingError(message, {
    code: SURFER_SESSION_UNAVAILABLE,
    status: 503,
    details,
  })
}

export class SurferSessionClient {
  private readonly baseUrl: string | undefined
  private readonly accessToken: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: SurferSessionClientOptions) {
    this.baseUrl = options.baseUrl?.trim().replace(/\/+$/, "") || undefined
    this.accessToken = options.accessToken?.trim() || undefined
    // workerd rejects a bare `fetch` invoked as a method with "Illegal
    // invocation", so the relay must hold a bound copy. Node does not care,
    // which is why this only ever failed on the deployed Worker.
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? 65_000
  }

  get endpoint(): string | null {
    return this.baseUrl ? `${this.baseUrl}/api/mcp/surfer-session` : null
  }

  async call(action: SurferSessionAction, body: JsonRecord): Promise<JsonRecord> {
    if (!this.endpoint || !this.accessToken) {
      throw unavailable(
        "Surfer session relay is not configured on this hosted MCP deployment."
      )
    }
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({ action, ...body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      // Without this the cause is invisible in production: the tool returns a
      // generic "could not be reached" and the Worker logs nothing.
      console.error("Surfer session relay request failed", {
        action,
        endpoint: this.endpoint,
        error:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      })
      throw unavailable(
        "SignalSurf could not be reached for this Surfer session.",
        { action }
      )
    }

    let payload: unknown = undefined
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }

    if (response.status >= 500) {
      throw unavailable("SignalSurf's Surfer session relay is unavailable.", {
        action,
        httpStatus: response.status,
      })
    }
    if (!response.ok) {
      const record = isRecord(payload) ? payload : {}
      const message =
        typeof record.error === "string" && record.error
          ? record.error
          : `Surfer session request failed (${response.status}).`
      const code =
        typeof record.code === "string" && record.code
          ? record.code
          : response.status === 401
            ? "UNAUTHORIZED"
            : response.status === 403
              ? "FORBIDDEN"
              : response.status === 404
                ? "NOT_FOUND"
                : "BAD_REQUEST"
      throw new UserFacingError(message, {
        code,
        status: response.status,
        details: { action, httpStatus: response.status },
      })
    }
    if (!isRecord(payload) || payload.ok !== true) {
      throw unavailable(
        "SignalSurf's Surfer session response did not match its public contract.",
        { action, httpStatus: response.status }
      )
    }
    return payload
  }

  async message(input: z.infer<typeof messageSurferSchema>) {
    const occurrenceId = input.occurrenceId ?? randomUUID()
    const result = await this.call("message", {
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      message: input.message,
      occurrenceId,
      waitSeconds: input.waitSeconds,
      clientLabel: input.clientLabel,
    })
    const reply = isRecord(result.reply) ? result.reply : null
    const message = isRecord(result.message) ? result.message : null
    const session = isRecord(result.session) ? result.session : null
    const nextStep =
      reply?.status === "pending"
        ? `Surfer has not replied yet. Call read_surfer_session with sessionId "${
            typeof session?.id === "string" ? session.id : ""
          }" and afterSequence = ${
            typeof message?.sequence === "number" ? message.sequence : 0
          } to pick up the reply, pending confirmations, and delegated work.`
        : undefined
    return {
      ...result,
      occurrenceId,
      ...(nextStep ? { nextStep } : {}),
    }
  }

  async read(input: z.infer<typeof readSurferSessionSchema>) {
    return this.call("read", {
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      afterSequence: input.afterSequence,
      limit: input.limit,
    })
  }

  async answerConfirmation(
    input: z.infer<typeof answerSurferConfirmationSchema>
  ) {
    const hasDecision = input.decision !== undefined
    const hasAnswer = input.answer !== undefined
    if (hasDecision === hasAnswer) {
      throw new UserFacingError(
        "answer_surfer_confirmation requires exactly one of decision or answer.",
        { code: "VALIDATION_ERROR", status: 422 }
      )
    }
    const occurrenceId = input.occurrenceId ?? randomUUID()
    const result = await this.call("answer_confirmation", {
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId,
      confirmationId: input.confirmationId,
      decision: input.decision,
      answer: input.answer,
      occurrenceId,
    })
    return { ...result, occurrenceId }
  }

  async close(input: z.infer<typeof closeSurferSessionSchema>) {
    return this.call("close", {
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId,
    })
  }

  async workspaces() {
    return this.call("workspaces", {})
  }
}

async function runSessionTool(fn: () => Promise<unknown>) {
  try {
    return jsonResult(await fn())
  } catch (error) {
    return jsonErrorResult(error)
  }
}

export function registerSurferSessionTools(
  server: McpServer,
  client: SurferSessionClient
) {
  function config(name: SurferSessionToolName) {
    const definition = SURFER_SESSION_TOOLS[name]
    return {
      title: definition.title,
      description: definition.description,
      annotations: definition.annotations,
      inputSchema: SURFER_SESSION_TOOL_SCHEMAS[name],
    }
  }

  server.registerTool(
    "list_surfer_workspaces",
    config("list_surfer_workspaces"),
    () => runSessionTool(() => client.workspaces())
  )
  server.registerTool("message_surfer", config("message_surfer"), (args: any) =>
    runSessionTool(() => client.message(args))
  )
  server.registerTool(
    "read_surfer_session",
    config("read_surfer_session"),
    (args: any) => runSessionTool(() => client.read(args))
  )
  server.registerTool(
    "answer_surfer_confirmation",
    config("answer_surfer_confirmation"),
    (args: any) => runSessionTool(() => client.answerConfirmation(args))
  )
  server.registerTool(
    "close_surfer_session",
    config("close_surfer_session"),
    (args: any) => runSessionTool(() => client.close(args))
  )
}
