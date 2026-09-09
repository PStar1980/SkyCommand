# SkyCommand Dedicated Browser Worker

## Purpose

The Browser Worker is the isolated Playwright/Temporal execution service introduced by Browser Automation Phase 2. It keeps Chromium CPU/memory, browser crashes, browser dependencies, and browser-specific concurrency outside the API, Node Worker, and primary Temporal Worker.

## Runtime lane

```text
SkyCommand API / native smoke launcher
        |
        v
Temporal server
        |
        v
skycommand-browser-local task queue
        |
        v
Browser Worker
        |
        +-- Playwright 1.60.0
        +-- Chromium
        +-- Browser Test runner
```

Registered execution is now driven through the PostgreSQL Browser Test registry and SkyCommand API. The native smoke launcher remains available as a low-level infrastructure proof.

## Docker service

The Compose service is `browser-worker` and uses `docker/browser-worker.Dockerfile`.

The image is pinned to `mcr.microsoft.com/playwright:v1.60.0-noble` to match the repository's Playwright package/browser protocol version. The service uses `init: true` and `ipc: host` for Chromium process/IPC stability.

Browser test artifacts are written through the existing SkyEco workspace bind mount to:

```text
SkyCommand/artifacts/browser/tests/
```

The normal repository ZIP continues to exclude `/tests` and `/artifacts`; the canonical Git working tree must retain `tests/browser` because the Browser Worker image intentionally packages those source-controlled specs.

## Configuration

```text
SKYCOMMAND_BROWSER_TASK_QUEUE=skycommand-browser-local
SKYCOMMAND_BROWSER_DOCKER_BASE_URL=http://web:8080
SKYCOMMAND_BROWSER_EXECUTION_TIMEOUT_MS=600000
SKYCOMMAND_BROWSER_WORKER_MAX_CONCURRENT_ACTIVITIES=1
SKYCOMMAND_BROWSER_WORKER_MAX_CONCURRENT_WORKFLOW_TASKS=10
SKYCOMMAND_BROWSER_WORKER_HEARTBEAT_INTERVAL_MS=10000
SKYCOMMAND_BROWSER_WORKER_HEALTH_FRESHNESS_MS=45000
```

Browser credentials remain in the local `.env` file and are not persisted in source control.

## Commands

```powershell
npm run browser:worker:docker:up
npm run browser:worker:docker:restart
npm run browser:worker:docker:status
npm run browser:worker:docker:logs
npm run browser:worker:smoke
```

The smoke command starts `browserExecutionWorkflow` on the dedicated Temporal task queue and executes the read-only Workflow Initialization `@smoke` Playwright spec inside the Browser Worker container.

## Health and concurrency

The Browser Worker writes a short-lived heartbeat file inside its container. Docker marks the service healthy only while that heartbeat is fresh and the worker reports `ONLINE`. The Supervisor includes `browser-worker` in runtime health, and the Command Center exposes it as its own Server Status card.

Phase 2 intentionally uses:

- one concurrent browser activity;
- one Playwright worker per execution;
- zero Temporal activity retries;
- a ten-minute execution timeout.

Those defaults reduce duplicate side effects while Browser Automation semantics are still being introduced.

## Security boundary

The Phase 2 worker is currently intended for trusted SkyCommand/local E2E targets. Before general Browser Automation against untrusted external sites is enabled, the worker should receive the stronger sandbox/identity controls planned for the Browser Automation registry/security phases.

## Execution modes

Registered Playwright Tests support two execution modes:

- **HEADLESS** — the default background path through the dedicated Docker Browser Worker.
- **INTERACTIVE** — a LOCAL-only headed path routed by Temporal through the host-native SkyCommand Host Agent so Chromium can open in the signed-in desktop session.

Interactive execution still uses the same registered test definition, parameter validation, durable Browser Test ledger, structured result contract, and artifact directory. Only the execution target/presentation changes.

```text
Run Tests
   |
   +-- HEADLESS ----> browserExecutionWorkflow ----> Browser Worker ----> headless Chromium
   |
   +-- INTERACTIVE -> skyCommandHostAgentToolWorkflow -> Host Agent ----> headed Chromium
```

Interactive mode requires the Host Agent to be enabled and online and is intentionally limited to the `LOCAL` Browser Environment. Scheduled/background execution should remain headless.

### Interactive presentation and viewport sizing

SkyCommand maximizes and foregrounds the Chromium window for LOCAL interactive runs. By default,
the presenter also marks that Playwright Chromium window as Windows `TOPMOST`, keeping the visible
test above ordinary desktop applications for the lifetime of the browser process. The presenter
reasserts focus briefly after Chromium is created so the hidden Host Agent launcher does not leave
the browser minimized or behind another window. Interactive Playwright releases the fixed emulated
viewport and uses the maximized host window's real client area.

Headless runs keep deterministic evidence dimensions. Defaults are configurable in `.env`:

```text
SKYCOMMAND_BROWSER_VIEWPORT_WIDTH=1600
SKYCOMMAND_BROWSER_VIEWPORT_HEIGHT=900
SKYCOMMAND_BROWSER_INTERACTIVE_SLOW_MO_MS=300
SKYCOMMAND_BROWSER_INTERACTIVE_HOLD_MS=4000
SKYCOMMAND_BROWSER_INTERACTIVE_TOPMOST=true
```

The viewport settings affect headless screenshots; interactive runs use the actual maximized browser
window. The slow-motion, hold, and topmost settings affect only interactive/manual execution. Set
`SKYCOMMAND_BROWSER_INTERACTIVE_TOPMOST=false` if always-on-top presentation is undesirable for a
longer local browser session.


## Browser evidence

SkyCommand exposes only operator-meaningful browser evidence. Internal Playwright trace resources beneath `.playwright-artifacts-*` and `traces/resources/` are not promoted into the Browser Evidence table.

Artifacts remain protected by `BROWSER_TEST_READ`. Screenshot/video previews use an authenticated fetch plus a temporary browser object URL. Playwright HTML reports open through a short-lived report-scoped view ticket so the report and its relative `data/*` attachments render together; trace files continue to download through the authenticated artifact path.
