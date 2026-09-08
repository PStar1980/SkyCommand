# SkyCommand Browser Tests

This directory contains the native Playwright foundation for SkyCommand Browser Tests.
Operational browser automations are intentionally separate and will live under the future
`browser-automation/` source tree.

## Phase 1 scope

Phase 1 establishes a browser-test runner that is independent of the future SkyCommand Browser
Tests UI and database registry. Tests can therefore validate SkyCommand even when the browser
registry is unavailable.

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
Git. Structured SkyCommand browser-run records and per-run artifact indexing are future phases.

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
