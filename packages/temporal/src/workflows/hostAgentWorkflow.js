const { proxyActivities } = require('@temporalio/workflow');

const {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
  normalizeHostAgentTaskQueue,
} = require('../../../host-agent/src/config');

async function skyCommandHostAgentToolWorkflow(input = {}) {
  const hostTaskQueue = normalizeHostAgentTaskQueue(input.hostTaskQueue);
  const toolCode = String(input.toolCode || '').trim();
  const isFastProbe = toolCode === '__health' || toolCode === '__docker_snapshot';
  const { executeSkyCommandHostToolActivity } = proxyActivities({
    taskQueue: hostTaskQueue,
    scheduleToStartTimeout: isFastProbe ? '5 seconds' : '45 seconds',
    startToCloseTimeout: isFastProbe ? '15 seconds' : '10 minutes',
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
