# Unified SignalSurf MCP

The hosted MCP exposes one connection and one tool catalogue. An OAuth grant
contains `mcp:dm` plus at least one granular product scope; a manual token has
`mode = unified`. Grants from the removed pre-launch modes are rejected.

The merged catalogue contains:

- the public workspace-operation tools allowed by the grant's granular scopes;
- bounded member and Project collaboration capabilities in each granted
  workspace.

Every operation acts as the authorizing member and remains bounded by that
member's workspace role, current membership, tool scope, confirmation rules,
and product availability.

## Member and Project capabilities (SIG-2681, SIG-2815)

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
`workspaceId` to each schema. It then registers the scoped public product tools
on the same MCP server. A name collision fails discovery rather than silently
overriding either definition.

## Connecting

```bash
claude mcp add --transport http signalsurf https://mcp.signalsurf.ai/mcp
```

The consent page presents one SignalSurf connection. The protected-resource
challenge advertises `mcp:dm` together with the default granular product scopes,
so a new authorization receives the unified catalogue without a mode choice.

## Manual token (fallback)

For clients without OAuth, an administrator can create a unified MCP token in
SignalSurf Settings. It is bound to its creator and the workspaces selected
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

The external client is the assistant for the conversation. Calls read or write the
same Project resources the member can use in SignalSurf; there is no hidden
Surfer conversation behind the MCP connection. Project Threads are the durable
record of messages, decisions, delegated work, and results. Project Surfer work
keeps its normal confirmation boundary.

A routine lookup or atomic File/CRM mutation keeps its normal record-level
history and does not create Thread chatter. If the external conversation reaches
a durable Project-relevant conclusion, call `publish_project_conclusion` before
the final answer. Append the distilled decision, evidence, and next steps to the
relevant Thread when known; otherwise create a conclusion Thread. SignalSurf
shows it as Project Surfer with the external client and requesting member as
provenance, without copying the private transcript or waking Surfer.

`tools/list` is intentionally unavailable when an available workspace
catalogue cannot be loaded. Returning a partial list would let MCP clients
cache a false capability surface. Callers should retry the connection after a
transient `DIRECT_MESSAGE_UNAVAILABLE` response.

## Member-capability relay contract

Every member-capability request posts `{ action, ...fields }` to
`POST {SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL}/api/mcp/direct-message` with
the caller's bearer token. Success bodies are `{ ok: true, ... }`; failures are
`{ ok: false, error, code }` and preserve the HTTP status and product error
code. Network and upstream 5xx failures surface as
`DIRECT_MESSAGE_UNAVAILABLE` (503).
