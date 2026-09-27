# SignalSurf MCP connection

SignalSurf exposes one remote MCP endpoint and one deterministic tool registry.
Project collaboration and product operations are not connection modes: OAuth
scopes authorize individual calls while `tools/list` stays stable, so clients do
not cache a partial product surface.

## Agent and context model

The external host is a runtime for the Workspace's canonical SignalSurf Agent.
Claude, Codex, and other clients are not separate Project members and do not
author Project messages under the approving user's identity. Project messages
written through MCP use Agent authorship; the OAuth client, grant, and
authorizing user remain bounded audit provenance.

At session start, call `get_workspace_context`. It returns the Agent identity, authorized
Workspaces, member authority, grants, and effective product capabilities. When
entering or switching a Project, call `get_project_context`; pass `threadId`
when focusing a Thread. Reuse that bounded result for ordinary turns and refresh
it after a relevant write or scope change.

Workspace-wide CRM, Table, Workflow, and Campaign operations do not require a
Project. When work is Project-scoped, Project visibility and File permissions
still apply. Routine record edits keep their native object history and need no
Thread created merely as a log. Durable decisions, research findings,
assumptions, and next steps belong in a relevant Project Thread through
`publish_project_conclusion`.

## OAuth and execution boundary

The Web authorization server issues a ten-minute signed access token plus an
opaque rotating refresh token. The MCP Worker validates the access-token
signature, issuer, audience, expiry, Workspace grants, scopes, and role locally;
it does not query SignalSurf application tables during connector discovery.

Project tools are declared from the checked-in shared contract. On execution,
the Worker calls `POST {authorization server}/api/mcp/execute` with its own
service credential and a short-lived, audience-bound signed delegation. It
never forwards the user's
bearer token. SignalSurf Web verifies the service credential, confirms the
selected Workspace is granted, revalidates current membership, then applies the
normal Project and File authorization rules.

Product tools execute in the MCP Worker's repository layer with the same
Workspace and capability checks. A missing scope returns
`INSUFFICIENT_SCOPE`; leaving a Workspace prevents subsequent Project calls even
while a short-lived access token remains cryptographically valid.

## Several Workspaces

`get_workspace_context` and `list_workspaces` expose every Workspace in the signed grant.
Every Workspace-scoped call must pass one returned `workspaceId` when the grant
contains more than one Workspace. The caller cannot target an id outside the
signed grant, and Project execution checks current membership again.

## Plugin and raw MCP

The official SignalSurf Plugin is the primary user experience. It bundles the
remote endpoint with the routing instructions above and guides the host through
OAuth, context loading, Project switching, and conclusion writeback. Raw MCP at
`https://mcp.signalsurf.ai/mcp` remains an advanced integration surface; it
uses the same registry and OAuth contract, without a second compatibility mode.

The versioned public package and per-host installation instructions live in
`Signalsurf-ai/signalsurf-agent`. Claude and Codex can install it from that
GitHub marketplace; ChatGPT web uses the reviewed or custom MCP connector path;
Cursor uses the same package through its reviewed marketplace or local-plugin
development path.
