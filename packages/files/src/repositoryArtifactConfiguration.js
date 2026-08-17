const path = require('path');

const { translateWorkspacePath } = require('../../core/src/runtimePathResolver');

const SKYCOMMAND_ROOT = path.resolve(__dirname, '../../..');

// Direct CLI execution is still supported. SkyCommand-launched tools already
// inherit the API/worker environment, while local CLI runs can opportunistically
// load the repository .env when dotenv is installed.
try {
  require('dotenv').config({ path: path.join(SKYCOMMAND_ROOT, '.env') });
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

function getProfileCode(environment = process.env) {
  return (
    environment.SKYCOMMAND_CONFIG_PROFILE ||
    environment.SKYSERVER_CONFIG_PROFILE ||
    environment.SKYCOMMAND_CORE_PROFILE ||
    environment.SKYSERVER_CORE_PROFILE ||
    environment.CONFIG_PROFILE ||
    'DEV_LOCAL'
  );
}

function getDatabaseQuery() {
  return require('../../db/src/connection').query;
}

async function listAvailableRepositories({ query = null, profileCode = getProfileCode() } = {}) {
  const databaseQuery = query || getDatabaseQuery();
  const result = await databaseQuery(
    `
      SELECT repo_code
      FROM core.vw_repository_paths
      WHERE profile_code = $1
      ORDER BY display_order, repo_name, repo_code
    `,
    [profileCode],
  );

  return (result.rows || []).map((row) => row.repo_code);
}

async function loadRepositoryArtifactConfiguration(
  repositorySelection,
  { query = null, profileCode = getProfileCode() } = {},
) {
  const repository = String(repositorySelection || '').trim();

  if (!repository) {
    throw new Error('❌ Error: You must select a repository.');
  }

  const databaseQuery = query || getDatabaseQuery();
  const result = await databaseQuery(
    `
      SELECT
        profile_code,
        repo_id,
        repo_code,
        repo_name,
        root_path,
        repo_map_file_name,
        repo_map_output_path,
        repo_zip_file_name,
        repo_zip_output_path
      FROM core.vw_repository_paths
      WHERE profile_code = $1
        AND (LOWER(repo_code) = LOWER($2) OR LOWER(repo_name) = LOWER($2))
      ORDER BY CASE WHEN LOWER(repo_code) = LOWER($2) THEN 0 ELSE 1 END,
               display_order,
               repo_name
      LIMIT 1
    `,
    [profileCode, repository],
  );

  if (!result.rows || result.rows.length === 0) {
    const available = await listAvailableRepositories({
      query: databaseQuery,
      profileCode,
    });
    const availableMessage = available.length > 0 ? available.join(', ') : 'none';
    throw new Error(
      `❌ Error: Unknown or inactive repository '${repository}' for profile ${profileCode}. Available repositories: ${availableMessage}`,
    );
  }

  const row = result.rows[0];
  const pathOptions = { profileCode: row.profile_code };
  return {
    profileCode: row.profile_code,
    repoId: row.repo_id,
    repoCode: row.repo_code,
    repoName: row.repo_name,
    rootPath: translateWorkspacePath(row.root_path, pathOptions),
    repoMapFileName: row.repo_map_file_name,
    repoMapOutputPath: translateWorkspacePath(row.repo_map_output_path, pathOptions),
    repoZipFileName: row.repo_zip_file_name,
    repoZipOutputPath: translateWorkspacePath(row.repo_zip_output_path, pathOptions),
  };
}

module.exports = {
  getProfileCode,
  listAvailableRepositories,
  loadRepositoryArtifactConfiguration,
};
