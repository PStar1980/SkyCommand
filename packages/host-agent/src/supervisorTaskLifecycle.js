const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ACTIONS = new Set(['START', 'RESTART']);

function normalizeAction(value) {
  const action = String(value || '').trim().toUpperCase();
  if (!ACTIONS.has(action)) {
    const error = new Error('Host Agent Supervisor lifecycle action is not allowlisted.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_ACTION_NOT_ALLOWED';
    throw error;
  }
  return action;
}

async function executeSupervisorTaskLifecycle(
  { action, operationId = null } = {},
  {
    executor = execFileAsync,
    platform = process.platform,
    repositoryRoot = path.resolve(__dirname, '../../..'),
    timeoutMs = 120000,
  } = {},
) {
  const normalizedAction = normalizeAction(action);
  if (platform !== 'win32') {
    const error = new Error('Supervisor scheduled-task lifecycle controls require the Windows repository host.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_TASKS_UNAVAILABLE';
    throw error;
  }

  const scriptPath = path.join(
    repositoryRoot,
    'scripts',
    'powershell',
    'SkyCommand-SupervisorTask.ps1',
  );
  const scriptAction = normalizedAction === 'START' ? 'Start' : 'Restart';

  try {
    const result = await executor(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', scriptPath, '-Action', scriptAction],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    return {
      action: `${normalizedAction}_SUPERVISOR`,
      operationId: String(operationId || '').trim() || null,
      outcome: 'REQUESTED',
      output: String(result?.stdout || '').trim(),
      transport: 'guarded_scheduled_task_script',
    };
  } catch (cause) {
    const error = new Error('The guarded Supervisor scheduled-task operation failed.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_TASK_FAILED';
    error.cause = cause;
    throw error;
  }
}

module.exports = {
  ACTIONS,
  executeSupervisorTaskLifecycle,
  normalizeAction,
};
