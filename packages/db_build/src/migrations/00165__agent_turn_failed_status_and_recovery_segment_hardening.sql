-- Migration: 00165__agent_turn_failed_status_and_recovery_segment_hardening.sql
-- Purpose: Allow an accepted provider Turn to persist a terminal FAILED state.
--
-- Phase 19.3A1 distinguishes submission acceptance from provider execution
-- outcome. A provider Turn may therefore be ACKNOWLEDGED and later terminate
-- FAILED. The original Phase 19.2A check constraint predates that real-provider
-- terminal state and must be expanded without rewriting historical migrations.

ALTER TABLE worker.agent_turns
  DROP CONSTRAINT IF EXISTS agent_turns_status_check;

ALTER TABLE worker.agent_turns
  ADD CONSTRAINT agent_turns_status_check
  CHECK (status IN (
    'PREPARED',
    'SUBMITTED',
    'ACKNOWLEDGED',
    'REJECTED',
    'UNKNOWN',
    'RECONCILING',
    'COMPLETED',
    'FAILED',
    'CANCELED',
    'RECOVERY_REQUIRED'
  ));

COMMENT ON CONSTRAINT agent_turns_status_check ON worker.agent_turns IS
  'Provider-neutral Agent Turn lifecycle; FAILED is a terminal execution result after accepted submission and is distinct from REJECTED-before-acceptance.';
