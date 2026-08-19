const DEFAULT_HOST_AGENT_TASK_QUEUE = 'skycommand-host-local';

function normalizeHostAgentTaskQueue(value) {
  const normalized = String(value || DEFAULT_HOST_AGENT_TASK_QUEUE).trim();
  return normalized || DEFAULT_HOST_AGENT_TASK_QUEUE;
}

module.exports = {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
  normalizeHostAgentTaskQueue,
};
