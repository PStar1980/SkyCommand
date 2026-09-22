const os = require('node:os');
const { getTemporalConfig } = require('../../../packages/temporal/src/config');
const { getAgentRuntimeTaskQueue } = require('../../../packages/agents/src/runtimeWorker');

const forbiddenKeys = [
  'PGPASSWORD',
  'SKYCOMMAND_INTERNAL_API_TOKEN',
  'SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN',
  'SKYCOMMAND_SUPERVISOR_GRANT_SECRET',
  'SKYCOMMAND_ASSISTANT_API_TOKEN',
  'GITHUB_TOKEN',
  'SKYCOMMAND_GITHUB_TOKEN_FILE',
];

const forbiddenEnvironmentKeys = forbiddenKeys.filter((key) => Object.prototype.hasOwnProperty.call(process.env, key));
const result = {
  ok: forbiddenEnvironmentKeys.length === 0,
  service: 'SkyCommand Agent Runtime Worker',
  runtimeKind: 'FAKE_ONLY',
  taskQueue: getAgentRuntimeTaskQueue(),
  temporalAddress: getTemporalConfig().address,
  hostname: os.hostname(),
  generation: String(process.env.AGENT_RUNTIME_WORKER_GENERATION || `local-${process.pid}`).trim(),
  containment: {
    liveCheckoutMount: false,
    dockerSocket: false,
    prohibitedCredentials: forbiddenEnvironmentKeys.length === 0,
    directGit: false,
  },
  forbiddenEnvironmentKeys,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
