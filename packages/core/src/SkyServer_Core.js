#!/usr/bin/env node

/**
 * SkyServer_Core.js
 * Interactive CLI launcher for SkyServer automation scripts.
 *
 * - Loads config/SkyServer.json relative to this file
 * - Displays SkyServer Core as the app title
 * - Lists categories alphabetically
 * - Lists scripts alphabetically
 * - Prompts for script parameters from config
 * - Resolves script file locations from config
 * - Executes target scripts through Node
 * - Shows raw script output
 * - Pauses until ENTER
 * - Clears screen and loops back to menu
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

  if (param.type === 'repo') {
    return loadRepoOptions(config);
  }

  return null;
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

  const categories = [...config.categories].sort((a, b) => a.name.localeCompare(b.name));

  categories.forEach((category, index) => {
    console.log(`${magenta(index + 1)}) ${category.name}`);
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
  printHeader(category.name);

  const scripts = [...category.scripts].sort((a, b) => a.name.localeCompare(b.name));

  scripts.forEach((script, index) => {
    console.log(`${magenta(index + 1)}) ${script.name}`);
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

    if (options && options.length > 0) {
      console.log(`\n${param.prompt}`);

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

    const answer = await askQuestion(yellow(`${param.prompt}: `));

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

async function runScript(scriptDef) {
  console.clear();
  printHeader(`Executing: ${scriptDef.name}`);

  const scriptFile = resolveFromSkyServerRoot(scriptDef.file);

  if (!fs.existsSync(scriptFile)) {
    console.error(red(`ERROR: Script file not found at: ${scriptFile}`));
    await waitForEnter();
    return;
  }

  let args;

  try {
    args = await collectScriptArgs(scriptDef);
  } catch (err) {
    console.error(red(`\nERROR: ${err.message}`));
    await waitForEnter();
    return;
  }

  console.log('\nRunning:');
  console.log(green(`node ${scriptFile} ${args.map((arg) => `"${arg}"`).join(' ')}`));
  console.log('');

  const result = spawnSync(process.execPath, [scriptFile, ...args], {
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
