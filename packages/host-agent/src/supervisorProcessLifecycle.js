const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ACTIONS = new Set(['START', 'RESTART']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_SUPERVISOR_PORT = 17170;

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeAction(value) {
  const action = normalizeText(value).toUpperCase();
  if (!ACTIONS.has(action)) {
    const error = new Error('Host Agent Supervisor process lifecycle action is not allowlisted.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_ACTION_NOT_ALLOWED';
    throw error;
  }
  return action;
}

function normalizeOperationId(value) {
  const operationId = normalizeText(value).toLowerCase();
  if (operationId && !UUID_PATTERN.test(operationId)) {
    const error = new Error('Host Agent Supervisor process lifecycle operationId must be a UUID.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_OPERATION_ID_INVALID';
    throw error;
  }
  return operationId || null;
}

function getPaths(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  return {
    repositoryRoot: root,
    serverScript: path.join(root, 'packages', 'supervisor', 'src', 'server.js'),
  };
}

function assertExpectedSupervisorProcess(
  processInfo,
  { repositoryRoot, serverScript, allowBoundRelative = false } = {},
) {
  const pid = Number(processInfo?.processId ?? processInfo?.ProcessId);
  const name = normalizeText(processInfo?.name ?? processInfo?.Name).toLowerCase();
  const commandLine = normalizeText(processInfo?.commandLine ?? processInfo?.CommandLine);
  const ownsConfiguredPort = processInfo?.ownsConfiguredPort === true || processInfo?.OwnsConfiguredPort === true;
  const root = path.resolve(repositoryRoot || '');
  const script = path.resolve(serverScript || '');
  const lowerCommand = commandLine.replace(/\//g, '\\').toLowerCase();
  const absoluteScript = script.replace(/\//g, '\\').toLowerCase();
  const absoluteRoot = root.replace(/\//g, '\\').toLowerCase();
  const relativeScript = path.join('packages', 'supervisor', 'src', 'server.js').replace(/\//g, '\\').toLowerCase();

  if (!Number.isInteger(pid) || pid <= 0) {
    const error = new Error('Supervisor process identity is missing a valid PID.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_INVALID';
    throw error;
  }
  if (!['node', 'node.exe'].includes(name)) {
    const error = new Error(`Refusing Supervisor lifecycle operation for PID ${pid}; executable is not Node.js.`);
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_MISMATCH';
    throw error;
  }

  const exactAbsoluteIdentity =
    commandLine && lowerCommand.includes(absoluteScript) && lowerCommand.includes(absoluteRoot);
  const hasForeignAbsoluteSupervisorPath = /[a-z]:\\[^\"']*packages\\supervisor\\src\\server\.js/i.test(
    commandLine.replace(/\//g, '\\'),
  ) && !exactAbsoluteIdentity;
  const boundLegacyRelativeIdentity =
    commandLine &&
    allowBoundRelative &&
    ownsConfiguredPort &&
    lowerCommand.includes(relativeScript) &&
    !hasForeignAbsoluteSupervisorPath;

  if (!exactAbsoluteIdentity && !boundLegacyRelativeIdentity) {
    const error = new Error(
      `Refusing Supervisor lifecycle operation for PID ${pid}; process is not the exact SkyCommand Supervisor identity allowed for this repository/runtime.`,
    );
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_MISMATCH';
    throw error;
  }
  return {
    processId: pid,
    name,
    commandLine,
    ownsConfiguredPort,
    identityMode: exactAbsoluteIdentity ? 'ABSOLUTE_REPOSITORY_PATH' : 'BOUND_LEGACY_RELATIVE_PATH',
  };
}

async function listSupervisorProcesses({
  repositoryRoot,
  executor = execFileAsync,
  platform = process.platform,
  environment = process.env,
} = {}) {
  if (platform !== 'win32') {
    const error = new Error('Supervisor host-process lifecycle controls require the Windows repository host.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_UNAVAILABLE';
    throw error;
  }

  const configuredPort = Number(environment.SKYCOMMAND_SUPERVISOR_PORT || DEFAULT_SUPERVISOR_PORT);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : DEFAULT_SUPERVISOR_PORT;
  const command = [
    '$ownerProcessId = $null',
    '$discoverySource = $null',
    `$listeners = @(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue)`,
    'if ($listeners.Count -gt 0) { $ownerProcessId = [int]$listeners[0].OwningProcess; $discoverySource = "GET_NET_TCP_CONNECTION" }',
    'if (-not $ownerProcessId) {',
    '  $lines = @(netstat.exe -ano -p tcp 2>$null)',
    '  foreach ($line in $lines) {',
    '    $parts = @(([string]$line).Trim() -split "\\s+")',
    '    if ($parts.Count -lt 5 -or $parts[0] -ne "TCP" -or $parts[3] -ne "LISTENING") { continue }',
    '    $localEndpoint = [string]$parts[1]',
    '    $separator = $localEndpoint.LastIndexOf(":")',
    '    if ($separator -lt 0) { continue }',
    '    $candidatePort = 0',
    '    if (-not [int]::TryParse($localEndpoint.Substring($separator + 1), [ref]$candidatePort)) { continue }',
    `    if ($candidatePort -ne ${port}) { continue }`,
    '    $candidatePid = 0',
    '    if ([int]::TryParse([string]$parts[$parts.Count - 1], [ref]$candidatePid) -and $candidatePid -gt 0) {',
    '      $ownerProcessId = $candidatePid',
    '      $discoverySource = "NETSTAT"',
    '      break',
    '    }',
    '  }',
    '}',
    'if (-not $ownerProcessId) { Write-Output "[]"; exit 0 }',
    '$process = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerProcessId" -ErrorAction SilentlyContinue',
    'if (-not $process) { Write-Output "[]"; exit 0 }',
    '[pscustomobject]@{ ProcessId = $process.ProcessId; Name = $process.Name; CommandLine = $process.CommandLine; OwnsConfiguredPort = $true; DiscoverySource = $discoverySource } | ConvertTo-Json -Compress',
  ].join('; ');

  const result = await executor(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      cwd: path.resolve(repositoryRoot),
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  const text = normalizeText(result?.stdout) || '[]';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    const error = new Error('Supervisor process inventory returned invalid JSON.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_INVENTORY_INVALID';
    error.cause = cause;
    throw error;
  }
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return rows.map((row) => ({
    processId: Number(row?.ProcessId ?? row?.processId),
    name: normalizeText(row?.Name ?? row?.name),
    commandLine: normalizeText(row?.CommandLine ?? row?.commandLine),
    ownsConfiguredPort: row?.OwnsConfiguredPort === true || row?.ownsConfiguredPort === true,
    discoverySource: normalizeText(row?.DiscoverySource ?? row?.discoverySource) || null,
  }));
}

async function killSupervisorProcessTree(processInfo, {
  repositoryRoot,
  serverScript,
  executor = execFileAsync,
} = {}) {
  const expected = assertExpectedSupervisorProcess(processInfo, {
    repositoryRoot,
    serverScript,
    allowBoundRelative: processInfo?.ownsConfiguredPort === true,
  });
  await executor(
    'taskkill.exe',
    ['/PID', String(expected.processId), '/T', '/F'],
    {
      cwd: path.resolve(repositoryRoot),
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  return expected.processId;
}

function launchSupervisorProcess({
  repositoryRoot,
  serverScript,
  nodeExecutable = process.execPath,
  environment = process.env,
  spawner = spawn,
  fileSystem = fs,
} = {}) {
  const root = path.resolve(repositoryRoot);
  const script = path.resolve(serverScript);
  if (!fileSystem.existsSync(script)) {
    const error = new Error(`SkyCommand Supervisor server script was not found: ${script}`);
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_SERVER_MISSING';
    throw error;
  }

  const child = spawner(nodeExecutable, [script], {
    cwd: root,
    env: environment,
    detached: true,
    windowsHide: true,
    // Supervisor runtime evidence is reported through the governed health/lifecycle
    // surfaces. Do not create unmanaged append-only host log files here.
    stdio: 'ignore',
  });
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) {
    const error = new Error('SkyCommand Host Agent did not receive a PID for the Supervisor process.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_START_FAILED';
    throw error;
  }
  child.unref?.();
  return { processId: child.pid, nodeExecutable, serverScript: script };
}

function supervisorHealthUrl(environment = process.env) {
  const configuredPort = Number(environment.SKYCOMMAND_SUPERVISOR_PORT || DEFAULT_SUPERVISOR_PORT);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : DEFAULT_SUPERVISOR_PORT;
  return `http://127.0.0.1:${port}/health`;
}

async function waitForSupervisorHealth({
  fetcher = fetch,
  environment = process.env,
  attempts = 40,
  intervalMs = 250,
  sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const url = supervisorHealthUrl(environment);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(2500) });
      const payload = await response.json().catch(() => null);
      const expectedProjectName = normalizeText(
        environment.SKYCOMMAND_SUPERVISOR_PROJECT_NAME ||
        environment.SKYCOMMAND_DOCKER_SELF_PROJECT_NAME ||
        'skycommand',
      );
      if (
        response.ok &&
        payload?.ok === true &&
        payload?.service === 'SkyCommand Supervisor' &&
        normalizeText(payload?.projectName) === expectedProjectName
      ) {
        return { url, payload };
      }
      lastError = new Error(
        payload?.error ||
        `Supervisor health identity mismatch or HTTP ${response.status}.`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await sleeper(intervalMs);
  }
  const error = new Error('SkyCommand Supervisor did not become healthy after the guarded Host Agent lifecycle operation.');
  error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_HEALTH_TIMEOUT';
  error.cause = lastError;
  throw error;
}

async function waitForNoSupervisorProcesses(listProcesses, {
  attempts = 40,
  intervalMs = 125,
  sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = await listProcesses();
    if (remaining.length === 0) return;
    if (attempt < attempts - 1) await sleeper(intervalMs);
  }
  const error = new Error('Validated SkyCommand Supervisor process did not terminate after the guarded Host Agent stop request.');
  error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_STOP_TIMEOUT';
  throw error;
}

async function executeSupervisorProcessLifecycle(
  { action, operationId = null } = {},
  {
    platform = process.platform,
    repositoryRoot = path.resolve(__dirname, '../../..'),
    processLister,
    processKiller,
    processLauncher,
    healthChecker,
    executor = execFileAsync,
    spawner = spawn,
    fileSystem = fs,
    environment = process.env,
    sleeper,
  } = {},
) {
  const normalizedAction = normalizeAction(action);
  const normalizedOperationId = normalizeOperationId(operationId);
  if (platform !== 'win32') {
    const error = new Error('Supervisor host-process lifecycle controls require the Windows repository host.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_PROCESS_UNAVAILABLE';
    throw error;
  }

  const paths = getPaths(repositoryRoot);
  const listProcesses = processLister || (() => listSupervisorProcesses({
    repositoryRoot: paths.repositoryRoot,
    serverScript: paths.serverScript,
    executor,
    platform,
    environment,
  }));
  const killProcess = processKiller || ((processInfo) => killSupervisorProcessTree(processInfo, {
    repositoryRoot: paths.repositoryRoot,
    serverScript: paths.serverScript,
    executor,
  }));
  const launchProcess = processLauncher || (() => launchSupervisorProcess({
    repositoryRoot: paths.repositoryRoot,
    serverScript: paths.serverScript,
    nodeExecutable: process.execPath,
    environment,
    spawner,
    fileSystem,
  }));
  const checkHealth = healthChecker || (() => waitForSupervisorHealth({ environment, sleeper }));

  const existing = await listProcesses();
  let existingHealth = null;
  if (existing.length > 0) {
    // A legacy manually-started Supervisor can carry a relative script path. It is
    // accepted for the one-time transition only when it is the Node process bound
    // to the configured Supervisor port and the live endpoint proves SkyCommand
    // Supervisor identity. Newly launched processes use the absolute repo path.
    existingHealth = await checkHealth();
    for (const processInfo of existing) {
      assertExpectedSupervisorProcess(processInfo, {
        ...paths,
        allowBoundRelative: processInfo?.ownsConfiguredPort === true,
      });
    }
  }

  if (normalizedAction === 'START' && existing.length > 0) {
    const health = existingHealth;
    return {
      action: 'START_SUPERVISOR',
      operationId: normalizedOperationId,
      outcome: 'ALREADY_RUNNING',
      processId: existing[0].processId,
      previousProcessIds: existing.map((item) => item.processId),
      healthUrl: health?.url || null,
      transport: 'guarded_host_agent_process',
    };
  }

  if (normalizedAction === 'RESTART') {
    for (const processInfo of existing) await killProcess(processInfo);
    if (existing.length > 0) await waitForNoSupervisorProcesses(listProcesses, { sleeper });
  }

  const launched = await launchProcess();
  const health = await checkHealth();
  const launchedProcesses = await listProcesses();
  const observedLaunch = launchedProcesses.find((item) => item.processId === launched.processId);
  if (!observedLaunch) {
    const error = new Error('Supervisor health responded, but the newly launched PID does not own the configured Supervisor endpoint.');
    error.code = 'SKYCOMMAND_HOST_AGENT_SUPERVISOR_START_IDENTITY_MISMATCH';
    throw error;
  }
  assertExpectedSupervisorProcess(observedLaunch, {
    ...paths,
    allowBoundRelative: false,
  });
  return {
    action: `${normalizedAction}_SUPERVISOR`,
    operationId: normalizedOperationId,
    outcome: 'COMPLETED',
    processId: launched.processId,
    previousProcessIds: existing.map((item) => item.processId),
    healthUrl: health?.url || null,
    transport: 'guarded_host_agent_process',
  };
}

module.exports = {
  ACTIONS,
  assertExpectedSupervisorProcess,
  executeSupervisorProcessLifecycle,
  getPaths,
  killSupervisorProcessTree,
  launchSupervisorProcess,
  listSupervisorProcesses,
  normalizeAction,
  supervisorHealthUrl,
  waitForSupervisorHealth,
};
