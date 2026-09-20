# Direct Message mode

The hosted MCP serves two modes on one endpoint, chosen by the member on
SignalSurf's OAuth consent page.

| Mode | Grant | What the client gets | Who acts |
| --- | --- | --- | --- |
| Tools mode | product scopes, or a manual token with `mode = tools` | The public product-operation catalogue (`PUBLIC_MCP_TOOLS`) | The client drives SignalSurf directly |
| Direct Message mode | `mcp:dm`, or a manual token with `mode = surfer_session` | The capability set the member's own Surfer Direct Message has | The client acts as the member |

## What Direct Message mode is (SIG-2681)

The member's conversation lives in their own client. SignalSurf keeps no
second conversation, no server-side assistant of its own, and no transcript of
what the member said to their client. The client acts as the member with the
same capabilities the member's in-product Surfer Direct Message has: start or
continue Project Threads, review and manage delegated work, create and update
Projects, manage Project members and triggers, drive Thread Tasks. Real work
and its record live in the Projects those capabilities touch.

SignalSurf publishes the catalogue per member and workspace, so this server
states no tool list of its own:

- `POST {authorization server}/api/mcp/direct-message`
  - `{"action":"workspaces"}` — the granted workspaces, each with the member's
    access and that workspace's Surfer name.
  - `{"action":"catalog","workspaceId":…}` — the member's capabilities, with
    the product's own descriptions and argument schemas.
  - `{"action":"call","workspaceId":…,"tool":…,"arguments":{…}}` — run one, as
    the member, after SignalSurf re-validates membership in that workspace.

The server registers `list_workspaces` plus every published capability, adding
`workspaceId` to each schema. Nothing in this mode can change workspace data
directly; that is Tools mode, approved separately.

## Connecting

```bash
claude mcp add --transport http signalsurf https://mcp.signalsurf.ai/mcp
```

The consent page offers Direct Message and Tools; Direct Message is the
default when the client requests `mcp:dm`, which the 401 challenge advertises
first. Switching modes means authorizing again.


## Manual session token (fallback)

For clients without OAuth, a workspace member opens SignalSurf Settings → Agent → Profile → MCP →
Surfer session access and creates a **Surfer session** token. The token is
bound to that member and to the workspaces ticked when issuing it (the current
workspace plus any others the member belongs to, SIG-2669). A member's active
session tokens never share a workspace. Revoking the token ends access
immediately. Membership is re-validated in the target workspace on every relay
call, so losing one workspace stops access there without affecting the others.

## Several workspaces

Each workspace has its own Surfer, sessions, delegation ledger, memory and
timers; one MCP connection simply talks to each of them. Every session tool
takes an optional `workspaceId`. It may be omitted when the token reaches a
single workspace or when `sessionId` already identifies one; otherwise the call
fails with `WORKSPACE_REQUIRED` instead of guessing. `list_workspaces`
returns the granted workspaces with the member's current access and open-session
count in each.

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
`send_message`; Surfer decides whether to answer privately, look something
up, or delegate real work into a canonical Project Thread where every
operation, decision, and result stays publicly recorded with provenance. There
is no coordinator lease, no turn-claim protocol, and no manifest handed to the
client.

## Tools

- `list_workspaces()` lists the workspaces this token may reach.
- `send_message({ workspaceId?, sessionId?, message, occurrenceId?, waitSeconds?, clientLabel? })`
  appends one member message. Omit `sessionId` to open a new session. The
  call waits up to `waitSeconds` (default 25) for Surfer's reply; otherwise it
  returns `reply.status = "pending"` plus a `nextStep`. Retrying with the same
  `occurrenceId` is idempotent.
- `read_conversation({ workspaceId?, sessionId?, afterSequence?, limit? })` returns the
  transcript after a sequence, current activity, Surfer's private Working
  State, delegated Project Thread work with source links, timers, and pending
  confirmations/decisions. Without `sessionId` it lists the token's sessions.
- `answer_question({ workspaceId?, sessionId, confirmationId, decision | answer, occurrenceId? })`
  answers a pending item through its original authority boundary. Ids look like
  `op:<uuid>` (a confirmation raised inside the private conversation) or
  `decision:<uuid>` (a shared Project Thread decision projected into the
  session). Approval resumes exactly the original operation and cannot be
  replayed or redirected.
- `close_conversation({ workspaceId?, sessionId })` ends the session (idempotent). A
  scheduled follow-up moves to the canonical Direct Message; the Direct Message
  holds one follow-up, so if it already has one the result reports
  `droppedTimerCount` instead of replacing it.

## Relay contract

Every tool posts `{ action, ...fields }` to
`POST {SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL}/api/mcp/surfer-session` with
the caller's bearer token. Success bodies are `{ ok: true, ... }`; failures are
`{ ok: false, error, code }` and surface with the same HTTP status and code.
Network or 5xx failures surface as `SURFER_SESSION_UNAVAILABLE` (503).
