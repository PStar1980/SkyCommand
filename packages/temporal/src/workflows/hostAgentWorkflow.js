const { proxyActivities } = require('@temporalio/workflow');

const {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
  normalizeHostAgentTaskQueue,
} = require('../../../host-agent/src/config');

async function skyCommandHostAgentToolWorkflow(input = {}) {
  const hostTaskQueue = normalizeHostAgentTaskQueue(input.hostTaskQueue);
  const isHealthProbe = String(input.toolCode || '').trim() === '__health';
  const { executeSkyCommandHostToolActivity } = proxyActivities({
    taskQueue: hostTaskQueue,
    scheduleToStartTimeout: isHealthProbe ? '3 seconds' : '45 seconds',
    startToCloseTimeout: isHealthProbe ? '3 seconds' : '10 minutes',
    retry: {
      maximumAttempts: 1,
    },
  });

  return executeSkyCommandHostToolActivity({
    ...input,
    hostTaskQueue,
  });
}

module.exports = {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
  skyCommandHostAgentToolWorkflow,
};
