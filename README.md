# SignalSurf MCP — Deprecated

This standalone repository is retired. The maintained MCP runtime, thin
Cloudflare Worker gateway, and portable contracts live in
[Signalsurf-ai/signalsurf-web](https://github.com/Signalsurf-ai/signalsurf-web).
Do not install, deploy, or make product changes from this repository.
Its source and Git history are retained for historical reference.

## Connect to SignalSurf

Use the official
[SignalSurf Plugin](https://github.com/Signalsurf-ai/signalsurf-agent) or, for a
client that supports remote Streamable HTTP and OAuth, the existing endpoint:

```text
https://mcp.signalsurf.ai/mcp
```

The endpoint is not being retired. Follow the current Web
[hosted connection guide](https://github.com/Signalsurf-ai/signalsurf-web/blob/main/docs/hosted-mcp.md#user-setup)
for OAuth and Workspace selection. End users do not need a local server or
Supabase service-role credentials.

## Migrate development and deployments

- Change the hosted runtime and gateway in Web's
  [packages/mcp-server](https://github.com/Signalsurf-ai/signalsurf-web/tree/main/packages/mcp-server).
  Web also owns OAuth, product execution, and Workspace authorization.
- Change portable contracts in Web's
  [packages/mcp-contract](https://github.com/Signalsurf-ai/signalsurf-web/tree/main/packages/mcp-contract).
  Plugin source lives in Web's `agent-plugins/`; `signalsurf-agent` is its public
  distribution.
- For an existing local stdio or separately managed Node HTTP deployment, review
  the maintained package's
  [local setup](https://github.com/Signalsurf-ai/signalsurf-web/blob/main/packages/mcp-server/README.md#local-development-quick-start).
  Review the client's configuration, available tools, scopes, and response
  contracts, then validate its required operations. Retirement does not perform
  an automatic migration or establish drop-in parity for this old distribution.

The ownership and deployment baseline was verified against Web commit
[`3ef557d`](https://github.com/Signalsurf-ai/signalsurf-web/blob/3ef557dec1d997dc0ece511505dd4ee086b52a9f/docs/chatgpt-extension/README.md#architecture-decision-and-repository-boundaries).
Use the current Web documentation for subsequent changes.

## Operator notice

The old deployment script and `wrangler.toml` are retired from this repository.
Their historical configuration uses the same `signalsurf-mcp` Worker name and
`mcp.signalsurf.ai` domain as the maintained Web gateway. Do not restore or
publish that old deployment: it could replace the maintained gateway. Follow Web's
[deployment order](https://github.com/Signalsurf-ai/signalsurf-web/blob/main/packages/mcp-server/README.md#hosted-service-deployment)
from a reviewed Web checkout.

Deprecating or archiving a GitHub repository does not stop a deployed service,
remove a custom domain, revoke credentials, or migrate external consumers.
Keep the Web-owned hosted MCP and its gateway running. Before removing any
separately operated legacy instance or dedicated credential, identify its
deployment and consumers and verify their migration. This repository does not
contain a complete inventory of external installations or deployed artifacts.

The historical package metadata is `@signalsurf/mcp@0.1.0`, marked `private`,
with a `signalsurf-mcp` executable. That metadata is not evidence that no package,
container, fork, or private installation exists elsewhere.

## Historical documentation

These documents describe the retired implementation, not the current hosted
service or instructions for new deployments:

- [Connection](docs/mcp-connection.md)
- [Architecture](docs/architecture.md)
- [Capabilities](docs/capabilities.md)
- [Action approvals](docs/action-approval-integration.md)
- [Schema snapshot](schema/README.md)

Old installation and deployment instructions remain available in Git history.
Open product issues and changes in
[signalsurf-web](https://github.com/Signalsurf-ai/signalsurf-web/issues).
