# Direct Message mode

The hosted MCP serves two modes on one endpoint, chosen by the member on
SignalSurf's OAuth consent page.

| Mode | Grant | What the client gets | Who acts |
| --- | --- | --- | --- |
| Tools mode | workspace scopes, or a manual token with `mode = tools` | The public workspace-operation catalogue (`PUBLIC_MCP_TOOLS`) | The client drives SignalSurf directly |
| Direct Message mode | `mcp:dm`, or a manual token with `mode = surfer_session` | The capability set the member's own Surfer Direct Message has | The client acts as the member |

## What Direct Message mode is (SIG-2681)

The member's conversation lives in their own client. SignalSurf keeps no
second conversation, no server-side assistant of its own, and no transcript of
what the member said to their client. The client acts as the member with the
same capabilities the member's in-workspace Surfer Direct Message has: start or
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


## Manual token (fallback)

For clients without OAuth, a workspace member can create a Direct Message MCP
token in SignalSurf Settings. The stored database mode remains
`surfer_session` for compatibility, but the token does not create a Surfer
session or transcript. It is bound to the member and the workspaces selected
when issued. Revocation ends access immediately, and SignalSurf re-validates
membership in the target workspace on every call.

## Several workspaces

On connection, the server calls `workspaces`, loads the catalogue for every
currently available granted workspace, and merges those catalogues by tool
name. A conflicting definition fails discovery instead of choosing one
arbitrarily. Workspaces the member has left remain visible from
`list_workspaces`, but do not prevent the remaining workspace catalogues from
loading.

Every published capability accepts `workspaceId`. It may be omitted only when
the grant reaches one workspace; otherwise SignalSurf returns
`WORKSPACE_REQUIRED` instead of guessing. A capability that exists in one
workspace but not another is still discoverable, and SignalSurf checks its
availability again in the selected workspace when called.

## Execution and records

The external client is the assistant in this mode. Calls read or write the
same Project resources the member can use in SignalSurf; there is no hidden
Surfer conversation behind the MCP connection. Project Threads are the durable
record of messages, decisions, delegated work, and results. Project Surfer work
keeps its normal confirmation boundary.

`tools/list` is intentionally unavailable when an available workspace
catalogue cannot be loaded. Returning a partial list would let MCP clients
cache a false capability surface. Callers should retry the connection after a
transient `DIRECT_MESSAGE_UNAVAILABLE` response.

## Relay contract

Every Direct Message request posts `{ action, ...fields }` to
`POST {SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL}/api/mcp/direct-message` with
the caller's bearer token. Success bodies are `{ ok: true, ... }`; failures are
`{ ok: false, error, code }` and preserve the HTTP status and product error
code. Network and upstream 5xx failures surface as
`DIRECT_MESSAGE_UNAVAILABLE` (503).
