-- ============================================================
-- Seed: 00061__skycommand_application_brand_seed.sql
-- Purpose:
-- Applies the permanent SkyCommand product title to the existing
-- SKYSERVER_ADMIN application identity without changing its stable
-- app_code or breaking existing sessions, roles, and privileges.
-- ============================================================

BEGIN;

UPDATE core.applications
SET title = 'SkyCommand',
    description = 'Private SkyCommand workflow automation control plane and administrative web console.',
    updated_at = CURRENT_TIMESTAMP
WHERE app_code = 'SKYSERVER_ADMIN'
  AND (
    title IS DISTINCT FROM 'SkyCommand'
    OR description IS DISTINCT FROM 'Private SkyCommand workflow automation control plane and administrative web console.'
  );

COMMIT;
