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
  browserAutomationExecutionWorkflow,
  browserExecutionWorkflow,
};
