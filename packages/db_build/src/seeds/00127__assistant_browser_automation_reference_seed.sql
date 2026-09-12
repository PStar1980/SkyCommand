-- Seed: 00127__assistant_browser_automation_reference_seed.sql
-- Purpose: Opts the safe read-only reference automation into the Phase 11 Assistant integration surface.

BEGIN;

UPDATE core.browser_automations
SET assistant_enabled = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE automation_code = 'command-center-status-snapshot'
  AND enabled = TRUE
  AND side_effect_level = 'READ_ONLY'
  AND idempotency_mode = 'READ_ONLY'
  AND requires_confirmation = FALSE
  AND permission_code IS NOT NULL;

COMMIT;
