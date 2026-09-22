const os = require('node:os');
const { NativeConnection, Worker } = require('@temporalio/worker');
const { getTemporalConfig } = require('../../../packages/temporal/src/config');
const { getAgentRuntimeTaskQueue } = require('../../../packages/agents/src/runtimeWorker');
const activities = require('./activities');

async function startAgentRuntimeWorker() {
  const config = getTemporalConfig();
  const taskQueue = getAgentRuntimeTaskQueue();
  const identity = String(process.env.AGENT_RUNTIME_WORKER_IDENTITY || `agent-runtime-worker:${os.hostname()}:${process.pid}`).trim();
  const generation = String(process.env.AGENT_RUNTIME_WORKER_GENERATION || `local-${process.pid}`).trim();
  console.log(`[AgentRuntimeWorker] Starting isolated fake runtime worker identity=${identity} generation=${generation}`);
  console.log(`[AgentRuntimeWorker] address=${config.address} namespace=${config.namespace} taskQueue=${taskQueue}`);
  console.log('[AgentRuntimeWorker] containment=live-checkout:false,docker-socket:false,github-credentials:false,host-agent-credentials:false,supervisor-credentials:false,provider-credentials:false');

  const connection = await NativeConnection.connect({ address: config.address });
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue,
    activities,
    enableNonLocalActivities: true,
    identity,
  });
  await worker.run();
}

if (require.main === module) {
  startAgentRuntimeWorker().catch((error) => {
    console.error('[AgentRuntimeWorker] Failed to start:', error.stack || error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  startAgentRuntimeWorker,
};
