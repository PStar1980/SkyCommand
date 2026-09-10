const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('@playwright/test');

const {
  launchWindowsInteractiveBrowserPresenter,
  normalizeBooleanSetting,
  resolveGitHeadSha,
} = require('./browserTestRunner');

class BrowserAutomationExecutionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BrowserAutomationExecutionError';
    this.code = 'SKYCOMMAND_BROWSER_AUTOMATION_FAILED';
    this.details = details;
  }
}

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function normalizeExecutionId(value) {
  const normalized = normalizeText(value);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    return normalized;
  }
  return randomUUID();
}

function resolveAutomationScript(repositoryRoot, scriptPath) {
  const requested = normalizeText(scriptPath).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!requested) {
    throw new BrowserAutomationExecutionError('Playwright Automation script path is required.', {
      reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_PATH_REQUIRED',
    });
  }
  if (!requested.startsWith('browser-automation/scripts/') || !/\.(?:cjs|mjs|js)$/i.test(requested)) {
    throw new BrowserAutomationExecutionError(
      'Playwright Automation path must reference JavaScript beneath browser-automation/scripts/.',
      { reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_PATH_NOT_ALLOWED', scriptPath: requested },
    );
  }

  const allowedRoot = path.resolve(repositoryRoot, 'browser-automation/scripts');
  const resolvedPath = path.resolve(repositoryRoot, requested);
  if (resolvedPath !== allowedRoot && !resolvedPath.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new BrowserAutomationExecutionError('Playwright Automation path escaped the allowed source root.', {
      reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_PATH_ESCAPE',
      scriptPath: requested,
    });
  }
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new BrowserAutomationExecutionError('Playwright Automation source does not exist.', {
      reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_PATH_NOT_FOUND',
      scriptPath: requested,
    });
  }
  return { relativePath: requested, resolvedPath };
}

function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function safeFileName(value, fallback = 'artifact') {
  const normalized = normalizeText(value, fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return normalized || fallback;
}

function ensureInside(root, candidate) {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new BrowserAutomationExecutionError('Browser Automation artifact path escaped the run artifact root.', {
      reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_ARTIFACT_PATH_ESCAPE',
    });
  }
  return normalizedCandidate;
}

function walkFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  return files;
}

function classifyArtifact(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  if (normalized === 'skycommand-automation-summary.json') return null;
  if (/\.(png|jpe?g|webp)$/.test(normalized) || normalized.startsWith('screenshots/')) return 'SCREENSHOT';
  if (/\.(webm|mp4)$/.test(normalized) || normalized.startsWith('videos/')) return 'VIDEO';
  if (/\.zip$/.test(normalized) && normalized.includes('trace')) return 'TRACE';
  if (normalized.startsWith('downloads/')) return 'DOWNLOAD';
  return 'ATTACHMENT';
}

function artifactContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.json') return 'application/json';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.zip') return 'application/zip';
  if (ext === '.txt' || ext === '.log') return 'text/plain';
  return 'application/octet-stream';
}

function collectAutomationArtifacts(runRoot) {
  return walkFiles(runRoot)
    .map((absolutePath) => {
      const relativePath = path.relative(runRoot, absolutePath).replace(/\\/g, '/');
      const kind = classifyArtifact(relativePath);
      if (!kind) return null;
      const stat = fs.statSync(absolutePath);
      return {
        kind,
        name: path.basename(absolutePath),
        relativePath,
        contentType: artifactContentType(absolutePath),
        sizeBytes: stat.size,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function loginToSkyCommand(page, { email, password }) {
  if (!normalizeText(email) || !normalizeText(password)) {
    throw new BrowserAutomationExecutionError(
      'SkyCommand browser automation credentials are not configured. Set SKYCOMMAND_BROWSER_AUTOMATION_EMAIL/PASSWORD or the existing SKYCOMMAND_BROWSER_TEST_EMAIL/PASSWORD values.',
      { reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_CREDENTIALS_MISSING' },
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20000 }),
    page.getByRole('button', { name: 'Login', exact: true }).click(),
  ]);
}

function withExecutionTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new BrowserAutomationExecutionError(
        `Playwright Automation exceeded its ${timeoutMs} ms execution timeout.`,
        { reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_TIMEOUT', timeoutMs },
      ));
    }, timeoutMs);
    timer.unref?.();
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function validateAutomationResult(rawResult, input) {
  if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    throw new BrowserAutomationExecutionError('Playwright Automation must return a structured result object.', {
      reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_RESULT_REQUIRED',
    });
  }
  const expectedContract = normalizeText(input.outputType, 'browser_automation_summary.v1');
  const contract = normalizeText(rawResult.contract, expectedContract);
  if (contract !== expectedContract) {
    throw new BrowserAutomationExecutionError(
      `Playwright Automation returned contract '${contract}' but registry requires '${expectedContract}'.`,
      { reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_CONTRACT_MISMATCH', expectedContract, actualContract: contract },
    );
  }
  const status = normalizeText(rawResult.status, 'SUCCESS').toUpperCase();
  if (!['SUCCESS', 'FAILED'].includes(status)) {
    throw new BrowserAutomationExecutionError("Playwright Automation status must be SUCCESS or FAILED.", {
      reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_STATUS_INVALID', status,
    });
  }
  const returnedCode = normalizeText(rawResult.automationCode, input.automationCode);
  if (returnedCode !== input.automationCode) {
    throw new BrowserAutomationExecutionError('Playwright Automation returned a different automationCode than the registered execution.', {
      reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_CODE_MISMATCH', expected: input.automationCode, actual: returnedCode,
    });
  }
  return { ...rawResult, contract, status, automationCode: returnedCode };
}

async function runBrowserAutomation(input = {}, runtimeConfig = {}) {
  const repositoryRoot = path.resolve(runtimeConfig.repositoryRoot || process.cwd());
  const sourceRepositoryRoot = path.resolve(runtimeConfig.sourceRepositoryRoot || repositoryRoot);
  const automationArtifactRoot = path.resolve(
    runtimeConfig.automationArtifactRoot || path.join(sourceRepositoryRoot, 'artifacts/browser/automations'),
  );
  const executionId = normalizeExecutionId(input.executionId);
  const runRoot = ensureInside(automationArtifactRoot, path.join(automationArtifactRoot, executionId));
  // Temporal retries reuse the same execution id. Keep only the final attempt's evidence.
  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(runRoot, { recursive: true });

  const { relativePath: scriptPath, resolvedPath } = resolveAutomationScript(repositoryRoot, input.scriptPath);
  const automationCode = normalizeText(input.automationCode);
  if (!automationCode) throw new BrowserAutomationExecutionError('Playwright Automation code is required.');

  const browserType = normalizeText(input.browserType, 'chromium').toLowerCase();
  if (browserType !== 'chromium') {
    throw new BrowserAutomationExecutionError(`Unsupported Playwright Automation browser '${browserType}'.`);
  }
  const environmentCode = normalizeText(input.environmentCode, 'LOCAL').toUpperCase();
  const baseUrl = normalizeText(input.baseUrl, runtimeConfig.baseUrl || 'http://127.0.0.1:15171');
  const interactive = String(input.executionMode || '').toUpperCase() === 'INTERACTIVE' || input.headed === true;
  const timeoutMs = Math.min(
    parsePositiveInteger(input.timeoutMs, runtimeConfig.executionTimeoutMs || 600000, 3600000),
    parsePositiveInteger(runtimeConfig.executionTimeoutMs, 3600000, 3600000),
  );
  const viewportWidth = parsePositiveInteger(process.env.SKYCOMMAND_BROWSER_VIEWPORT_WIDTH, 1600, 7680);
  const viewportHeight = parsePositiveInteger(process.env.SKYCOMMAND_BROWSER_VIEWPORT_HEIGHT, 900, 4320);
  const slowMo = interactive ? parsePositiveInteger(process.env.SKYCOMMAND_BROWSER_INTERACTIVE_SLOW_MO_MS, 300, 5000) : 0;
  const holdMs = interactive ? parsePositiveInteger(process.env.SKYCOMMAND_BROWSER_INTERACTIVE_HOLD_MS, 4000, 30000) : 0;
  const topmost = normalizeBooleanSetting(process.env.SKYCOMMAND_BROWSER_INTERACTIVE_TOPMOST, true);
  const sourceCommit = resolveGitHeadSha(sourceRepositoryRoot);
  const startedAt = new Date();

  let browser = null;
  let context = null;
  let page = null;
  let businessResult = null;
  let executionError = null;

  if (interactive && process.platform === 'win32') {
    launchWindowsInteractiveBrowserPresenter(repositoryRoot, process.pid, { topmost });
  }

  try {
    browser = await chromium.launch({
      headless: !interactive,
      slowMo,
      args: interactive ? ['--start-maximized'] : [],
    });
    context = await browser.newContext({
      baseURL: baseUrl,
      ...(interactive ? { viewport: null } : { viewport: { width: viewportWidth, height: viewportHeight } }),
      acceptDownloads: true,
    });
    page = await context.newPage();
    if (interactive) await page.bringToFront().catch(() => {});

    const screenshotsRoot = path.join(runRoot, 'screenshots');
    const downloadsRoot = path.join(runRoot, 'downloads');
    fs.mkdirSync(screenshotsRoot, { recursive: true });
    fs.mkdirSync(downloadsRoot, { recursive: true });

    const helpers = {
      async authenticateSkyCommand() {
        const email = normalizeText(process.env.SKYCOMMAND_BROWSER_AUTOMATION_EMAIL || process.env.SKYCOMMAND_BROWSER_TEST_EMAIL);
        const password = normalizeText(process.env.SKYCOMMAND_BROWSER_AUTOMATION_PASSWORD || process.env.SKYCOMMAND_BROWSER_TEST_PASSWORD);
        return loginToSkyCommand(page, { email, password });
      },
      async captureScreenshot(name, options = {}) {
        const fileName = `${safeFileName(name, 'Screenshot')}.png`;
        const absolutePath = ensureInside(screenshotsRoot, path.join(screenshotsRoot, fileName));
        await page.screenshot({ path: absolutePath, fullPage: options.fullPage !== false });
        return {
          type: 'SCREENSHOT',
          name: normalizeText(name, fileName),
          relativePath: path.relative(runRoot, absolutePath).replace(/\\/g, '/'),
        };
      },
      async saveDownload(download, preferredName = null) {
        const suggestedName = preferredName || download.suggestedFilename() || 'download.bin';
        const fileName = safeFileName(suggestedName, 'download.bin');
        const absolutePath = ensureInside(downloadsRoot, path.join(downloadsRoot, fileName));
        await download.saveAs(absolutePath);
        return {
          type: 'DOWNLOAD',
          name: fileName,
          relativePath: path.relative(runRoot, absolutePath).replace(/\\/g, '/'),
        };
      },
    };

    delete require.cache[require.resolve(resolvedPath)];
    const automationModule = require(resolvedPath);
    if (typeof automationModule.execute !== 'function') {
      throw new BrowserAutomationExecutionError('Playwright Automation module must export an execute(context) function.', {
        reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_EXECUTE_EXPORT_REQUIRED',
        scriptPath,
      });
    }

    const returned = await withExecutionTimeout(
      automationModule.execute({
        page,
        context,
        browser,
        automationCode,
        environment: environmentCode,
        baseUrl,
        parameters: input.parameters && typeof input.parameters === 'object' ? input.parameters : {},
        helpers,
        artifactRoot: runRoot,
        executionId,
      }),
      timeoutMs,
    );
    businessResult = validateAutomationResult(returned, {
      automationCode,
      outputType: input.outputType,
    });
    if (businessResult.status !== 'SUCCESS') {
      throw new BrowserAutomationExecutionError(
        normalizeText(businessResult.message, `${automationCode} reported FAILED.`),
        { reasonCode: 'SKYCOMMAND_BROWSER_AUTOMATION_REPORTED_FAILED', result: businessResult },
      );
    }
    if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
  } catch (error) {
    executionError = error;
    if (page) {
      try {
        const failurePath = path.join(runRoot, 'screenshots', 'Automation Failure.png');
        fs.mkdirSync(path.dirname(failurePath), { recursive: true });
        await page.screenshot({ path: failurePath, fullPage: true });
      } catch (_screenshotError) {
        // Evidence capture is best-effort and must not replace the original failure.
      }
    }
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  const completedAt = new Date();
  const artifacts = collectAutomationArtifacts(runRoot);
  const summary = {
    contract: normalizeText(input.outputType, 'browser_automation_summary.v1'),
    executionType: 'AUTOMATION',
    executionMode: interactive ? 'INTERACTIVE' : 'HEADLESS',
    status: executionError ? 'FAILED' : 'SUCCESS',
    automationCode,
    browser: browserType,
    environment: environmentCode,
    parameters: input.parameters && typeof input.parameters === 'object' ? input.parameters : {},
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    sourceCommit: sourceCommit || null,
    scriptPath,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    result: executionError ? businessResult?.result ?? null : businessResult?.result ?? null,
    artifacts,
    failure: executionError ? {
      code: normalizeText(executionError.code, 'SKYCOMMAND_BROWSER_AUTOMATION_FAILED'),
      message: normalizeText(executionError.message || executionError, 'Playwright Automation failed.'),
      details: executionError.details || null,
      stack: executionError.stack || null,
    } : null,
  };

  fs.writeFileSync(path.join(runRoot, 'skycommand-automation-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  if (executionError) {
    throw new BrowserAutomationExecutionError(summary.failure.message, summary);
  }

  return summary;
}

module.exports = {
  BrowserAutomationExecutionError,
  classifyArtifact,
  collectAutomationArtifacts,
  loginToSkyCommand,
  normalizeExecutionId,
  resolveAutomationScript,
  runBrowserAutomation,
  validateAutomationResult,
};
