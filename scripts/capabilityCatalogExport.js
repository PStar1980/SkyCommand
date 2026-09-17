#!/usr/bin/env node

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { runToolCli } = require('../packages/tools/src');
const {
  TOOL_RESULT_OUTPUT_TYPE,
  QUERIES,
  CATALOGUE_SCHEMA_VERSION,
  SOURCE_DATA_CLASSIFICATION,
  assertGeneratedPaths,
  collectCapabilityCatalogue,
  createCapabilityCatalogToolResult,
  exportCapabilityCatalogue,
} = require('../packages/capability-catalog/src');
const {
  loadRepositoryArtifactConfiguration,
} = require('../packages/files/src/repositoryArtifactConfiguration');
const outputSchema = require('../packages/capability-catalog/contracts/capability_catalog_summary.v1.schema.json');
const { validateJsonSchema } = require('../packages/tools/src/jsonSchemaValidator');
const { validateToolResult } = require('../packages/tools/src/toolResultContract');

const scriptRoot = path.resolve(__dirname, '..');
const CANONICAL_REPOSITORY_CODE = 'SkyCommand';
dotenv.config({ path: path.join(scriptRoot, '.env'), quiet: true });

async function resolveCanonicalRepositoryRoot({
  repositoryCode = CANONICAL_REPOSITORY_CODE,
  loadRepository = loadRepositoryArtifactConfiguration,
  fileSystem = fs,
} = {}) {
  const repository = await loadRepository(repositoryCode);
  const configuredRoot = String(repository?.rootPath || '').trim();

  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new Error(
      "Capability catalogue canonical repository '" +
        repositoryCode +
        "' has no absolute registered root path.",
    );
  }

  const canonicalRoot = path.resolve(configuredRoot);
  let stats;
  try {
    stats = fileSystem.statSync(canonicalRoot);
    fileSystem.accessSync(canonicalRoot, fileSystem.constants.R_OK | fileSystem.constants.W_OK);
  } catch (error) {
    throw new Error(
      'Capability catalogue canonical repository root is not readable and writable: ' +
        canonicalRoot +
        '.',
      { cause: error },
    );
  }

  if (!stats.isDirectory()) {
    throw new Error(
      'Capability catalogue canonical repository root must be a directory: ' + canonicalRoot + '.',
    );
  }

  return canonicalRoot;
}

async function resolveCanonicalArtifactTarget(dependencies = {}) {
  const canonicalRepositoryRoot = await resolveCanonicalRepositoryRoot(dependencies);
  return {
    repositoryRoot: canonicalRepositoryRoot,
    outputDirectory: path.join(canonicalRepositoryRoot, 'docs', 'generated'),
  };
}

async function executeCapabilityCatalog(_args = [], _toolContext = {}, dependencies = {}) {
  const database = dependencies.database || require('../packages/db/src/connection');
  const target = await resolveCanonicalArtifactTarget({
    loadRepository:
      dependencies.loadRepositoryArtifactConfiguration || loadRepositoryArtifactConfiguration,
    fileSystem: dependencies.fileSystem || fs,
  });
  const exporter = dependencies.exportCapabilityCatalogue || exportCapabilityCatalogue;
  return exporter({
    database,
    repositoryRoot: target.repositoryRoot,
    outputDirectory: target.outputDirectory,
  });
}

function renderConsole(result) {
  console.log(`[SkyCommand Capability Catalogue] Exported ${result.catalogueSchemaVersion}.`);
  console.log(`[SkyCommand Capability Catalogue] JSON: ${result.generatedArtifactPaths.json}`);
  console.log(`[SkyCommand Capability Catalogue] XLSX: ${result.generatedArtifactPaths.xlsx}`);
  console.log(
    `[SkyCommand Capability Catalogue] Resource counts: ${JSON.stringify(result.resourceCounts)}`,
  );
  if (result.warnings.length > 0) {
    console.warn(`[SkyCommand Capability Catalogue] Warnings: ${result.warnings.length}`);
  }
}

function createFailureToolResult(error) {
  return createCapabilityCatalogToolResult({
    ok: false,
    warnings: [
      {
        code: error?.code || 'CAPABILITY_CATALOG_EXPORT_FAILED',
        message: error?.message || 'Export failed.',
      },
    ],
  });
}

function selfTestRows() {
  const r = Object.fromEntries(Object.keys(QUERIES).map((key) => [key, []]));
  const id = '00000000-0000-4000-8000-000000000001';
  r.database = [
    { database_name: 'skycommand_dev', server_version: 'PostgreSQL 16.4', server_port: 5432 },
  ];
  r.applications = [
    {
      app_id: id,
      app_code: 'SKYCOMMAND_CORE',
      title: 'SkyCommand',
      manifest_version: '1.0',
      description: null,
      active: true,
    },
  ];
  r.toolCategories = [
    {
      category_id: id,
      app_id: id,
      category_code: 'ops',
      name: 'Operations',
      label: 'Operations',
      description: null,
      display_order: 1,
      enabled: true,
      category_kind_code: 'GENERAL',
    },
  ];
  r.tools = [
    {
      tool_id: id,
      category_id: id,
      tool_code: 'z_tool',
      name: 'Z Tool',
      label: 'Z',
      description: null,
      script_repo_id: id,
      script_path: 'scripts/z.js',
      runtime_code: 'node',
      permission_code: 'TOOL_RUN',
      risk_code: 'LOW',
      requires_confirmation: false,
      confirmation_text: null,
      captures_output: true,
      allow_params: true,
      display_order: 1,
      enabled: true,
      output_type: 'z_summary.v1',
      output_schema_path: 'contracts/z.schema.json',
      managed_by_skycommand: false,
      registered_at: null,
      file_hash: null,
      category_code: 'ops',
      category_label: 'Operations',
      category_kind_code: 'GENERAL',
      script_repo_code: 'skycommand',
      script_repo_name: 'SkyCommand',
      runtime_name: 'Node.js',
      risk_name: 'Low',
      risk_rank: 1,
    },
  ];
  r.toolParameters = [
    {
      parameter_id: id,
      tool_id: id,
      tool_code: 'z_tool',
      parameter_name: 'apiKey',
      label: 'API key',
      param_type_code: 'string',
      prompt: null,
      required: false,
      default_value: 'super-secret-value',
      option_source_code: null,
      display_order: 1,
      enabled: true,
      argument_mode: 'POSITIONAL',
      cli_flag: null,
    },
  ];
  r.browserEnvironments = [
    {
      environment_code: 'LOCAL',
      environment_name: 'Local',
      description: null,
      base_url: 'http://localhost:3000',
      display_order: 1,
      enabled: true,
    },
  ];
  r.testCategories = [
    {
      category_id: id,
      category_code: 'smoke',
      name: 'Smoke',
      label: 'Smoke',
      description: null,
      display_order: 1,
      enabled: true,
    },
  ];
  r.browserTests = [
    {
      test_id: id,
      category_id: id,
      test_code: 'smoke_test',
      name: 'Smoke',
      label: 'Smoke',
      description: null,
      script_repo_id: id,
      script_path: 'tests/smoke.spec.js',
      browser_type: 'chromium',
      default_environment_code: 'LOCAL',
      timeout_seconds: 30,
      retry_count: 0,
      grep_pattern: '@smoke',
      permission_code: 'BROWSER_TEST_RUN',
      risk_code: 'LOW',
      requires_confirmation: false,
      confirmation_text: null,
      display_order: 1,
      enabled: true,
      managed_by_skycommand: true,
      category_code: 'smoke',
      category_label: 'Smoke',
      script_repo_code: 'skycommand',
      script_repo_name: 'SkyCommand',
      risk_name: 'Low',
    },
  ];
  r.testSuites = [
    {
      suite_id: id,
      suite_code: 'smoke_suite',
      name: 'Smoke',
      label: 'Smoke',
      description: null,
      default_environment_code: 'LOCAL',
      execution_mode: 'HEADLESS',
      stop_on_failure: true,
      permission_code: 'BROWSER_TEST_SUITE_RUN',
      display_order: 1,
      enabled: true,
      managed_by_skycommand: true,
    },
  ];
  r.suiteMembers = [
    {
      suite_member_id: id,
      suite_id: id,
      test_id: id,
      test_code: 'smoke_test',
      environment_code: 'LOCAL',
      parameter_overrides: { password: 'omit' },
      display_order: 1,
      enabled: true,
    },
  ];
  r.workflowCategories = [
    {
      workflow_category_id: id,
      category_code: 'GENERAL',
      display_name: 'General',
      description: null,
      display_order: 1,
      enabled: true,
    },
  ];
  r.workflows = [
    {
      workflow_definition_id: id,
      workflow_code: 'z_workflow',
      display_name: 'Z workflow',
      description: null,
      status: 'ACTIVE',
      visible_in_admin: true,
      enabled: true,
      start_permission_code: 'WORKFLOW_START',
      cancel_permission_code: null,
      version_count: 1,
      latest_version_number: 1,
      published_version_number: 1,
      latest_version_id: id,
      published_version_id: id,
      latest_node_count: 1,
      latest_edge_count: 0,
      published_node_count: 1,
      published_edge_count: 0,
      category_code: 'GENERAL',
      category_display_name: 'General',
      category_description: null,
      category_display_order: 1,
      category_enabled: true,
      config: {
        runtimeParameters: [
          {
            key: 'commitMessage',
            label: 'Commit message',
            type: 'string',
            required: true,
            defaultValue: 'do-not-leak-this-default',
            description: 'Commit message for the governed development workflow.',
            displayOrder: 20,
          },
          {
            key: 'repoName',
            label: 'Repository',
            type: 'repo',
            required: true,
            options: [{ value: 'SkyCommand', label: 'SkyCommand' }],
            displayOrder: 10,
          },
          {
            key: 'apiToken',
            label: 'API token',
            type: 'string',
            defaultValue: 'do-not-leak-this-token',
            allowedValues: ['do-not-leak-this-option'],
            displayOrder: 30,
          },
        ],
        privateConfig: 'do-not-export-config',
      },
    },
  ];
  r.temporalWorkflows = [
    {
      definition_id: id,
      workflow_code: 'temporal_only',
      workflow_type: 'temporalOnly',
      display_name: 'Temporal only',
      description: null,
      task_queue_name: 'default',
      workflow_id_prefix: 'temporal-only',
      run_source_default: 'manual',
      default_timeout_ms: 1000,
      max_timeout_ms: 2000,
      default_concurrency: 1,
      max_concurrency: 1,
      start_permission_code: 'WORKFLOW_START',
      cancel_permission_code: null,
      terminate_permission_code: null,
      visible_in_admin: true,
      enabled: true,
      config: {},
    },
  ];
  r.temporalWorkflowParameters = [
    {
      parameter_id: id,
      definition_id: id,
      workflow_code: 'temporal_only',
      parameter_name: 'temporalParameter',
      label: 'Temporal parameter',
      parameter_type: 'string',
      required: false,
      default_value: null,
      min_value: null,
      max_value: null,
      allowed_values: null,
      placeholder: null,
      help_text: null,
      validation_regex: null,
      admin_visible: true,
      start_form_field: true,
      display_order: 10,
    },
  ];
  r.browserAutomations = [
    {
      automation_id: id,
      category_id: id,
      automation_code: 'smoke_automation',
      name: 'Smoke automation',
      label: 'Smoke automation',
      description: null,
      script_repo_id: id,
      script_path: 'tests/smoke-automation.js',
      browser_type: 'chromium',
      default_environment_code: 'LOCAL',
      timeout_seconds: 30,
      retry_count: 0,
      max_concurrency: 1,
      permission_code: 'BROWSER_AUTOMATION_RUN',
      risk_code: 'LOW',
      requires_confirmation: false,
      confirmation_text: null,
      side_effect_level: 'READ_ONLY',
      idempotency_mode: 'SAFE_RETRY',
      output_type: 'smoke_summary.v1',
      output_schema_path: 'contracts/smoke.schema.json',
      display_order: 1,
      enabled: true,
      managed_by_skycommand: true,
      assistant_enabled: false,
      category_code: 'smoke',
      category_label: 'Smoke',
      script_repo_code: 'skycommand',
      script_repo_name: 'SkyCommand',
      risk_name: 'Low',
    },
  ];
  r.schedules = [
    {
      schedule_id: id,
      schedule_code: 'workflow_schedule',
      schedule_name: 'Workflow schedule',
      description: null,
      schedule_type: 'INTERVAL',
      timezone: 'America/Toronto',
      run_at: null,
      interval_value: 1,
      interval_unit: 'DAY',
      cron_expression: null,
      enabled: true,
      max_concurrent_runs: 1,
      misfire_policy: 'RUN_ONCE',
      next_run_at: null,
      last_run_at: null,
      last_status: null,
      profile_id: null,
      profile_code: null,
      tool_code: 'skyserver_workflow_start',
      tool_label: 'Start SkyServer Workflow',
      parameters: { workflowCode: 'z_workflow', inputJson: '{"commitMessage":"omit"}' },
    },
    {
      ...{
        schedule_id: `${id}-test`,
        schedule_code: 'test_schedule',
        schedule_name: 'Test schedule',
        description: null,
        schedule_type: 'INTERVAL',
        timezone: 'America/Toronto',
        run_at: null,
        interval_value: 1,
        interval_unit: 'DAY',
        cron_expression: null,
        enabled: true,
        max_concurrent_runs: 1,
        misfire_policy: 'RUN_ONCE',
        next_run_at: null,
        last_run_at: null,
        last_status: null,
        profile_id: null,
        profile_code: null,
        tool_code: 'browser_test_schedule_start',
        tool_label: 'Run Playwright Test',
        parameters: {
          testCode: 'smoke_test',
          environmentCode: 'LOCAL',
          parametersJson: '{"password":"omit"}',
        },
      },
    },
    {
      ...{
        schedule_id: `${id}-suite`,
        schedule_code: 'suite_schedule',
        schedule_name: 'Suite schedule',
        description: null,
        schedule_type: 'INTERVAL',
        timezone: 'America/Toronto',
        run_at: null,
        interval_value: 1,
        interval_unit: 'DAY',
        cron_expression: null,
        enabled: true,
        max_concurrent_runs: 1,
        misfire_policy: 'RUN_ONCE',
        next_run_at: null,
        last_run_at: null,
        last_status: null,
        profile_id: null,
        profile_code: null,
        tool_code: 'browser_test_suite_schedule_start',
        tool_label: 'Run Playwright Test Suite',
        parameters: { suiteCode: 'smoke_suite', environmentCode: 'LOCAL' },
      },
    },
    {
      ...{
        schedule_id: `${id}-automation`,
        schedule_code: 'automation_schedule',
        schedule_name: 'Automation schedule',
        description: null,
        schedule_type: 'INTERVAL',
        timezone: 'America/Toronto',
        run_at: null,
        interval_value: 1,
        interval_unit: 'DAY',
        cron_expression: null,
        enabled: true,
        max_concurrent_runs: 1,
        misfire_policy: 'RUN_ONCE',
        next_run_at: null,
        last_run_at: null,
        last_status: null,
        profile_id: null,
        profile_code: null,
        tool_code: 'browser_automation_schedule_start',
        tool_label: 'Run Playwright Automation',
        parameters: { automationCode: 'smoke_automation', environmentCode: 'LOCAL' },
      },
    },
    {
      ...{
        schedule_id: `${id}-malformed`,
        schedule_code: 'malformed_schedule',
        schedule_name: 'Malformed bridge schedule',
        description: null,
        schedule_type: 'INTERVAL',
        timezone: 'America/Toronto',
        run_at: null,
        interval_value: 1,
        interval_unit: 'DAY',
        cron_expression: null,
        enabled: true,
        max_concurrent_runs: 1,
        misfire_policy: 'RUN_ONCE',
        next_run_at: null,
        last_run_at: null,
        last_status: null,
        profile_id: null,
        profile_code: null,
        tool_code: 'browser_test_schedule_start',
        tool_label: 'Run Playwright Test',
        parameters: { testCode: { invalid: true } },
      },
    },
    {
      ...{
        schedule_id: `${id}-ordinary`,
        schedule_code: 'ordinary_schedule',
        schedule_name: 'Ordinary tool schedule',
        description: null,
        schedule_type: 'INTERVAL',
        timezone: 'America/Toronto',
        run_at: null,
        interval_value: 1,
        interval_unit: 'DAY',
        cron_expression: null,
        enabled: true,
        max_concurrent_runs: 1,
        misfire_policy: 'RUN_ONCE',
        next_run_at: null,
        last_run_at: null,
        last_status: null,
        profile_id: null,
        profile_code: null,
        tool_code: 'z_tool',
        tool_label: 'Z',
        parameters: { mode: 'safe' },
      },
    },
  ];
  r.workflowVersions = [
    {
      workflow_version_id: id,
      workflow_definition_id: id,
      workflow_code: 'z_workflow',
      version_number: 1,
      version_label: 'v1',
      status: 'PUBLISHED',
      graph_version: '1.0',
      published_at: null,
      node_count: 1,
      edge_count: 0,
    },
  ];
  r.workflowNodes = [
    {
      workflow_node_id: id,
      workflow_version_id: id,
      workflow_code: 'z_workflow',
      version_number: 1,
      version_status: 'PUBLISHED',
      node_key: 'run_tool',
      node_type_code: 'TOOL',
      display_name: 'Run tool',
      description: null,
      target_code: 'z_tool',
      target_ref_id: id,
      timeout_ms: 1000,
      display_order: 1,
      enabled: true,
      target_config: { mode: 'safe' },
      input_parameters: { password: 'omit', mode: 'safe' },
      retry_policy: { retries: 1 },
      config: { secret: 'omit' },
    },
  ];
  r.repositories = [
    {
      repo_id: id,
      repo_code: 'skycommand',
      repo_name: 'SkyCommand',
      description: null,
      main_branch: 'main',
      dev_branch: 'dev',
      active: true,
      is_skycommand_repository: true,
    },
  ];
  r.permissions = [
    {
      permission_id: id,
      permission_code: 'TOOL_RUN',
      resource: 'tool',
      action: 'run',
      description: null,
      active: true,
      app_code: 'SKYCOMMAND_CORE',
      app_title: 'SkyCommand',
    },
  ];
  r.roles = [
    {
      role_id: id,
      role_code: 'ADMIN',
      role_name: 'Administrator',
      description: null,
      is_system_role: true,
      active: true,
      app_code: 'SKYCOMMAND_CORE',
      app_title: 'SkyCommand',
    },
  ];
  r.rolePermissions = [
    {
      role_id: id,
      role_code: 'ADMIN',
      permission_id: id,
      permission_code: 'TOOL_RUN',
      active: true,
    },
  ];
  return r;
}

function fakeDatabase(rows, statements) {
  return {
    getConfiguredDatabaseIdentity: () => ({ configuredHost: 'localhost', configuredPort: 5432 }),
    pool: {
      async connect() {
        return {
          async query(sql) {
            const statement = String(sql).trim();
            statements.push(statement);
            if (['BEGIN READ ONLY', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
            const key = Object.keys(QUERIES).find(
              (candidate) => QUERIES[candidate].trim() === statement,
            );
            if (!key) throw new Error(`Unexpected SQL: ${statement}`);
            return { rows: rows[key] || [] };
          },
          release() {},
        };
      },
    },
  };
}

async function runSelfTest() {
  const rows = selfTestRows();
  const statements = [];
  const fixedTime = '2026-09-14T16:00:00.000Z';
  const snapshot = await collectCapabilityCatalogue({
    database: fakeDatabase(rows, statements),
    generatedAtUtc: fixedTime,
    sourceRevision: 'b'.repeat(40),
    environment: { NODE_ENV: 'development' },
  });
  assert.equal(snapshot.schemaVersion, CATALOGUE_SCHEMA_VERSION);
  assert.equal(snapshot.sourceDataClassification, SOURCE_DATA_CLASSIFICATION);
  assert.equal(snapshot.resourceCounts.tools, 1);
  assert.equal(snapshot.resourceCounts.testSuites, 1);
  assert.equal(snapshot.resourceCounts.suiteMembers, 1);
  assert.equal(snapshot.resourceCounts.workflowNodes, 1);
  assert.equal(snapshot.resources.toolParameters[0].defaultValue, '[REDACTED]');
  assert.deepEqual(
    snapshot.resources.workflowParameters.map((parameter) => parameter.parameterName),
    ['repoName', 'commitMessage', 'apiToken'],
  );
  assert.equal(
    snapshot.resources.workflowParameters.find(
      (parameter) => parameter.parameterName === 'commitMessage',
    ).defaultValue,
    'do-not-leak-this-default',
  );
  assert.equal(
    snapshot.resources.workflowParameters.find(
      (parameter) => parameter.parameterName === 'apiToken',
    ).defaultValue,
    '[REDACTED]',
  );
  assert.equal(
    snapshot.resources.workflowParameters.find(
      (parameter) => parameter.parameterName === 'apiToken',
    ).allowedValues,
    '[REDACTED]',
  );
  assert.deepEqual(
    snapshot.resources.temporalWorkflowParameters.map((parameter) => parameter.parameterName),
    ['temporalParameter'],
  );
  const schedulesByCode = Object.fromEntries(
    snapshot.resources.schedules.map((schedule) => [schedule.code, schedule]),
  );
  assert.deepEqual(
    ['workflow_schedule', 'test_schedule', 'suite_schedule', 'automation_schedule'].map(
      (code) => schedulesByCode[code].targetType,
    ),
    ['WORKFLOW', 'BROWSER_TEST', 'BROWSER_TEST_SUITE', 'BROWSER_AUTOMATION'],
  );
  assert.equal(schedulesByCode.workflow_schedule.targetName, 'Z workflow');
  assert.equal(schedulesByCode.test_schedule.targetName, 'Smoke');
  assert.equal(schedulesByCode.suite_schedule.targetName, 'Smoke');
  assert.equal(schedulesByCode.automation_schedule.targetName, 'Smoke automation');
  assert.equal(schedulesByCode.ordinary_schedule.targetType, 'TOOL');
  assert.equal(schedulesByCode.ordinary_schedule.targetCode, 'z_tool');
  assert.equal(schedulesByCode.ordinary_schedule.targetName, 'Z');
  assert.equal(schedulesByCode.malformed_schedule.targetType, 'BROWSER_TEST');
  assert.equal(schedulesByCode.malformed_schedule.targetCode, null);
  assert.equal(schedulesByCode.malformed_schedule.targetResolution, 'MALFORMED_TARGET_IDENTIFIER');
  assert.deepEqual(schedulesByCode.workflow_schedule.parameterKeys, ['inputJson', 'workflowCode']);
  assert.deepEqual(snapshot.resources.workflowNodes[0].inputParameterKeys, ['mode']);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /super-secret-value|do-not-leak-this-token|do-not-leak-this-option|omit|password/i,
  );
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /"users"|"userRoles"|"sessions"|remoteUrl|rootPath/i,
  );
  assert.equal(statements[0], 'BEGIN READ ONLY');
  assert.equal(statements.at(-1), 'COMMIT');
  assert.ok(
    statements.every(
      (s) => ['BEGIN READ ONLY', 'COMMIT', 'ROLLBACK'].includes(s) || /^SELECT\s/i.test(s),
    ),
  );
  assert.ok(statements.every((s) => !/SELECT\s+\*/i.test(s)));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-catalog-'));
  try {
    const outputDirectory = path.join(root, 'docs', 'generated');
    assert.equal(assertGeneratedPaths(outputDirectory, root), outputDirectory);
    assert.throws(() => assertGeneratedPaths(path.join(root, 'outside'), root));
    const result = await exportCapabilityCatalogue({
      database: fakeDatabase(rows, []),
      repositoryRoot: root,
      outputDirectory,
      generatedAtUtc: fixedTime,
      sourceRevision: 'b'.repeat(40),
      environment: { NODE_ENV: 'development' },
    });
    assert.deepEqual(result.generatedArtifactPaths, {
      json: 'docs/generated/SkyCommand_Capability_Catalog.json',
      xlsx: 'docs/generated/SkyCommand_Capability_Catalog.xlsx',
    });
    const workbook = XLSX.readFile(path.join(root, result.generatedArtifactPaths.xlsx));
    [
      'Summary',
      'Tools',
      'Tool Parameters',
      'Workflows',
      'Workflow Parameters',
      'Workflow Nodes',
      'Workflow Edges',
      'Playwright Tests',
      'Test Suites',
      'Suite Members',
      'Browser Automations',
      'Automation Parameters',
      'Automation Environments',
      'Schedules',
      'Repositories',
      'Environments',
      'Permissions',
      'Roles',
      'Role Permissions',
    ].forEach((sheet) => assert.ok(workbook.SheetNames.includes(sheet), `missing sheet ${sheet}`));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(root, result.generatedArtifactPaths.json), 'utf8'))
        .resourceCounts,
      result.resourceCounts,
    );
    assert.match(result.sha256.json, /^[a-f0-9]{64}$/);
    assert.match(result.sha256.xlsx, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const executionImageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-app-image-'));
  const canonicalRepositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'skycommand-canonical-repo-'),
  );
  try {
    let capturedExportOptions = null;
    let capturedGitCwd = null;
    const canonicalResult = await executeCapabilityCatalog(
      [],
      {},
      {
        database: fakeDatabase(rows, []),
        loadRepositoryArtifactConfiguration: async () => ({
          repoCode: 'SkyCommand',
          rootPath: canonicalRepositoryRoot,
        }),
        exportCapabilityCatalogue: (options) => {
          capturedExportOptions = options;
          return exportCapabilityCatalogue({
            ...options,
            generatedAtUtc: fixedTime,
            gitExecute: (_args, cwd) => {
              capturedGitCwd = cwd;
              return { status: 0, stdout: 'c'.repeat(40) + '\n', stderr: '' };
            },
          });
        },
      },
    );
    const canonicalOutputDirectory = path.join(canonicalRepositoryRoot, 'docs', 'generated');
    assert.notEqual(canonicalRepositoryRoot, executionImageRoot);
    assert.equal(capturedExportOptions.repositoryRoot, canonicalRepositoryRoot);
    assert.equal(capturedExportOptions.outputDirectory, canonicalOutputDirectory);
    assert.equal(capturedGitCwd, canonicalRepositoryRoot);
    assert.equal(canonicalResult.sourceRevision, 'c'.repeat(40));
    assert.deepEqual(canonicalResult.generatedArtifactPaths, {
      json: 'docs/generated/SkyCommand_Capability_Catalog.json',
      xlsx: 'docs/generated/SkyCommand_Capability_Catalog.xlsx',
    });
    assert.equal(
      fs.existsSync(path.join(canonicalOutputDirectory, 'SkyCommand_Capability_Catalog.json')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(canonicalOutputDirectory, 'SkyCommand_Capability_Catalog.xlsx')),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(executionImageRoot, 'docs', 'generated', 'SkyCommand_Capability_Catalog.json'),
      ),
      false,
    );
    assert.equal(
      fs.existsSync(
        path.join(executionImageRoot, 'docs', 'generated', 'SkyCommand_Capability_Catalog.xlsx'),
      ),
      false,
    );
    assert.throws(
      () =>
        assertGeneratedPaths(
          path.join(canonicalRepositoryRoot, 'outside'),
          canonicalRepositoryRoot,
        ),
      /exactly docs\/generated/,
    );
    await assert.rejects(
      () =>
        resolveCanonicalRepositoryRoot({
          loadRepository: async () => ({
            rootPath: path.join(executionImageRoot, 'missing'),
          }),
        }),
      /not readable and writable/,
    );
    await assert.rejects(
      () =>
        resolveCanonicalRepositoryRoot({
          loadRepository: async () => ({ rootPath: 'relative/SkyCommand' }),
        }),
      /no absolute registered root path/,
    );
  } finally {
    fs.rmSync(executionImageRoot, { recursive: true, force: true });
    fs.rmSync(canonicalRepositoryRoot, { recursive: true, force: true });
  }
  const absolutePathToolResult = createCapabilityCatalogToolResult({
    ok: true,
    generatedArtifactPaths: {
      json: 'C:\\Users\\pauls\\SkyCommand\\docs\\generated\\catalog.json',
      xlsx: '/workspace/SkyCommand/docs/generated/catalog.xlsx',
    },
  });
  assert.deepEqual(absolutePathToolResult.output.generatedArtifactPaths, {
    json: null,
    xlsx: null,
  });
  const toolResult = createCapabilityCatalogToolResult({
    ok: true,
    outcome: 'CAPABILITY_CATALOG_EXPORTED',
    generatedArtifactPaths: { json: 'x.json', xlsx: 'x.xlsx' },
    catalogueSchemaVersion: CATALOGUE_SCHEMA_VERSION,
    generationTimestampUtc: fixedTime,
    sourceRevision: 'b'.repeat(40),
    database: {
      name: 'skycommand_dev',
      configuredTarget: { configuredHost: 'localhost', configuredPort: 5432 },
      serverVersion: 'PostgreSQL 16.4',
      serverPort: 5432,
    },
    runtime: { environment: 'development', profile: null },
    resourceCounts: snapshot.resourceCounts,
    warnings: [],
    sha256: { json: 'a'.repeat(64), xlsx: 'b'.repeat(64) },
  });
  validateToolResult(toolResult, { expectedOutputType: TOOL_RESULT_OUTPUT_TYPE, outputSchema });
  validateJsonSchema(toolResult.output, outputSchema);
  const repoRoot = path.resolve(__dirname, '..');
  [
    'docs/generated/SkyCommand_Capability_Catalog.json',
    'docs/generated/SkyCommand_Capability_Catalog.xlsx',
  ].forEach((file) =>
    assert.equal(
      spawnSync('git', ['check-ignore', '-q', file], {
        cwd: repoRoot,
        stdio: 'ignore',
        shell: false,
      }).status,
      0,
    ),
  );
  console.log('[SkyCommand] Capability catalogue exporter self-test passed.');
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  return runToolCli({
    toolCode: 'capability_catalog_export',
    outputType: TOOL_RESULT_OUTPUT_TYPE,
    outputSchema,
    execute: executeCapabilityCatalog,
    createToolResult: createCapabilityCatalogToolResult,
    createFailureToolResult,
    renderConsole,
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  createFailureToolResult,
  executeCapabilityCatalog,
  main,
  renderConsole,
};
