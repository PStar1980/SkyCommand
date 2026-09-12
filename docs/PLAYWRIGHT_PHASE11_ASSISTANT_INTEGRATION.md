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

## Structured result consumption

The start call returns `202 Accepted` with a `statusUrl`. Poll that URL until `terminal` becomes `true`. The final response exposes the registered automation's structured `result`, any normalized failure, source commit, timings, and assistant-scoped artifact URLs.

## Audit

Every Assistant execution attempt records an `ASSISTANT_BROWSER_AUTOMATION` audit event, including success/failure, automation code, resulting Temporal workflow ID when available, authentication mode, permission scope, and a bounded error code.

## Configuration

Add a strong local token to `.env`:

```dotenv
SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED=true
SKYCOMMAND_ASSISTANT_API_TOKEN=<strong-random-token>
SKYCOMMAND_ASSISTANT_PERMISSION_CODES=BROWSER_AUTOMATION_READ,BROWSER_AUTOMATION_RUN
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
