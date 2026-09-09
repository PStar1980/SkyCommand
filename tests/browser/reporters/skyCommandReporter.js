const fs = require('node:fs');
const path = require('node:path');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function relativeArtifactPath(filePath, artifactRoot) {
  if (!filePath) return null;
  const absolute = path.resolve(filePath);
  const root = path.resolve(artifactRoot);
  if (absolute === root) return '.';
  if (!absolute.startsWith(`${root}${path.sep}`)) return normalizePath(filePath);
  return normalizePath(path.relative(root, absolute));
}

function classifyAttachment(attachment = {}) {
  const name = String(attachment.name || '').toLowerCase();
  const contentType = String(attachment.contentType || '').toLowerCase();
  const filePath = String(attachment.path || '').toLowerCase();
  if (name.includes('trace') || filePath.endsWith('trace.zip')) return 'TRACE';
  if (contentType.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(filePath)) return 'SCREENSHOT';
  if (contentType.startsWith('video/') || /\.(webm|mp4)$/i.test(filePath)) return 'VIDEO';
  return 'ATTACHMENT';
}

function cleanError(error = {}) {
  return {
    message: error.message || null,
    stack: error.stack || null,
    snippet: error.snippet || null,
  };
}

class SkyCommandReporter {
  constructor() {
    this.startedAt = new Date();
    this.tests = [];
    this.testCaseCounts = { passed: 0, failed: 0, skipped: 0, flaky: 0, interrupted: 0 };
    this.assertionCounts = { passed: 0, failed: 0 };
  }

  onTestEnd(test, result) {
    const artifactRoot = process.env.SKYCOMMAND_BROWSER_ARTIFACT_ROOT || process.cwd();
    const status = String(result.status || '').toLowerCase();
    if (status === 'passed') this.testCaseCounts.passed += 1;
    else if (status === 'failed' || status === 'timedout') this.testCaseCounts.failed += 1;
    else if (status === 'skipped') this.testCaseCounts.skipped += 1;
    else if (status === 'interrupted') this.testCaseCounts.interrupted += 1;

    if (String(result.status || '').toLowerCase() === 'passed' && result.retry > 0) {
      this.testCaseCounts.flaky += 1;
    }

    const assertionSteps = [];
    const visitSteps = (steps = []) => {
      for (const step of steps || []) {
        if (String(step.category || '').toLowerCase() === 'expect') assertionSteps.push(step);
        if (Array.isArray(step.steps) && step.steps.length) visitSteps(step.steps);
      }
    };
    visitSteps(result.steps || []);
    for (const step of assertionSteps) {
      if (step.error) this.assertionCounts.failed += 1;
      else this.assertionCounts.passed += 1;
    }

    const annotations = Array.isArray(test.annotations) ? test.annotations : [];
    const linkedWorkflowIds = annotations
      .filter((annotation) => ['skycommand-workflow-id', 'skycommand-workflow-run'].includes(String(annotation.type || '').toLowerCase()))
      .map((annotation) => String(annotation.description || '').trim())
      .filter(Boolean);

    this.tests.push({
      title: test.title,
      titlePath: typeof test.titlePath === 'function' ? test.titlePath() : [test.title],
      location: test.location
        ? { file: normalizePath(test.location.file), line: test.location.line, column: test.location.column }
        : null,
      projectName: test.parent?.project?.()?.name || null,
      status: result.status,
      expectedStatus: test.expectedStatus,
      durationMs: Number(result.duration || 0),
      retry: Number(result.retry || 0),
      errors: (result.errors || []).map(cleanError),
      annotations: annotations.map((annotation) => ({
        type: annotation.type || null,
        description: annotation.description || null,
      })),
      linkedWorkflowIds,
      artifacts: (result.attachments || [])
        .filter((attachment) => attachment.path)
        .map((attachment) => ({
          kind: classifyAttachment(attachment),
          name: attachment.name || path.basename(attachment.path),
          contentType: attachment.contentType || null,
          relativePath: relativeArtifactPath(attachment.path, artifactRoot),
        })),
    });
  }

  async onEnd(result) {
    const summaryPath = process.env.SKYCOMMAND_BROWSER_SUMMARY_PATH;
    if (!summaryPath) return;

    const completedAt = new Date();
    const failedTests = this.tests.filter((test) => ['failed', 'timedout', 'interrupted'].includes(String(test.status || '').toLowerCase()));
    const linkedWorkflowIds = [...new Set(this.tests.flatMap((test) => test.linkedWorkflowIds || []))];
    const payload = {
      contract: 'browser_test_summary.v1',
      status: String(result?.status || '').toUpperCase() === 'PASSED' ? 'PASSED' : 'FAILED',
      testCode: process.env.SKYCOMMAND_BROWSER_TEST_CODE || null,
      environmentCode: process.env.SKYCOMMAND_BROWSER_ENVIRONMENT_CODE || null,
      browserType: process.env.SKYCOMMAND_BROWSER_TYPE || 'chromium',
      executionMode: process.env.SKYCOMMAND_BROWSER_EXECUTION_MODE || 'HEADLESS',
      startedAt: this.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - this.startedAt.getTime(),
      testCases: { ...this.testCaseCounts, total: this.tests.length },
      assertions: { ...this.assertionCounts, total: this.assertionCounts.passed + this.assertionCounts.failed },
      tests: this.tests,
      linkedWorkflowIds,
      failure: failedTests.length
        ? {
            title: failedTests[0].title,
            location: failedTests[0].location,
            message: failedTests[0].errors?.[0]?.message || 'Playwright Test failed.',
            stack: failedTests[0].errors?.[0]?.stack || null,
            snippet: failedTests[0].errors?.[0]?.snippet || null,
          }
        : null,
    };

    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}

module.exports = SkyCommandReporter;
