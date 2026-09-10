-- Seed: 00120__browser_automation_execution_seed.sql
-- Purpose: Enables the safe Phase 7 reference Playwright Automation after execution support exists.

BEGIN;

UPDATE core.browser_automations
SET enabled = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE automation_code = 'command-center-status-snapshot'
  AND side_effect_level = 'READ_ONLY'
  AND idempotency_mode = 'READ_ONLY';

COMMIT;
