const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { query } = require('../../../../packages/db/src/connection');
const authService = require('./authService');

const APP_CODE = process.env.SKYSERVER_CORE_APP_CODE || 'SKYSERVER_CORE';
const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

const LOW_RISK_RUN_PERMISSION = 'CORE_RUN_LOW_RISK_SCRIPT';
const MEDIUM_RISK_RUN_PERMISSION = 'CORE_RUN_MEDIUM_RISK_SCRIPT';
const HIGH_RISK_RUN_PERMISSION = 'CORE_RUN_HIGH_RISK_SCRIPT';

const DEFAULT_TIMEOUT_MS = Number(process.env.TOOL_EXECUTION_TIMEOUT_MS || 180000);
const MAX_OUTPUT_BYTES = Number(process.env.TOOL_EXECUTION_MAX_OUTPUT_BYTES || 250000);

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function getPermissionCodeSet(permissionRows = []) {
  return new Set(
    permissionRows
      .map((permission) => permission.permissionCode || permission.permission_code)
      .filter(Boolean),
  );
}

function getRiskRunPermission(riskCode) {
  switch (String(riskCode || '').toLowerCase()) {
    case 'low':
      return LOW_RISK_RUN_PERMISSION;
    case 'medium':
      return MEDIUM_RISK_RUN_PERMISSION;
    case 'high':
      return HIGH_RISK_RUN_PERMISSION;
    default:
      return null;
  }
}

function sanitizeMetadata(metadata = {}) {
  return JSON.stringify(metadata || {});
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === '' ? null : text;
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

function buildSummary({ status, exitCode, stdout, stderr, timedOut }) {
  const output = stdout || stderr || '';
  const firstLine = output
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

function collectOutput(bufferState, chunk) {
  const text = chunk.toString();
  const byteLength = Buffer.byteLength(text);

  if (bufferState.totalBytes >= MAX_OUTPUT_BYTES) {
    bufferState.truncated = true;
    return;
  }

  const remainingBytes = MAX_OUTPUT_BYTES - bufferState.totalBytes;

  if (byteLength <= remainingBytes) {
    bufferState.chunks.push(text);
    bufferState.totalBytes += byteLength;
    return;
  }

  bufferState.chunks.push(text.slice(0, remainingBytes));
  bufferState.totalBytes = MAX_OUTPUT_BYTES;
  bufferState.truncated = true;
}

function stringifyOutput(bufferState) {
  const output = bufferState.chunks.join('');

  if (!bufferState.truncated) {
    return output;
  }

  return `${output}\n\n[SkyServer API] Output truncated at ${MAX_OUTPUT_BYTES} bytes.`;
}

async function loadToolForExecution(toolCode) {
  const result = await query(
    `
      SELECT
        m.app_code,
        m.category_code,
        m.category_label,
        m.tool_id,
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
            AND tv.channel_code = 'admin-web'
        )
        AND EXISTS (
          SELECT 1
          FROM core.tool_visibility tv
          WHERE tv.tool_id = m.tool_id
            AND tv.channel_code = 'api'
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

async function insertExecutionStarted({ tool, scriptFile, parameters, user, session }) {
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
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'STARTED', $7::jsonb)
      RETURNING execution_id, started_at
    `,
    [
      user?.userId || null,
      session?.sessionId || null,
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
        apiLaunched: true,
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

async function auditExecutionAttempt({
  user,
  context,
  toolCode,
  success,
  message,
  action = 'run_tool',
  metadata = {},
}) {
  await authService.recordAuditEvent({
    userId: user?.userId || null,
    eventType: success ? 'TOOL_EXECUTION' : 'TOOL_EXECUTION_DENIED',
    resourceType: 'core.tools',
    resourceId: toolCode,
    action,
    success,
    message,
    metadata,
    ipAddress: context?.ipAddress || null,
    userAgent: context?.userAgent || null,
  });
}

async function executeChildProcess({ tool, scriptFile, args }) {
  const runtime = getRuntimeCommand(tool);
  const commandArgs = [...runtime.prefixArgs, scriptFile, ...args];

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const stdoutState = { chunks: [], totalBytes: 0, truncated: false };
    const stderrState = { chunks: [], totalBytes: 0, truncated: false };

    let timedOut = false;
    let settled = false;

    const child = spawn(runtime.command, commandArgs, {
      cwd: path.dirname(scriptFile),
      shell: false,
      env: process.env,
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => collectOutput(stdoutState, chunk));
    child.stderr.on('data', (chunk) => collectOutput(stderrState, chunk));

    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      resolve({
        status: 'FAILED',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        stdout: stringifyOutput(stdoutState),
        stderr: `${stringifyOutput(stderrState)}\n${error.message}`.trim(),
        timedOut,
        runtimeLabel: runtime.label,
        commandArgs,
      });
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const exitCode = timedOut ? -1 : code;
      const status = exitCode === 0 ? 'SUCCESS' : 'FAILED';

      resolve({
        status,
        exitCode,
        durationMs: Date.now() - startedAt,
        stdout: stringifyOutput(stdoutState),
        stderr: stringifyOutput(stderrState),
        timedOut,
        runtimeLabel: runtime.label,
        commandArgs,
      });
    });
  });
}

async function assertRunAllowed({ tool, permissions, user, context }) {
  if (!tool) {
    throw createHttpError(404, 'Tool not found or not enabled for Admin-Web/API execution.');
  }

  const permissionCodes = getPermissionCodeSet(permissions);
  const requiredRiskPermission = getRiskRunPermission(tool.risk_code);
  const missingPermissions = [];

  if (!requiredRiskPermission) {
    await auditExecutionAttempt({
      user,
      context,
      toolCode: tool.tool_code,
      success: false,
      message: `Unsupported risk level: ${tool.risk_code}`,
      metadata: { riskCode: tool.risk_code },
    });

    throw createHttpError(500, `Unsupported risk level: ${tool.risk_code}`);
  }

  if (tool.permission_code && !permissionCodes.has(tool.permission_code)) {
    missingPermissions.push(tool.permission_code);
  }

  if (!permissionCodes.has(requiredRiskPermission)) {
    missingPermissions.push(requiredRiskPermission);
  }

  if (missingPermissions.length > 0) {
    await auditExecutionAttempt({
      user,
      context,
      toolCode: tool.tool_code,
      success: false,
      message: `Missing permission(s): ${missingPermissions.join(', ')}`,
      metadata: { missingPermissions },
    });

    throw createHttpError(403, 'Permission denied.', { missingPermissions });
  }
}

function assertConfirmationIfRequired({ tool, confirmed }) {
  if (!toBoolean(tool.requires_confirmation)) {
    return;
  }

  if (confirmed === true || confirmed === 'true' || confirmed === 'YES' || confirmed === 'yes') {
    return;
  }

  throw createHttpError(400, 'Confirmation is required for this tool.');
}

async function runTool({
  toolCode,
  parameters = {},
  confirmed = false,
  user,
  session,
  permissions = [],
  context = {},
}) {
  const normalizedToolCode = normalizeOptionalString(toolCode);

  if (!normalizedToolCode) {
    throw createHttpError(400, 'toolCode is required.');
  }

  const tool = await loadToolForExecution(normalizedToolCode);

  await assertRunAllowed({
    tool,
    permissions,
    user,
    context,
  });

  assertConfirmationIfRequired({
    tool,
    confirmed,
  });

  const scriptFile = resolveScriptFile(tool);
  const { args } = await buildToolArgs({
    toolCode: tool.tool_code,
    rawParameters: parameters,
  });

  const execution = await insertExecutionStarted({
    tool,
    scriptFile,
    parameters,
    user,
    session,
  });

  await auditExecutionAttempt({
    user,
    context,
    toolCode: tool.tool_code,
    success: true,
    message: 'Tool execution started.',
    action: 'start_tool',
    metadata: {
      executionId: execution.execution_id,
      parameters,
    },
  });

  const childResult = await executeChildProcess({
    tool,
    scriptFile,
    args,
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
    },
  });

  await authService.recordAuditEvent({
    userId: user?.userId || null,
    eventType: 'TOOL_EXECUTION',
    resourceType: 'core.tools',
    resourceId: tool.tool_code,
    action: 'finish_tool',
    success: childResult.status === 'SUCCESS',
    message: summary,
    metadata: {
      executionId: execution.execution_id,
      status: childResult.status,
      exitCode: childResult.exitCode,
      durationMs: childResult.durationMs,
    },
    ipAddress: context?.ipAddress || null,
    userAgent: context?.userAgent || null,
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
  };
}

module.exports = {
  runTool,
};
