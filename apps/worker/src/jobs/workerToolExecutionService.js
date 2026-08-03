const fs = require('fs');
const path = require('path');
const { query } = require('../../../../packages/db/src/connection');
const { executeToolProcess } = require('../../../../packages/tools/src');

const APP_CODE = process.env.SKYCOMMAND_CORE_APP_CODE || process.env.SKYSERVER_CORE_APP_CODE || 'SKYSERVER_CORE';
const PROFILE_CODE =
  process.env.SKYCOMMAND_CONFIG_PROFILE || process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYCOMMAND_CORE_PROFILE || process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

const DEFAULT_TIMEOUT_MS = Number(
  process.env.WORKER_TOOL_TIMEOUT_MS || process.env.TOOL_EXECUTION_TIMEOUT_MS || 180000,
);
const MAX_OUTPUT_BYTES = Number(
  process.env.WORKER_TOOL_MAX_OUTPUT_BYTES || process.env.TOOL_EXECUTION_MAX_OUTPUT_BYTES || 250000,
);
const ALLOW_HIGH_RISK_TOOLS =
  String(process.env.WORKER_ALLOW_HIGH_RISK_TOOLS || 'false').toLowerCase() === 'true';

const activeExecutionLocks = new Map();

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === '' ? null : text;
}

function sanitizeMetadata(metadata = {}) {
  return JSON.stringify(metadata || {});
}

function assertNoNullByte(value, label) {
  if (typeof value === 'string' && value.includes('\0')) {
    throw createHttpError(400, `${label} contains an invalid null byte.`);
  }
}

function assertSafeFileName(value, label) {
  if (!value) {
    return;
  }

  assertNoNullByte(value, label);

  if (value !== path.basename(value)) {
    throw createHttpError(400, `${label} must be a file name only, not a path.`);
  }
}

function validateStringParam(value, parameterName) {
  if (value === undefined || value === null) {
    return value;
  }

  const text = String(value);

  assertNoNullByte(text, parameterName);

  if (text.length > 1000) {
    throw createHttpError(400, `${parameterName} is too long.`);
  }

  if (parameterName.toLowerCase() === 'filename') {
    assertSafeFileName(text, parameterName);
  }

  return text;
}

function assertPlainParameterObject(parameters) {
  if (parameters === undefined || parameters === null) {
    return {};
  }

  if (Array.isArray(parameters) || typeof parameters !== 'object') {
    throw createHttpError(400, 'Tool parameters must be a JSON object.');
  }

  return parameters;
}

function normalizeParameterValue(rawValue, parameter) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    if (parameter.default_value !== undefined && parameter.default_value !== null) {
      return parameter.default_value;
    }

    if (toBoolean(parameter.required)) {
      throw createHttpError(400, `Missing required parameter: ${parameter.parameter_name}`);
    }

    return null;
  }

  switch (parameter.param_type_code) {
    case 'boolean':
      return toBoolean(rawValue) ? 'true' : 'false';

    case 'number': {
      const numberValue = Number(rawValue);

      if (Number.isNaN(numberValue)) {
        throw createHttpError(400, `${parameter.parameter_name} must be numeric.`);
      }

      return String(numberValue);
    }

    case 'repo':
    case 'select':
    case 'path':
    case 'string':
    case 'date':
    default:
      return validateStringParam(rawValue, parameter.parameter_name);
  }
}

function getRuntimeCommand(tool) {
  const runtime = tool.runtime_code || 'node';

  if (runtime === 'node') {
    return {
      command: process.execPath,
      prefixArgs: [],
      label: 'node',
    };
  }

  if (runtime === 'powershell') {
    return {
      command: tool.runtime_executable || 'powershell.exe',
      prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
      label: 'powershell',
    };
  }

  if (runtime === 'pwsh') {
    return {
      command: tool.runtime_executable || 'pwsh',
      prefixArgs: ['-NoProfile', '-File'],
      label: 'pwsh',
    };
  }

  throw createHttpError(500, `Unsupported runtime: ${runtime}`);
}

function assertPathInsideRoot(scriptFile, repoRoot) {
  const relativePath = path.relative(repoRoot, scriptFile);

  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw createHttpError(500, 'Configured script path resolves outside of its repository root.');
  }
}

function resolveScriptFile(tool) {
  if (!tool.root_path) {
    throw createHttpError(500, 'Tool repository root path is not configured.');
  }

  if (!tool.script_path) {
    throw createHttpError(500, 'Tool script path is not configured.');
  }

  assertNoNullByte(tool.root_path, 'root_path');
  assertNoNullByte(tool.script_path, 'script_path');

  const repoRoot = path.resolve(tool.root_path);
  const scriptFile = path.isAbsolute(tool.script_path)
    ? path.resolve(tool.script_path)
    : path.resolve(repoRoot, tool.script_path);

  assertPathInsideRoot(scriptFile, repoRoot);

  if (!fs.existsSync(scriptFile)) {
    throw createHttpError(500, `Configured script file was not found: ${tool.tool_code}`);
  }

  return scriptFile;
}

function getLogDirectory() {
  const skyServerRoot = path.resolve(__dirname, '../../../..');
  const logDirectory = path.join(skyServerRoot, 'logs', 'script-executions');

  fs.mkdirSync(logDirectory, { recursive: true });

  return logDirectory;
}

function writeExecutionOutputFiles({ executionId, stdout, stderr }) {
  const logDirectory = getLogDirectory();
  const stdoutPath = path.join(logDirectory, `${executionId}.stdout.log`);
  const stderrPath = path.join(logDirectory, `${executionId}.stderr.log`);

  fs.writeFileSync(stdoutPath, stdout || '', 'utf8');
  fs.writeFileSync(stderrPath, stderr || '', 'utf8');

  return {
    stdoutPath,
    stderrPath,
  };
}

function getUsefulOutputLine(output) {
  return (output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !line.includes('[dotenv'));
}

function buildSummary({
  status,
  exitCode,
  stdout,
  stderr,
  timedOut,
  toolResult = null,
  toolResultContract = null,
}) {
  if (toolResultContract?.error?.message) {
    return `Structured tool result rejected: ${toolResultContract.error.message}`;
  }

  if (toolResult?.message) {
    return toolResult.message;
  }

  const firstUsefulLine = getUsefulOutputLine(stdout) || getUsefulOutputLine(stderr);
  const firstLine =
    firstUsefulLine ||
    (stdout || stderr || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0];

  if (timedOut) {
    return 'Script timed out.';
  }

  if (status === 'SUCCESS') {
    return firstLine || 'Script completed successfully.';
  }

  return firstLine || `Script failed with exit code ${exitCode}.`;
}

function getExecutionLockKey(tool) {
  return `${APP_CODE}:${PROFILE_CODE}:worker:${tool.tool_code}`;
}

function assertExecutionNotAlreadyRunning(tool) {
  const lockKey = getExecutionLockKey(tool);
  const activeExecution = activeExecutionLocks.get(lockKey);

  if (activeExecution) {
    throw createHttpError(
      409,
      `${tool.label || tool.tool_code} is already running in this worker.`,
      {
        activeExecutionId: activeExecution.executionId || null,
        startedAt: activeExecution.startedAt || null,
        toolCode: tool.tool_code,
      },
    );
  }
}

function acquireExecutionLock(tool) {
  const lockKey = getExecutionLockKey(tool);

  activeExecutionLocks.set(lockKey, {
    toolCode: tool.tool_code,
    startedAt: new Date().toISOString(),
    executionId: null,
  });

  return {
    setExecutionId(executionId) {
      const currentLock = activeExecutionLocks.get(lockKey);

      if (currentLock) {
        activeExecutionLocks.set(lockKey, {
          ...currentLock,
          executionId,
        });
      }
    },
    release() {
      activeExecutionLocks.delete(lockKey);
    },
  };
}

async function loadWorkerTool(toolCode) {
  const result = await query(
    `
      SELECT
        m.app_code,
        m.category_code,
        m.category_label,
        m.tool_id,
        r.repo_id AS script_repo_id,
        m.tool_code,
        m.name,
        m.label,
        m.description,
        m.script_repo_code,
        m.script_path,
        m.runtime_code,
        m.runtime_executable,
        m.permission_code,
        m.risk_code,
        m.risk_rank,
        m.requires_confirmation,
        m.confirmation_text,
        m.captures_output,
        m.allow_params,
        m.tool_display_order,
        rp.root_path
      FROM core.vw_tool_manifest m
      JOIN core.repositories r
        ON r.repo_code = m.script_repo_code
      JOIN core.repository_paths rp
        ON rp.repo_id = r.repo_id
      JOIN core.config_profiles cp
        ON cp.profile_id = rp.profile_id
      WHERE m.app_code = $1
        AND m.tool_code = $2
        AND cp.profile_code = $3
        AND cp.active = TRUE
        AND r.active = TRUE
        AND rp.active = TRUE
        AND EXISTS (
          SELECT 1
          FROM core.tool_visibility tv
          WHERE tv.tool_id = m.tool_id
            AND tv.channel_code = 'worker'
        )
      LIMIT 1
    `,
    [APP_CODE, toolCode, PROFILE_CODE],
  );

  return result.rows[0] || null;
}

async function loadToolParameters(toolCode) {
  const result = await query(
    `
      SELECT
        tool_code,
        parameter_id,
        parameter_name,
        label,
        param_type_code,
        prompt,
        required,
        default_value,
        option_source_code,
        display_order,
        enabled
      FROM core.vw_tool_parameters
      WHERE tool_code = $1
      ORDER BY display_order, parameter_name
    `,
    [toolCode],
  );

  return result.rows;
}

async function loadRepositoryOptionValues() {
  const result = await query(
    `
      SELECT repo_code
      FROM core.vw_repository_paths
      WHERE profile_code = $1
      ORDER BY display_order, repo_name
    `,
    [PROFILE_CODE],
  );

  return new Set(result.rows.map((row) => row.repo_code));
}

async function buildToolArgs({ toolCode, rawParameters }) {
  const parameterRows = await loadToolParameters(toolCode);
  const inputParameters = rawParameters || {};
  const allowedParameterNames = new Set(parameterRows.map((row) => row.parameter_name));
  const unknownParameters = Object.keys(inputParameters).filter(
    (parameterName) => !allowedParameterNames.has(parameterName),
  );

  if (unknownParameters.length > 0) {
    throw createHttpError(400, `Unknown parameter(s): ${unknownParameters.join(', ')}`);
  }

  let repositoryOptions = null;
  const args = [];

  for (const parameter of parameterRows) {
    const rawValue = inputParameters[parameter.parameter_name];
    const normalizedValue = normalizeParameterValue(rawValue, parameter);

    if (normalizedValue === null) {
      continue;
    }

    if (parameter.param_type_code === 'repo' || parameter.option_source_code === 'repositories') {
      if (!repositoryOptions) {
        repositoryOptions = await loadRepositoryOptionValues();
      }

      if (!repositoryOptions.has(normalizedValue)) {
        throw createHttpError(400, `Invalid repository selection: ${normalizedValue}`);
      }
    }

    args.push(normalizedValue);
  }

  return {
    args,
    parameterRows,
  };
}

function assertWorkerToolAllowed(tool) {
  if (!tool) {
    throw createHttpError(404, 'Tool not found or not enabled for worker execution.');
  }

  if (String(tool.risk_code || '').toLowerCase() === 'high' && !ALLOW_HIGH_RISK_TOOLS) {
    throw createHttpError(403, 'High-risk tools are not allowed in worker execution by default.', {
      toolCode: tool.tool_code,
      riskCode: tool.risk_code,
      override: 'Set WORKER_ALLOW_HIGH_RISK_TOOLS=true only if this is intentional.',
    });
  }
}

async function insertExecutionStarted({
  tool,
  scriptFile,
  parameters,
  schedule,
  scheduleRun,
  workerNode,
}) {
  const result = await query(
    `
      INSERT INTO auth.script_execution_log (
        user_id,
        session_id,
        script_name,
        script_file,
        category,
        parameters,
        status,
        metadata
      )
      VALUES (NULL, NULL, $1, $2, $3, $4::jsonb, 'STARTED', $5::jsonb)
      RETURNING execution_id, started_at
    `,
    [
      tool.tool_code,
      scriptFile,
      tool.category_code,
      JSON.stringify(parameters || {}),
      sanitizeMetadata({
        appCode: APP_CODE,
        profileCode: PROFILE_CODE,
        toolId: tool.tool_id,
        toolLabel: tool.label,
        riskCode: tool.risk_code,
        workerLaunched: true,
        workerNodeId: workerNode?.workerNodeId || null,
        workerNodeName: workerNode?.nodeName || null,
        scheduleId: schedule?.scheduleId || null,
        scheduleCode: schedule?.scheduleCode || null,
        scheduleRunId: scheduleRun?.scheduleRunId || null,
      }),
    ],
  );

  return result.rows[0];
}

async function updateExecutionFinished({
  executionId,
  status,
  exitCode,
  durationMs,
  stdoutPath,
  stderrPath,
  summary,
  metadata = {},
}) {
  await query(
    `
      UPDATE auth.script_execution_log
      SET status = $2,
          exit_code = $3,
          finished_at = CURRENT_TIMESTAMP,
          duration_ms = $4,
          stdout_path = $5,
          stderr_path = $6,
          summary = $7,
          metadata = metadata || $8::jsonb
      WHERE execution_id = $1
    `,
    [
      executionId,
      status,
      exitCode,
      durationMs,
      stdoutPath,
      stderrPath,
      summary,
      sanitizeMetadata(metadata),
    ],
  );
}

async function executeChildProcess({
  tool,
  scriptFile,
  args,
  schedule,
  scheduleRun,
  workerNode,
  executionId,
}) {
  const runtime = getRuntimeCommand(tool);
  const commandArgs = [...runtime.prefixArgs, scriptFile, ...args];

  const result = await executeToolProcess({
    command: runtime.command,
    commandArgs,
    cwd: path.dirname(scriptFile),
    env: {
      ...process.env,
      SKYWEB_ALERT_SCHEDULE_CODE: schedule?.scheduleCode || '',
      SKYWEB_ALERT_SCHEDULE_RUN_ID: scheduleRun?.scheduleRunId || '',
      SKYWEB_ALERT_WORKER_NODE_ID: workerNode?.workerNodeId || '',
      SKYWEB_ALERT_WORKER_NODE_NAME: workerNode?.nodeName || '',
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    outputTruncationLabel: 'SkyCommand Worker',
    executionId,
    toolCode: tool.tool_code,
    rootDirectory: tool.root_path,
  });

  return {
    ...result,
    runtimeLabel: runtime.label,
    commandArgs,
  };
}

async function runWorkerTool({ toolCode, parameters = {}, schedule, scheduleRun, workerNode }) {
  const normalizedToolCode = normalizeOptionalString(toolCode);

  if (!normalizedToolCode) {
    throw createHttpError(400, 'toolCode is required.');
  }

  const safeParameters = assertPlainParameterObject(parameters);
  const tool = await loadWorkerTool(normalizedToolCode);

  assertWorkerToolAllowed(tool);
  assertExecutionNotAlreadyRunning(tool);

  const executionLock = acquireExecutionLock(tool);
  let execution = null;

  try {
    const scriptFile = resolveScriptFile(tool);
    const { args } = await buildToolArgs({
      toolCode: tool.tool_code,
      rawParameters: safeParameters,
    });

    execution = await insertExecutionStarted({
      tool,
      scriptFile,
      parameters: safeParameters,
      schedule,
      scheduleRun,
      workerNode,
    });
    executionLock.setExecutionId(execution.execution_id);

    const childResult = await executeChildProcess({
      tool,
      scriptFile,
      args,
      schedule,
      scheduleRun,
      workerNode,
      executionId: execution.execution_id,
    });

    const outputFiles = writeExecutionOutputFiles({
      executionId: execution.execution_id,
      stdout: childResult.stdout,
      stderr: childResult.stderr,
    });

    const summary = buildSummary({
      status: childResult.status,
      exitCode: childResult.exitCode,
      stdout: childResult.stdout,
      stderr: childResult.stderr,
      timedOut: childResult.timedOut,
      toolResult: childResult.toolResult,
      toolResultContract: childResult.toolResultContract,
    });

    await updateExecutionFinished({
      executionId: execution.execution_id,
      status: childResult.status,
      exitCode: childResult.exitCode,
      durationMs: childResult.durationMs,
      stdoutPath: outputFiles.stdoutPath,
      stderrPath: outputFiles.stderrPath,
      summary,
      metadata: {
        runtime: childResult.runtimeLabel,
        timedOut: childResult.timedOut,
        outputTruncated:
          childResult.stdout.includes('Output truncated') ||
          childResult.stderr.includes('Output truncated'),
        processStatus: childResult.processStatus,
        toolResultAvailable: Boolean(childResult.toolResult),
        toolResultContract: childResult.toolResultContract,
      },
    });

    return {
      executionId: execution.execution_id,
      toolCode: tool.tool_code,
      label: tool.label,
      status: childResult.status,
      exitCode: childResult.exitCode,
      durationMs: childResult.durationMs,
      startedAt: execution.started_at,
      summary,
      stdout: childResult.stdout,
      stderr: childResult.stderr,
      toolResult: childResult.toolResult,
      toolResultContract: childResult.toolResultContract,
    };
  } catch (error) {
    if (execution?.execution_id) {
      const outputFiles = writeExecutionOutputFiles({
        executionId: execution.execution_id,
        stdout: '',
        stderr: error.stack || error.message || String(error),
      });

      await updateExecutionFinished({
        executionId: execution.execution_id,
        status: 'FAILED',
        exitCode: -1,
        durationMs: 0,
        stdoutPath: outputFiles.stdoutPath,
        stderrPath: outputFiles.stderrPath,
        summary: error.message || 'Worker tool execution failed unexpectedly.',
        metadata: {
          unexpectedFailure: true,
          errorMessage: error.message || String(error),
        },
      });
    }

    throw error.statusCode
      ? error
      : createHttpError(500, error.message || 'Worker tool execution failed unexpectedly.');
  } finally {
    executionLock.release();
  }
}

module.exports = {
  runWorkerTool,
};
