-- ============================================================
-- Migration: 00065__repository_intelligence_tool.sql
-- Purpose:
-- Renames the existing read-only Git status utility to
-- Repository Intelligence and makes it worker-visible for safe
-- scheduled diagnostics. No hash, snapshot, or runtime gate is
-- introduced; PostgreSQL remains the active tool catalogue.
-- ============================================================

BEGIN;

UPDATE core.tools
SET label = 'Repository Intelligence',
    description = 'Performs a watcher-safe checkout-free repository readiness inspection across local and remote development/main branches.',
    risk_code = 'low',
    requires_confirmation = FALSE,
    confirmation_text = NULL,
    captures_output = TRUE,
    allow_params = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE tool_code = 'git_repo_status';

INSERT INTO core.tool_visibility (tool_id, channel_code)
SELECT t.tool_id, 'worker'
FROM core.tools t
WHERE t.tool_code = 'git_repo_status'
ON CONFLICT (tool_id, channel_code) DO NOTHING;

COMMIT;
