const fs = require('fs');
const path = require('path');
const { query } = require('../../../../packages/db/src/connection');
const authService = require('./authService');
const {
  executeToolProcess,
  getRegisteredToolExecutionContract,
  isToolResultRequired,
} = require('../../../../packages/tools/src');

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
const CONFIGURED_STALE_AFTER_MINUTES = Number(process.env.TOOL_EXECUTION_STALE_AFTER_MINUTES || 15);
const DEFAULT_STALE_AFTER_MS = Math.max(
  Number.isFinite(CONFIGURED_STALE_AFTER_MINUTES)
    ? CONFIGURED_STALE_AFTER_MINUTES * 60 * 1000
    : 15 * 60 * 1000,
  DEFAULT_TIMEOUT_MS + 60000,
);

const MAX_PARAMETER_COUNT = Number(process.env.TOOL_EXECUTION_MAX_PARAMETERS || 20);
const MAX_PARAMETER_BYTES = Number(process.env.TOOL_EXECUTION_MAX_PARAMETER_BYTES || 12000);
const HIGH_RISK_CONFIRMATION_PHRASE =
  process.env.TOOL_HIGH_RISK_CONFIRMATION_PHRASE || 'RUN HIGH RISK';
const SKYSERVER_WORKFLOW_START_TOOL_CODE = 'skyserver_workflow_start';

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

function normalizeConfirmationPhrase(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
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

function assertParameterPayloadSafe(parameters = {}) {
  const parameterEntries = Object.entries(parameters);

  if (parameterEntries.length > MAX_PARAMETER_COUNT) {
    throw createHttpError(400, `Too many parameters. Maximum allowed: ${MAX_PARAMETER_COUNT}.`);
  }

  const parameterJson = JSON.stringify(parameters || {});
  const parameterBytes = Buffer.byteLength(parameterJson, 'utf8');

  if (parameterBytes > MAX_PARAMETER_BYTES) {
    throw createHttpError(
      400,
      `Parameter payload is too large. Maximum allowed: ${MAX_PARAMETER_BYTES} bytes.`,
    );
  }

  for (const [parameterName, parameterValue] of parameterEntries) {
    validateStringParam(parameterName, 'parameter name');

    if (typeof parameterValue === 'string') {
      validateStringParam(parameterValue, parameterName);
    }
  }
}

function getExecutionLockKey(tool) {
  return `${APP_CODE}:${PROFILE_CODE}:${tool.tool_code}`;
}

function assertExecutionNotAlreadyRunning(tool) {
  const lockKey = getExecutionLockKey(tool);
  const activeExecution = activeExecutionLocks.get(lockKey);

  if (activeExecution) {
    throw createHttpError(409, `${tool.label || tool.tool_code} is already running.`, {
      activeExecutionId: activeExecution.executionId || null,
      startedAt: activeExecution.startedAt || null,
      toolCode: tool.tool_code,
    });
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
    lockKey,
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

function normalizeExecutionError(error) {
  if (!error) {
    return 'Unexpected tool execution error.';
  }

  return error.stack || error.message || String(error);
}

async function markStaleStartedExecutions(options = {}) {
  const staleAfterMs = Number(options.staleAfterMs || DEFAULT_STALE_AFTER_MS);
  const safeStaleAfterMs =
    Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : DEFAULT_STALE_AFTER_MS;
  const staleAfterSeconds = Math.ceil(safeStaleAfterMs / 1000);
  const reason = options.reason || 'stale_started_execution_cleanup';

  const result = await query(
    `
      UPDATE auth.script_execution_log
      SET status = 'FAILED',
          exit_code = -1,
          finished_at = CURRENT_TIMESTAMP,
          duration_ms = GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) * 1000)::BIGINT
          ),
          summary = COALESCE(
            summary,
            'Marked failed by SkyServer because execution remained STARTED beyond the stale threshold.'
          ),
          metadata = metadata || $2::jsonb
      WHERE status = 'STARTED'
        AND started_at < CURRENT_TIMESTAMP - ($1::TEXT)::INTERVAL
      RETURNING execution_id, script_name, started_at
    `,
    [
      `${staleAfterSeconds} seconds`,
      sanitizeMetadata({
        staleCleanup: true,
        reason,
        staleAfterMs: safeStaleAfterMs,
        cleanedAt: new Date().toISOString(),
      }),
    ],
  );

  return {
    staleAfterMs: safeStaleAfterMs,
    cleanedCount: result.rowCount || 0,
    executions: result.rows || [],
  };
}

async function loadToolForExecution(toolCode) {
  const result = await query(
    `
      SELECT
        m.app_code,
        m.category_code,
        m.category_label,
        m.tool_id,
        r.repo_id AS script_repo_id,
        snapshot.tool_manifest_snapshot_id,
        snapshot.validation_status AS manifest_snapshot_status,
        snapshot.manifest_version,
        snapshot.manifest_path,
        snapshot.runtime_type AS manifest_runtime_type,
        snapshot.entrypoint_path AS manifest_entrypoint_path,
        snapshot.output_type AS manifest_output_type,
        snapshot.result_required AS manifest_result_required,
        snapshot.manifest_hash,
        snapshot.entrypoint_hash,
        snapshot.output_schema_hash,
        snapshot.contract_sample_hash,
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
      LEFT JOIN core.tool_manifest_snapshots snapshot
        ON snapshot.tool_id = m.tool_id
       AND snapshot.is_current = TRUE
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

async function loadSkyserverWorkflowOptionValues() {
  const result = await query(
    `
      SELECT workflow_code
      FROM worker.vw_workflow_definitions
      WHERE status = 'ACTIVE'
        AND enabled = TRUE
        AND visible_in_admin = TRUE
        AND published_version_id IS NOT NULL
      ORDER BY display_name, workflow_code
    `,
  );

  return new Set(result.rows.map((row) => row.workflow_code));
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
  let skyserverWorkflowOptions = null;
  const args = [];
  const normalizedParameters = {};

  for (const parameter of parameterRows) {
    const rawValue = inputParameters[parameter.parameter_name];
    const normalizedValue = normalizeParameterValue(rawValue, parameter);

    if (normalizedValue === null) {
      continue;
    }

    normalizedParameters[parameter.parameter_name] = normalizedValue;

    if (parameter.param_type_code === 'repo' || parameter.option_source_code === 'repositories') {
      if (!repositoryOptions) {
        repositoryOptions = await loadRepositoryOptionValues();
      }

      if (!repositoryOptions.has(normalizedValue)) {
        throw createHttpError(400, `Invalid repository selection: ${normalizedValue}`);
      }
    }

    if (parameter.option_source_code === 'skyserver_workflows') {
      if (!skyserverWorkflowOptions) {
        skyserverWorkflowOptions = await loadSkyserverWorkflowOptionValues();
      }

      if (!skyserverWorkflowOptions.has(normalizedValue)) {
        throw createHttpError(400, `Invalid workflow selection: ${normalizedValue}`);
      }
    }

    args.push(normalizedValue);
  }

  return {
    args,
    parameterRows,
    normalizedParameters,
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

async function markExecutionFailedAfterUnexpectedError({ execution, executionStartedAtMs, error }) {
  if (!execution?.execution_id) {
    return;
  }

  const normalizedError = normalizeExecutionError(error);
  const summary = error?.message
    ? `Tool execution failed unexpectedly: ${error.message}`
    : 'Tool execution failed unexpectedly.';

  let outputFiles = {
    stdoutPath: null,
    stderrPath: null,
  };

  try {
    outputFiles = writeExecutionOutputFiles({
      executionId: execution.execution_id,
      stdout: '',
      stderr: normalizedError,
    });
  } catch (fileError) {
    console.error('[SkyServer API] Failed to write execution failure logs:', fileError);
  }

  await updateExecutionFinished({
    executionId: execution.execution_id,
    status: 'FAILED',
    exitCode: -1,
    durationMs: Math.max(0, Date.now() - executionStartedAtMs),
    stdoutPath: outputFiles.stdoutPath,
    stderrPath: outputFiles.stderrPath,
    summary,
    metadata: {
      unexpectedFailure: true,
      errorMessage: error?.message || String(error),
    },
  });
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

async function executeChildProcess({
  tool,
  scriptFile,
  args,
  executionId,
  toolResultRequired = false,
}) {
  const runtime = getRuntimeCommand(tool);
  const commandArgs = [...runtime.prefixArgs, scriptFile, ...args];
  const executionContract = getRegisteredToolExecutionContract(tool, {
    repositoryRoot: tool.root_path,
  });

  const result = await executeToolProcess({
    command: runtime.command,
    commandArgs,
    cwd: path.dirname(scriptFile),
    env: process.env,
    timeoutMs: executionContract?.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    outputTruncationLabel: 'SkyServer API',
    executionId,
    toolCode: tool.tool_code,
    toolResultRequired: Boolean(toolResultRequired || executionContract?.resultRequired),
    toolResultExpectedOutputType: executionContract?.expectedOutputType || null,
    toolResultOutputSchema: executionContract?.outputSchema || null,
    rootDirectory: tool.root_path,
  });

  return {
    ...result,
    runtimeLabel: runtime.label,
    commandArgs,
    manifestContract: executionContract
      ? {
          snapshotId: executionContract.snapshotId || null,
          snapshotStatus: executionContract.snapshotStatus || null,
          manifestHash: executionContract.manifestHash || null,
          entrypointHash: executionContract.entrypointHash || null,
          outputType: executionContract.expectedOutputType || null,
          resultRequired: executionContract.resultRequired === true,
        }
      : null,
  };
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

function assertConfirmationIfRequired({ tool, confirmed, confirmationPhrase }) {
  if (!toBoolean(tool.requires_confirmation)) {
    return;
  }

  const confirmedBoolean =
    confirmed === true || confirmed === 'true' || confirmed === 'YES' || confirmed === 'yes';

  if (!confirmedBoolean) {
    throw createHttpError(400, 'Confirmation is required for this tool.');
  }

  if (String(tool.risk_code || '').toLowerCase() !== 'high') {
    return;
  }

  if (normalizeConfirmationPhrase(confirmationPhrase) === HIGH_RISK_CONFIRMATION_PHRASE) {
    return;
  }

  throw createHttpError(
    400,
    `High-risk confirmation phrase is required: ${HIGH_RISK_CONFIRMATION_PHRASE}`,
  );
}


function parseWorkflowInputJson(value) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return {};
  }

  let parsed;

  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw createHttpError(400, `Workflow input JSON is invalid: ${error.message}`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw createHttpError(400, 'Workflow input JSON must be an object.');
  }

  return parsed;
}

async function runSkyserverWorkflowBridgeTool({
  tool,
  safeParameters,
  user,
  session,
  permissions,
  context,
}) {
  const executionStartedAtMs = Date.now();
  const { normalizedParameters } = await buildToolArgs({
    toolCode: tool.tool_code,
    rawParameters: safeParameters,
  });
  const workflowCode = normalizeOptionalString(normalizedParameters.workflowCode);

  if (!workflowCode) {
    throw createHttpError(400, 'workflowCode is required.');
  }

  const input = parseWorkflowInputJson(normalizedParameters.inputJson);

  if (normalizeOptionalString(normalizedParameters.workflowId)) {
    input.workflowId = normalizeOptionalString(normalizedParameters.workflowId);
  }

  input.runSource = input.runSource || 'api';
  input.triggerType = input.triggerType || 'API';
  input.startedFrom = input.startedFrom || 'admin_tool_bridge';

  const execution = await insertExecutionStarted({
    tool,
    scriptFile: `workflow://skyserver/${workflowCode}`,
    parameters: safeParameters,
    user,
    session,
  });

  try {
    await auditExecutionAttempt({
      user,
      context,
      toolCode: tool.tool_code,
      success: true,
      message: `SkyServer workflow bridge started ${workflowCode}.`,
      action: 'start_workflow_bridge',
      metadata: {
        executionId: execution.execution_id,
        workflowCode,
        parameters: safeParameters,
      },
    });
  } catch (auditError) {
    console.error('[SkyServer API] Failed to record workflow bridge audit event:', auditError);
  }

  try {
    const workflowExecutorService = require('./workflowExecutorService');
    const result = await workflowExecutorService.startWorkflowWithTemporal({
      workflowCode,
      input,
      user,
      session,
      permissions,
      context,
    });
    const run = result.run || {};
    const temporalWorkflow = result.temporalWorkflow || {};
    const durationMs = Math.max(0, Date.now() - executionStartedAtMs);
    const summary = result.message || `Workflow ${workflowCode} started through Temporal.`;

    await updateExecutionFinished({
      executionId: execution.execution_id,
      status: 'SUCCESS',
      exitCode: 0,
      durationMs,
      stdoutPath: null,
      stderrPath: null,
      summary,
      metadata: {
        bridgeTool: true,
        workflowCode,
        workflowRunRecordId: run.workflowRunRecordId || null,
        temporalWorkflowId: temporalWorkflow.workflowId || run.temporalWorkflowId || null,
        temporalRunId: temporalWorkflow.runId || run.temporalRunId || null,
      },
    });

    try {
      await authService.recordAuditEvent({
        userId: user?.userId || null,
        eventType: 'TOOL_EXECUTION',
        resourceType: 'core.tools',
        resourceId: tool.tool_code,
        action: 'finish_workflow_bridge',
        success: true,
        message: summary,
        metadata: {
          executionId: execution.execution_id,
          workflowCode,
          workflowRunRecordId: run.workflowRunRecordId || null,
          temporalWorkflowId: temporalWorkflow.workflowId || run.temporalWorkflowId || null,
        },
        ipAddress: context?.ipAddress || null,
        userAgent: context?.userAgent || null,
      });
    } catch (auditError) {
      console.error('[SkyServer API] Failed to record workflow bridge finish event:', auditError);
    }

    return {
      executionId: execution.execution_id,
      toolCode: tool.tool_code,
      label: tool.label,
      status: 'SUCCESS',
      exitCode: 0,
      durationMs,
      startedAt: execution.started_at,
      summary,
      stdout: JSON.stringify(
        {
          ok: true,
          workflowCode,
          workflowRunRecordId: run.workflowRunRecordId || null,
          temporalWorkflowId: temporalWorkflow.workflowId || run.temporalWorkflowId || null,
          temporalRunId: temporalWorkflow.runId || run.temporalRunId || null,
        },
        null,
        2,
      ),
      stderr: '',
      workflow: result,
    };
  } catch (error) {
    await markExecutionFailedAfterUnexpectedError({
      execution,
      executionStartedAtMs,
      error,
    });

    throw error.statusCode
      ? error
      : createHttpError(500, error.message || 'SkyServer workflow bridge failed unexpectedly.');
  }
}

async function runTool({
  toolCode,
  parameters = {},
  confirmed = false,
  confirmationPhrase = '',
  user,
  session,
  permissions = [],
  context = {},
}) {
  const normalizedToolCode = normalizeOptionalString(toolCode);

  if (!normalizedToolCode) {
    throw createHttpError(400, 'toolCode is required.');
  }

  const safeParameters = assertPlainParameterObject(parameters);
  assertParameterPayloadSafe(safeParameters);

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
    confirmationPhrase,
  });

  assertExecutionNotAlreadyRunning(tool);

  if (tool.tool_code === SKYSERVER_WORKFLOW_START_TOOL_CODE) {
    const executionLock = acquireExecutionLock(tool);

    try {
      return await runSkyserverWorkflowBridgeTool({
        tool,
        safeParameters,
        user,
        session,
        permissions,
        context,
      });
    } finally {
      executionLock.release();
    }
  }

  const executionLock = acquireExecutionLock(tool);
  let execution = null;
  const executionStartedAtMs = Date.now();

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
      user,
      session,
    });
    executionLock.setExecutionId(execution.execution_id);

    try {
      await auditExecutionAttempt({
        user,
        context,
        toolCode: tool.tool_code,
        success: true,
        message: 'Tool execution started.',
        action: 'start_tool',
        metadata: {
          executionId: execution.execution_id,
          parameters: safeParameters,
        },
      });
    } catch (auditError) {
      console.error('[SkyServer API] Failed to record tool start audit event:', auditError);
    }

    const toolResultRequired = isToolResultRequired(tool);
    const childResult = await executeChildProcess({
      tool,
      scriptFile,
      args,
      executionId: execution.execution_id,
      toolResultRequired,
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
        manifestContract: childResult.manifestContract,
      },
    });

    try {
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
    } catch (auditError) {
      console.error('[SkyServer API] Failed to record tool finish audit event:', auditError);
    }

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
      manifestContract: childResult.manifestContract,
    };
  } catch (error) {
    if (execution?.execution_id) {
      try {
        await markExecutionFailedAfterUnexpectedError({
          execution,
          executionStartedAtMs,
          error,
        });
      } catch (cleanupError) {
        console.error('[SkyServer API] Failed to clean up failed execution:', cleanupError);
      }
    }

    throw error.statusCode
      ? error
      : createHttpError(500, error.message || 'Tool execution failed unexpectedly.');
  } finally {
    executionLock.release();
  }
}

module.exports = {
  markStaleStartedExecutions,
  runTool,
};
