-- Migration: 00079__portable_catalogue_administration.sql
-- Phase 16.2.2: Managed catalogue write permission and deferred
-- domain-alignment guardrails for administrative edits.

BEGIN;

INSERT INTO auth.permissions (
  permission_code,
  resource,
  action,
  description,
  active
)
VALUES (
  'DATA_CATALOGUE_WRITE',
  'data_catalogue',
  'write',
  'Create and update portable data domains, sources, assets, metrics, and dependencies.',
  TRUE
)
ON CONFLICT (permission_code)
DO UPDATE SET
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT role.role_id, permission.permission_id, TRUE
FROM auth.roles role
JOIN auth.permissions permission
  ON permission.permission_code = 'DATA_CATALOGUE_WRITE'
WHERE role.role_code IN ('SUPER_ADMIN', 'ADMIN')
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION data.validate_catalogue_domain_alignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invalid_count INTEGER := 0;
BEGIN
  SELECT COUNT(*)::int
  INTO invalid_count
  FROM data.asset_source_bindings binding
  JOIN data.assets asset ON asset.asset_id = binding.asset_id
  JOIN data.sources source ON source.source_id = binding.source_id
  WHERE asset.domain_id <> source.domain_id;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Portable catalogue contains % cross-domain asset/source binding(s).', invalid_count;
  END IF;

  SELECT COUNT(*)::int
  INTO invalid_count
  FROM data.metric_dependencies dependency
  JOIN data.metrics owner_metric ON owner_metric.metric_id = dependency.metric_id
  LEFT JOIN data.assets dependency_asset ON dependency_asset.asset_id = dependency.asset_id
  LEFT JOIN data.metrics dependency_metric
    ON dependency_metric.metric_id = dependency.depends_on_metric_id
  WHERE (
      dependency.asset_id IS NOT NULL
      AND dependency_asset.domain_id IS DISTINCT FROM owner_metric.domain_id
    )
    OR (
      dependency.depends_on_metric_id IS NOT NULL
      AND dependency_metric.domain_id IS DISTINCT FROM owner_metric.domain_id
    );

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Portable catalogue contains % cross-domain metric dependency/dependencies.', invalid_count;
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION data.validate_catalogue_domain_alignment() OWNER TO postgres;

DROP TRIGGER IF EXISTS data_sources_validate_catalogue_alignment ON data.sources;
CREATE CONSTRAINT TRIGGER data_sources_validate_catalogue_alignment
AFTER INSERT OR UPDATE OR DELETE ON data.sources
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION data.validate_catalogue_domain_alignment();

DROP TRIGGER IF EXISTS data_assets_validate_catalogue_alignment ON data.assets;
CREATE CONSTRAINT TRIGGER data_assets_validate_catalogue_alignment
AFTER INSERT OR UPDATE OR DELETE ON data.assets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION data.validate_catalogue_domain_alignment();

DROP TRIGGER IF EXISTS data_metrics_validate_catalogue_alignment ON data.metrics;
CREATE CONSTRAINT TRIGGER data_metrics_validate_catalogue_alignment
AFTER INSERT OR UPDATE OR DELETE ON data.metrics
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION data.validate_catalogue_domain_alignment();

COMMIT;
