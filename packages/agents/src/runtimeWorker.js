const AGENT_RUNTIME_TASK_QUEUE = 'skycommand-agent-runtime-local';
const AGENT_RUNTIME_ADAPTER_CONTRACT = 'AgentRuntimeAdapter.v1';

function getAgentRuntimeTaskQueue(environment) {
  const source = environment || (typeof process !== 'undefined' ? process.env : null);
  return String(source?.AGENT_RUNTIME_TASK_QUEUE || AGENT_RUNTIME_TASK_QUEUE).trim() || AGENT_RUNTIME_TASK_QUEUE;
}

module.exports = {
  AGENT_RUNTIME_TASK_QUEUE,
  AGENT_RUNTIME_ADAPTER_CONTRACT,
  getAgentRuntimeTaskQueue,
};
