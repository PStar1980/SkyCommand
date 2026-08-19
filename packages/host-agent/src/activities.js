const os = require('node:os');

const { executeLocalRepositorySync } = require('../../git/src/local_repo_sync');

const HOST_AGENT_HEALTH_TOOL_CODE = '__health';
const LOCAL_REPOSITORY_SYNC_TOOL_CODE = 'local_repo_sync';

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function serializeError(error) {
  return {
    code: normalizeText(error?.code) || 'SKYCOMMAND_HOST_AGENT_TOOL_FAILED',
    message: normalizeText(error?.message || error) || 'Host Agent tool execution failed.',
    syncResult: error?.syncResult || null,
  };
}

async function executeSkyCommandHostToolActivity(input = {}) {
  const toolCode = normalizeText(input.toolCode);

  if (toolCode === HOST_AGENT_HEALTH_TOOL_CODE) {
    return {
      ok: true,
      toolCode,
      result: {
        status: 'ONLINE',
        executionTarget: 'HOST',
        hostname: os.hostname(),
        processId: process.pid,
        platform: process.platform,
        profileCode:
          normalizeText(process.env.SKYCOMMAND_CONFIG_PROFILE) ||
          normalizeText(process.env.SKYSERVER_CONFIG_PROFILE) ||
          'DEV_LOCAL',
        taskQueue: normalizeText(input.hostTaskQueue),
        checkedAt: new Date().toISOString(),
      },
    };
  }

  if (toolCode !== LOCAL_REPOSITORY_SYNC_TOOL_CODE) {
    return {
      ok: false,
      toolCode,
      error: {
        code: 'SKYCOMMAND_HOST_AGENT_TOOL_NOT_ALLOWED',
        message: `Host Agent does not allow tool '${toolCode || 'blank'}'.`,
        syncResult: null,
      },
    };
  }

  try {
    const result = await executeLocalRepositorySync([
      normalizeText(input.repoName),
      normalizeText(input.expectedLocalDevSha),
      normalizeText(input.expectedSynchronizedHeadSha),
    ]);

    return {
      ok: true,
      toolCode,
      result: {
        ...result,
        transport: 'temporal_host_agent',
      },
    };
  } catch (error) {
    return {
      ok: false,
      toolCode,
      error: serializeError(error),
    };
  }
}

module.exports = {
  HOST_AGENT_HEALTH_TOOL_CODE,
  LOCAL_REPOSITORY_SYNC_TOOL_CODE,
  executeSkyCommandHostToolActivity,
  serializeError,
};
