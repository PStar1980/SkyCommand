const { proxyActivities } = require('@temporalio/workflow');

const { executeBrowserTestActivity } = proxyActivities({
  startToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 1,
  },
});

async function browserExecutionWorkflow(input = {}) {
  return executeBrowserTestActivity(input);
}


async function browserTestSuiteWorkflow(input = {}) {
  const members = Array.isArray(input.members) ? input.members : [];
  const startedAtMs = Date.now();
  const results = [];
  let stop = false;

  for (const member of members) {
    if (stop) {
      results.push({
        suiteMemberId: member.suiteMemberId || null,
        testId: member.testId || null,
        testCode: member.testCode || 'unknown',
        testLabel: member.testLabel || member.testCode || 'Browser Test',
        displayOrder: Number(member.displayOrder || 999),
        status: 'NOT_RUN',
        durationMs: null,
        executionId: member.executionId || null,
        artifactRoot: null,
        result: null,
        failure: { message: 'Not run because this suite stops after the first failure.' },
      });
      continue;
    }

    const memberStartedAt = Date.now();
    try {
      const result = await executeBrowserTestActivity(member.executionInput || {});
      results.push({
        suiteMemberId: member.suiteMemberId || null,
        testId: member.testId || null,
        testCode: member.testCode || result?.testCode || 'unknown',
        testLabel: member.testLabel || member.testCode || 'Browser Test',
        displayOrder: Number(member.displayOrder || 999),
        status: 'PASSED',
        durationMs: Number(result?.durationMs || (Date.now() - memberStartedAt)),
        executionId: member.executionId || result?.executionId || null,
        artifactRoot: result?.artifactRoot || null,
        result,
        failure: null,
      });
    } catch (error) {
      results.push({
        suiteMemberId: member.suiteMemberId || null,
        testId: member.testId || null,
        testCode: member.testCode || 'unknown',
        testLabel: member.testLabel || member.testCode || 'Browser Test',
        displayOrder: Number(member.displayOrder || 999),
        status: 'FAILED',
        durationMs: Math.max(0, Date.now() - memberStartedAt),
        executionId: member.executionId || null,
        artifactRoot: null,
        result: null,
        failure: {
          name: error?.name || null,
          message: error?.message || 'Browser Test failed.',
        },
      });
      if (input.stopOnFailure === true) stop = true;
    }
  }

  const passed = results.filter((item) => item.status === 'PASSED').length;
  const failed = results.filter((item) => item.status === 'FAILED').length;
  const notRun = results.filter((item) => item.status === 'NOT_RUN').length;
  const status = failed === 0 && notRun === 0 ? 'PASSED' : (passed > 0 ? 'PARTIAL' : 'FAILED');

  return {
    contract: 'browser_test_suite_summary.v1',
    status,
    suiteCode: input.suiteCode || 'unknown',
    environmentCode: input.environmentCode || 'LOCAL',
    executionMode: 'HEADLESS',
    total: results.length,
    passed,
    failed,
    notRun,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    members: results,
  };
}

async function browserAutomationExecutionWorkflow(input = {}) {
  const retryCount = Math.max(0, Math.min(3, Number.parseInt(input.retryCount, 10) || 0));
  const { executeBrowserAutomationActivity } = proxyActivities({
    startToCloseTimeout: '65 minutes',
    retry: {
      maximumAttempts: retryCount + 1,
    },
  });
  return executeBrowserAutomationActivity(input);
}

module.exports = {
  browserTestSuiteWorkflow,
  browserAutomationExecutionWorkflow,
  browserExecutionWorkflow,
};
