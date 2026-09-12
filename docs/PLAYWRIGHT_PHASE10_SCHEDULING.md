# Playwright Phase 10 — Scheduling

## Scope

Phase 10 makes the existing Scheduler a first-class launch surface for registered Playwright targets without changing the durable `worker.schedules` ownership model.

Supported target types:

- Playwright Test
- Playwright Test Suite
- Playwright Automation

All scheduled browser execution is headless and unattended. Targets that require interactive confirmation are rejected from scheduling. Suite schedules are validated member-by-member so a confirmation-required or environment-incompatible member cannot be hidden inside a scheduled suite.

## Architecture

The scheduler continues to persist a `tool_id`. Three internal worker-visible bridge tools translate the scheduled target into the existing Playwright services:

- `browser_test_schedule_start`
- `browser_test_suite_schedule_start`
- `browser_automation_schedule_start`

The Node Worker intercepts these bridge codes in `scheduledToolRunner.js`, launches the registered Playwright target through the existing API services, then waits for the durable Temporal/browser execution to reach a terminal state. This makes the scheduler run status represent the real Playwright result instead of only the launch request.

## Scheduler UI

Create / Manage Schedules now exposes five target types:

1. Tool
2. Workflow
3. Playwright Test
4. Playwright Test Suite
5. Playwright Automation

For Playwright targets the UI provides target selection, allowed environment selection, and registered runtime parameters. Confirmation-required tests and automations are excluded from the unattended target list.

## History and notifications

Scheduler Operations stores `metadata.browserTarget` containing the target identity, Playwright status, environment, execution mode, workflow/run IDs, duration, source revision, artifact count, and operations link. The Run Detail card renders this as Playwright schedule evidence.

Failed scheduler runs now create a durable `SCHEDULE_RUN_FAILED` in-app notification for the schedule owner and link to Scheduler Operations. This applies to Playwright schedules as well as existing scheduled targets.

## Database changes

- `00124__playwright_scheduler_bridges_seed.sql` registers the three internal bridge tools and their parameters.
- `00125__scheduler_failure_notifications.sql` extends notification types/source types and adds the failed-schedule-run notification trigger.

Apply the normal SkyCommand database build/promotion path so both SQL files are installed before testing the new schedule target types.

## Validation

Run:

```bash
npm run workflow-playwright-nodes:self-test
npm run playwright-scheduler:self-test
npm run validate
```

Recommended manual acceptance test:

1. Create a one-time Playwright Test Suite schedule for `skycommand-smoke` in `LOCAL`.
2. Queue it immediately (or wait for its run time).
3. Verify Scheduler Operations reaches `SUCCESS` only after the suite reaches `PASSED`.
4. Open Run Detail and verify Playwright schedule evidence and the result link.
5. Verify Test Suites shows the matching execution with trigger source `SCHEDULER`.
6. Temporarily schedule a known-safe failing fixture, if available, and confirm a `SCHEDULE_RUN_FAILED` notification appears and links back to Scheduler Operations.

Development Promotion remains independent of Playwright scheduling and browser regression execution.
