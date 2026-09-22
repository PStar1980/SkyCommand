const os = require('node:os');
const { executeFakeRuntime, reconcileFakeRuntime, resolveFakeRuntimeCase } = require('../../../packages/agents/src/fakeRuntime');
const { getAgentRuntimeTaskQueue } = require('../../../packages/agents/src/runtimeWorker');

function workerIdentity() {
  return String(process.env.AGENT_RUNTIME_WORKER_IDENTITY || `agent-runtime-worker:${os.hostname()}:${process.pid}`).trim();
}

function workerGeneration() {
  return String(process.env.AGENT_RUNTIME_WORKER_GENERATION || `local-${process.pid}`).trim();
}

function containmentProfile() {
  return {
    liveCheckoutMount: false,
    arbitraryHostFilesystem: false,
    dockerSocket: false,
    githubCredentials: false,
    hostAgentCredentials: false,
    supervisorCredentials: false,
    apiControlPlaneSecrets: false,
    providerCredentials: false,
    browserState: false,
    directGit: false,
  };
}

async function executeFakeRuntimeActivity(input = {}) {
  const result = executeFakeRuntime({
    ...input,
    workerIdentity: workerIdentity(),
  });
  return {
    ...result,
    worker: {
      ...(result.worker || {}),
      identity: workerIdentity(),
      generation: workerGeneration(),
      taskQueue: getAgentRuntimeTaskQueue(),
      processId: process.pid,
      hostname: os.hostname(),
    },
    containmentProfile: containmentProfile(),
  };
}

async function reconcileFakeRuntimeActivity(input = {}) {
  const fixture = resolveFakeRuntimeCase(input.caseId, input.runtimeKind);
  return reconcileFakeRuntime({
    ...input,
    fixture,
    workerIdentity: workerIdentity(),
  });
}

module.exports = {
  executeFakeRuntimeActivity,
  reconcileFakeRuntimeActivity,
};
