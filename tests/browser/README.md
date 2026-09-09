# SkyCommand Browser Tests

This directory contains the native Playwright foundation for SkyCommand Browser Tests.
Operational browser automations are intentionally separate and will live under the future
`browser-automation/` source tree.

## Phase 1 scope

Phase 1 established a browser-test runner that remains independent of the SkyCommand Browser
Tests UI and database registry. Even after the Phase 3 registry is enabled, native Playwright
commands can therefore validate SkyCommand when the registry or API is unavailable.

The initial smoke test verifies the Start Workflow **Initialize** interaction without starting a
workflow or producing external side effects.

## Local prerequisites

1. SkyCommand must be running and reachable at `SKYCOMMAND_BROWSER_BASE_URL`.
2. Install the Playwright Chromium runtime once after `npm install`:

   ```powershell
   npm run test:browser:install
   ```

3. Configure local credentials in `.env` (never commit them):

   ```text
   SKYCOMMAND_BROWSER_BASE_URL=http://127.0.0.1:15171
   SKYCOMMAND_BROWSER_TEST_EMAIL=<test-user-email>
   SKYCOMMAND_BROWSER_TEST_PASSWORD=<test-user-password>
   SKYCOMMAND_BROWSER_TEST_WORKFLOW_CODE=repo-map-zip
   ```

A dedicated browser-test identity is preferred as the Browser Test subsystem matures.

## Commands

```powershell
npm run test:browser:list
npm run test:browser:smoke
npm run test:browser
npm run test:browser:headed
```

`test:browser:smoke` runs tests tagged `@smoke`. The default runner uses one Chromium worker and
zero retries so browser execution remains deterministic while mutating-test safety rules are still
being established.

## Artifacts

Failure evidence is written beneath:

```text
artifacts/browser/tests/
```

Playwright traces, screenshots, videos, and HTML reports are generated there and are excluded from
Git. Phase 5 assigns each registered execution its own artifact directory beneath this root, persists a
durable `worker.browser_test_runs` ledger, indexes browser evidence in
`worker.browser_test_artifacts`, and records the source Git SHA used for the run.

Registered executions also write `skycommand-summary.json` using the
`browser_test_summary.v1` contract. Tests that launch a SkyCommand workflow can attach the resulting
workflow run to Browser Test Operations with `helpers/skyCommandLinks.js`; the operations UI then
provides direct navigation to Workflow Operations.

## Phase 2 dedicated Browser Worker

The same source-controlled specs can now execute inside the isolated Docker `browser-worker` through
a dedicated Temporal task queue. The host-native commands above remain useful for fast authoring and
debugging, while the worker lane proves the infrastructure path that the future Browser Test registry
will invoke.

```powershell
npm run browser:worker:docker:up
npm run browser:worker:docker:status
npm run browser:worker:smoke
npm run browser:worker:docker:logs
```

The container targets `SKYCOMMAND_BROWSER_DOCKER_BASE_URL` (default `http://web:8080`) rather than
host `localhost`, writes artifacts back into the canonical host repository, executes only approved
spec paths beneath `tests/browser/specs/`, and defaults to one concurrent browser activity with zero
Temporal retries.

## Phase 3 Browser Test Registry

Browser Test source remains in this directory, while registration metadata now lives in PostgreSQL.
The registry stores the source path, category, browser/environment policy, timeout/retry settings,
permission/risk metadata, and runtime parameter definitions. Source code is never stored in the
database.

Registered test parameters are supplied to Playwright as one JSON object through:

```text
SKYCOMMAND_BROWSER_TEST_PARAMETERS
```

Specs can consume the values with `helpers/browserTestParameters.js`. The original host-native
environment variables remain valid as local-authoring fallbacks.

After applying migrations/seeds and rebuilding the backend, the end-to-end registry proof is:

```powershell
npm run browser:registry:smoke
```

That proof resolves `workflow-initialization-e2e` from PostgreSQL, normalizes its registered
parameters/environment, starts the dedicated Temporal Browser Worker execution, and waits for the
Playwright result.

## Phase 5.1 interactive presentation and evidence viewing

Registered LOCAL tests can run in either **Background (Headless)** mode through the Docker Browser
Worker or **Interactive (Headed · Host)** mode through the host-native Host Agent. Interactive runs
force headed Chromium, add a small `slowMo` delay for human visibility, and on Windows use the
host-side window presenter to restore/foreground the Chromium window even though the long-running
Host Agent itself is launched hidden.

Playwright HTML reports are opened through a short-lived, report-scoped view ticket created by an
authenticated `BROWSER_TEST_READ` request. The ticket serves the report entry page and its relative
`data/*` attachments together, so screenshots and other report evidence remain visible without
placing the user's SkyCommand session bearer token in the report URL.

### Interactive presentation and viewport sizing

SkyCommand maximizes and foregrounds the Chromium window for LOCAL interactive runs. The presenter
reasserts focus briefly after the Chromium window is created so the hidden Host Agent launcher does
not leave the browser minimized or behind another window. Interactive Playwright releases the fixed
emulated viewport and uses the maximized host window's real client area.

Headless runs keep deterministic evidence dimensions. Defaults are configurable in `.env`:

```text
SKYCOMMAND_BROWSER_VIEWPORT_WIDTH=1600
SKYCOMMAND_BROWSER_VIEWPORT_HEIGHT=900
SKYCOMMAND_BROWSER_INTERACTIVE_SLOW_MO_MS=300
SKYCOMMAND_BROWSER_INTERACTIVE_HOLD_MS=4000
```

The viewport settings affect headless screenshots; interactive runs use the actual maximized browser
window. The slow-motion and hold values affect only interactive/manual execution.

