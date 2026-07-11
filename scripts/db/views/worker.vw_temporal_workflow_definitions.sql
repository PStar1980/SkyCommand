-- View: worker.vw_temporal_workflow_definitions
-- Purpose: API-friendly workflow definition payload with parameter schema.

CREATE OR REPLACE VIEW worker.vw_temporal_workflow_definitions AS
SELECT
  d.definition_id,
  d.workflow_code,
  d.workflow_type,
  d.display_name,
  d.description,
  d.task_queue_name,
  d.task_queue_config_key,
  d.workflow_id_prefix,
  d.run_source_default,
  d.default_timeout_ms,
  d.max_timeout_ms,
  d.default_concurrency,
  d.max_concurrency,
  d.start_permission_code,
  d.cancel_permission_code,
  d.terminate_permission_code,
  d.visible_in_admin,
  d.enabled,
  d.config,
  d.created_at,
  d.updated_at,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'parameterId', p.parameter_id,
        'name', p.parameter_name,
        'label', p.label,
        'type', p.parameter_type,
        'required', p.required,
        'defaultValue', p.default_value,
        'minValue', p.min_value,
        'maxValue', p.max_value,
        'allowedValues', p.allowed_values,
        'placeholder', p.placeholder,
        'helpText', p.help_text,
        'validationRegex', p.validation_regex,
        'adminVisible', p.admin_visible,
        'startFormField', p.start_form_field,
        'displayOrder', p.display_order,
        'config', p.config
      )
      ORDER BY p.display_order, p.parameter_name
    ) FILTER (WHERE p.parameter_id IS NOT NULL),
    '[]'::jsonb
  ) AS parameters
FROM worker.temporal_workflow_definitions d
LEFT JOIN worker.temporal_workflow_parameters p
  ON p.definition_id = d.definition_id
GROUP BY d.definition_id;

ALTER VIEW worker.vw_temporal_workflow_definitions OWNER TO postgres;

COMMENT ON VIEW worker.vw_temporal_workflow_definitions IS 'Temporal workflow definitions with parameter schemas aggregated for SkyServer Core/API.';
