#!/usr/bin/env node

/**
 * SkyServer_Core.js
 * Interactive CLI launcher for SkyServer automation scripts.
 *
 * Database-backed version:
 * - Loads .env from the SkyServer repo root
 * - Reads SkyServer Core categories/tools/parameters from PostgreSQL core.* tables
 * - Reads repository paths from core.repositories/core.repository_paths
 * - Lists CLI-visible categories/tools only
 * - Adds a top-level Run Tools / Run Workflows launcher
 * - Starts active, published SkyServer workflows through the Temporal-backed executor
 * - Prompts for configured tool parameters
 * - Resolves script locations from database-backed repository roots
 * - Executes target scripts through configured runtime
 * - Shows raw script output
 * - Pauses until ENTER
 * - Clears screen and loops back to menu
 *
 * Notes:
 * - Normal operation is database-configured.
 * - A tiny recovery fallback is included for db_health/db_build if the core
 *   configuration tables are unavailable, so the CLI does not lock itself out.
 *
 * Author: Paul Sattaur
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

// ------------------------------------------------------------
// Paths / environment
// ------------------------------------------------------------

const CORE_DIR = __dirname;

// SkyServer/packages/core/src -> SkyServer
const SKY_SERVER_ROOT = path.resolve(CORE_DIR, '../../..');
const ENV_PATH = path.join(SKY_SERVER_ROOT, '.env');

dotenv.config({ path: ENV_PATH });

const { pool } = require('../../db/src/connection');
const workflowExecutorService = require('../../../apps/api/src/services/workflowExecutorService');

const APP_CODE = process.env.SKYSERVER_CORE_APP_CODE || 'SKYSERVER_CORE';
const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

const DEFAULT_WORKFLOW_EXECUTOR_MODE = String(
  process.env.SKYSERVER_CORE_WORKFLOW_EXECUTOR_MODE || 'temporal',
)
  .trim()
  .toLowerCase();
const CLI_USER_AGENT = 'SkyServer_Core CLI';

// ------------------------------------------------------------
// Colors
// ------------------------------------------------------------

const cyan = (str) => `\x1b[36m${str}\x1b[0m`;
const yellow = (str) => `\x1b[33m${str}\x1b[0m`;
const magenta = (str) => `\x1b[35m${str}\x1b[0m`;
const green = (str) => `\x1b[32m${str}\x1b[0m`;
const red = (str) => `\x1b[31m${str}\x1b[0m`;
const gray = (str) => `\x1b[90m${str}\x1b[0m`;

// ------------------------------------------------------------
// Console helpers
// ------------------------------------------------------------

function printHeader(title) {
  console.log(cyan('=========================================='));
  console.log(cyan(`              ${title}`));
  console.log(cyan('==========================================\n'));
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('\nPress ENTER to return to the menu...', () => {
      rl.close();
      resolve();
    });
  });
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function isEnabled(item) {
  return item.enabled !== false;
}

function getDisplayName(item) {
  return item.label || item.name || item.toolCode || item.categoryCode || 'Unnamed';
}

function getRuntime(scriptDef) {
  return scriptDef.runtimeCode || scriptDef.runtime || 'node';
}

function sortByDisplayOrderThenName(a, b) {
  const orderA = Number.isFinite(a.displayOrder) ? a.displayOrder : 999999;
  const orderB = Number.isFinite(b.displayOrder) ? b.displayOrder : 999999;

  if (orderA !== orderB) {
    return orderA - orderB;
  }

  return getDisplayName(a).localeCompare(getDisplayName(b));
}

// ------------------------------------------------------------
// Database manifest loading
// ------------------------------------------------------------

async function queryRows(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

function mapCategory(row) {
  return {
    categoryId: row.category_id,
    categoryCode: row.category_code,
    name: row.name,
    label: row.label,
    description: row.description,
    displayOrder: row.display_order,
    enabled: row.enabled,
    scripts: [],
  };
}

function mapTool(row) {
  return {
    toolId: row.tool_id,
    categoryCode: row.category_code,
    toolCode: row.tool_code,
    name: row.name,
    label: row.label,
    description: row.description,
    scriptRepoCode: row.script_repo_code,
    scriptPath: row.script_path,
    runtimeCode: row.runtime_code,
    runtimeExecutable: row.runtime_executable,
    permissionCode: row.permission_code,
    risk: row.risk_code,
    requiresConfirmation: toBoolean(row.requires_confirmation),
    confirmationText: row.confirmation_text,
    capturesOutput: toBoolean(row.captures_output),
    allowParams: toBoolean(row.allow_params),
    displayOrder: row.display_order,
    enabled: row.enabled,
    params: [],
  };
}

function mapParameter(row) {
  return {
    toolCode: row.tool_code,
    name: row.parameter_name,
    label: row.label,
    paramTypeCode: row.param_type_code,
    type: row.param_type_code,
    prompt: row.prompt,
    required: toBoolean(row.required),
    defaultValue: row.default_value,
    optionSourceCode: row.option_source_code,
    optionsSource: row.option_source_code,
    displayOrder: row.display_order,
    enabled: row.enabled,
    options: [],
  };
}

function mapStaticOption(row) {
  return {
    toolCode: row.tool_code,
    parameterName: row.parameter_name,
    label: row.option_label,
    value: row.option_value,
    displayOrder: row.display_order,
    enabled: row.enabled,
  };
}

function mapRepository(row) {
  return {
    repoCode: row.repo_code,
    repoName: row.repo_name,
    rootPath: row.root_path,
    displayOrder: row.display_order,
    active: row.active,
  };
}

function mapWorkflowDefinition(row) {
  return {
    workflowDefinitionId: row.workflow_definition_id,
    workflowCode: row.workflow_code,
    displayName: row.display_name,
    description: row.description,
    status: row.status,
    enabled: row.enabled,
    visibleInAdmin: row.visible_in_admin,
    startPermissionCode: row.start_permission_code,
    publishedVersionId: row.published_version_id,
    publishedVersionNumber: row.published_version_number,
    nodeCount: row.published_node_count || row.latest_node_count || 0,
    edgeCount: row.published_edge_count || row.latest_edge_count || 0,
    displayOrder: row.display_order || 100,
  };
}

async function loadApplication() {
  const rows = await queryRows(
    `
      SELECT
        app_id,
        app_code,
        title,
        manifest_version,
        description,
        active
      FROM core.applications
      WHERE app_code = $1
        AND active = TRUE
      LIMIT 1
    `,
    [APP_CODE],
  );

  if (rows.length === 0) {
    throw new Error(`Active application config not found for app_code=${APP_CODE}`);
  }

  return rows[0];
}

async function loadCategories() {
  const rows = await queryRows(
    `
      SELECT
        c.category_id,
        c.category_code,
        c.name,
        c.label,
        c.description,
        c.display_order,
        c.enabled
      FROM core.tool_categories c
      JOIN core.applications a
        ON a.app_id = c.app_id
      JOIN core.tool_category_visibility cv
        ON cv.category_id = c.category_id
      WHERE a.app_code = $1
        AND a.active = TRUE
        AND c.enabled = TRUE
        AND cv.channel_code = 'cli'
      ORDER BY c.display_order, c.label
    `,
    [APP_CODE],
  );

  return rows.map(mapCategory);
}

async function loadTools() {
  const rows = await queryRows(
    `
      SELECT
        t.tool_id,
        c.category_code,
        t.tool_code,
        t.name,
        t.label,
        t.description,
        r.repo_code AS script_repo_code,
        t.script_path,
        t.runtime_code,
        rt.executable AS runtime_executable,
        t.permission_code,
        t.risk_code,
        t.requires_confirmation,
        t.confirmation_text,
        t.captures_output,
        t.allow_params,
        t.display_order,
        t.enabled
      FROM core.tools t
      JOIN core.tool_categories c
        ON c.category_id = t.category_id
      JOIN core.applications a
        ON a.app_id = c.app_id
      JOIN core.tool_visibility tv
        ON tv.tool_id = t.tool_id
      JOIN core.repositories r
        ON r.repo_id = t.script_repo_id
      JOIN core.runtimes rt
        ON rt.runtime_code = t.runtime_code
      WHERE a.app_code = $1
        AND a.active = TRUE
        AND c.enabled = TRUE
        AND t.enabled = TRUE
        AND tv.channel_code = 'cli'
        AND rt.active = TRUE
      ORDER BY c.display_order, t.display_order, t.label
    `,
    [APP_CODE],
  );

  return rows.map(mapTool);
}

async function loadParameters() {
  const rows = await queryRows(
    `
      SELECT
        t.tool_code,
        p.parameter_name,
        p.label,
        p.param_type_code,
        p.prompt,
        p.required,
        p.default_value,
        p.option_source_code,
        p.display_order,
        p.enabled
      FROM core.tool_parameters p
      JOIN core.tools t
        ON t.tool_id = p.tool_id
      JOIN core.tool_categories c
        ON c.category_id = t.category_id
      JOIN core.applications a
        ON a.app_id = c.app_id
      WHERE a.app_code = $1
        AND p.enabled = TRUE
        AND t.enabled = TRUE
        AND c.enabled = TRUE
      ORDER BY t.tool_code, p.display_order, p.parameter_name
    `,
    [APP_CODE],
  );

  return rows.map(mapParameter);
}

async function loadStaticParameterOptions() {
  const rows = await queryRows(
    `
      SELECT
        t.tool_code,
        p.parameter_name,
        o.option_label,
        o.option_value,
        o.display_order,
        o.enabled
      FROM core.tool_parameter_options o
      JOIN core.tool_parameters p
        ON p.parameter_id = o.parameter_id
      JOIN core.tools t
        ON t.tool_id = p.tool_id
      JOIN core.tool_categories c
        ON c.category_id = t.category_id
      JOIN core.applications a
        ON a.app_id = c.app_id
      WHERE a.app_code = $1
        AND o.enabled = TRUE
        AND p.enabled = TRUE
        AND t.enabled = TRUE
        AND c.enabled = TRUE
      ORDER BY t.tool_code, p.parameter_name, o.display_order, o.option_label
    `,
    [APP_CODE],
  );

  return rows.map(mapStaticOption);
}

async function loadRepositories() {
  const rows = await queryRows(
    `
      SELECT
        r.repo_code,
        r.repo_name,
        rp.root_path,
        r.display_order,
        r.active
      FROM core.repositories r
      JOIN core.repository_paths rp
        ON rp.repo_id = r.repo_id
      JOIN core.config_profiles cp
        ON cp.profile_id = rp.profile_id
      WHERE cp.profile_code = $1
        AND cp.active = TRUE
        AND r.active = TRUE
        AND rp.active = TRUE
      ORDER BY r.display_order, r.repo_code
    `,
    [PROFILE_CODE],
  );

  return rows.map(mapRepository);
}

async function loadWorkflowDefinitions() {
  const rows = await queryRows(
    `
      SELECT
        workflow_definition_id,
        workflow_code,
        display_name,
        description,
        status,
        enabled,
        visible_in_admin,
        start_permission_code,
        published_version_id,
        published_version_number,
        latest_node_count,
        latest_edge_count,
        published_node_count,
        published_edge_count,
        updated_at
      FROM worker.vw_workflow_definitions
      WHERE status = 'ACTIVE'
        AND enabled = TRUE
        AND visible_in_admin = TRUE
        AND published_version_id IS NOT NULL
      ORDER BY display_name, workflow_code
    `,
  );

  return rows.map(mapWorkflowDefinition);
}

async function loadSkyserverWorkflowOptions() {
  const workflows = await loadWorkflowDefinitions();

  return workflows.map((workflow, index) => ({
    label: `${workflow.displayName} (${workflow.workflowCode})`,
    value: workflow.workflowCode,
    displayOrder: workflow.displayOrder || index + 1,
  }));
}

function attachParametersToTools(tools, parameters, staticOptions) {
  const toolsByCode = new Map(tools.map((tool) => [tool.toolCode, tool]));
  const optionsByParam = new Map();

  for (const option of staticOptions) {
    const key = `${option.toolCode}:${option.parameterName}`;

    if (!optionsByParam.has(key)) {
      optionsByParam.set(key, []);
    }

    optionsByParam.get(key).push({
      label: option.label,
      value: option.value,
      displayOrder: option.displayOrder,
    });
  }

  for (const param of parameters) {
    const tool = toolsByCode.get(param.toolCode);

    if (!tool) {
      continue;
    }

    const key = `${param.toolCode}:${param.name}`;
    param.options = (optionsByParam.get(key) || []).sort(sortByDisplayOrderThenName);
    tool.params.push(param);
  }

  for (const tool of tools) {
    tool.params.sort(sortByDisplayOrderThenName);
  }
}

function attachToolsToCategories(categories, tools) {
  const categoriesByCode = new Map(categories.map((category) => [category.categoryCode, category]));

  for (const tool of tools) {
    const category = categoriesByCode.get(tool.categoryCode);

    if (!category) {
      continue;
    }

    category.scripts.push(tool);
  }

  for (const category of categories) {
    category.scripts.sort(sortByDisplayOrderThenName);
  }

  return categories.filter((category) => category.scripts.length > 0);
}

async function loadManifestFromDatabase() {
  const [application, categories, tools, parameters, staticOptions, repositories, workflows] =
    await Promise.all([
      loadApplication(),
      loadCategories(),
      loadTools(),
      loadParameters(),
      loadStaticParameterOptions(),
      loadRepositories(),
      loadWorkflowDefinitions(),
    ]);

  attachParametersToTools(tools, parameters, staticOptions);

  return {
    app: {
      appCode: application.app_code,
      title: application.title,
      manifestVersion: application.manifest_version,
      description: application.description,
    },
    profileCode: PROFILE_CODE,
    repositories,
    workflows,
    categories: attachToolsToCategories(categories, tools),
    source: 'database',
  };
}

// ------------------------------------------------------------
// Recovery fallback
// ------------------------------------------------------------

function getRecoveryManifest(error) {
  return {
    app: {
      appCode: 'SKYSERVER_CORE_RECOVERY',
      title: 'SkyServer Core Recovery',
      manifestVersion: 'recovery',
      description: 'Minimal recovery launcher used when database configuration cannot be loaded.',
    },
    profileCode: PROFILE_CODE,
    repositories: [
      {
        repoCode: 'SkyServer',
        repoName: 'SkyServer',
        rootPath: SKY_SERVER_ROOT,
        displayOrder: 40,
        active: true,
      },
    ],
    workflows: [],
    categories: [
      {
        categoryCode: 'recovery_tools',
        name: 'Recovery Tools',
        label: 'Recovery Tools',
        description: 'Minimal direct tools available while database configuration is unavailable.',
        displayOrder: 10,
        enabled: true,
        scripts: [
          {
            toolCode: 'db_health',
            name: 'db_health',
            label: 'Database Health Check',
            description: 'Tests PostgreSQL connectivity using the configured environment.',
            scriptRepoCode: 'SkyServer',
            scriptPath: 'packages/db/src/db_health.js',
            runtimeCode: 'node',
            risk: 'low',
            requiresConfirmation: false,
            confirmationText: null,
            capturesOutput: true,
            allowParams: false,
            displayOrder: 10,
            enabled: true,
            params: [],
          },
          {
            toolCode: 'db_build',
            name: 'db_build',
            label: 'Database Build',
            description: 'Rebuilds the PostgreSQL database from ordered migrations and seed files.',
            scriptRepoCode: 'SkyServer',
            scriptPath: 'packages/db_build/src/db_build.js',
            runtimeCode: 'node',
            risk: 'high',
            requiresConfirmation: true,
            confirmationText:
              'Database configuration could not be loaded. Use this only if you intentionally want to run the database build.',
            capturesOutput: true,
            allowParams: false,
            displayOrder: 20,
            enabled: true,
            params: [],
          },
        ],
      },
    ],
    source: 'recovery',
    loadError: error,
  };
}

// ------------------------------------------------------------
// Script/menu helpers
// ------------------------------------------------------------

function getRepositoryOptions(config) {
  return [...config.repositories]
    .filter((repo) => repo.active !== false)
    .sort(sortByDisplayOrderThenName)
    .map((repo) => ({
      label: repo.repoName || repo.repoCode,
      value: repo.repoCode,
    }));
}

function getRepositoryRoot(config, repoCode) {
  const repo = config.repositories.find((item) => item.repoCode === repoCode);

  if (!repo || !repo.rootPath) {
    return null;
  }

  return repo.rootPath;
}

async function getOptionsForParam(param, config) {
  if (Array.isArray(param.options) && param.options.length > 0) {
    return param.options.map((option) => ({
      label: option.label || option.value,
      value: option.value,
      displayOrder: option.displayOrder,
    }));
  }

  if (
    param.paramTypeCode === 'repo' ||
    param.type === 'repo' ||
    param.optionSourceCode === 'repositories'
  ) {
    return getRepositoryOptions(config);
  }

  if (param.optionSourceCode === 'skyserver_workflows') {
    return loadSkyserverWorkflowOptions();
  }

  return null;
}

function getParamPrompt(param) {
  return param.prompt || param.label || param.name;
}

function resolveScriptFile(config, scriptDef) {
  const scriptRepoCode = scriptDef.scriptRepoCode || 'SkyServer';
  const repoRoot = getRepositoryRoot(config, scriptRepoCode);

  if (!repoRoot) {
    throw new Error(
      `No active repository path found for repo=${scriptRepoCode}, profile=${config.profileCode}`,
    );
  }

  if (path.isAbsolute(scriptDef.scriptPath)) {
    return scriptDef.scriptPath;
  }

  return path.resolve(repoRoot, scriptDef.scriptPath);
}

function getRuntimeCommand(scriptDef) {
  const runtime = getRuntime(scriptDef);

  if (runtime === 'node') {
    return {
      command: process.execPath,
      prefixArgs: [],
      label: 'node',
    };
  }

  if (runtime === 'powershell') {
    return {
      command: scriptDef.runtimeExecutable || 'powershell.exe',
      prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
      label: 'powershell',
    };
  }

  if (runtime === 'pwsh') {
    return {
      command: scriptDef.runtimeExecutable || 'pwsh',
      prefixArgs: ['-NoProfile', '-File'],
      label: 'pwsh',
    };
  }

  throw new Error(`Unsupported runtime: ${runtime}`);
}

// ------------------------------------------------------------
// Main menu
// ------------------------------------------------------------

async function mainMenu(config) {
  console.clear();
  printHeader(config.app.title || 'SkyServer Core');

  if (config.source === 'database') {
    console.log(gray(`Config source: PostgreSQL core schema | profile=${config.profileCode}\n`));
  } else {
    console.log(yellow(`Config source: RECOVERY FALLBACK | profile=${config.profileCode}`));
    console.log(yellow(`Reason: ${config.loadError.message}\n`));
  }

  const workflowCount = Array.isArray(config.workflows) ? config.workflows.length : 0;

  console.log(`${magenta(1)}) Run Tools`);
  console.log(gray('   Database-backed SkyServer Core tools and scripts.'));
  console.log(`${magenta(2)}) Run Workflows`);
  console.log(gray(`   Start active published SkyServer workflows through Temporal. ${workflowCount} available.`));
  console.log(`${magenta(3)}) Exit\n`);

  const choice = await askQuestion(yellow('Select an option: '));

  if (choice === '1') {
    await toolsCategoryMenu(config);
    return mainMenu(config);
  }

  if (choice === '2') {
    await workflowMenu(config);
    return mainMenu(config);
  }

  if (choice === '3') {
    console.log(green('\nGoodbye'));
    await closePool();
    process.exit(0);
  }

  console.log(red('\nInvalid selection.'));
  await waitForEnter();
  return mainMenu(config);
}

async function toolsCategoryMenu(config) {
  console.clear();
  printHeader(config.app.title || 'SkyServer Core');

  if (config.source === 'database') {
    console.log(gray(`Config source: PostgreSQL core schema | profile=${config.profileCode}\n`));
  } else {
    console.log(yellow(`Config source: RECOVERY FALLBACK | profile=${config.profileCode}`));
    console.log(yellow(`Reason: ${config.loadError.message}\n`));
  }

  const categories = [...config.categories].filter(isEnabled).sort(sortByDisplayOrderThenName);

  categories.forEach((category, index) => {
    console.log(`${magenta(index + 1)}) ${getDisplayName(category)}`);

    if (category.description) {
      console.log(gray(`   ${category.description}`));
    }
  });

  console.log(`${magenta(categories.length + 1)}) Back\n`);

  const choice = await askQuestion(yellow('Select a category: '));
  const index = Number.parseInt(choice, 10);

  if (Number.isNaN(index) || index < 1 || index > categories.length + 1) {
    console.log(red('\nInvalid selection.'));
    await waitForEnter();
    return mainMenu(config);
  }

  if (index === categories.length + 1) {
    return;
  }

  await scriptMenu(config, categories[index - 1]);
  return toolsCategoryMenu(config);
}


// ------------------------------------------------------------
// Workflow menu
// ------------------------------------------------------------

async function loadCoreOperator() {
  const requestedEmail = String(
    process.env.SKYSERVER_CORE_OPERATOR_EMAIL || process.env.SKYSERVER_ADMIN_EMAIL || '',
  ).trim().toLowerCase();

  const userParams = [];
  let userWhere = `
    EXISTS (
      SELECT 1
      FROM auth.vw_user_roles ur
      WHERE ur.user_id = u.user_id
        AND ur.app_code = 'SKYSERVER_ADMIN'
        AND ur.role_code = 'SUPER_ADMIN'
    )
  `;

  if (requestedEmail) {
    userParams.push(requestedEmail);
    userWhere = 'LOWER(u.email) = $1';
  }

  const userRows = await queryRows(
    `
      SELECT
        u.user_id,
        u.email,
        u.username,
        u.display_name,
        u.status,
        u.is_system_user,
        u.last_login_at
      FROM auth.users u
      WHERE u.status = 'ACTIVE'
        AND ${userWhere}
      ORDER BY u.last_login_at DESC NULLS LAST, u.created_at DESC
      LIMIT 1
    `,
    userParams,
  );

  const userRow = userRows[0] || null;

  if (!userRow) {
    const permissionRows = await queryRows(
      `
        SELECT permission_code
        FROM auth.permissions
        WHERE active = TRUE
          AND permission_code IN ('WORKFLOW_RUN', 'TEMPORAL_WORKFLOW_START', 'WORKER_SCHEDULE_RUN')
      `,
    );

    return {
      user: null,
      permissions: permissionRows.map((row) => ({ permissionCode: row.permission_code })),
      note: requestedEmail
        ? `No active operator found for ${requestedEmail}; using limited workflow-run permissions.`
        : 'No active SUPER_ADMIN operator found; using limited workflow-run permissions.',
    };
  }

  const permissionRows = await queryRows(
    `
      SELECT DISTINCT permission_code
      FROM auth.vw_user_permissions
      WHERE user_id = $1
        AND app_code = 'SKYSERVER_ADMIN'
      ORDER BY permission_code
    `,
    [userRow.user_id],
  );

  return {
    user: {
      userId: userRow.user_id,
      email: userRow.email,
      username: userRow.username,
      displayName: userRow.display_name,
      status: userRow.status,
      isSystemUser: toBoolean(userRow.is_system_user),
      source: 'skyserver_core_cli',
    },
    permissions: permissionRows.map((row) => ({ permissionCode: row.permission_code })),
    note: requestedEmail
      ? `Operator resolved from SKYSERVER_CORE_OPERATOR_EMAIL=${requestedEmail}.`
      : `Operator resolved from latest active SUPER_ADMIN: ${userRow.display_name || userRow.email}.`,
  };
}

async function workflowMenu(config) {
  console.clear();
  printHeader('Run Workflows');

  if (config.source !== 'database') {
    console.log(red('Workflows require the PostgreSQL-backed SkyServer configuration.'));
    await waitForEnter();
    return;
  }

  const workflows = await loadWorkflowDefinitions();

  if (workflows.length === 0) {
    console.log(yellow('No active published SkyServer workflows are available.'));
    await waitForEnter();
    return;
  }

  workflows.forEach((workflow, index) => {
    console.log(
      `${magenta(index + 1)}) ${workflow.displayName} ${gray(`(${workflow.workflowCode})`)}`,
    );
    console.log(
      gray(
        `   v${workflow.publishedVersionNumber || '?'} · ${workflow.nodeCount} node(s) · ${workflow.edgeCount} edge(s)${workflow.startPermissionCode ? ` · permission ${workflow.startPermissionCode}` : ''}`,
      ),
    );

    if (workflow.description) {
      console.log(gray(`   ${workflow.description}`));
    }
  });

  console.log(`${magenta(workflows.length + 1)}) Back\n`);

  const choice = await askQuestion(yellow('Select a workflow: '));
  const index = Number.parseInt(choice, 10);

  if (Number.isNaN(index) || index < 1 || index > workflows.length + 1) {
    console.log(red('\nInvalid selection.'));
    await waitForEnter();
    return workflowMenu(config);
  }

  if (index === workflows.length + 1) {
    return;
  }

  await runWorkflow(config, workflows[index - 1]);
}

function parseWorkflowInputJson(inputJson) {
  const trimmed = String(inputJson || '').trim();

  if (!trimmed) {
    return {};
  }

  let parsed;

  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Workflow input must be valid JSON: ${error.message}`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Workflow input JSON must be an object.');
  }

  return parsed;
}

async function collectWorkflowInput(workflow) {
  console.log('');
  console.log(yellow(`Workflow: ${workflow.displayName} (${workflow.workflowCode})`));
  console.log(gray(`Published version: v${workflow.publishedVersionNumber || '?'}`));
  console.log(gray(`Graph: ${workflow.nodeCount} node(s), ${workflow.edgeCount} edge(s)`));

  if (workflow.description) {
    console.log(gray(workflow.description));
  }

  const executorAnswer = await askQuestion(
    yellow(
      `Executor mode [${DEFAULT_WORKFLOW_EXECUTOR_MODE === 'inline' ? 'inline' : 'temporal'}] (temporal/inline): `,
    ),
  );
  const executorMode = String(executorAnswer || DEFAULT_WORKFLOW_EXECUTOR_MODE || 'temporal')
    .trim()
    .toLowerCase();

  if (!['temporal', 'inline'].includes(executorMode)) {
    throw new Error('Executor mode must be temporal or inline.');
  }

  const workflowId = await askQuestion(
    yellow('Optional Temporal workflow ID override (leave blank for auto-generated): '),
  );
  const inputJson = await askQuestion(
    yellow('Optional workflow input JSON object (leave blank for saved node defaults): '),
  );

  const input = parseWorkflowInputJson(inputJson);

  if (workflowId.trim()) {
    input.workflowId = workflowId.trim();
  }

  input.runSource = input.runSource || 'manual';
  input.triggerType = input.triggerType || 'MANUAL';
  input.startedFrom = input.startedFrom || 'skyserver_core_cli';

  return {
    executorMode,
    input,
  };
}

async function runWorkflow(config, workflow) {
  console.clear();
  printHeader(`Starting Workflow: ${workflow.displayName}`);

  let launch;

  try {
    launch = await collectWorkflowInput(workflow);
  } catch (error) {
    console.error(red(`\nERROR: ${error.message}`));
    await waitForEnter();
    return;
  }

  console.log('');
  console.log(yellow('⚠️  Confirmation required for workflow start'));
  console.log(yellow(`Workflow: ${workflow.displayName} (${workflow.workflowCode})`));
  console.log(yellow(`Executor: ${launch.executorMode}`));
  console.log(yellow('Type YES to start this workflow.'));

  const confirmed = await askQuestion(yellow('Confirm: '));

  if (confirmed !== 'YES') {
    console.log(yellow('\nCancelled.'));
    await waitForEnter();
    return;
  }

  let operator;

  try {
    operator = await loadCoreOperator();
  } catch (error) {
    console.error(red(`\nERROR resolving CLI operator: ${error.message}`));
    await waitForEnter();
    return;
  }

  console.log(gray(`\n${operator.note}`));
  console.log(green(`Starting ${workflow.workflowCode} through ${launch.executorMode} executor...\n`));

  try {
    const execute =
      launch.executorMode === 'inline'
        ? workflowExecutorService.executeWorkflow
        : workflowExecutorService.startWorkflowWithTemporal;
    const result = await execute({
      workflowCode: workflow.workflowCode,
      input: launch.input,
      user: operator.user,
      session: null,
      permissions: operator.permissions,
      context: {
        ipAddress: null,
        userAgent: CLI_USER_AGENT,
      },
    });

    const run = result.run || {};
    const temporalWorkflow = result.temporalWorkflow || run.temporalWorkflow || {};

    console.log(green(result.message || `Workflow ${workflow.workflowCode} started.`));
    console.log('');
    console.log(`Run record: ${run.workflowRunRecordId || 'n/a'}`);
    console.log(`Status: ${run.status || (result.started ? 'RUNNING' : result.ok ? 'COMPLETED' : 'UNKNOWN')}`);

    if (run.versionNumber) {
      console.log(`Version: v${run.versionNumber}`);
    }

    if (temporalWorkflow.workflowId || run.temporalWorkflowId) {
      console.log(`Temporal workflow ID: ${temporalWorkflow.workflowId || run.temporalWorkflowId}`);
    }

    if (temporalWorkflow.runId || run.temporalRunId) {
      console.log(`Temporal run ID: ${temporalWorkflow.runId || run.temporalRunId}`);
    }
  } catch (error) {
    console.error(red('\nERROR starting workflow:'));
    console.error(error.details ? JSON.stringify(error.details, null, 2) : error.message || error);
  }

  await waitForEnter();
}

// ------------------------------------------------------------
// Script menu
// ------------------------------------------------------------

async function scriptMenu(config, category) {
  console.clear();
  printHeader(getDisplayName(category));

  const scripts = [...category.scripts].filter(isEnabled).sort(sortByDisplayOrderThenName);

  scripts.forEach((script, index) => {
    const risk = script.risk ? ` [${script.risk.toUpperCase()}]` : '';

    console.log(`${magenta(index + 1)}) ${getDisplayName(script)}${gray(risk)}`);

    if (script.description) {
      console.log(gray(`   ${script.description}`));
    }
  });

  console.log(`${magenta(scripts.length + 1)}) Back\n`);

  const choice = await askQuestion(yellow('Select a script: '));
  const index = Number.parseInt(choice, 10);

  if (Number.isNaN(index) || index < 1 || index > scripts.length + 1) {
    console.log(red('\nInvalid selection.'));
    await waitForEnter();
    return scriptMenu(config, category);
  }

  if (index === scripts.length + 1) {
    return;
  }

  await runScript(config, scripts[index - 1]);
}

// ------------------------------------------------------------
// Script execution
// ------------------------------------------------------------

async function collectScriptArgs(scriptDef, config) {
  const args = [];

  for (const param of scriptDef.params || []) {
    const options = await getOptionsForParam(param, config);
    const prompt = getParamPrompt(param);

    if (options && options.length > 0) {
      console.log(`\n${prompt}`);

      options.sort(sortByDisplayOrderThenName).forEach((option, index) => {
        console.log(`${index + 1}) ${option.label}`);
      });

      const choice = await askQuestion(yellow('Select an option: '));
      const index = Number.parseInt(choice, 10);

      if (Number.isNaN(index) || index < 1 || index > options.length) {
        throw new Error(`Invalid selection for ${param.name}`);
      }

      args.push(options[index - 1].value);
      continue;
    }

    const answer = await askQuestion(yellow(`${prompt}: `));

    if (param.required && answer === '') {
      throw new Error(`${param.name} is required.`);
    }

    if (!param.required && answer === '') {
      continue;
    }

    args.push(answer === '' ? param.defaultValue : answer);
  }

  return args.filter((arg) => arg !== undefined && arg !== null);
}

async function confirmRisk(scriptDef) {
  if (!scriptDef.requiresConfirmation) {
    return true;
  }

  const risk = scriptDef.risk ? scriptDef.risk.toUpperCase() : 'UNKNOWN';
  const scriptName = getDisplayName(scriptDef);

  console.log('');
  console.log(yellow(`⚠️  Confirmation required for ${scriptName}`));
  console.log(yellow(`Risk level: ${risk}`));

  if (scriptDef.confirmationText) {
    console.log(yellow(scriptDef.confirmationText));
  }

  const answer = await askQuestion(yellow('Type YES to continue: '));

  return answer === 'YES';
}

async function runScript(config, scriptDef) {
  console.clear();
  printHeader(`Executing: ${getDisplayName(scriptDef)}`);

  if (!scriptDef.scriptPath) {
    console.error(red('ERROR: Script file is not configured.'));
    await waitForEnter();
    return;
  }

  let scriptFile;

  try {
    scriptFile = resolveScriptFile(config, scriptDef);
  } catch (err) {
    console.error(red(`ERROR: ${err.message}`));
    await waitForEnter();
    return;
  }

  if (!fs.existsSync(scriptFile)) {
    console.error(red(`ERROR: Script file not found at: ${scriptFile}`));
    await waitForEnter();
    return;
  }

  let args;

  try {
    const confirmed = await confirmRisk(scriptDef);

    if (!confirmed) {
      console.log(yellow('\nCancelled.'));
      await waitForEnter();
      return;
    }

    args = await collectScriptArgs(scriptDef, config);
  } catch (err) {
    console.error(red(`\nERROR: ${err.message}`));
    await waitForEnter();
    return;
  }

  let runtimeCommand;

  try {
    runtimeCommand = getRuntimeCommand(scriptDef);
  } catch (err) {
    console.error(red(`\nERROR: ${err.message}`));
    await waitForEnter();
    return;
  }

  const commandArgs = [...runtimeCommand.prefixArgs, scriptFile, ...args];

  console.log('\nRunning:');
  console.log(
    green(`${runtimeCommand.label} ${scriptFile} ${args.map((arg) => `"${arg}"`).join(' ')}`),
  );
  console.log('');

  const result = spawnSync(runtimeCommand.command, commandArgs, {
    cwd: path.dirname(scriptFile),
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error(red('\nERROR running script:'));
    console.error(result.error.message);
  } else if (result.status !== 0) {
    console.error(red(`\nScript exited with status code ${result.status}`));
  }

  await waitForEnter();
}

// ------------------------------------------------------------
// Shutdown
// ------------------------------------------------------------

async function closePool() {
  try {
    await pool.end();
  } catch {
    // Nothing useful to do during CLI shutdown.
  }
}

async function shutdown(signal) {
  console.log(yellow(`\nReceived ${signal}. Shutting down...`));
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

async function start() {
  let config;

  try {
    config = await loadManifestFromDatabase();
  } catch (error) {
    config = getRecoveryManifest(error);
  }

  if (config.categories.length === 0 && (!Array.isArray(config.workflows) || config.workflows.length === 0)) {
    console.error(red('ERROR: No CLI-visible tools or runnable workflows found.'));
    await closePool();
    process.exit(1);
  }

  await mainMenu(config);
}

start().catch(async (error) => {
  console.error(red('\nFatal SkyServer Core error:'));
  console.error(error);
  await closePool();
  process.exit(1);
});
