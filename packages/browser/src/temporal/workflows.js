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

module.exports = {
  browserExecutionWorkflow,
};
