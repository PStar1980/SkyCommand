const { proxyActivities } = require('@temporalio/workflow');

const { loadFredMacroDataActivity } = proxyActivities({
  startToCloseTimeout: '35 minutes',
  retry: {
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 3,
  },
});

async function fredIngestionWorkflow(input = {}) {
  const startedAt = new Date().toISOString();
  const result = await loadFredMacroDataActivity(input);

  return {
    ok: true,
    workflow: 'fredIngestionWorkflow',
    startedAt,
    completedAt: new Date().toISOString(),
    activity: result,
  };
}

module.exports = {
  fredIngestionWorkflow,
};
