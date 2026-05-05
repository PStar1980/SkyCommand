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

const APP_CODE = process.env.SKYSERVER_CORE_APP_CODE || 'SKYSERVER_CORE';
const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

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
  const [application, categories, tools, parameters, staticOptions, repositories] =
    await Promise.all([
      loadApplication(),
      loadCategories(),
      loadTools(),
      loadParameters(),
      loadStaticParameterOptions(),
      loadRepositories(),
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

function getOptionsForParam(param, config) {
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

  const categories = [...config.categories].filter(isEnabled).sort(sortByDisplayOrderThenName);

  categories.forEach((category, index) => {
    console.log(`${magenta(index + 1)}) ${getDisplayName(category)}`);

    if (category.description) {
      console.log(gray(`   ${category.description}`));
    }
  });

  console.log(`${magenta(categories.length + 1)}) Exit\n`);

  const choice = await askQuestion(yellow('Select a category: '));
  const index = Number.parseInt(choice, 10);

  if (Number.isNaN(index) || index < 1 || index > categories.length + 1) {
    console.log(red('\nInvalid selection.'));
    await waitForEnter();
    return mainMenu(config);
  }

  if (index === categories.length + 1) {
    console.log(green('\nGoodbye'));
    await closePool();
    process.exit(0);
  }

  await scriptMenu(config, categories[index - 1]);
  return mainMenu(config);
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
    const options = getOptionsForParam(param, config);
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

  if (config.categories.length === 0) {
    console.error(red('ERROR: No CLI-visible categories/tools found.'));
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
