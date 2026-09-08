const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_CAPTURE_BYTES = 128 * 1024;

class BrowserTestExecutionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BrowserTestExecutionError';
    this.code = 'SKYCOMMAND_BROWSER_TEST_FAILED';
    this.details = details;
  }
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function appendBounded(current, chunk, maxBytes = MAX_CAPTURE_BYTES) {
  const combined = `${current}${String(chunk || '')}`;
  if (Buffer.byteLength(combined, 'utf8') <= maxBytes) return combined;
  const buffer = Buffer.from(combined, 'utf8');
  return buffer.subarray(buffer.length - maxBytes).toString('utf8');
}

function resolveBrowserSpec(repositoryRoot, testPath) {
  const requested = normalizeText(testPath);
  if (!requested) {
    throw new BrowserTestExecutionError('Browser test path is required.', {
      reasonCode: 'SKYCOMMAND_BROWSER_TEST_PATH_REQUIRED',
    });
  }

  const normalizedRelative = requested.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalizedRelative.startsWith('tests/browser/specs/') || !/\.spec\.[cm]?[jt]s$/i.test(normalizedRelative)) {
    throw new BrowserTestExecutionError(
      'Browser test path must reference a Playwright spec beneath tests/browser/specs/.',
      { reasonCode: 'SKYCOMMAND_BROWSER_TEST_PATH_NOT_ALLOWED', testPath: requested },
    );
  }

  const resolved = path.resolve(repositoryRoot, normalizedRelative);
  const allowedRoot = path.resolve(repositoryRoot, 'tests/browser/specs');
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new BrowserTestExecutionError('Browser test path escaped the allowed spec root.', {
      reasonCode: 'SKYCOMMAND_BROWSER_TEST_PATH_ESCAPE',
      testPath: requested,
    });
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new BrowserTestExecutionError('Browser test spec does not exist.', {
      reasonCode: 'SKYCOMMAND_BROWSER_TEST_PATH_NOT_FOUND',
      testPath: normalizedRelative,
    });
  }

  return { relativePath: normalizedRelative, resolvedPath: resolved };
}

function buildPlaywrightArgs({ configPath, testPath, grep }) {
  const args = ['test', '--config', configPath, '--workers=1', testPath];
  const normalizedGrep = normalizeText(grep);
  if (normalizedGrep) args.push('--grep', normalizedGrep);
  return args;
}

function runChildProcess(command, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 600000;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 5000).unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
      process.stderr.write(chunk);
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: Number.isInteger(code) ? code : 1,
        signal: signal || null,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

async function runBrowserTest(input = {}, runtimeConfig = {}) {
  const startedAt = new Date();
  const repositoryRoot = path.resolve(runtimeConfig.repositoryRoot || process.cwd());
  const { relativePath } = resolveBrowserSpec(repositoryRoot, input.testPath);
  const configPath = normalizeText(runtimeConfig.testConfigPath) || 'tests/browser/playwright.config.js';
  const playwrightBinary = path.resolve(repositoryRoot, 'node_modules/.bin/playwright');
  const args = buildPlaywrightArgs({
    configPath,
    testPath: relativePath,
    grep: input.grep,
  });

  const env = {
    ...process.env,
    SKYCOMMAND_BROWSER_BASE_URL:
      normalizeText(runtimeConfig.baseUrl) || process.env.SKYCOMMAND_BROWSER_BASE_URL,
    CI: process.env.CI || 'true',
  };

  const result = await runChildProcess(playwrightBinary, args, {
    cwd: repositoryRoot,
    env,
    timeoutMs: runtimeConfig.executionTimeoutMs,
  });
  const completedAt = new Date();

  const summary = {
    contract: 'browser_worker_execution.v1',
    executionType: 'TEST',
    status: result.code === 0 && !result.timedOut ? 'PASSED' : 'FAILED',
    testPath: relativePath,
    grep: normalizeText(input.grep) || null,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    stdout: result.stdout,
    stderr: result.stderr,
  };

  if (summary.status !== 'PASSED') {
    const reason = result.timedOut
      ? `Browser test exceeded the ${runtimeConfig.executionTimeoutMs} ms execution timeout.`
      : `Browser test exited with code ${result.code}.`;
    throw new BrowserTestExecutionError(reason, summary);
  }

  return summary;
}

module.exports = {
  BrowserTestExecutionError,
  buildPlaywrightArgs,
  resolveBrowserSpec,
  runBrowserTest,
  runChildProcess,
};
