const path = require('node:path');
const {
  createPgDatabaseAdapter,
  DatabaseUpgradeError,
  executeRegisteredDatabaseUpgrade,
} = require('./databaseUpgradeEngine');

const ENVIRONMENT_CODE = 'DEV_LOCAL';
const REPOSITORY_CODE = 'SkyCommand';
const TOOL_CODE = 'database_upgrade_apply';
const PERMISSION_CODE = 'DB_UPGRADE_APPLY';
const SCRIPT_PATH = 'packages/db_upgrade/src/databaseUpgradeApply.js';
const REQUIRED_CHANNELS = ['admin-web', 'api', 'cli', 'worker'];

function registeredContextError(code, message, details = {}) {
  return new DatabaseUpgradeError(code, message, details);
}

function normalizeRoot(value) {
  return path
    .normalize(path.resolve(String(value || '')))
    .replace(/[\\/]$/, '')
    .toLowerCase();
}

function configuredEnvironmentCode(environment = process.env) {
  return String(
    environment.SKYCOMMAND_CONFIG_PROFILE ||
      environment.SKYSERVER_CONFIG_PROFILE ||
      environment.SKYCOMMAND_CORE_PROFILE ||
      environment.SKYSERVER_CORE_PROFILE ||
      environment.CONFIG_PROFILE ||
      ENVIRONMENT_CODE,
  )
    .trim()
    .toUpperCase();
}

async function verifyRegisteredDevContext({
  environment = process.env,
  adapter = null,
  repositoryRoot = path.resolve(__dirname, '../../..'),
} = {}) {
  if (configuredEnvironmentCode(environment) !== ENVIRONMENT_CODE) {
    throw registeredContextError(
      'DATABASE_UPGRADE_DEV_PROFILE_REQUIRED',
      'The autonomous database-upgrade Tool is registered only for DEV_LOCAL.',
    );
  }

  const client = await (adapter || createPgDatabaseAdapter(environment)).connect();
  try {
    const binding = await client.query(
      `
        SELECT cp.profile_code, r.repo_id, r.repo_code, rp.root_path
        FROM core.config_profiles cp
        JOIN core.repository_paths rp ON rp.profile_id = cp.profile_id
        JOIN core.repositories r ON r.repo_id = rp.repo_id
        WHERE cp.profile_code = $1
          AND cp.active = TRUE
          AND rp.active = TRUE
          AND r.active = TRUE
          AND r.is_skycommand_repository = TRUE
      `,
      [ENVIRONMENT_CODE],
    );
    if (binding.rowCount !== 1 || binding.rows[0].repo_code !== REPOSITORY_CODE) {
      throw registeredContextError(
        'DATABASE_UPGRADE_REGISTERED_BINDING_INVALID',
        'The registered DEV_LOCAL SkyCommand repository binding is missing or ambiguous.',
      );
    }
    if (normalizeRoot(binding.rows[0].root_path) !== normalizeRoot(repositoryRoot)) {
      throw registeredContextError(
        'DATABASE_UPGRADE_REGISTERED_REPOSITORY_MISMATCH',
        'The registered DEV_LOCAL repository root does not match the executing checkout.',
      );
    }

    const tool = await client.query(
      `
        SELECT t.tool_id, t.tool_code, t.script_path, t.runtime_code,
               t.permission_code, t.risk_code, t.requires_confirmation,
               t.allow_params, t.enabled, t.script_repo_id, r.repo_code
        FROM core.tools t
        JOIN core.repositories r ON r.repo_id = t.script_repo_id
        WHERE t.tool_code = $1
      `,
      [TOOL_CODE],
    );
    if (tool.rowCount !== 1) {
      throw registeredContextError(
        'DATABASE_UPGRADE_REGISTERED_TOOL_INVALID',
        'The autonomous database-upgrade Tool registration is missing or ambiguous.',
      );
    }
    const row = tool.rows[0];
    if (
      row.repo_code !== REPOSITORY_CODE ||
      row.script_repo_id !== binding.rows[0].repo_id ||
      row.script_path !== SCRIPT_PATH ||
      row.runtime_code !== 'node' ||
      row.permission_code !== PERMISSION_CODE ||
      row.risk_code !== 'medium' ||
      row.requires_confirmation !== false ||
      row.allow_params !== false ||
      row.enabled !== true
    ) {
      throw registeredContextError(
        'DATABASE_UPGRADE_REGISTERED_TOOL_INVALID',
        'The autonomous database-upgrade Tool metadata does not match its fixed DEV_LOCAL contract.',
      );
    }

    const visibility = await client.query(
      `
        SELECT channel_code
        FROM core.tool_visibility
        WHERE tool_id = $1
        ORDER BY channel_code
      `,
      [row.tool_id],
    );
    const channels = visibility.rows.map((entry) => entry.channel_code);
    if (REQUIRED_CHANNELS.some((channel) => !channels.includes(channel))) {
      throw registeredContextError(
        'DATABASE_UPGRADE_REGISTERED_VISIBILITY_INVALID',
        'The autonomous database-upgrade Tool is not visible through every registered execution channel.',
      );
    }

    return {
      environmentCode: ENVIRONMENT_CODE,
      repositoryCode: REPOSITORY_CODE,
      repositoryId: binding.rows[0].repo_id,
      toolCode: TOOL_CODE,
      toolId: row.tool_id,
      permissionCode: PERMISSION_CODE,
    };
  } finally {
    if (typeof client.release === 'function') client.release();
    else if (typeof client.end === 'function') await client.end().catch(() => {});
  }
}

async function executeRegisteredDevDatabaseUpgrade(options = {}) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, '../../..');
  const binding = await verifyRegisteredDevContext({ ...options, repositoryRoot });
  return executeRegisteredDatabaseUpgrade({ ...options, repositoryRoot, binding });
}

module.exports = {
  ENVIRONMENT_CODE,
  PERMISSION_CODE,
  REPOSITORY_CODE,
  REQUIRED_CHANNELS,
  SCRIPT_PATH,
  TOOL_CODE,
  configuredEnvironmentCode,
  executeRegisteredDevDatabaseUpgrade,
  normalizeRoot,
  verifyRegisteredDevContext,
};
