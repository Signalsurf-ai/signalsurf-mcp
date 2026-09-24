# SignalSurf MCP connection

The hosted MCP exposes one connection. Its OAuth scopes determine the tool
catalogue: `mcp:dm` grants bounded member and Project collaboration
capabilities, while granular product scopes grant their corresponding public
workspace operations. Manual tokens delegate both surfaces. There is no
connection-mode field or parallel DM/Tools connection type.

Every operation acts as the authorizing member and remains bounded by that
member's workspace role, current membership, granted scope, confirmation rules,
and product availability.

## Member and Project capabilities

The member's conversation lives in their own client. SignalSurf keeps no
second conversation, server-side assistant, or transcript of what the member
said to their client. With `mcp:dm`, the client may use the same bounded
collaboration capabilities as the member: start or continue Project Threads,
review and manage delegated work, create and update Projects, manage Project
members and triggers, and drive Thread Tasks. Real work and its record live in
the Projects those capabilities touch.

SignalSurf publishes this catalogue per member and workspace:

- `POST {authorization server}/api/mcp/direct-message`
  - `{"action":"workspaces"}` — granted workspaces, access, and Surfer names.
  - `{"action":"catalog","workspaceId":…}` — member capabilities with the
    product's descriptions and argument schemas.
  - `{"action":"call","workspaceId":…,"tool":…,"arguments":{…}}` — run one
    after SignalSurf re-validates membership in that workspace.

When `mcp:dm` is granted, the server registers `list_workspaces` plus every
published collaboration capability and adds `workspaceId` to each schema. The
stable public product-tool catalogue remains discoverable on the connection;
each call enforces its granular scope, and `find_capabilities` returns only
tools the token may use. A name collision fails discovery rather than silently
overriding either definition.

## Connecting

```bash
claude mcp add --transport http signalsurf https://mcp.signalsurf.ai/mcp
```

The protected-resource challenge advertises `mcp:dm` together with the default
granular product scopes, so normal authorization receives both surfaces. A
least-privilege client may request only the capabilities it needs.

## Manual token fallback

For clients without OAuth, an administrator can create a manual MCP token in
SignalSurf Settings. It is bound to its creator and selected workspaces and
delegates the standard collaboration and product capabilities. Revocation ends
access immediately, and SignalSurf re-validates membership in the target
workspace on every call.

## Several workspaces

For a collaboration grant, the server loads the catalogue for every currently
available granted workspace and merges them by tool name. A conflicting
definition fails discovery. Workspaces the member has left remain visible from
`list_workspaces` but do not prevent the remaining catalogues from loading.

Every published collaboration capability accepts `workspaceId`. It may be
omitted only when the grant reaches one workspace; otherwise SignalSurf returns
`WORKSPACE_REQUIRED`. Availability is checked again in the selected workspace
when a capability is called.

## Execution and records

The external client is the assistant for the conversation. Calls read or write
the same Project resources the member can use in SignalSurf; there is no hidden
Surfer conversation behind the MCP connection. Project Threads are the durable
record of messages, decisions, delegated work, and results. Project Surfer work
keeps its normal confirmation boundary.

A routine lookup or atomic File/CRM mutation keeps normal record-level history
and does not create Thread chatter. If the external conversation reaches a
durable Project-relevant conclusion, call `publish_project_conclusion` before
the final answer. Append the distilled decision, evidence, and next steps to a
relevant Thread when known; otherwise create a conclusion Thread. SignalSurf
shows it as Project Surfer with the external client and requesting member as
provenance, without copying the private transcript or waking Surfer.

`tools/list` fails when an available collaboration workspace catalogue cannot
load; returning a partial list could make clients cache a false capability
surface. Retry after a transient `DIRECT_MESSAGE_UNAVAILABLE` response.

## Collaboration relay contract

Every collaboration-capability request posts `{ action, ...fields }` to
`POST {SIGNALSURF_MCP_AUTHORIZATION_SERVER_URL}/api/mcp/direct-message` with
the caller's bearer token. Success bodies are `{ ok: true, ... }`; failures are
`{ ok: false, error, code }` and preserve the HTTP status and product error
code. Network and upstream 5xx failures surface as
`DIRECT_MESSAGE_UNAVAILABLE` (503).
