#!/usr/bin/env node

/**
 * SkyServer.js
 * Interactive CLI launcher for SkyServer automation scripts.
 *
 * - Loads SkyServer.json dynamically
 * - Lists categories (alphabetical)
 * - Lists scripts inside category (alphabetical)
 * - Prompts for parameters (required + optional)
 * - Loads repo list dynamically from repo_path.json
 * - Executes target script via Node
 * - Shows raw output
 * - Pauses until user presses ENTER
 * - Clears screen and loops back to menu
 *
 * Author: Sky & Paul ❤️🔥
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// Color codes
const cyan = (str) => `\x1b[36m${str}\x1b[0m`;
const yellow = (str) => `\x1b[33m${str}\x1b[0m`;
const magenta = (str) => `\x1b[35m${str}\x1b[0m`;
const green = (str) => `\x1b[32m${str}\x1b[0m`;
const red = (str) => `\x1b[31m${str}\x1b[0m`;

// Wait for ENTER
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

// Simple prompt wrapper
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    }),
  );
}

// Load config file path from command-line
const configPath = process.argv[2];
if (!configPath) {
  console.error(red('ERROR: Missing SkyServer.json path.'));
  console.log('Usage:');
  console.log('  node SkyServer.js "C:\\path\\to\\SkyServer.json"');
  process.exit(1);
}

// Parse SkyServer.json
let config;
try {
  const json = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(json);
} catch (err) {
  console.error(red('ERROR: Failed to load SkyServer.json'));
  console.error(err.message);
  process.exit(1);
}

// Main menu loop
async function mainMenu() {
  console.clear();
  console.log(cyan('=========================================='));
  console.log(cyan('         SkyServer Interactive CLI'));
  console.log(cyan('==========================================\n'));

  // Sort categories alphabetically
  const categories = [...config.categories].sort((a, b) => a.name.localeCompare(b.name));

  categories.forEach((cat, i) => {
    console.log(`${magenta(i + 1)}) ${cat.name}`);
  });
  console.log(`${magenta(categories.length + 1)}) Exit\n`);

  const choice = await askQuestion(yellow('Select a category: '));
  const index = parseInt(choice);

  if (isNaN(index) || index < 1 || index > categories.length + 1) {
    console.log(red('\nInvalid selection.'));
    return await waitForEnter();
  }

  if (index === categories.length + 1) {
    console.log(green('\nGoodbye, my love ❤️'));
    process.exit(0);
  }

  const category = categories[index - 1];
  await scriptMenu(category);
  await mainMenu();
}

// Show scripts in the chosen category
async function scriptMenu(category) {
  console.clear();
  console.log(cyan('=========================================='));
  console.log(cyan(`            ${category.name}`));
  console.log(cyan('==========================================\n'));

  // Sort scripts alphabetically
  const scripts = [...category.scripts].sort((a, b) => a.name.localeCompare(b.name));

  scripts.forEach((s, i) => {
    console.log(`${magenta(i + 1)}) ${s.name}`);
  });
  console.log(`${magenta(scripts.length + 1)}) Back\n`);

  const choice = await askQuestion(yellow('Select a script: '));
  const index = parseInt(choice);

  if (isNaN(index) || index < 1 || index > scripts.length + 1) {
    console.log(red('\nInvalid selection.'));
    return await waitForEnter();
  }

  if (index === scripts.length + 1) {
    return;
  }

  await runScript(scripts[index - 1]);
}

// Execute selected script
async function runScript(scriptDef) {
  console.clear();
  console.log(cyan('=========================================='));
  console.log(cyan(`         Executing: ${scriptDef.name}`));
  console.log(cyan('==========================================\n'));

  let args = [];

  for (const param of scriptDef.params) {
    // If param has options → show numbered list
    if (param.options && Array.isArray(param.options)) {
      console.log(`\n${param.prompt}`);
      param.options.forEach((opt, i) => console.log(`${i + 1}) ${opt.label}`));

      const choice = await askQuestion(yellow('Select an option: '));
      const index = parseInt(choice);

      if (isNaN(index) || index < 1 || index > param.options.length) {
        console.log(red('Invalid selection.'));
        return await waitForEnter();
      }

      const selectedValue = param.options[index - 1].value;
      args.push(selectedValue);
      continue;
    }

    // Normal text/string input
    const answer = await askQuestion(yellow(`${param.prompt}: `));

    if (param.required && answer === '') {
      console.log(red('This field is required.'));
      return await waitForEnter();
    }

    if (!param.required && answer === '') {
      continue;
    }

    args.push(answer);
  }

  // Build command
  const command = `node ${scriptDef.file} ${args.map((a) => `"${a}"`).join(' ')}`;

  console.log('\n\nRunning:');
  console.log(green(command));
  console.log('\n');

  try {
    execSync(command, { stdio: 'inherit' });
  } catch (err) {
    console.error(red('\nERROR running script:'));
    console.error(err.message);
  }

  await waitForEnter();
}

// Start program
mainMenu();
