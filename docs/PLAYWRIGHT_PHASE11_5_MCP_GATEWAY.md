# SkyCommand Playwright Phase 11.5 — MCP Gateway

**Status:** Implementation package  
**Date:** September 12, 2026

## Purpose

Phase 11.5 adds a local Model Context Protocol (MCP) gateway in front of the bounded Phase 11 Assistant Integration API. The gateway lets MCP-capable agent systems such as Codex connect to SkyCommand without receiving direct access to PostgreSQL, Docker, Temporal, the Browser Worker, or arbitrary shell execution.

The initial gateway intentionally exposes only the Playwright Browser Automation surface already governed by Phase 11. Future SkyCommand agentic orchestration can add tools/workflows/agent-run namespaces behind the same policy boundary.

```text
MCP Agent (Codex / local agent / future connector)
                    |
                    | stdio MCP
                    v
        SkyCommand MCP Gateway
                    |
                    | Bearer token + agent id
                    v
       Phase 11 Assistant API
                    |
       +------------+-------------+
       |                          |
  Assistant opt-in           Permission scope
  Confirmation policy        Environment policy
       |                          |
       +------------+-------------+
                    |
                    v
          Playwright Automation
                    |
                 Temporal
                    |
              Browser Worker
```

## Security model

The MCP process is **not** a privileged bypass. It delegates every discovery and execution request to `/api/assistant`, so Phase 11 remains authoritative.

Execution requires every applicable gate to pass:

1. `SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED=true`.
2. A valid `SKYCOMMAND_ASSISTANT_API_TOKEN`.
3. `SKYCOMMAND_MCP_GATEWAY_ENABLED=true`.
4. `SKYCOMMAND_MCP_EXECUTION_ENABLED=true` (otherwise the execute tool is not advertised).
5. The automation code must appear in `SKYCOMMAND_MCP_ALLOWED_AUTOMATION_CODES` (or `*` must be deliberately configured).
6. The Browser Automation must have **Assistant execution enabled** in SkyCommand.
7. The Browser Automation cannot require human confirmation.
8. The Assistant service permission scope must contain the automation's execution permission.
9. The requested environment must be registered and allowed.
10. Browser execution remains `HEADLESS`.

The MCP allowlist is intentionally deny-by-default when empty. This gives an agent-specific layer above the broader Assistant catalogue.

## Protocol and transport

The initial gateway uses local **STDIO MCP** with the `2025-11-25` initialize handshake. This keeps the gateway dependency-free and compatible with clients that support the established MCP legacy era. A 2026-era auto-negotiating client may probe `server/discover`; the gateway returns Method Not Found so compatible clients can fall back to the `2025-11-25` handshake.

A future Phase 11.x can migrate the gateway to the official MCP TypeScript SDK v2 and serve the 2026 MCP era and Streamable HTTP from the same tool definitions. That transport upgrade should not change the SkyCommand safety contract.

## MCP tools

Read tools are always advertised while the gateway is enabled:

- `skycommand_system_capabilities`
- `skycommand_browser_automations_list`
- `skycommand_browser_automation_get`
- `skycommand_browser_automation_run_get`

The execute tool is advertised only when `SKYCOMMAND_MCP_EXECUTION_ENABLED=true`:

- `skycommand_browser_automation_run`

The execute tool is conservatively annotated as write/destructive/open-world at the MCP layer. SkyCommand then performs the authoritative automation-specific risk checks server-side.

## Configuration

Add or update the following in the real `.env` file:

```dotenv
SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED=true
SKYCOMMAND_ASSISTANT_API_TOKEN=<existing-strong-phase11-token>
SKYCOMMAND_ASSISTANT_PERMISSION_CODES=BROWSER_AUTOMATION_READ,BROWSER_AUTOMATION_RUN

SKYCOMMAND_MCP_GATEWAY_ENABLED=true
SKYCOMMAND_MCP_EXECUTION_ENABLED=false
SKYCOMMAND_MCP_API_BASE_URL=http://127.0.0.1:7171/api/assistant
SKYCOMMAND_MCP_AGENT_ID=codex-local
SKYCOMMAND_MCP_ALLOWED_AUTOMATION_CODES=command-center-status-snapshot
SKYCOMMAND_MCP_REQUEST_TIMEOUT_MS=65000
SKYCOMMAND_MCP_LOG_LEVEL=info
```

Start in read-only mode. After discovery is proven, set:

```dotenv
SKYCOMMAND_MCP_EXECUTION_ENABLED=true
```

and restart the MCP client/server connection.

## Codex CLI configuration

Codex supports local STDIO MCP servers. From the SkyCommand repository root, register this gateway with:

```powershell
codex mcp add skycommand -- node scripts/mcp/skycommandMcpGateway.js
```

Or use a project-scoped `.codex/config.toml` entry:

```toml
[mcp_servers.skycommand]
command = "node"
args = ["scripts/mcp/skycommandMcpGateway.js"]
cwd = "C:/path/to/SkyCommand"
required = true
startup_timeout_sec = 20
tool_timeout_sec = 90

default_tools_approval_mode = "writes"
```

The gateway loads the repository `.env` itself. Do **not** duplicate the Assistant API token into the Codex configuration unless a deployment topology later requires it.

After registration:

```powershell
codex mcp list
```

Inside Codex, use `/mcp` to inspect the active tools.

## Acceptance sequence

1. Keep `SKYCOMMAND_MCP_EXECUTION_ENABLED=false`.
2. Restart the API after applying this update so agent identity is included in Phase 11 audit metadata.
3. Run:

```powershell
npm run mcp-gateway:self-test
npm run assistant-integration:self-test
npm run validate
```

4. Register the gateway with Codex.
5. Confirm that Codex sees the four read tools but **not** `skycommand_browser_automation_run`.
6. Ask Codex to list SkyCommand browser automations. Only allowlisted + Assistant-enabled automations should be returned.
7. Set `SKYCOMMAND_MCP_EXECUTION_ENABLED=true` and reconnect MCP.
8. Confirm the run tool is now visible.
9. Ask Codex to start `command-center-status-snapshot` in `LOCAL` and then poll the returned workflow id with `skycommand_browser_automation_run_get`.
10. Verify the corresponding Browser Automation Operation shows `ASSISTANT` origin and the Access Control audit event contains the configured MCP agent id.
11. Disable MCP execution again after acceptance if the agent is not intended to retain autonomous execution capability.

## Important boundary

An agent that also has unrestricted local shell/filesystem/Docker/database access can potentially bypass the MCP gateway by using those separate privileges. The MCP gateway only governs actions that flow through it. For strong isolation, agent sandbox/OS permissions should make SkyCommand the capability broker rather than granting the agent parallel unrestricted access to the underlying machine.

## Future direction

The next agentic layers can reuse this gateway pattern:

```text
skycommand.system.*
skycommand.tools.*
skycommand.workflows.*
skycommand.browser_tests.*
skycommand.browser_automations.*
skycommand.schedules.*
skycommand.executions.*
skycommand.agents.*
```

Those namespaces should be added only when their corresponding SkyCommand API surfaces have explicit agent policy, permissions, structured outputs, audit, and approval semantics. MCP should remain an adapter over governed SkyCommand capabilities—not an alternate privileged control plane.
