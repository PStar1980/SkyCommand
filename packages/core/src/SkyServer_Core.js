#!/usr/bin/env node

/**
 * SkyServer_Core.js
 * Interactive CLI launcher for SkyServer automation scripts.
 *
 * - Loads config/SkyServer.json relative to this file
 * - Displays SkyServer Core as the app title
 * - Lists CLI-visible categories/scripts
 * - Prompts for script parameters from config
 * - Resolves script file locations from config
 * - Executes target scripts through configured runtime
 * - Shows raw script output
 * - Pauses until ENTER
 * - Clears screen and loops back to menu
 *
 * The SkyServer.json manifest is shared between:
 * - SkyServer Core CLI
 * - future Admin-Web/API tool execution
 *
 * Author: Paul Sattaur
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

// ------------------------------------------------------------
// Paths
// ------------------------------------------------------------

const CORE_DIR = __dirname;
const CONFIG_PATH = path.join(CORE_DIR, 'config', 'SkyServer.json');

// SkyServer/packages/core/src -> SkyServer
const SKY_SERVER_ROOT = path.resolve(CORE_DIR, '../../..');

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

// ------------------------------------------------------------
// Config helpers
// ------------------------------------------------------------

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(red(`ERROR: Failed to load ${label}`));
    console.error(err.message);
    process.exit(1);
  }
}

function resolveFromSkyServerRoot(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(SKY_SERVER_ROOT, filePath);
}

function isVisibleInCli(item) {
  if (item.enabled === false) {
    return false;
  }

  if (!Array.isArray(item.visibility)) {
    return true;
  }

  return item.visibility.includes('cli');
}

function getDisplayName(item) {
  return item.label || item.name || item.id || 'Unnamed';
}

function getScriptId(scriptDef) {
  return scriptDef.id || scriptDef.name || scriptDef.label || 'unknown_script';
}

function getScriptFile(scriptDef) {
  return scriptDef.scriptFile || scriptDef.file;
}

function getRuntime(scriptDef) {
  return scriptDef.runtime || 'node';
}

function sortByDisplayOrderThenName(a, b) {
  const orderA = Number.isFinite(a.displayOrder) ? a.displayOrder : 999999;
  const orderB = Number.isFinite(b.displayOrder) ? b.displayOrder : 999999;

  if (orderA !== orderB) {
    return orderA - orderB;
  }

  return getDisplayName(a).localeCompare(getDisplayName(b));
}

function loadRepoOptions(config) {
  const repoPathConfig = config.paths?.repoPathConfig;

  if (!repoPathConfig) {
    return [];
  }

  const resolvedRepoConfigPath = resolveFromSkyServerRoot(repoPathConfig);

  if (!fs.existsSync(resolvedRepoConfigPath)) {
    console.error(red(`ERROR: repo_path.json not found at: ${resolvedRepoConfigPath}`));
    process.exit(1);
  }

  const repoPaths = readJson(resolvedRepoConfigPath, 'repo_path.json');

  return Object.keys(repoPaths)
    .sort((a, b) => a.localeCompare(b))
    .map((repoName) => ({
      label: repoName,
      value: repoName,
    }));
}

function getOptionsForParam(param, config) {
  if (Array.isArray(param.options)) {
    return param.options;
  }

  if (param.type === 'repo' || param.optionsSource === 'repositories') {
    return loadRepoOptions(config);
  }

  return null;
}

function getParamPrompt(param) {
  return param.prompt || param.label || param.name;
}

// ------------------------------------------------------------
// Load SkyServer Core config
// ------------------------------------------------------------

if (!fs.existsSync(CONFIG_PATH)) {
  console.error(red(`ERROR: SkyServer Core config not found at: ${CONFIG_PATH}`));
  process.exit(1);
}

const config = readJson(CONFIG_PATH, 'SkyServer.json');
const appTitle = config.app?.title || 'SkyServer Core';

// ------------------------------------------------------------
// Main menu
// ------------------------------------------------------------

async function mainMenu() {
  console.clear();
  printHeader(appTitle);

  const categories = [...config.categories]
    .filter(isVisibleInCli)
    .filter((category) => Array.isArray(category.scripts))
    .map((category) => ({
      ...category,
      scripts: category.scripts.filter(isVisibleInCli),
    }))
    .filter((category) => category.scripts.length > 0)
    .sort(sortByDisplayOrderThenName);

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
    return mainMenu();
  }

  if (index === categories.length + 1) {
    console.log(green('\nGoodbye'));
    process.exit(0);
  }

  await scriptMenu(categories[index - 1]);
  return mainMenu();
}

// ------------------------------------------------------------
// Script menu
// ------------------------------------------------------------

async function scriptMenu(category) {
  console.clear();
  printHeader(getDisplayName(category));

  const scripts = [...category.scripts].filter(isVisibleInCli).sort(sortByDisplayOrderThenName);

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
    return scriptMenu(category);
  }

  if (index === scripts.length + 1) {
    return;
  }

  await runScript(scripts[index - 1]);
}

// ------------------------------------------------------------
// Script execution
// ------------------------------------------------------------

async function collectScriptArgs(scriptDef) {
  const args = [];

  for (const param of scriptDef.params || []) {
    const options = getOptionsForParam(param, config);
    const prompt = getParamPrompt(param);

    if (options && options.length > 0) {
      console.log(`\n${prompt}`);

      options.forEach((option, index) => {
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

    args.push(answer);
  }

  return args;
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

function getRuntimeCommand(runtime) {
  if (runtime === 'node') {
    return {
      command: process.execPath,
      prefixArgs: [],
      label: 'node',
    };
  }

  if (runtime === 'powershell') {
    return {
      command: 'powershell.exe',
      prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
      label: 'powershell',
    };
  }

  if (runtime === 'pwsh') {
    return {
      command: 'pwsh',
      prefixArgs: ['-NoProfile', '-File'],
      label: 'pwsh',
    };
  }

  throw new Error(`Unsupported runtime: ${runtime}`);
}

async function runScript(scriptDef) {
  console.clear();
  printHeader(`Executing: ${getDisplayName(scriptDef)}`);

  const scriptPath = getScriptFile(scriptDef);

  if (!scriptPath) {
    console.error(red('ERROR: Script file is not configured.'));
    await waitForEnter();
    return;
  }

  const scriptFile = resolveFromSkyServerRoot(scriptPath);

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

    args = await collectScriptArgs(scriptDef);
  } catch (err) {
    console.error(red(`\nERROR: ${err.message}`));
    await waitForEnter();
    return;
  }

  let runtimeCommand;

  try {
    runtimeCommand = getRuntimeCommand(getRuntime(scriptDef));
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
// Start
// ------------------------------------------------------------

mainMenu();
