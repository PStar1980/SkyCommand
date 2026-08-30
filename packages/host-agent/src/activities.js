const os = require('node:os');

const { executeDevCommit } = require('../../git/src/dev_commit');
const { executeMainMerge } = require('../../git/src/main_merge');
const { executeLocalRepositorySync } = require('../../git/src/local_repo_sync');
const { executeDockerSnapshot } = require('./dockerSnapshot');
const {
  DOCKER_COMPOSE_CONTROL_TOOL_CODE,
  executeDockerComposeControl,
} = require('./dockerControl');
const {
  DOCKER_CONTAINER_CONTROL_TOOL_CODE,
  DOCKER_CONTAINER_DETAIL_TOOL_CODE,
  executeDockerContainerControl,
  executeDockerContainerDetail,
} = require('./dockerContainer');
const {
  DOCKER_RESOURCE_CONTROL_TOOL_CODE,
  DOCKER_RESOURCE_DETAIL_TOOL_CODE,
  executeDockerResourceControl,
  executeDockerResourceDetail,
} = require('./dockerResource');

const HOST_AGENT_HEALTH_TOOL_CODE = '__health';
const DEV_COMMIT_TOOL_CODE = 'dev_commit';
const MAIN_MERGE_TOOL_CODE = 'main_merge';
const LOCAL_REPOSITORY_SYNC_TOOL_CODE = 'local_repo_sync';
const DOCKER_SNAPSHOT_TOOL_CODE = '__docker_snapshot';

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function serializeError(error) {
  return {
    code: normalizeText(error?.code) || 'SKYCOMMAND_HOST_AGENT_TOOL_FAILED',
    message: normalizeText(error?.message || error) || 'Host Agent tool execution failed.',
    syncResult: error?.syncResult || null,
    details: error?.details || null,
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

  if (toolCode === DOCKER_SNAPSHOT_TOOL_CODE) {
    try {
      const result = await executeDockerSnapshot();
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

  if (toolCode === DOCKER_COMPOSE_CONTROL_TOOL_CODE) {
    try {
      const result = await executeDockerComposeControl({
        projectName: input.projectName,
        action: input.action,
        configFiles: input.configFiles,
      });

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

  if (toolCode === DOCKER_CONTAINER_DETAIL_TOOL_CODE) {
    try {
      const result = await executeDockerContainerDetail({
        containerId: input.containerId,
        tail: input.tail,
      });

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

  if (toolCode === DOCKER_RESOURCE_DETAIL_TOOL_CODE) {
    try {
      const result = await executeDockerResourceDetail({
        resourceType: input.resourceType,
        reference: input.reference,
      });

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

  if (toolCode === DOCKER_RESOURCE_CONTROL_TOOL_CODE) {
    try {
      const result = await executeDockerResourceControl({
        resourceType: input.resourceType,
        reference: input.reference,
        action: input.action,
      });

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

  if (toolCode === DOCKER_CONTAINER_CONTROL_TOOL_CODE) {
    try {
      const result = await executeDockerContainerControl({
        containerId: input.containerId,
        action: input.action,
      });

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

  if (toolCode === DEV_COMMIT_TOOL_CODE) {
    try {
      const result = await executeDevCommit(
        [normalizeText(input.repoName), normalizeText(input.commitMessage)],
        {
          orchestratedExecution: true,
          executionTarget: 'HOST',
          transport: 'temporal_host_agent',
        },
      );

      return {
        ok: true,
        toolCode,
        result: {
          ...result,
          transport: 'temporal_host_agent',
          executionTarget: 'HOST',
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

  if (toolCode === MAIN_MERGE_TOOL_CODE) {
    try {
      const result = await executeMainMerge(
        [normalizeText(input.repoName), normalizeText(input.tagName)],
        {
          remoteOnly: true,
          executionTarget: 'HOST',
          transport: 'temporal_host_agent',
        },
      );

      return {
        ok: true,
        toolCode,
        result: {
          ...result,
          transport: 'temporal_host_agent',
          executionTarget: 'HOST',
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
  DOCKER_COMPOSE_CONTROL_TOOL_CODE,
  DOCKER_CONTAINER_CONTROL_TOOL_CODE,
  DOCKER_CONTAINER_DETAIL_TOOL_CODE,
  DOCKER_RESOURCE_CONTROL_TOOL_CODE,
  DOCKER_RESOURCE_DETAIL_TOOL_CODE,
  DOCKER_SNAPSHOT_TOOL_CODE,
  DEV_COMMIT_TOOL_CODE,
  HOST_AGENT_HEALTH_TOOL_CODE,
  LOCAL_REPOSITORY_SYNC_TOOL_CODE,
  MAIN_MERGE_TOOL_CODE,
  executeSkyCommandHostToolActivity,
  serializeError,
};
