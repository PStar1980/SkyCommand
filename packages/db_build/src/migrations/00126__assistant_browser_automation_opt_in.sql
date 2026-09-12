-- Migration: 00126__assistant_browser_automation_opt_in.sql
-- Purpose: Adds an explicit per-automation opt-in boundary for the Assistant integration surface.

BEGIN;

ALTER TABLE core.browser_automations
  ADD COLUMN IF NOT EXISTS assistant_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN core.browser_automations.assistant_enabled IS
  'Explicit administrator opt-in for execution through the bounded SkyCommand Assistant integration API. Confirmation-required automations remain ineligible.';

CREATE INDEX IF NOT EXISTS idx_browser_automations_assistant_catalogue
  ON core.browser_automations (assistant_enabled, enabled, display_order, automation_code);

COMMIT;
