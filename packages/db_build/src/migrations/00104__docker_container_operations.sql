-- Migration: 00104__docker_container_operations.sql
-- Phase 17.5: Docker container deep inspection, bounded logs, and guarded lifecycle controls.
-- Existing Docker read/control permissions are intentionally reused; this migration updates
-- their operator-facing descriptions so deployed databases reflect the expanded scope.

BEGIN;

UPDATE auth.permissions
SET description = 'View Docker Engine, Compose project, container, image, volume, and network inventory plus bounded container inspection and logs through the SkyCommand Host Agent.',
    updated_at = CURRENT_TIMESTAMP
WHERE permission_code = 'INFRASTRUCTURE_DOCKER_READ';

UPDATE auth.permissions
SET description = 'Control eligible discovered Docker Compose projects and external containers through allow-listed SkyCommand Host Agent lifecycle operations.',
    updated_at = CURRENT_TIMESTAMP
WHERE permission_code = 'INFRASTRUCTURE_DOCKER_CONTROL';

COMMIT;
