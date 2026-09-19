# Surfer session mode

The hosted MCP serves two separately selectable surfaces from the same
endpoint. The bearer token decides which one a request sees.

| Mode | Token | Tools | Who acts |
| --- | --- | --- | --- |
| Tool mode (default) | OAuth grant or manual token with `mode = tools` | The public product-operation catalog (`PUBLIC_MCP_TOOLS`), OAuth scopes, resources, prompts, and the one-time approval flow | The external client drives SignalSurf directly |
| Surfer session mode | Manual token issued in SignalSurf Settings with `mode = surfer_session` | `message_surfer`, `read_surfer_session`, `answer_surfer_confirmation`, `close_surfer_session` | Surfer, SignalSurf's server-side agent, acting as the token's member |

Session mode changes nothing about tool mode: its four tools are not part of
`PUBLIC_MCP_TOOLS`, the public tool contract, or the Surfer parity registry.

## Issuing a session token

A workspace member opens SignalSurf Settings → Agent → Profile → MCP →
Surfer session access and creates a **Surfer session** token. The token is
bound to that member; a member holds at most one active session token per
workspace. Revoking the token ends access immediately. Membership and role
are re-validated on every relay call, so a removed member's token stops
working before the next action.

## How a session works

Each session is an independent private conversation between the member and
Surfer (`agent_conversation` with `thread_kind = surfer_session`). It shares the
member's canonical Direct Message runtime: the same system prompt, tools,
authorization policy, workspace Thread pulse, delegation ledger, memory, and
one-time timers. Sessions never appear in the Direct Message sidebar. Closing a
session ends its transcript and admits no further Surfer turns; a follow-up
still scheduled on it moves to the member's canonical Direct Message when that
Direct Message has no follow-up of its own.

The client is only an input device. It relays member text with
`message_surfer`; Surfer decides whether to answer privately, look something
up, or delegate real work into a canonical Project Thread where every
operation, decision, and result stays publicly recorded with provenance. There
is no coordinator lease, no turn-claim protocol, and no manifest handed to the
client.

## Tools

- `message_surfer({ sessionId?, message, occurrenceId?, waitSeconds?, clientLabel? })`
  appends one member message. Omit `sessionId` to open a new session. The
  call waits up to `waitSeconds` (default 25) for Surfer's reply; otherwise it
  returns `reply.status = "pending"` plus a `nextStep`. Retrying with the same
  `occurrenceId` is idempotent.
- `read_surfer_session({ sessionId?, afterSequence?, limit? })` returns the
  transcript after a sequence, current activity, Surfer's private Working
  State, delegated Project Thread work with source links, timers, and pending
  confirmations/decisions. Without `sessionId` it lists the token's sessions.
- `answer_surfer_confirmation({ sessionId, confirmationId, decision | answer, occurrenceId? })`
  answers a pending item through its original authority boundary. Ids look like
  `op:<uuid>` (a confirmation raised inside the private conversation) or
  `decision:<uuid>` (a shared Project Thread decision projected into the
  session). Approval resumes exactly the original operation and cannot be
  replayed or redirected.
- `close_surfer_session({ sessionId })` ends the session (idempotent). A
  scheduled follow-up moves to the canonical Direct Message; the Direct Message
  holds one follow-up, so if it already has one the result reports
  `droppedTimerCount` instead of replacing it.

## Relay contract

Every tool posts `{ action, ...fields }` to
`POST {SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL}/api/mcp/surfer-session` with
the caller's bearer token. Success bodies are `{ ok: true, ... }`; failures are
`{ ok: false, error, code }` and surface with the same HTTP status and code.
Network or 5xx failures surface as `SURFER_SESSION_UNAVAILABLE` (503).
