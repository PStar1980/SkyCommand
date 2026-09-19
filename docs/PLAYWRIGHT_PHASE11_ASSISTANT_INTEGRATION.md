# Playwright Phase 11 — Assistant Integration

## Goal

Phase 11 exposes explicitly authorized Playwright Automations through a small assistant-facing HTTP/JSON surface. It does **not** grant an assistant arbitrary browser or machine access. The integration can execute only registered, enabled Playwright Automations that an administrator has explicitly opted in.

## Safety model

The Assistant integration is disabled by default and requires all of the following before an automation can run:

1. `SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED=true`.
2. A valid `SKYCOMMAND_ASSISTANT_API_TOKEN` bearer token.
3. The automation is active and has `assistant_enabled = TRUE`.
4. The service identity contains the automation's configured execution permission.
5. The automation does **not** require human confirmation.
6. The requested environment is already registered and enabled for the automation.
7. Execution is `HEADLESS`; the Assistant surface cannot request interactive Chromium.

Confirmation-required automations are deliberately rejected rather than allowing an assistant to self-confirm. High-impact automations already require confirmation, so they cannot be assistant-enabled under the Phase 11 policy.

## Database changes

`00126__assistant_browser_automation_opt_in.sql` adds `core.browser_automations.assistant_enabled`, defaulting to `FALSE`.

`00127__assistant_browser_automation_reference_seed.sql` opts in only the existing read-only `command-center-status-snapshot` reference automation when its safety contract remains compatible.

## Administration UI

Manage Automations and Add Automation now include **Assistant execution enabled**. The control is disabled when confirmation is required or no execution permission is configured. The Manage Automations table includes an **Assistant** column so the opt-in state is visible at a glance.

## API surface

All routes below require the Assistant bearer token and live beneath `/api/assistant`:

- `GET /capabilities`
- `GET /openapi.json`
- `GET /browser-automations`
- `GET /browser-automations/:automationCode`
- `POST /browser-automations/:automationCode/runs`
- `GET /browser-automation-runs/:workflowId`
- `GET /browser-automation-runs/:workflowId/artifacts/:artifactId`

Assistant-started runs are recorded with `triggerSource = ASSISTANT`. The assistant run endpoint refuses to expose runs started through manual, scheduler, or workflow surfaces.

### Step C — governed Development Promotion start

The separately gated `POST /development-promotion/runs` endpoint accepts exactly:

```json
{
  "commitMessage": "...",
  "finalizationWorkflowRunId": "<successful dev_change_finalize workflow run id>",
  "idempotencyKey": "<caller-scoped retry key>"
}
```

The server supplies `workflowCode = skyserver_dev_commit`, `repoName` from the exact configured `SkyCommand` repository, `executor = temporal`, `runSource = assistant`, and `triggerType = ASSISTANT`. It rejects extra execution/control fields, blank/multiline/control-character messages, invalid finalization run ids, and invalid idempotency keys. The referenced successful `dev_change_finalize` receipt must match the exact repository, DEV environment/profile, source/configuration/SQL identity, and zero-pending database state; current drift blocks the start. The response is a governed generic workflow-run receipt with principal/request attribution and a read path for terminal observation. R6 promotion versions remove the redundant Merge Approval node; the explicit user promotion instruction remains the authorization boundary.

This endpoint requires the Assistant service identity to possess the complete, explicit permission envelope below; none of these permissions are part of the Assistant default set:

```text
WORKFLOW_RUN
DEV_PROMOTION_PREFLIGHT
REPO_MAP_GENERATE
REPO_ZIP_GENERATE
GIT_COMMIT_RUN
GIT_MAIN_MERGE_RUN
GIT_LOCAL_SYNC_RUN
CORE_RUN_LOW_RISK_SCRIPT
CORE_RUN_MEDIUM_RISK_SCRIPT
CORE_RUN_HIGH_RISK_SCRIPT
```

The service checks the entire envelope before creating a workflow run. If any code is absent, it returns `403 ASSISTANT_DEV_PROMOTION_PERMISSION_SCOPE_MISSING` with only the missing `missingPermissionCodes`; it never starts a partially authorized promotion. Capability discovery distinguishes `configured` from `enabled`/`executable` and exposes `requiredPermissionCodes`, `missingPermissionCodes`, and the explicit blocked reason. It also requires both `SKYCOMMAND_ASSISTANT_DEV_PROMOTION_ENABLED=true` and a nonblank `SKYCOMMAND_ASSISTANT_DEV_PROMOTION_REPOSITORY=SkyCommand`.

## Structured result consumption

The start call returns `202 Accepted` with a generic workflow-run record reference. Read `/api/assistant/workflow-runs/{workflowRunRecordId}` until the run is terminal. The final response exposes the workflow-owned structured result, commit/merge/sync evidence, timings, and assistant-scoped artifact references without exposing secrets.

## Audit

Every Assistant execution attempt records an `ASSISTANT_BROWSER_AUTOMATION` audit event, including success/failure, automation code, resulting Temporal workflow ID when available, authentication mode, permission scope, and a bounded error code.

## Configuration

Add a strong local token to `.env`:

```dotenv
SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED=true
SKYCOMMAND_ASSISTANT_API_TOKEN=<strong-random-token>
SKYCOMMAND_ASSISTANT_PERMISSION_CODES=BROWSER_AUTOMATION_READ,BROWSER_AUTOMATION_RUN

# Step C, disabled until separately reviewed and accepted.
SKYCOMMAND_ASSISTANT_DEV_PROMOTION_ENABLED=false
SKYCOMMAND_ASSISTANT_DEV_PROMOTION_REPOSITORY=
```

Generate a token locally with Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The API is currently published on localhost by Docker, so this surface remains local unless the operator intentionally places another authenticated bridge in front of it.

## Acceptance test

After applying the database build and restarting the API:

```powershell
$token = '<your token>'
$headers = @{ Authorization = "Bearer $token" }

Invoke-RestMethod `
  -Uri 'http://127.0.0.1:7171/api/assistant/capabilities' `
  -Headers $headers

Invoke-RestMethod `
  -Uri 'http://127.0.0.1:7171/api/assistant/browser-automations' `
  -Headers $headers
```

The catalogue should contain `command-center-status-snapshot` with `assistant.executable = true`.

Start it:

```powershell
$body = @{
  environmentCode = 'LOCAL'
  parameters = @{}
} | ConvertTo-Json -Depth 10

$start = Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:7171/api/assistant/browser-automations/command-center-status-snapshot/runs' `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body

$start.execution
```

Poll the returned workflow ID:

```powershell
$workflowId = $start.execution.workflowId
Invoke-RestMethod `
  -Uri "http://127.0.0.1:7171/api/assistant/browser-automation-runs/$workflowId" `
  -Headers $headers
```

Expected result: `triggerSource = ASSISTANT`, `executionMode = HEADLESS`, and eventually `terminal = true` with `status = SUCCESS` and a structured `result`.

## Validation

```powershell
npm run assistant-integration:self-test
npm run validate
```

## Boundary for ChatGPT / external assistants

This phase creates the explicit SkyCommand-side execution contract required by the architecture plan. A cloud assistant still cannot directly reach a localhost-only API without a separately authorized connector, plugin, local desktop bridge, or comparable transport. That transport can consume the Phase 11 OpenAPI contract without weakening SkyCommand's registry, permission, risk, environment, audit, and execution boundaries.
