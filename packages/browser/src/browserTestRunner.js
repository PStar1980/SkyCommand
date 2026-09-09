const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
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

function normalizeBooleanSetting(value, defaultValue = false) {
  if (value === undefined || value === null || String(value).trim() === '') return Boolean(defaultValue);
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
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

function resolvePlaywrightCli(repositoryRoot) {
  const root = path.resolve(repositoryRoot || process.cwd());
  const candidates = [
    path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
    path.join(root, 'node_modules', 'playwright', 'cli.js'),
  ];

  const resolved = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch (_error) {
      return false;
    }
  });

  if (!resolved) {
    throw new BrowserTestExecutionError(
      'Playwright CLI is not installed for the selected browser execution runtime.',
      {
        reasonCode: 'SKYCOMMAND_BROWSER_PLAYWRIGHT_CLI_NOT_FOUND',
        repositoryRoot: root,
        candidates: candidates.map((candidate) => normalizeRelativePath(path.relative(root, candidate))),
      },
    );
  }

  return resolved;
}

function buildPlaywrightArgs({ configPath, testPath, grep, browserType = 'chromium', retryCount = 0, timeoutMs = null, headed = false }) {
  const args = ['test', '--config', configPath, '--workers=1', testPath];
  if (headed) args.push('--headed');
  const normalizedBrowserType = normalizeText(browserType) || 'chromium';
  if (normalizedBrowserType) args.push('--project', normalizedBrowserType);
  const normalizedRetryCount = Number.parseInt(retryCount, 10);
  if (Number.isInteger(normalizedRetryCount) && normalizedRetryCount > 0) {
    args.push(`--retries=${Math.min(normalizedRetryCount, 3)}`);
  }
  const normalizedTimeoutMs = Number.parseInt(timeoutMs, 10);
  if (Number.isInteger(normalizedTimeoutMs) && normalizedTimeoutMs > 0) {
    args.push(`--timeout=${normalizedTimeoutMs}`);
  }
  const normalizedGrep = normalizeText(grep);
  if (normalizedGrep) args.push('--grep', normalizedGrep);
  return args;
}

function launchWindowsInteractiveBrowserPresenter(repositoryRoot, rootProcessId, options = {}) {
  if (process.platform !== 'win32' || !Number.isInteger(Number(rootProcessId))) return false;
  const presenterScript = path.resolve(repositoryRoot, 'scripts/powershell/Show-SkyCommandPlaywrightWindow.ps1');
  if (!fs.existsSync(presenterScript) || !fs.statSync(presenterScript).isFile()) return false;

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    presenterScript,
    '-RootProcessId',
    String(rootProcessId),
    '-TimeoutSeconds',
    '12',
    '-FocusDurationMs',
    '2500',
  ];
  if (options.topmost !== false) args.push('-Topmost');

  try {
    const child = spawn('powershell.exe', args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref?.();
    return true;
  } catch (_error) {
    return false;
  }
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
      windowsHide: options.windowsHide !== false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      options.onSpawn?.(child);
    } catch (_error) {
      // Presentation hooks are best-effort and must never change test semantics.
    }

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

function getEffectiveTimeoutMs(inputTimeoutMs, runtimeTimeoutMs) {
  const runtimeCap = Number(runtimeTimeoutMs) > 0 ? Number(runtimeTimeoutMs) : 600000;
  const requested = Number(inputTimeoutMs);
  if (!Number.isFinite(requested) || requested <= 0) return runtimeCap;
  return Math.min(requested, runtimeCap);
}

function serializeBrowserTestParameters(value) {
  if (value === undefined || value === null) return '{}';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BrowserTestExecutionError('Browser test parameters must be a JSON object.', {
      reasonCode: 'SKYCOMMAND_BROWSER_TEST_PARAMETERS_INVALID',
    });
  }
  return JSON.stringify(value);
}

function normalizeExecutionId(value) {
  const normalized = normalizeText(value) || randomUUID();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(normalized)) {
    throw new BrowserTestExecutionError('Browser executionId contains unsupported characters.', {
      reasonCode: 'SKYCOMMAND_BROWSER_EXECUTION_ID_INVALID',
    });
  }
  return normalized;
}

function resolveGitHeadSha(repositoryRoot) {
  try {
    const gitPath = path.join(repositoryRoot, '.git');
    if (!fs.existsSync(gitPath)) return null;
    let gitDirectory = gitPath;
    if (fs.statSync(gitPath).isFile()) {
      const pointer = fs.readFileSync(gitPath, 'utf8').trim();
      const match = pointer.match(/^gitdir:\s*(.+)$/i);
      if (!match) return null;
      gitDirectory = path.resolve(repositoryRoot, match[1]);
    }
    const head = fs.readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head.toLowerCase();
    const refMatch = head.match(/^ref:\s*(.+)$/i);
    if (!refMatch) return null;
    const ref = refMatch[1].trim();
    const looseRef = path.join(gitDirectory, ...ref.split('/'));
    if (fs.existsSync(looseRef)) {
      const sha = fs.readFileSync(looseRef, 'utf8').trim();
      if (/^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase();
    }
    const packedRefs = path.join(gitDirectory, 'packed-refs');
    if (fs.existsSync(packedRefs)) {
      const line = fs.readFileSync(packedRefs, 'utf8')
        .split(/\r?\n/)
        .find((entry) => entry && !entry.startsWith('#') && !entry.startsWith('^') && entry.endsWith(` ${ref}`));
      const sha = line?.split(/\s+/)?.[0];
      if (/^[0-9a-f]{40}$/i.test(sha || '')) return sha.toLowerCase();
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function classifyArtifact(relativePath) {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  if (normalized.endsWith('trace.zip')) return { kind: 'TRACE', contentType: 'application/zip' };
  if (/\.(png|jpg|jpeg|webp)$/.test(normalized)) return { kind: 'SCREENSHOT', contentType: normalized.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  if (/\.(webm|mp4)$/.test(normalized)) return { kind: 'VIDEO', contentType: normalized.endsWith('.webm') ? 'video/webm' : 'video/mp4' };
  if (normalized === 'report/index.html') return { kind: 'REPORT', contentType: 'text/html' };
  return null;
}

function shouldExposeBrowserArtifact(relativePath) {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  if (!normalized) return false;
  if (normalized.split('/').some((segment) => segment.startsWith('.playwright-artifacts-'))) return false;
  if (normalized.includes('/traces/resources/') || normalized.startsWith('traces/resources/')) return false;
  if (normalized.startsWith('report/') && normalized !== 'report/index.html') return false;
  return true;
}

function collectBrowserArtifacts(artifactRoot, reporterSummary = null) {
  const artifactsByPath = new Map();

  function addArtifact(candidate = {}) {
    const relativePath = normalizeRelativePath(candidate.relativePath);
    if (!relativePath || !shouldExposeBrowserArtifact(relativePath)) return;
    const absolute = path.resolve(artifactRoot, relativePath);
    if (!absolute.startsWith(`${path.resolve(artifactRoot)}${path.sep}`)) return;
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return;
    const classification = classifyArtifact(relativePath);
    const requestedKind = normalizeText(candidate.kind).toUpperCase();
    const kind = ['TRACE','SCREENSHOT','VIDEO','REPORT','ATTACHMENT','DOWNLOAD'].includes(requestedKind)
      ? requestedKind
      : classification?.kind;
    if (!kind) return;
    const stat = fs.statSync(absolute);
    artifactsByPath.set(relativePath, {
      kind,
      contentType: normalizeText(candidate.contentType) || classification?.contentType || 'application/octet-stream',
      name: normalizeText(candidate.name) || path.basename(relativePath),
      relativePath,
      sizeBytes: stat.size,
    });
  }

  for (const test of Array.isArray(reporterSummary?.tests) ? reporterSummary.tests : []) {
    for (const artifact of Array.isArray(test?.artifacts) ? test.artifacts : []) {
      addArtifact(artifact);
    }
  }

  addArtifact({
    kind: 'REPORT',
    name: 'Playwright HTML Report',
    contentType: 'text/html',
    relativePath: 'report/index.html',
  });

  const kindOrder = new Map([['TRACE', 1], ['SCREENSHOT', 2], ['VIDEO', 3], ['REPORT', 4], ['DOWNLOAD', 5], ['ATTACHMENT', 6]]);
  return [...artifactsByPath.values()].sort((left, right) => {
    const byKind = (kindOrder.get(left.kind) || 99) - (kindOrder.get(right.kind) || 99);
    return byKind || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function readReporterSummary(summaryPath) {
  try {
    if (!fs.existsSync(summaryPath)) return null;
    const value = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (_error) {
    return null;
  }
}

async function runBrowserTest(input = {}, runtimeConfig = {}) {
  const startedAt = new Date();
  const repositoryRoot = path.resolve(runtimeConfig.repositoryRoot || process.cwd());
  const { relativePath } = resolveBrowserSpec(repositoryRoot, input.testPath);
  const configPath = normalizeText(runtimeConfig.testConfigPath) || 'tests/browser/playwright.config.js';
  const playwrightCli = resolvePlaywrightCli(repositoryRoot);
  const effectiveTimeoutMs = getEffectiveTimeoutMs(input.timeoutMs, runtimeConfig.executionTimeoutMs);
  const processTimeoutMs = Math.min(
    Number(runtimeConfig.executionTimeoutMs) > 0 ? Number(runtimeConfig.executionTimeoutMs) : 600000,
    effectiveTimeoutMs + 30000,
  );
  const executionId = normalizeExecutionId(input.executionId);
  const artifactBaseRoot = path.resolve(runtimeConfig.artifactRoot || path.join(repositoryRoot, 'artifacts/browser/tests'));
  const runArtifactRoot = path.resolve(artifactBaseRoot, executionId);
  if (!runArtifactRoot.startsWith(`${artifactBaseRoot}${path.sep}`)) {
    throw new BrowserTestExecutionError('Browser artifact path escaped the configured artifact root.', {
      reasonCode: 'SKYCOMMAND_BROWSER_ARTIFACT_PATH_ESCAPE',
    });
  }
  fs.rmSync(runArtifactRoot, { recursive: true, force: true });
  fs.mkdirSync(runArtifactRoot, { recursive: true });
  const reporterSummaryPath = path.join(runArtifactRoot, 'skycommand-summary.json');

  const interactive = String(input.executionMode || '').toUpperCase() === 'INTERACTIVE' || input.headed === true;
  const interactiveTopmost = normalizeBooleanSetting(
    runtimeConfig.interactiveTopmost ?? process.env.SKYCOMMAND_BROWSER_INTERACTIVE_TOPMOST,
    true,
  );

  const args = buildPlaywrightArgs({
    configPath,
    testPath: relativePath,
    grep: input.grep,
    browserType: input.browserType || 'chromium',
    retryCount: input.retryCount || 0,
    timeoutMs: effectiveTimeoutMs,
    headed: interactive,
  });

  const env = {
    ...process.env,
    SKYCOMMAND_BROWSER_BASE_URL:
      normalizeText(input.baseUrl) || normalizeText(runtimeConfig.baseUrl) || process.env.SKYCOMMAND_BROWSER_BASE_URL,
    SKYCOMMAND_BROWSER_TEST_CODE: normalizeText(input.testCode),
    SKYCOMMAND_BROWSER_ENVIRONMENT_CODE: normalizeText(input.environmentCode),
    SKYCOMMAND_BROWSER_TYPE: normalizeText(input.browserType) || 'chromium',
    SKYCOMMAND_BROWSER_TEST_PARAMETERS: serializeBrowserTestParameters(input.parameters),
    SKYCOMMAND_BROWSER_ARTIFACT_ROOT: runArtifactRoot,
    SKYCOMMAND_BROWSER_SUMMARY_PATH: reporterSummaryPath,
    SKYCOMMAND_BROWSER_RUN_ID: executionId,
    SKYCOMMAND_BROWSER_EXECUTION_MODE: interactive ? 'INTERACTIVE' : 'HEADLESS',
    CI: interactive ? '' : (process.env.CI || 'true'),
  };

  // Invoke Playwright through Node rather than the platform-specific npm .bin shim.
  // This keeps the same runner portable between the Linux Browser Worker and the
  // Windows host-native Host Agent used for headed/interactive execution.
  const result = await runChildProcess(process.execPath, [playwrightCli, ...args], {
    cwd: repositoryRoot,
    env,
    timeoutMs: processTimeoutMs,
    windowsHide: !interactive,
    onSpawn: interactive && process.platform === 'win32'
      ? (child) => launchWindowsInteractiveBrowserPresenter(repositoryRoot, child.pid, { topmost: interactiveTopmost })
      : null,
  });
  const completedAt = new Date();
  const reporterSummary = readReporterSummary(reporterSummaryPath);
  const sourceRepositoryRoot = path.resolve(runtimeConfig.sourceRepositoryRoot || repositoryRoot);
  const sourceCommit = resolveGitHeadSha(sourceRepositoryRoot);
  const artifacts = collectBrowserArtifacts(runArtifactRoot, reporterSummary);
  const relativeArtifactRoot = runArtifactRoot.startsWith(`${sourceRepositoryRoot}${path.sep}`)
    ? normalizeRelativePath(path.relative(sourceRepositoryRoot, runArtifactRoot))
    : null;

  const summary = {
    contract: 'browser_test_summary.v1',
    workerContract: 'browser_worker_execution.v1',
    executionType: 'TEST',
    executionId,
    status: result.code === 0 && !result.timedOut ? 'PASSED' : 'FAILED',
    testCode: normalizeText(input.testCode) || null,
    testPath: relativePath,
    grep: normalizeText(input.grep) || null,
    browserType: normalizeText(input.browserType) || 'chromium',
    executionMode: interactive ? 'INTERACTIVE' : 'HEADLESS',
    environmentCode: normalizeText(input.environmentCode) || null,
    parameters: input.parameters && typeof input.parameters === 'object' ? input.parameters : {},
    testCases: reporterSummary?.testCases || null,
    assertions: reporterSummary?.assertions || null,
    testCasesDetail: reporterSummary?.tests || [],
    failure: reporterSummary?.failure || null,
    linkedWorkflowIds: reporterSummary?.linkedWorkflowIds || [],
    sourceCommit,
    artifactRoot: relativeArtifactRoot,
    artifacts,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    timeoutMs: effectiveTimeoutMs,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    stdout: result.stdout,
    stderr: result.stderr,
  };

  fs.writeFileSync(reporterSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  if (summary.status !== 'PASSED') {
    const reason = result.timedOut
      ? `Browser test process exceeded the ${processTimeoutMs} ms hard execution timeout.`
      : summary.failure?.message || `Browser test exited with code ${result.code}.`;
    throw new BrowserTestExecutionError(reason, summary);
  }

  return summary;
}

module.exports = {
  BrowserTestExecutionError,
  buildPlaywrightArgs,
  classifyArtifact,
  collectBrowserArtifacts,
  getEffectiveTimeoutMs,
  launchWindowsInteractiveBrowserPresenter,
  normalizeBooleanSetting,
  normalizeExecutionId,
  readReporterSummary,
  resolveBrowserSpec,
  resolvePlaywrightCli,
  resolveGitHeadSha,
  serializeBrowserTestParameters,
  shouldExposeBrowserArtifact,
  runBrowserTest,
  runChildProcess,
};
