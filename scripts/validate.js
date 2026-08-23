#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const excludedDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'logs',
  'node_modules',
  'tmp',
]);
const syntaxExtensions = new Set(['.cjs', '.js', '.mjs']);

const routineSelfTests = [
  'db-health:self-test',
  'db-build:self-test',
  'tool-template:self-test',
  'skycommand-repository:self-test',
  'tool-onboarding:self-test',
  'tool-verification:self-test',
  'tool-verification-navigation:self-test',
  'approval-history:self-test',
  'tool-result:self-test',
  'macro-ingestion:self-test',
  'macro-ingestion-cli:self-test',
  'workflow-result-context:self-test',
  'repository-package:self-test',
  'repository-map:self-test',
  'repository-artifact-config:self-test',
  'runtime-path-resolver:self-test',
  'git-repository-status:self-test',
  'git-commit:self-test',
  'git-branch-sync:self-test',
  'git-local-sync:self-test',
  'host-agent:self-test',
  'docker-integration:self-test',
  'host-agent:auto-start:self-test',
  'workflow-node-parameters:self-test',
  'workflow-condition:self-test',
  'workflow-approval-branch:self-test',
  'workflow-tool-confirmation:self-test',
  'workflow-tool-visibility:self-test',
  'workflow-database-output:self-test',
  'workflow-start-catalogue:self-test',
  'workflow-clone-parity:self-test',
  'workflow-host-agent-preflight:self-test',
  'auth-expiry-refresh:self-test',
  'tool-execution-response:self-test',
  'tool-execution-output-workspace:self-test',
  'chart-typography:self-test',
  'dashboard-ui-consistency:self-test',
  'sidebar-accordion:self-test',
  'repository-page-split:self-test',
  'brand-theme:self-test',
  'command-search:self-test',
  'notification-foundation:self-test',
  'skycommand-identity:self-test',
  'api-dashboard:self-test',
  'workflow-cli-params:self-test',
  'temporal-docker:self-test',
  'temporal-worker-docker:self-test',
  'node-worker-docker:self-test',
  'api-docker:self-test',
  'postgres-docker:self-test',
  'core-docker-db:self-test',
  'ingestion-identity:self-test',
  'ingestion-profile-guardrails:self-test',
  'ingestion-data-catalogue:self-test',
  'ingestion-data-catalogue-admin:self-test',
  'ingestion-freshness:self-test',
  'ingestion-freshness-integration:self-test',
  'ingestion-ledger:self-test',
  'ingestion-adapter-retry:self-test',
  'ingestion-adapter-registry:self-test',
  'ingestion-revision-quality:self-test',
  'ingestion-quality-policy:self-test',
  'ingestion-quality-admin:self-test',
  'ingestion-recovery:self-test',
  'ingestion-production-recovery:self-test',
  'ingestion-live-recovery:self-test',
  'ingestion-operations-surface:self-test',
  'ingestion-consumer-contracts:self-test',
];

function collectJavaScriptFiles(directory, output = []) {
  if (!fs.existsSync(directory)) {
    return output;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavaScriptFiles(absolutePath, output);
      continue;
    }

    if (entry.isFile() && syntaxExtensions.has(path.extname(entry.name))) {
      output.push(absolutePath);
    }
  }

  return output;
}

function run(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    input: options.input,
  });

  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

function runSyntaxChecks() {
  const roots = [
    path.join(repositoryRoot, 'apps'),
    path.join(repositoryRoot, 'packages'),
    path.join(repositoryRoot, 'scripts'),
    path.join(repositoryRoot, 'eslint.config.mjs'),
  ];

  const files = [];
  for (const root of roots) {
    if (fs.existsSync(root) && fs.statSync(root).isFile()) {
      files.push(root);
    } else {
      collectJavaScriptFiles(root, files);
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  console.log(`\n[validate] Syntax checks: ${files.length} JavaScript file(s)`);

  files.forEach((filePath, index) => {
    const relativePath = path.relative(repositoryRoot, filePath);
    console.log(`[validate] syntax ${index + 1}/${files.length}: ${relativePath}`);
    const source = fs.readFileSync(filePath, 'utf8');
    const isModule = /(^|\n)\s*(?:import|export)\b/.test(source);
    if (isModule && path.extname(filePath) === '.js') {
      run(
        process.execPath,
        ['--check', '--input-type=module'],
        `Syntax check for ${relativePath}`,
        { input: source },
      );
    } else {
      run(process.execPath, ['--check', relativePath], `Syntax check for ${relativePath}`);
    }
  });
}

function npmInvocation(scriptName) {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, 'run', scriptName],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', scriptName],
  };
}

function runSelfTests() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
  );
  const scripts = packageJson.scripts || {};

  console.log(`\n[validate] Routine self-tests: ${routineSelfTests.length}`);
  routineSelfTests.forEach((scriptName, index) => {
    if (!scripts[scriptName]) {
      throw new Error(`Validation script is not registered: ${scriptName}`);
    }

    console.log(`[validate] test ${index + 1}/${routineSelfTests.length}: ${scriptName}`);
    const invocation = npmInvocation(scriptName);
    run(invocation.command, invocation.args, `Self-test ${scriptName}`);
  });
}

function main() {
  const argumentsSet = new Set(process.argv.slice(2));
  const syntaxOnly = argumentsSet.has('--syntax');
  const selfTestsOnly = argumentsSet.has('--self-tests');

  if (syntaxOnly && selfTestsOnly) {
    throw new Error('Choose either --syntax or --self-tests, not both.');
  }

  if (!selfTestsOnly) {
    runSyntaxChecks();
  }
  if (!syntaxOnly) {
    runSelfTests();
  }

  console.log('\n✅ SkyCommand validation passed.');
}

try {
  main();
} catch (error) {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 1;
}
