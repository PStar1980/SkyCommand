const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const XLSX = require('xlsx');
const {
  getWorkflowRuntimeParameterDefinitions,
} = require('../../core/src/workflowCliRuntimeParameters');
const { resolveScheduledTarget } = require('../../core/src/scheduleTargetResolution');

const {
  REDACTED,
  isSecretSensitiveKey,
  nullableText,
  safeJsonValue,
  safeObjectKeys,
  safeParameterDefault,
  safeParameterKeys,
  safeRepositoryRelativePath,
  safeUrl,
} = require('./redaction');

const CATALOGUE_SCHEMA_VERSION = 'capability_catalog.v1';
const SOURCE_DATA_CLASSIFICATION = 'LIVE_RUNTIME_DATABASE_SNAPSHOT';
const TOOL_RESULT_OUTPUT_TYPE = 'capability_catalog_summary.v1';
const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const GENERATED_ROOT = path.join(REPOSITORY_ROOT, 'docs', 'generated');

const QUERIES = Object.freeze({
  database: `
    SELECT
      current_database() AS database_name,
      current_setting('server_version') AS server_version,
      inet_server_port() AS server_port
  `,
  applications: `
    SELECT app_id, app_code, title, manifest_version, description, active
    FROM core.applications
    ORDER BY app_code, app_id
  `,
  configProfiles: `
    SELECT profile_id, profile_code, profile_name, description, active
    FROM core.config_profiles
    ORDER BY profile_code, profile_id
  `,
  visibilityChannels: `
    SELECT channel_code, channel_name, description, active
    FROM core.visibility_channels
    ORDER BY channel_code
  `,
  runtimes: `
    SELECT runtime_code, runtime_name, executable, description, active
    FROM core.runtimes
    ORDER BY runtime_code
  `,
  riskLevels: `
    SELECT risk_code, risk_name, risk_rank, description, active
    FROM core.risk_levels
    ORDER BY risk_rank, risk_code
  `,
  paramTypes: `
    SELECT param_type_code, param_type_name, description, active
    FROM core.param_types
    ORDER BY param_type_code
  `,
  optionSources: `
    SELECT option_source_code, option_source_name, description, active
    FROM core.option_sources
    ORDER BY option_source_code
  `,
  toolCategories: `
    SELECT category_id, app_id, category_code, name, label, description, display_order, enabled, category_kind_code
    FROM core.tool_categories
    ORDER BY display_order, category_code, category_id
  `,
  categoryVisibility: `
    SELECT category_id, channel_code
    FROM core.tool_category_visibility
    ORDER BY category_id, channel_code
  `,
  tools: `
    SELECT
      t.tool_id, t.category_id, t.tool_code, t.name, t.label, t.description,
      t.script_repo_id, t.script_path, t.runtime_code, t.permission_code,
      t.risk_code, t.requires_confirmation, t.confirmation_text, t.captures_output,
      t.allow_params, t.display_order, t.enabled, t.output_type, t.output_schema_path,
      t.managed_by_skycommand, t.registered_at, t.file_hash,
      c.category_code, c.label AS category_label, c.category_kind_code,
      r.repo_code AS script_repo_code, r.repo_name AS script_repo_name,
      rt.runtime_name, risk.risk_name, risk.risk_rank
    FROM core.tools t
    JOIN core.tool_categories c ON c.category_id = t.category_id
    LEFT JOIN core.repositories r ON r.repo_id = t.script_repo_id
    LEFT JOIN core.runtimes rt ON rt.runtime_code = t.runtime_code
    LEFT JOIN core.risk_levels risk ON risk.risk_code = t.risk_code
    ORDER BY t.display_order, t.tool_code, t.tool_id
  `,
  toolParameters: `
    SELECT
      p.parameter_id, p.tool_id, t.tool_code, p.parameter_name, p.label,
      p.param_type_code, p.prompt, p.required, p.default_value, p.option_source_code,
      p.display_order, p.enabled, p.argument_mode, p.cli_flag
    FROM core.tool_parameters p
    JOIN core.tools t ON t.tool_id = p.tool_id
    ORDER BY t.tool_code, p.display_order, p.parameter_name, p.parameter_id
  `,
  toolOptions: `
    SELECT
      o.option_id, o.parameter_id, p.parameter_name, t.tool_code,
      o.option_label, o.option_value, o.display_order, o.enabled
    FROM core.tool_parameter_options o
    JOIN core.tool_parameters p ON p.parameter_id = o.parameter_id
    JOIN core.tools t ON t.tool_id = p.tool_id
    ORDER BY t.tool_code, p.parameter_name, o.display_order, o.option_value, o.option_id
  `,
  toolVisibility: `
    SELECT v.tool_id, t.tool_code, v.channel_code
    FROM core.tool_visibility v
    JOIN core.tools t ON t.tool_id = v.tool_id
    ORDER BY t.tool_code, v.channel_code
  `,
  repositories: `
    SELECT repo_id, repo_code, repo_name, description, main_branch, dev_branch, active, is_skycommand_repository
    FROM core.repositories
    ORDER BY display_order, repo_code, repo_id
  `,
  browserEnvironments: `
    SELECT environment_code, environment_name, description, base_url, display_order, enabled
    FROM core.browser_environments
    ORDER BY display_order, environment_code
  `,
  testCategories: `
    SELECT category_id, category_code, name, label, description, display_order, enabled
    FROM core.browser_test_categories
    ORDER BY display_order, category_code, category_id
  `,
  browserTests: `
    SELECT
      t.test_id, t.category_id, t.test_code, t.name, t.label, t.description,
      t.script_repo_id, t.script_path, t.browser_type, t.default_environment_code,
      t.timeout_seconds, t.retry_count, t.grep_pattern, t.permission_code,
      t.risk_code, t.requires_confirmation, t.confirmation_text, t.display_order,
      t.enabled, t.managed_by_skycommand, c.category_code, c.label AS category_label,
      r.repo_code AS script_repo_code, r.repo_name AS script_repo_name,
      risk.risk_name
    FROM core.browser_tests t
    JOIN core.browser_test_categories c ON c.category_id = t.category_id
    LEFT JOIN core.repositories r ON r.repo_id = t.script_repo_id
    LEFT JOIN core.risk_levels risk ON risk.risk_code = t.risk_code
    ORDER BY t.display_order, t.test_code, t.test_id
  `,
  testEnvironments: `
    SELECT e.test_id, t.test_code, e.environment_code
    FROM core.browser_test_environments e
    JOIN core.browser_tests t ON t.test_id = e.test_id
    ORDER BY t.test_code, e.environment_code
  `,
  testParameters: `
    SELECT
      p.parameter_id, p.test_id, t.test_code, p.parameter_name, p.label,
      p.param_type_code, p.prompt, p.required, p.default_value, p.option_source_code,
      p.display_order, p.enabled
    FROM core.browser_test_parameters p
    JOIN core.browser_tests t ON t.test_id = p.test_id
    ORDER BY t.test_code, p.display_order, p.parameter_name, p.parameter_id
  `,
  testOptions: `
    SELECT
      o.option_id, o.parameter_id, p.parameter_name, t.test_code,
      o.option_label, o.option_value, o.display_order, o.enabled
    FROM core.browser_test_parameter_options o
    JOIN core.browser_test_parameters p ON p.parameter_id = o.parameter_id
    JOIN core.browser_tests t ON t.test_id = p.test_id
    ORDER BY t.test_code, p.parameter_name, o.display_order, o.option_value, o.option_id
  `,
  testSuites: `
    SELECT
      suite_id, suite_code, name, label, description, default_environment_code,
      execution_mode, stop_on_failure, permission_code, display_order, enabled,
      managed_by_skycommand
    FROM core.browser_test_suites
    ORDER BY display_order, suite_code, suite_id
  `,
  suiteMembers: `
    SELECT
      m.suite_member_id, m.suite_id, m.test_id, t.test_code, m.environment_code,
      m.parameter_overrides, m.display_order, m.enabled
    FROM core.browser_test_suite_members m
    JOIN core.browser_tests t ON t.test_id = m.test_id
    ORDER BY m.suite_id, m.display_order, t.test_code, m.suite_member_id
  `,
  workflowCategories: `
    SELECT workflow_category_id, category_code, display_name, description, display_order, enabled
    FROM worker.workflow_categories
    ORDER BY display_order, category_code, workflow_category_id
  `,
  workflows: `
    SELECT
      workflow_definition_id, workflow_code, display_name, description, status,
      visible_in_admin, enabled, start_permission_code, cancel_permission_code,
      version_count, latest_version_number, published_version_number,
      latest_version_id, published_version_id, latest_node_count, latest_edge_count,
      published_node_count, published_edge_count, category_code,
      category_display_name, category_description, category_display_order, category_enabled,
      config
    FROM worker.vw_workflow_definitions
    ORDER BY category_display_order, category_code, workflow_code, workflow_definition_id
  `,
  workflowVersions: `
    SELECT
      v.workflow_version_id, v.workflow_definition_id, d.workflow_code,
      v.version_number, v.version_label, v.status, v.graph_version,
      v.published_at, n.node_count, e.edge_count
    FROM worker.workflow_versions v
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    LEFT JOIN (
      SELECT workflow_version_id, COUNT(*)::INTEGER AS node_count
      FROM worker.workflow_nodes
      GROUP BY workflow_version_id
    ) n ON n.workflow_version_id = v.workflow_version_id
    LEFT JOIN (
      SELECT workflow_version_id, COUNT(*)::INTEGER AS edge_count
      FROM worker.workflow_edges
      GROUP BY workflow_version_id
    ) e ON e.workflow_version_id = v.workflow_version_id
    ORDER BY d.workflow_code, v.version_number, v.workflow_version_id
  `,
  workflowNodes: `
    SELECT
      n.workflow_node_id, n.workflow_version_id, d.workflow_code,
      v.version_number, v.status AS version_status, n.node_key, n.node_type_code,
      n.display_name, n.description, n.target_code, n.target_ref_id,
      n.timeout_ms, n.display_order, n.enabled,
      n.target_config, n.input_parameters, n.retry_policy, n.config
    FROM worker.workflow_nodes n
    JOIN worker.workflow_versions v ON v.workflow_version_id = n.workflow_version_id
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    ORDER BY d.workflow_code, v.version_number, n.display_order, n.node_key, n.workflow_node_id
  `,
  workflowEdges: `
    SELECT
      e.workflow_edge_id, e.workflow_version_id, d.workflow_code,
      v.version_number, v.status AS version_status, e.edge_key,
      e.from_node_id, e.to_node_id, e.edge_type,
      (e.condition_expression IS NOT NULL AND btrim(e.condition_expression) <> '') AS condition_configured,
      e.display_order
    FROM worker.workflow_edges e
    JOIN worker.workflow_versions v ON v.workflow_version_id = e.workflow_version_id
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    ORDER BY d.workflow_code, v.version_number, e.display_order, e.edge_key, e.workflow_edge_id
  `,
  temporalWorkflows: `
    SELECT
      definition_id, workflow_code, workflow_type, display_name, description,
      task_queue_name, workflow_id_prefix, run_source_default, default_timeout_ms,
      max_timeout_ms, default_concurrency, max_concurrency, start_permission_code,
      cancel_permission_code, terminate_permission_code, visible_in_admin, enabled, config
    FROM worker.temporal_workflow_definitions
    ORDER BY workflow_code, definition_id
  `,
  temporalWorkflowParameters: `
    SELECT
      p.parameter_id, p.definition_id, d.workflow_code, p.parameter_name, p.label,
      p.parameter_type, p.required, p.default_value, p.min_value, p.max_value,
      p.allowed_values, p.placeholder, p.help_text, p.validation_regex,
      p.admin_visible, p.start_form_field, p.display_order
    FROM worker.temporal_workflow_parameters p
    JOIN worker.temporal_workflow_definitions d ON d.definition_id = p.definition_id
    ORDER BY d.workflow_code, p.display_order, p.parameter_name, p.parameter_id
  `,
  automationCategories: `
    SELECT category_id, category_code, name, label, description, display_order, enabled
    FROM core.browser_automation_categories
    ORDER BY display_order, category_code, category_id
  `,
  browserAutomations: `
    SELECT
      a.automation_id, a.category_id, a.automation_code, a.name, a.label,
      a.description, a.script_repo_id, a.script_path, a.browser_type,
      a.default_environment_code, a.timeout_seconds, a.retry_count, a.max_concurrency,
      a.permission_code, a.risk_code, a.requires_confirmation, a.confirmation_text,
      a.side_effect_level, a.idempotency_mode, a.output_type, a.output_schema_path,
      a.display_order, a.enabled, a.managed_by_skycommand, a.assistant_enabled,
      c.category_code, c.label AS category_label, r.repo_code AS script_repo_code,
      r.repo_name AS script_repo_name, risk.risk_name
    FROM core.browser_automations a
    JOIN core.browser_automation_categories c ON c.category_id = a.category_id
    LEFT JOIN core.repositories r ON r.repo_id = a.script_repo_id
    LEFT JOIN core.risk_levels risk ON risk.risk_code = a.risk_code
    ORDER BY a.display_order, a.automation_code, a.automation_id
  `,
  automationEnvironments: `
    SELECT e.automation_id, a.automation_code, e.environment_code
    FROM core.browser_automation_environments e
    JOIN core.browser_automations a ON a.automation_id = e.automation_id
    ORDER BY a.automation_code, e.environment_code
  `,
  automationParameters: `
    SELECT
      p.parameter_id, p.automation_id, a.automation_code, p.parameter_name,
      p.label, p.param_type_code, p.prompt, p.required, p.default_value,
      p.option_source_code, p.display_order, p.enabled
    FROM core.browser_automation_parameters p
    JOIN core.browser_automations a ON a.automation_id = p.automation_id
    ORDER BY a.automation_code, p.display_order, p.parameter_name, p.parameter_id
  `,
  automationOptions: `
    SELECT
      o.option_id, o.parameter_id, p.parameter_name, a.automation_code,
      o.option_label, o.option_value, o.display_order, o.enabled
    FROM core.browser_automation_parameter_options o
    JOIN core.browser_automation_parameters p ON p.parameter_id = o.parameter_id
    JOIN core.browser_automations a ON a.automation_id = p.automation_id
    ORDER BY a.automation_code, p.parameter_name, o.display_order, o.option_value, o.option_id
  `,
  schedules: `
    SELECT
      s.schedule_id, s.schedule_code, s.schedule_name, s.description,
      s.schedule_type, s.timezone, s.run_at, s.interval_value, s.interval_unit,
      s.cron_expression, s.enabled, s.max_concurrent_runs, s.misfire_policy,
      s.next_run_at, s.last_run_at, s.last_status, s.profile_id,
      p.profile_code, t.tool_code, t.label AS tool_label, s.parameters
    FROM worker.schedules s
    JOIN core.tools t ON t.tool_id = s.tool_id
    LEFT JOIN core.config_profiles p ON p.profile_id = s.profile_id
    ORDER BY s.schedule_code, s.schedule_id
  `,
  permissions: `
    SELECT p.permission_id, p.permission_code, p.resource, p.action, p.description,
      p.active, a.app_code, a.title AS app_title
    FROM auth.permissions p
    LEFT JOIN core.applications a ON a.app_id = p.app_id
    ORDER BY p.permission_code, p.permission_id
  `,
  roles: `
    SELECT r.role_id, r.role_code, r.role_name, r.description,
      r.is_system_role, r.active, a.app_code, a.title AS app_title
    FROM auth.roles r
    LEFT JOIN core.applications a ON a.app_id = r.app_id
    ORDER BY r.role_code, r.role_id
  `,
  rolePermissions: `
    SELECT
      rp.role_id, r.role_code, rp.permission_id, p.permission_code,
      rp.active
    FROM auth.role_permissions rp
    JOIN auth.roles r ON r.role_id = rp.role_id
    JOIN auth.permissions p ON p.permission_id = rp.permission_id
    ORDER BY r.role_code, p.permission_code, rp.role_id, rp.permission_id
  `,
});

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function toInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sortBy(rows, ...keys) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const l = String(left[key] ?? '');
      const r = String(right[key] ?? '');
      const comparison = l.localeCompare(r);
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

function mapSimple(row, fields) {
  return Object.fromEntries(
    fields.map(([output, input, transform]) => [
      output,
      transform ? transform(row[input], row) : (row[input] ?? null),
    ]),
  );
}

function mapParameter(row, ownerKey) {
  return {
    parameterId: row.parameter_id,
    [ownerKey]:
      row[
        ownerKey === 'toolCode'
          ? 'tool_code'
          : ownerKey === 'testCode'
            ? 'test_code'
            : 'automation_code'
      ] || null,
    parameterName: nullableText(row.parameter_name),
    label: nullableText(row.label),
    type: nullableText(row.param_type_code),
    prompt: nullableText(row.prompt),
    required: toBoolean(row.required),
    defaultValue: safeParameterDefault(row.parameter_name, row.default_value),
    optionSource: nullableText(row.option_source_code),
    displayOrder: toInteger(row.display_order),
    enabled: toBoolean(row.enabled),
    ...(row.argument_mode !== undefined
      ? { argumentMode: nullableText(row.argument_mode), cliFlag: nullableText(row.cli_flag) }
      : {}),
  };
}

function mapOption(row, ownerKey) {
  const parameterName = row.parameter_name;
  return {
    optionId: row.option_id,
    [ownerKey]:
      row[
        ownerKey === 'toolCode'
          ? 'tool_code'
          : ownerKey === 'testCode'
            ? 'test_code'
            : 'automation_code'
      ] || null,
    parameterId: row.parameter_id,
    parameterName: nullableText(parameterName),
    optionLabel: isSecretSensitiveKey(parameterName) ? REDACTED : nullableText(row.option_label),
    optionValue: isSecretSensitiveKey(parameterName) ? REDACTED : safeJsonValue(row.option_value),
    displayOrder: toInteger(row.display_order),
    enabled: toBoolean(row.enabled),
  };
}

function summarizeObject(value) {
  return safeObjectKeys(value);
}

function mapWorkflowRuntimeParameters(rows) {
  return rows.flatMap((row) =>
    getWorkflowRuntimeParameterDefinitions(row.config || {}).map((parameter) => ({
      parameterId: null,
      definitionId: row.workflow_definition_id,
      workflowCode: row.workflow_code,
      parameterName: parameter.key,
      label: parameter.label,
      type: parameter.type,
      required: parameter.required,
      defaultValue: safeParameterDefault(parameter.key, parameter.defaultValue),
      minValue: null,
      maxValue: null,
      allowedValues: isSecretSensitiveKey(parameter.key)
        ? REDACTED
        : safeJsonValue(parameter.options),
      placeholder: null,
      helpText: parameter.description || null,
      validationRegex: null,
      adminVisible: null,
      startFormField: null,
      displayOrder: toInteger(parameter.displayOrder),
    })),
  );
}

function mapRows(rows) {
  const toolParameters = rows.toolParameters.map((row) => mapParameter(row, 'toolCode'));
  const testParameters = rows.testParameters.map((row) => mapParameter(row, 'testCode'));
  const automationParameters = rows.automationParameters.map((row) =>
    mapParameter(row, 'automationCode'),
  );
  const resources = {
    applications: rows.applications.map((r) =>
      mapSimple(r, [
        ['applicationId', 'app_id'],
        ['code', 'app_code'],
        ['title', 'title'],
        ['manifestVersion', 'manifest_version'],
        ['description', 'description'],
        ['active', 'active', toBoolean],
      ]),
    ),
    configProfiles: rows.configProfiles.map((r) =>
      mapSimple(r, [
        ['profileId', 'profile_id'],
        ['code', 'profile_code'],
        ['name', 'profile_name'],
        ['description', 'description'],
        ['active', 'active', toBoolean],
      ]),
    ),
    visibilityChannels: rows.visibilityChannels.map((r) =>
      mapSimple(r, [
        ['code', 'channel_code'],
        ['name', 'channel_name'],
        ['description', 'description'],
        ['active', 'active', toBoolean],
      ]),
    ),
    runtimes: rows.runtimes.map((r) =>
      mapSimple(r, [
        ['code', 'runtime_code'],
        ['name', 'runtime_name'],
        ['executable', 'executable'],
        ['description', 'description'],
        ['active', 'active', toBoolean],
      ]),
    ),
    riskLevels: rows.riskLevels.map((r) =>
      mapSimple(r, [
        ['code', 'risk_code'],
        ['name', 'risk_name'],
        ['rank', 'risk_rank', toInteger],
        ['description', 'description'],
        ['active', 'active', toBoolean],
      ]),
    ),
    parameterTypes: rows.paramTypes.map((r) =>
      mapSimple(r, [
        ['code', 'param_type_code'],
        ['name', 'param_type_name'],
        ['description', 'description'],
        ['active', 'active', toBoolean],
      ]),
    ),
    optionSources: rows.optionSources.map((r) =>
      mapSimple(r, [
        ['code', 'option_source_code'],
        ['name', 'option_source_name'],
        ['description', 'description'],
        ['active', 'active', toBoolean],
      ]),
    ),
    toolCategories: rows.toolCategories.map((r) => ({
      categoryId: r.category_id,
      applicationId: r.app_id,
      code: r.category_code,
      name: r.name,
      label: r.label,
      description: r.description || null,
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
      kind: r.category_kind_code || null,
    })),
    categoryVisibility: rows.categoryVisibility.map((r) => ({
      categoryId: r.category_id,
      channelCode: r.channel_code,
    })),
    tools: rows.tools.map((r) => ({
      toolId: r.tool_id,
      categoryId: r.category_id,
      code: r.tool_code,
      name: r.name,
      label: r.label,
      description: r.description || null,
      scriptRepositoryId: r.script_repo_id,
      scriptRepositoryCode: r.script_repo_code || null,
      scriptRepositoryName: r.script_repo_name || null,
      scriptPath: safeRepositoryRelativePath(r.script_path),
      runtime: r.runtime_code || null,
      runtimeName: r.runtime_name || null,
      permission: r.permission_code || null,
      risk: r.risk_code || null,
      riskName: r.risk_name || null,
      riskRank: toInteger(r.risk_rank),
      requiresConfirmation: toBoolean(r.requires_confirmation),
      confirmationText: r.confirmation_text || null,
      capturesOutput: toBoolean(r.captures_output),
      allowsParameters: toBoolean(r.allow_params),
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
      outputType: r.output_type || null,
      outputSchemaPath: safeRepositoryRelativePath(r.output_schema_path),
      managedBySkyCommand: toBoolean(r.managed_by_skycommand),
      registeredAt: toIso(r.registered_at),
      fileHash: /^[a-f0-9]{64}$/i.test(String(r.file_hash || ''))
        ? String(r.file_hash).toLowerCase()
        : null,
      categoryCode: r.category_code || null,
      categoryLabel: r.category_label || null,
      categoryKind: r.category_kind_code || null,
    })),
    toolParameters,
    toolOptions: rows.toolOptions.map((r) => mapOption(r, 'toolCode')),
    toolVisibility: rows.toolVisibility.map((r) => ({
      toolId: r.tool_id,
      toolCode: r.tool_code,
      channelCode: r.channel_code,
    })),
    repositories: rows.repositories.map((r) => ({
      repositoryId: r.repo_id,
      code: r.repo_code,
      name: r.repo_name,
      description: r.description || null,
      mainBranch: r.main_branch || null,
      developmentBranch: r.dev_branch || null,
      status: toBoolean(r.active) ? 'ACTIVE' : 'INACTIVE',
      active: toBoolean(r.active),
      isSkyCommandRepository: toBoolean(r.is_skycommand_repository),
    })),
    browserEnvironments: rows.browserEnvironments.map((r) => ({
      code: r.environment_code,
      name: r.environment_name,
      description: r.description || null,
      baseUrl: safeUrl(r.base_url),
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
    })),
    testCategories: rows.testCategories.map((r) => ({
      categoryId: r.category_id,
      code: r.category_code,
      name: r.name,
      label: r.label,
      description: r.description || null,
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
    })),
    browserTests: rows.browserTests.map((r) => ({
      testId: r.test_id,
      categoryId: r.category_id,
      code: r.test_code,
      name: r.name,
      label: r.label,
      description: r.description || null,
      scriptRepositoryId: r.script_repo_id,
      scriptRepositoryCode: r.script_repo_code || null,
      scriptRepositoryName: r.script_repo_name || null,
      scriptPath: safeRepositoryRelativePath(r.script_path),
      browser: r.browser_type || null,
      defaultEnvironment: r.default_environment_code || null,
      timeoutSeconds: toInteger(r.timeout_seconds),
      retryCount: toInteger(r.retry_count),
      grepPattern: r.grep_pattern || null,
      permission: r.permission_code || null,
      risk: r.risk_code || null,
      riskName: r.risk_name || null,
      requiresConfirmation: toBoolean(r.requires_confirmation),
      confirmationText: r.confirmation_text || null,
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
      managedBySkyCommand: toBoolean(r.managed_by_skycommand),
      categoryCode: r.category_code || null,
      categoryLabel: r.category_label || null,
    })),
    testEnvironments: rows.testEnvironments.map((r) => ({
      testId: r.test_id,
      testCode: r.test_code,
      environmentCode: r.environment_code,
    })),
    testParameters,
    testOptions: rows.testOptions.map((r) => mapOption(r, 'testCode')),
    testSuites: rows.testSuites.map((r) => ({
      suiteId: r.suite_id,
      code: r.suite_code,
      name: r.name,
      label: r.label,
      description: r.description || null,
      defaultEnvironment: r.default_environment_code || null,
      executionMode: r.execution_mode || null,
      stopOnFailure: toBoolean(r.stop_on_failure),
      permission: r.permission_code || null,
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
      managedBySkyCommand: toBoolean(r.managed_by_skycommand),
    })),
    suiteMembers: rows.suiteMembers.map((r) => ({
      suiteMemberId: r.suite_member_id,
      suiteId: r.suite_id,
      testId: r.test_id,
      testCode: r.test_code,
      environmentCode: r.environment_code || null,
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
      parameterKeys: safeParameterKeys(r.parameter_overrides),
    })),
    workflowCategories: rows.workflowCategories.map((r) => ({
      categoryId: r.workflow_category_id,
      code: r.category_code,
      name: r.display_name,
      description: r.description || null,
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
    })),
    workflows: rows.workflows.map((r) => ({
      workflowId: r.workflow_definition_id,
      code: r.workflow_code,
      name: r.display_name,
      description: r.description || null,
      status: r.status,
      visibleInAdmin: toBoolean(r.visible_in_admin),
      enabled: toBoolean(r.enabled),
      startPermission: r.start_permission_code || null,
      cancelPermission: r.cancel_permission_code || null,
      versionCount: toInteger(r.version_count),
      latestVersionNumber: toInteger(r.latest_version_number),
      publishedVersionNumber: toInteger(r.published_version_number),
      latestVersionId: r.latest_version_id || null,
      publishedVersionId: r.published_version_id || null,
      latestNodeCount: toInteger(r.latest_node_count),
      latestEdgeCount: toInteger(r.latest_edge_count),
      publishedNodeCount: toInteger(r.published_node_count),
      publishedEdgeCount: toInteger(r.published_edge_count),
      categoryCode: r.category_code || null,
      categoryName: r.category_display_name || null,
      categoryDescription: r.category_description || null,
      categoryEnabled: toBoolean(r.category_enabled),
    })),
    workflowVersions: rows.workflowVersions.map((r) => ({
      versionId: r.workflow_version_id,
      workflowId: r.workflow_definition_id,
      workflowCode: r.workflow_code,
      versionNumber: toInteger(r.version_number),
      versionLabel: r.version_label || null,
      status: r.status,
      graphVersion: r.graph_version || null,
      publishedAt: toIso(r.published_at),
      nodeCount: toInteger(r.node_count) || 0,
      edgeCount: toInteger(r.edge_count) || 0,
    })),
    workflowNodes: rows.workflowNodes.map((r) => ({
      nodeId: r.workflow_node_id,
      versionId: r.workflow_version_id,
      workflowCode: r.workflow_code,
      versionNumber: toInteger(r.version_number),
      versionStatus: r.version_status,
      nodeKey: r.node_key,
      nodeType: r.node_type_code,
      displayName: r.display_name,
      description: r.description || null,
      targetCode: r.target_code || null,
      targetReferenceId: r.target_ref_id || null,
      timeoutMs: toInteger(r.timeout_ms),
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
      targetConfigKeys: summarizeObject(r.target_config),
      inputParameterKeys: safeParameterKeys(r.input_parameters),
      retryPolicyKeys: summarizeObject(r.retry_policy),
      configKeys: summarizeObject(r.config),
    })),
    workflowEdges: rows.workflowEdges.map((r) => ({
      edgeId: r.workflow_edge_id,
      versionId: r.workflow_version_id,
      workflowCode: r.workflow_code,
      versionNumber: toInteger(r.version_number),
      versionStatus: r.version_status,
      edgeKey: r.edge_key || null,
      fromNodeId: r.from_node_id,
      toNodeId: r.to_node_id,
      edgeType: r.edge_type,
      conditionConfigured: toBoolean(r.condition_configured),
      displayOrder: toInteger(r.display_order),
    })),
    temporalWorkflows: rows.temporalWorkflows.map((r) => ({
      definitionId: r.definition_id,
      code: r.workflow_code,
      workflowType: r.workflow_type,
      name: r.display_name,
      description: r.description || null,
      taskQueue: r.task_queue_name || null,
      workflowIdPrefix: r.workflow_id_prefix || null,
      runSourceDefault: r.run_source_default || null,
      defaultTimeoutMs: toInteger(r.default_timeout_ms),
      maxTimeoutMs: toInteger(r.max_timeout_ms),
      defaultConcurrency: toInteger(r.default_concurrency),
      maxConcurrency: toInteger(r.max_concurrency),
      startPermission: r.start_permission_code || null,
      cancelPermission: r.cancel_permission_code || null,
      terminatePermission: r.terminate_permission_code || null,
      visibleInAdmin: toBoolean(r.visible_in_admin),
      enabled: toBoolean(r.enabled),
      configKeys: summarizeObject(r.config),
    })),
    temporalWorkflowParameters: rows.temporalWorkflowParameters.map((r) => ({
      parameterId: r.parameter_id,
      definitionId: r.definition_id,
      workflowCode: r.workflow_code,
      parameterName: r.parameter_name,
      label: r.label,
      type: r.parameter_type,
      required: toBoolean(r.required),
      defaultValue: safeParameterDefault(r.parameter_name, r.default_value),
      minValue: toInteger(r.min_value),
      maxValue: toInteger(r.max_value),
      allowedValues: isSecretSensitiveKey(r.parameter_name)
        ? REDACTED
        : safeJsonValue(r.allowed_values),
      placeholder: r.placeholder || null,
      helpText: r.help_text || null,
      validationRegex: r.validation_regex || null,
      adminVisible: toBoolean(r.admin_visible),
      startFormField: toBoolean(r.start_form_field),
      displayOrder: toInteger(r.display_order),
    })),
    automationCategories: rows.automationCategories.map((r) => ({
      categoryId: r.category_id,
      code: r.category_code,
      name: r.name,
      label: r.label,
      description: r.description || null,
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
    })),
    browserAutomations: rows.browserAutomations.map((r) => ({
      automationId: r.automation_id,
      categoryId: r.category_id,
      code: r.automation_code,
      name: r.name,
      label: r.label,
      description: r.description || null,
      scriptRepositoryId: r.script_repo_id,
      scriptRepositoryCode: r.script_repo_code || null,
      scriptRepositoryName: r.script_repo_name || null,
      scriptPath: safeRepositoryRelativePath(r.script_path),
      browser: r.browser_type || null,
      defaultEnvironment: r.default_environment_code || null,
      timeoutSeconds: toInteger(r.timeout_seconds),
      retryCount: toInteger(r.retry_count),
      maxConcurrency: toInteger(r.max_concurrency),
      permission: r.permission_code || null,
      risk: r.risk_code || null,
      riskName: r.risk_name || null,
      requiresConfirmation: toBoolean(r.requires_confirmation),
      confirmationText: r.confirmation_text || null,
      sideEffects: r.side_effect_level || null,
      idempotency: r.idempotency_mode || null,
      outputType: r.output_type || null,
      outputSchemaPath: safeRepositoryRelativePath(r.output_schema_path),
      displayOrder: toInteger(r.display_order),
      enabled: toBoolean(r.enabled),
      managedBySkyCommand: toBoolean(r.managed_by_skycommand),
      assistantEnabled: toBoolean(r.assistant_enabled),
      categoryCode: r.category_code || null,
      categoryLabel: r.category_label || null,
    })),
    automationEnvironments: rows.automationEnvironments.map((r) => ({
      automationId: r.automation_id,
      automationCode: r.automation_code,
      environmentCode: r.environment_code,
    })),
    automationParameters,
    automationOptions: rows.automationOptions.map((r) => mapOption(r, 'automationCode')),
    schedules: [],
    permissions: rows.permissions.map((r) => ({
      permissionId: r.permission_id,
      code: r.permission_code,
      resource: r.resource,
      action: r.action,
      description: r.description || null,
      active: toBoolean(r.active),
      applicationCode: r.app_code || null,
      applicationTitle: r.app_title || null,
    })),
    roles: rows.roles.map((r) => ({
      roleId: r.role_id,
      code: r.role_code,
      name: r.role_name,
      description: r.description || null,
      systemRole: toBoolean(r.is_system_role),
      active: toBoolean(r.active),
      applicationCode: r.app_code || null,
      applicationTitle: r.app_title || null,
    })),
    rolePermissions: rows.rolePermissions.map((r) => ({
      roleId: r.role_id,
      roleCode: r.role_code,
      permissionId: r.permission_id,
      permissionCode: r.permission_code,
      active: toBoolean(r.active),
    })),
  };

  resources.workflowParameters = mapWorkflowRuntimeParameters(rows.workflows);
  resources.schedules = rows.schedules.map((r) => {
    const resolvedTarget = resolveScheduledTarget({
      toolCode: r.tool_code,
      parameters: r.parameters,
      toolName: r.tool_label,
      catalogues: {
        tools: resources.tools,
        workflows: resources.workflows,
        browserTests: resources.browserTests,
        testSuites: resources.testSuites,
        browserAutomations: resources.browserAutomations,
      },
    });
    return {
      scheduleId: r.schedule_id,
      code: r.schedule_code,
      name: r.schedule_name,
      description: r.description || null,
      targetType: resolvedTarget.targetType,
      targetCode: resolvedTarget.targetCode,
      targetName: resolvedTarget.targetName,
      targetParameterName: resolvedTarget.targetParameterName,
      targetResolution: resolvedTarget.targetResolution,
      profileCode: r.profile_code || null,
      timingType: r.schedule_type,
      timezone: r.timezone || null,
      runAt: toIso(r.run_at),
      intervalValue: toInteger(r.interval_value),
      intervalUnit: r.interval_unit || null,
      cronExpression: r.cron_expression || null,
      enabled: toBoolean(r.enabled),
      status: r.last_status || null,
      maxConcurrentRuns: toInteger(r.max_concurrent_runs),
      misfirePolicy: r.misfire_policy || null,
      nextRunAt: toIso(r.next_run_at),
      lastRunAt: toIso(r.last_run_at),
      parameterKeys: safeParameterKeys(r.parameters),
    };
  });

  Object.keys(resources).forEach((key) => {
    resources[key] = sortBy(resources[key], ...SORT_KEYS[key]);
  });

  return resources;
}

const SORT_KEYS = {
  applications: ['code', 'applicationId'],
  configProfiles: ['code', 'profileId'],
  visibilityChannels: ['code'],
  runtimes: ['code'],
  riskLevels: ['rank', 'code'],
  parameterTypes: ['code'],
  optionSources: ['code'],
  toolCategories: ['displayOrder', 'code', 'categoryId'],
  categoryVisibility: ['categoryId', 'channelCode'],
  tools: ['displayOrder', 'code', 'toolId'],
  toolParameters: ['toolCode', 'displayOrder', 'parameterName', 'parameterId'],
  toolOptions: ['toolCode', 'parameterName', 'displayOrder', 'optionValue', 'optionId'],
  toolVisibility: ['toolCode', 'channelCode'],
  repositories: ['code', 'repositoryId'],
  browserEnvironments: ['displayOrder', 'code'],
  testCategories: ['displayOrder', 'code', 'categoryId'],
  browserTests: ['displayOrder', 'code', 'testId'],
  testEnvironments: ['testCode', 'environmentCode'],
  testParameters: ['testCode', 'displayOrder', 'parameterName', 'parameterId'],
  testOptions: ['testCode', 'parameterName', 'displayOrder', 'optionValue', 'optionId'],
  testSuites: ['displayOrder', 'code', 'suiteId'],
  suiteMembers: ['suiteId', 'displayOrder', 'testCode', 'suiteMemberId'],
  workflowCategories: ['displayOrder', 'code', 'categoryId'],
  workflows: ['categoryCode', 'code', 'workflowId'],
  workflowVersions: ['workflowCode', 'versionNumber', 'versionId'],
  workflowParameters: ['workflowCode', 'displayOrder', 'parameterName'],
  workflowNodes: ['workflowCode', 'versionNumber', 'displayOrder', 'nodeKey', 'nodeId'],
  workflowEdges: ['workflowCode', 'versionNumber', 'displayOrder', 'edgeKey', 'edgeId'],
  temporalWorkflows: ['code', 'definitionId'],
  temporalWorkflowParameters: ['workflowCode', 'displayOrder', 'parameterName', 'parameterId'],
  automationCategories: ['displayOrder', 'code', 'categoryId'],
  browserAutomations: ['displayOrder', 'code', 'automationId'],
  automationEnvironments: ['automationCode', 'environmentCode'],
  automationParameters: ['automationCode', 'displayOrder', 'parameterName', 'parameterId'],
  automationOptions: ['automationCode', 'parameterName', 'displayOrder', 'optionValue', 'optionId'],
  schedules: ['code', 'scheduleId'],
  permissions: ['code', 'permissionId'],
  roles: ['code', 'roleId'],
  rolePermissions: ['roleCode', 'permissionCode', 'roleId', 'permissionId'],
};

async function queryRows(client, key, warnings) {
  try {
    const result = await client.query(QUERIES[key]);
    return result.rows || [];
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      warnings.push({
        code: 'CATALOGUE_SECTION_UNAVAILABLE',
        message: `${key} section unavailable in the current database schema.`,
      });
      return [];
    }
    throw error;
  }
}

function getConfiguredTarget(database) {
  return typeof database.getConfiguredDatabaseIdentity === 'function'
    ? database.getConfiguredDatabaseIdentity()
    : { configuredHost: null, configuredPort: null };
}

function getRuntimeIdentity(environment = process.env) {
  return {
    environment: nullableText(environment.SKYCOMMAND_ENVIRONMENT || environment.NODE_ENV),
    profile: nullableText(environment.SKYCOMMAND_PROFILE || environment.SKYCOMMAND_CONFIG_PROFILE),
  };
}

function getSourceRevision(repositoryRoot = REPOSITORY_ROOT, execute = null) {
  try {
    const result = execute
      ? execute(['rev-parse', '--verify', 'HEAD'], repositoryRoot)
      : spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
          cwd: repositoryRoot,
          encoding: 'utf8',
          stdio: 'pipe',
          shell: false,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
    const output = String(result.stdout || '').trim();
    return /^[0-9a-f]{40,64}$/i.test(output) ? output.toLowerCase() : null;
  } catch (_error) {
    return null;
  }
}

function countResources(resources) {
  return Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, value.length]));
}

async function collectCapabilityCatalogue({
  database,
  repositoryRoot = REPOSITORY_ROOT,
  environment = process.env,
  generatedAtUtc = new Date().toISOString(),
  sourceRevision = undefined,
  gitExecute = null,
} = {}) {
  if (!database?.pool?.connect)
    throw new TypeError('collectCapabilityCatalogue requires a database pool with connect().');
  const warnings = [];
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const databaseRows = await queryRows(client, 'database', warnings);
    const rows = {};
    for (const key of Object.keys(QUERIES).filter((key) => key !== 'database')) {
      rows[key] = await queryRows(client, key, warnings);
    }
    await client.query('COMMIT');
    const resources = mapRows(rows);
    const databaseIdentity = databaseRows[0] || {};
    const revision =
      sourceRevision === undefined ? getSourceRevision(repositoryRoot, gitExecute) : sourceRevision;
    const snapshot = {
      schemaVersion: CATALOGUE_SCHEMA_VERSION,
      catalogueSchemaVersion: CATALOGUE_SCHEMA_VERSION,
      sourceDataClassification: SOURCE_DATA_CLASSIFICATION,
      generatedAtUtc,
      source: {
        sourceRevision: revision,
        runtime: getRuntimeIdentity(environment),
        database: {
          name: databaseIdentity.database_name || null,
          configuredTarget: getConfiguredTarget(database),
          serverVersion: databaseIdentity.server_version || null,
          serverPort: toInteger(databaseIdentity.server_port),
        },
      },
      resourceCounts: countResources(resources),
      resources,
      warnings,
    };
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function assertGeneratedPaths(outputDirectory, repositoryRoot = REPOSITORY_ROOT) {
  const generatedRoot = path.resolve(repositoryRoot, 'docs', 'generated');
  const resolvedDirectory = path.resolve(outputDirectory);
  const relative = path.relative(generatedRoot, resolvedDirectory);
  if (relative !== '') {
    throw new Error('Capability catalogue output directory must be exactly docs/generated.');
  }
  return resolvedDirectory;
}

function normalizeGeneratedArtifactPaths(paths = {}, repositoryRoot = REPOSITORY_ROOT) {
  return {
    json: safeRepositoryRelativePath(
      path.isAbsolute(String(paths.json || ''))
        ? path.relative(repositoryRoot, paths.json)
        : paths.json,
    ),
    xlsx: safeRepositoryRelativePath(
      path.isAbsolute(String(paths.xlsx || ''))
        ? path.relative(repositoryRoot, paths.xlsx)
        : paths.xlsx,
    ),
  };
}

function workbookRows(snapshot) {
  const r = snapshot.resources;
  const summaryRows = [
    ['Field', 'Value'],
    ['Catalogue schema version', snapshot.catalogueSchemaVersion],
    ['Source/data classification', snapshot.sourceDataClassification],
    ['Generated UTC', snapshot.generatedAtUtc],
    ['Source revision', snapshot.source.sourceRevision || 'UNAVAILABLE'],
    ['Runtime environment', snapshot.source.runtime.environment || 'UNAVAILABLE'],
    ['Runtime profile', snapshot.source.runtime.profile || 'UNAVAILABLE'],
    ['Database name', snapshot.source.database.name || 'UNAVAILABLE'],
    [
      'Configured DB host',
      snapshot.source.database.configuredTarget.configuredHost || 'UNAVAILABLE',
    ],
    [
      'Configured DB port',
      snapshot.source.database.configuredTarget.configuredPort ?? 'UNAVAILABLE',
    ],
    ['PostgreSQL version', snapshot.source.database.serverVersion || 'UNAVAILABLE'],
    ['PostgreSQL server port', snapshot.source.database.serverPort ?? 'UNAVAILABLE'],
    ['Warning count', snapshot.warnings.length],
    [],
    ['Resource class', 'Row count'],
    ...Object.entries(snapshot.resourceCounts).map(([key, count]) => [key, count]),
  ];
  const definitions = {
    Tools: [
      'toolId',
      'code',
      'name',
      'label',
      'description',
      'categoryCode',
      'categoryLabel',
      'categoryKind',
      'runtime',
      'runtimeName',
      'permission',
      'risk',
      'riskName',
      'riskRank',
      'requiresConfirmation',
      'confirmationText',
      'capturesOutput',
      'allowsParameters',
      'displayOrder',
      'enabled',
      'outputType',
      'outputSchemaPath',
      'scriptRepositoryCode',
      'scriptRepositoryName',
      'scriptPath',
      'managedBySkyCommand',
      'registeredAt',
      'fileHash',
    ],
    'Tool Parameters': [
      'parameterId',
      'toolCode',
      'parameterName',
      'label',
      'type',
      'prompt',
      'required',
      'defaultValue',
      'optionSource',
      'displayOrder',
      'enabled',
      'argumentMode',
      'cliFlag',
    ],
    'Tool Options': [
      'optionId',
      'toolCode',
      'parameterId',
      'parameterName',
      'optionLabel',
      'optionValue',
      'displayOrder',
      'enabled',
    ],
    'Tool Visibility': ['toolId', 'toolCode', 'channelCode'],
    'Tool Categories': [
      'categoryId',
      'applicationId',
      'code',
      'name',
      'label',
      'description',
      'displayOrder',
      'enabled',
      'kind',
    ],
    'Category Visibility': ['categoryId', 'channelCode'],
    Workflows: [
      'workflowId',
      'code',
      'name',
      'description',
      'categoryCode',
      'categoryName',
      'status',
      'enabled',
      'visibleInAdmin',
      'startPermission',
      'cancelPermission',
      'versionCount',
      'latestVersionNumber',
      'publishedVersionNumber',
      'latestNodeCount',
      'latestEdgeCount',
      'publishedNodeCount',
      'publishedEdgeCount',
    ],
    'Workflow Versions': [
      'versionId',
      'workflowId',
      'workflowCode',
      'versionNumber',
      'versionLabel',
      'status',
      'graphVersion',
      'publishedAt',
      'nodeCount',
      'edgeCount',
    ],
    'Workflow Parameters': [
      'parameterId',
      'definitionId',
      'workflowCode',
      'parameterName',
      'label',
      'type',
      'required',
      'defaultValue',
      'minValue',
      'maxValue',
      'allowedValues',
      'placeholder',
      'helpText',
      'validationRegex',
      'adminVisible',
      'startFormField',
      'displayOrder',
    ],
    'Workflow Nodes': [
      'nodeId',
      'versionId',
      'workflowCode',
      'versionNumber',
      'versionStatus',
      'nodeKey',
      'nodeType',
      'displayName',
      'description',
      'targetCode',
      'targetReferenceId',
      'timeoutMs',
      'displayOrder',
      'enabled',
      'targetConfigKeys',
      'inputParameterKeys',
      'retryPolicyKeys',
      'configKeys',
    ],
    'Workflow Edges': [
      'edgeId',
      'versionId',
      'workflowCode',
      'versionNumber',
      'versionStatus',
      'edgeKey',
      'fromNodeId',
      'toNodeId',
      'edgeType',
      'conditionConfigured',
      'displayOrder',
    ],
    'Temporal Workflows': [
      'definitionId',
      'code',
      'workflowType',
      'name',
      'description',
      'taskQueue',
      'workflowIdPrefix',
      'runSourceDefault',
      'defaultTimeoutMs',
      'maxTimeoutMs',
      'defaultConcurrency',
      'maxConcurrency',
      'startPermission',
      'cancelPermission',
      'terminatePermission',
      'visibleInAdmin',
      'enabled',
      'configKeys',
    ],
    'Playwright Tests': [
      'testId',
      'code',
      'name',
      'label',
      'description',
      'categoryCode',
      'categoryLabel',
      'browser',
      'defaultEnvironment',
      'timeoutSeconds',
      'retryCount',
      'grepPattern',
      'permission',
      'risk',
      'riskName',
      'requiresConfirmation',
      'confirmationText',
      'displayOrder',
      'enabled',
      'managedBySkyCommand',
      'scriptRepositoryCode',
      'scriptRepositoryName',
      'scriptPath',
    ],
    'Test Parameters': [
      'parameterId',
      'testCode',
      'parameterName',
      'label',
      'type',
      'prompt',
      'required',
      'defaultValue',
      'optionSource',
      'displayOrder',
      'enabled',
    ],
    'Test Options': [
      'optionId',
      'testCode',
      'parameterId',
      'parameterName',
      'optionLabel',
      'optionValue',
      'displayOrder',
      'enabled',
    ],
    'Test Environments': ['testId', 'testCode', 'environmentCode'],
    'Test Categories': [
      'categoryId',
      'code',
      'name',
      'label',
      'description',
      'displayOrder',
      'enabled',
    ],
    'Test Suites': [
      'suiteId',
      'code',
      'name',
      'label',
      'description',
      'defaultEnvironment',
      'executionMode',
      'stopOnFailure',
      'permission',
      'displayOrder',
      'enabled',
      'managedBySkyCommand',
    ],
    'Suite Members': [
      'suiteMemberId',
      'suiteId',
      'testId',
      'testCode',
      'environmentCode',
      'displayOrder',
      'enabled',
      'parameterKeys',
    ],
    'Browser Automations': [
      'automationId',
      'code',
      'name',
      'label',
      'description',
      'categoryCode',
      'categoryLabel',
      'browser',
      'defaultEnvironment',
      'timeoutSeconds',
      'retryCount',
      'maxConcurrency',
      'permission',
      'risk',
      'riskName',
      'requiresConfirmation',
      'confirmationText',
      'sideEffects',
      'idempotency',
      'assistantEnabled',
      'outputType',
      'outputSchemaPath',
      'displayOrder',
      'enabled',
      'managedBySkyCommand',
      'scriptRepositoryCode',
      'scriptRepositoryName',
      'scriptPath',
    ],
    'Automation Parameters': [
      'parameterId',
      'automationCode',
      'parameterName',
      'label',
      'type',
      'prompt',
      'required',
      'defaultValue',
      'optionSource',
      'displayOrder',
      'enabled',
    ],
    'Automation Options': [
      'optionId',
      'automationCode',
      'parameterId',
      'parameterName',
      'optionLabel',
      'optionValue',
      'displayOrder',
      'enabled',
    ],
    'Automation Environments': ['automationId', 'automationCode', 'environmentCode'],
    Schedules: [
      'scheduleId',
      'code',
      'name',
      'description',
      'targetType',
      'targetCode',
      'targetName',
      'targetParameterName',
      'targetResolution',
      'profileCode',
      'timingType',
      'timezone',
      'runAt',
      'intervalValue',
      'intervalUnit',
      'cronExpression',
      'enabled',
      'status',
      'maxConcurrentRuns',
      'misfirePolicy',
      'nextRunAt',
      'lastRunAt',
      'parameterKeys',
    ],
    Repositories: [
      'repositoryId',
      'code',
      'name',
      'description',
      'mainBranch',
      'developmentBranch',
      'status',
      'active',
      'isSkyCommandRepository',
    ],
    Environments: ['code', 'name', 'description', 'baseUrl', 'displayOrder', 'enabled'],
    Permissions: [
      'permissionId',
      'code',
      'resource',
      'action',
      'description',
      'active',
      'applicationCode',
      'applicationTitle',
    ],
    Roles: [
      'roleId',
      'code',
      'name',
      'description',
      'systemRole',
      'active',
      'applicationCode',
      'applicationTitle',
    ],
    'Role Permissions': ['roleId', 'roleCode', 'permissionId', 'permissionCode', 'active'],
    Applications: ['applicationId', 'code', 'title', 'manifestVersion', 'description', 'active'],
    'Config Profiles': ['profileId', 'code', 'name', 'description', 'active'],
    Runtimes: ['code', 'name', 'executable', 'description', 'active'],
    'Risk Levels': ['code', 'name', 'rank', 'description', 'active'],
    'Parameter Types': ['code', 'name', 'description', 'active'],
    'Option Sources': ['code', 'name', 'description', 'active'],
    'Visibility Channels': ['code', 'name', 'description', 'active'],
    'Workflow Categories': ['categoryId', 'code', 'name', 'description', 'displayOrder', 'enabled'],
    'Automation Categories': [
      'categoryId',
      'code',
      'name',
      'label',
      'description',
      'displayOrder',
      'enabled',
    ],
    'Temporal Workflow Parameters': [
      'parameterId',
      'definitionId',
      'workflowCode',
      'parameterName',
      'label',
      'type',
      'required',
      'defaultValue',
      'minValue',
      'maxValue',
      'allowedValues',
      'placeholder',
      'helpText',
      'validationRegex',
      'adminVisible',
      'startFormField',
      'displayOrder',
    ],
  };
  const dataBySheet = {
    Tools: r.tools,
    'Tool Parameters': r.toolParameters,
    'Tool Options': r.toolOptions,
    'Tool Visibility': r.toolVisibility,
    'Tool Categories': r.toolCategories,
    'Category Visibility': r.categoryVisibility,
    Workflows: r.workflows,
    'Workflow Versions': r.workflowVersions,
    'Workflow Parameters': r.workflowParameters,
    'Workflow Nodes': r.workflowNodes,
    'Workflow Edges': r.workflowEdges,
    'Temporal Workflows': r.temporalWorkflows,
    'Playwright Tests': r.browserTests,
    'Test Parameters': r.testParameters,
    'Test Options': r.testOptions,
    'Test Environments': r.testEnvironments,
    'Test Categories': r.testCategories,
    'Test Suites': r.testSuites,
    'Suite Members': r.suiteMembers,
    'Browser Automations': r.browserAutomations,
    'Automation Parameters': r.automationParameters,
    'Automation Options': r.automationOptions,
    'Automation Environments': r.automationEnvironments,
    Schedules: r.schedules,
    Repositories: r.repositories,
    Environments: r.browserEnvironments,
    Permissions: r.permissions,
    Roles: r.roles,
    'Role Permissions': r.rolePermissions,
    Applications: r.applications,
    'Config Profiles': r.configProfiles,
    Runtimes: r.runtimes,
    'Risk Levels': r.riskLevels,
    'Parameter Types': r.parameterTypes,
    'Option Sources': r.optionSources,
    'Visibility Channels': r.visibilityChannels,
    'Workflow Categories': r.workflowCategories,
    'Automation Categories': r.automationCategories,
    'Temporal Workflow Parameters': r.temporalWorkflowParameters,
  };
  return { Summary: summaryRows, dataBySheet, definitions };
}

function writeWorkbook(snapshot, outputPath) {
  const { Summary, dataBySheet, definitions } = workbookRows(snapshot);
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(Summary);
  summarySheet['!cols'] = [{ wch: 34 }, { wch: 72 }];
  summarySheet['!autofilter'] = { ref: `A1:B${Summary.length}` };
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  for (const [sheetName, columns] of Object.entries(definitions)) {
    const data = dataBySheet[sheetName] || [];
    const rows = [
      columns,
      ...data.map((item) =>
        columns.map((column) => {
          const value = item[column];
          if (Array.isArray(value)) return value.join(', ');
          if (value && typeof value === 'object') return JSON.stringify(value);
          return value ?? null;
        }),
      ),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!autofilter'] = {
      ref: `A1:${XLSX.utils.encode_col(Math.max(columns.length - 1, 0))}${Math.max(rows.length, 1)}`,
    };
    sheet['!cols'] = columns.map((column) => ({
      wch: Math.min(Math.max(column.length + 2, 12), 36),
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  }
  XLSX.writeFile(workbook, outputPath, { bookType: 'xlsx', compression: true });
}

async function exportCapabilityCatalogue({
  database,
  repositoryRoot = REPOSITORY_ROOT,
  outputDirectory = GENERATED_ROOT,
  environment = process.env,
  generatedAtUtc,
  sourceRevision,
  gitExecute,
} = {}) {
  const resolvedRoot = assertGeneratedPaths(outputDirectory, repositoryRoot);
  await fs.mkdir(resolvedRoot, { recursive: true });
  const snapshot = await collectCapabilityCatalogue({
    database,
    repositoryRoot,
    environment,
    generatedAtUtc,
    sourceRevision,
    gitExecute,
  });
  const jsonPath = path.join(resolvedRoot, 'SkyCommand_Capability_Catalog.json');
  const xlsxPath = path.join(resolvedRoot, 'SkyCommand_Capability_Catalog.xlsx');
  await fs.writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  writeWorkbook(snapshot, xlsxPath);
  const hashes = {};
  for (const [key, filePath] of Object.entries({ json: jsonPath, xlsx: xlsxPath })) {
    hashes[key] = crypto
      .createHash('sha256')
      .update(await fs.readFile(filePath))
      .digest('hex');
  }
  return {
    ok: true,
    outcome: 'CAPABILITY_CATALOG_EXPORTED',
    generatedArtifactPaths: normalizeGeneratedArtifactPaths(
      { json: jsonPath, xlsx: xlsxPath },
      repositoryRoot,
    ),
    catalogueSchemaVersion: snapshot.catalogueSchemaVersion,
    generationTimestampUtc: snapshot.generatedAtUtc,
    sourceRevision: snapshot.source.sourceRevision,
    database: snapshot.source.database,
    runtime: snapshot.source.runtime,
    resourceCounts: snapshot.resourceCounts,
    warnings: snapshot.warnings,
    sha256: hashes,
    snapshot,
  };
}

function createCapabilityCatalogToolResult(result) {
  return {
    schemaVersion: '1.0',
    success: Boolean(result?.ok),
    message: result?.ok
      ? 'Capability catalogue snapshot exported.'
      : 'Capability catalogue export failed.',
    outputType: TOOL_RESULT_OUTPUT_TYPE,
    output: {
      outcome: result?.outcome || 'CAPABILITY_CATALOG_EXPORT_FAILED',
      generatedArtifactPaths: normalizeGeneratedArtifactPaths(result?.generatedArtifactPaths),
      catalogueSchemaVersion: result?.catalogueSchemaVersion || CATALOGUE_SCHEMA_VERSION,
      generationTimestampUtc: result?.generationTimestampUtc || null,
      sourceRevision: result?.sourceRevision || null,
      database: result?.database || {
        name: null,
        configuredTarget: { configuredHost: null, configuredPort: null },
        serverVersion: null,
        serverPort: null,
      },
      runtime: result?.runtime || { environment: null, profile: null },
      resourceCounts: result?.resourceCounts || {},
      warnings: result?.warnings || [],
      sha256: result?.sha256 || { json: null, xlsx: null },
    },
    warnings: result?.warnings || [],
    error: result?.ok
      ? null
      : {
          code: 'CAPABILITY_CATALOG_EXPORT_FAILED',
          message: 'Capability catalogue export failed.',
        },
    metadata: { sourceDataClassification: SOURCE_DATA_CLASSIFICATION },
  };
}

module.exports = {
  CATALOGUE_SCHEMA_VERSION,
  GENERATED_ROOT,
  QUERIES,
  REPOSITORY_ROOT,
  SOURCE_DATA_CLASSIFICATION,
  TOOL_RESULT_OUTPUT_TYPE,
  assertGeneratedPaths,
  collectCapabilityCatalogue,
  createCapabilityCatalogToolResult,
  exportCapabilityCatalogue,
  getSourceRevision,
  mapRows,
  writeWorkbook,
};
