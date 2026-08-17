const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { query } = require('../../../../packages/db/src/connection');

function isDockerRuntime() {
  return String(process.env.SKYCOMMAND_RUNTIME_ENV || '').trim().toLowerCase() === 'docker';
}

function toBoolean(value) {
  return ['true', '1', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

function assertCommandResult(result, message) {
  if (result.status === 0) {
    return;
  }

  throw new Error(
    `${message}: ${String(result.stderr || result.error?.message || 'unknown error').trim()}`,
  );
}

function assertDirectoryWritable(directoryPath, label) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }

  const statistics = fs.statSync(directoryPath);
  if (!statistics.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directoryPath}`);
  }

  fs.accessSync(directoryPath, fs.constants.R_OK | fs.constants.W_OK);
}

async function assertDockerApiConfiguration() {
  if (!isDockerRuntime()) {
    return null;
  }

  const profileCode = String(process.env.SKYCOMMAND_CONFIG_PROFILE || '').trim();
  if (profileCode !== 'DOCKER_LOCAL') {
    throw new Error(
      `Docker API requires SKYCOMMAND_CONFIG_PROFILE=DOCKER_LOCAL; received '${profileCode || 'blank'}'.`,
    );
  }

  const result = await query(
    `
      SELECT r.repo_code, rp.root_path
      FROM core.repository_paths rp
      JOIN core.repositories r ON r.repo_id = rp.repo_id
      JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
      WHERE cp.profile_code = 'DOCKER_LOCAL'
        AND r.active = TRUE
        AND rp.active = TRUE
        AND cp.active = TRUE
      ORDER BY r.display_order ASC, r.repo_code ASC
    `,
  );

  const repositoryPaths = (result.rows || [])
    .map((row) => ({
      repoCode: String(row.repo_code || '').trim(),
      rootPath: String(row.root_path || '').trim(),
    }))
    .filter((row) => row.repoCode && row.rootPath);
  const skyCommandRepository = repositoryPaths.find((row) => row.repoCode === 'SkyCommand');
  const rootPath = skyCommandRepository?.rootPath || '';

  if (!rootPath) {
    throw new Error(
      'Docker API requires the DOCKER_LOCAL repository profile. Apply migration 00098__docker_local_repository_profile.sql first.',
    );
  }
  if (!fs.existsSync(rootPath)) {
    throw new Error(
      `DOCKER_LOCAL SkyCommand path is not mounted inside the API container: ${rootPath}. Check SKYCOMMAND_DOCKER_WORKSPACE_ROOT.`,
    );
  }

  const mountedRepositoryPaths = repositoryPaths.filter((repository) =>
    fs.existsSync(repository.rootPath),
  );
  const clearSafeDirectories = spawnSync(
    'git',
    ['config', '--global', '--unset-all', 'safe.directory'],
    { encoding: 'utf8' },
  );
  if (![0, 5].includes(clearSafeDirectories.status ?? 1)) {
    assertCommandResult(clearSafeDirectories, 'Unable to reset Docker Git safe.directory configuration');
  }

  for (const repository of mountedRepositoryPaths) {
    const safeDirectoryResult = spawnSync(
      'git',
      ['config', '--global', '--add', 'safe.directory', repository.rootPath],
      { encoding: 'utf8' },
    );
    assertCommandResult(
      safeDirectoryResult,
      `Unable to register Docker Git safe.directory for ${repository.repoCode}`,
    );
  }

  const dockerGitEnabled = toBoolean(process.env.SKYCOMMAND_DOCKER_GIT_ENABLED);
  if (dockerGitEnabled) {
    const tokenFile = String(
      process.env.SKYCOMMAND_GITHUB_TOKEN_FILE || '/run/secrets/skycommand_github_token',
    ).trim();
    const githubUsername = String(process.env.SKYCOMMAND_GITHUB_USERNAME || '').trim();
    const authorName = String(process.env.GIT_AUTHOR_NAME || '').trim();
    const authorEmail = String(process.env.GIT_AUTHOR_EMAIL || '').trim();

    if (!githubUsername || !authorName || !authorEmail) {
      throw new Error(
        'Docker API Git automation is enabled but GitHub username/commit identity is incomplete.',
      );
    }
    if (!fs.existsSync(tokenFile) || fs.readFileSync(tokenFile, 'utf8').trim() === '') {
      throw new Error(
        `Docker API Git automation is enabled but the mounted GitHub token secret is missing or empty: ${tokenFile}.`,
      );
    }
  }

  const executionLogRoot = path.resolve(
    String(process.env.SKYCOMMAND_EXECUTION_LOG_ROOT || path.join('/app', 'logs', 'script-executions')),
  );
  assertDirectoryWritable(executionLogRoot, 'Docker API execution log root');

  console.log(`[SkyCommand API] dockerProfile=${profileCode}`);
  console.log(`[SkyCommand API] dockerSkyCommandRoot=${rootPath}`);
  console.log(`[SkyCommand API] dockerGitSafeDirectories=${mountedRepositoryPaths.length}`);
  console.log(`[SkyCommand API] dockerExecutionLogRoot=${executionLogRoot}`);
  console.log(`[SkyCommand API] dockerGit=${dockerGitEnabled ? 'enabled' : 'disabled'}`);

  return {
    profileCode,
    rootPath,
    mountedRepositoryCount: mountedRepositoryPaths.length,
    executionLogRoot,
    dockerGitEnabled,
  };
}

module.exports = {
  assertDockerApiConfiguration,
  isDockerRuntime,
};
