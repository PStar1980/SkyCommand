const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getProfileCode,
  loadRepositoryArtifactConfiguration,
} = require('./repositoryArtifactConfiguration');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');

async function run() {
  assert.equal(getProfileCode({}), 'DEV_LOCAL');
  assert.equal(
    getProfileCode({ SKYCOMMAND_CONFIG_PROFILE: 'TEST_PROFILE' }),
    'TEST_PROFILE',
  );

  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return {
      rows: [
        {
          profile_code: 'DEV_LOCAL',
          repo_id: '11111111-1111-1111-1111-111111111111',
          repo_code: 'SkyCommand',
          repo_name: 'SkyCommand',
          root_path: 'C:\\SkyCommand',
          repo_map_file_name: 'SkyCommand_RepoMap.md',
          repo_map_output_path: 'C:\\SkyCommand\\docs',
          repo_zip_file_name: 'SkyCommand_RepoZip.zip',
          repo_zip_output_path: 'C:\\SkyCommand\\zip',
        },
      ],
    };
  };

  const configuration = await loadRepositoryArtifactConfiguration('SkyCommand', {
    query,
    profileCode: 'DEV_LOCAL',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['DEV_LOCAL', 'SkyCommand']);
  assert.match(calls[0].sql, /core\.vw_repository_paths/);
  assert.equal(configuration.repoCode, 'SkyCommand');
  assert.equal(configuration.rootPath, 'C:\\SkyCommand');
  assert.equal(configuration.repoMapFileName, 'SkyCommand_RepoMap.md');
  assert.equal(configuration.repoMapOutputPath, 'C:\\SkyCommand\\docs');
  assert.equal(configuration.repoZipFileName, 'SkyCommand_RepoZip.zip');
  assert.equal(configuration.repoZipOutputPath, 'C:\\SkyCommand\\zip');

  const dockerConfiguration = await loadRepositoryArtifactConfiguration('SkyCommand', {
    profileCode: 'DOCKER_LOCAL',
    query: async () => ({
      rows: [
        {
          profile_code: 'DOCKER_LOCAL',
          repo_id: '11111111-1111-1111-1111-111111111111',
          repo_code: 'SkyCommand',
          repo_name: 'SkyCommand',
          root_path: '/workspace/SkyEco System/SkyCommand System/SkyCommand',
          repo_map_file_name: 'SkyCommand_RepoMap.md',
          repo_map_output_path:
            'C:\\Users\\test\\Dropbox\\Programming\\SkyEco System\\SkyCommand System\\SkyCommand\\docs',
          repo_zip_file_name: 'SkyCommand_RepoZip.zip',
          repo_zip_output_path:
            'C:\\Users\\test\\Dropbox\\Programming\\SkyEco System\\SkyCommand System\\SkyCommand\\zip',
        },
      ],
    }),
  });
  assert.equal(
    dockerConfiguration.repoMapOutputPath,
    '/workspace/SkyEco System/SkyCommand System/SkyCommand/docs',
  );
  assert.equal(
    dockerConfiguration.repoZipOutputPath,
    '/workspace/SkyEco System/SkyCommand System/SkyCommand/zip',
  );

  let missingCall = 0;
  const missingQuery = async () => {
    missingCall += 1;
    if (missingCall === 1) return { rows: [] };
    return { rows: [{ repo_code: 'SkyCommand' }, { repo_code: 'SkyDataStudio' }] };
  };

  await assert.rejects(
    () =>
      loadRepositoryArtifactConfiguration('UnknownRepo', {
        query: missingQuery,
        profileCode: 'DEV_LOCAL',
      }),
    /Available repositories: SkyCommand, SkyDataStudio/,
  );

  const migration = fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      'packages/db_build/src/migrations/00096__repository_artifact_tool_parameters.sql',
    ),
    'utf8',
  );
  assert.match(migration, /repo_map_generate/);
  assert.match(migration, /repo_zip_generate/);
  assert.match(migration, /'repoName'/);
  assert.match(migration, /input_parameters - 'location' - 'fileName' - 'outputPath'/);

  const baseSeed = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'packages/db_build/src/seeds/00019__core_config_seed.sql'),
    'utf8',
  );
  assert.match(
    baseSeed,
    /\('repo_map_generate','repoName','Repository','repo','Select repository',TRUE,NULL,'repositories',10\)/,
  );
  assert.match(
    baseSeed,
    /\('repo_zip_generate','repoName','Repository','repo','Select repository',TRUE,NULL,'repositories',10\)/,
  );
  assert.doesNotMatch(baseSeed, /\('repo_map_generate','location'/);
  assert.doesNotMatch(baseSeed, /\('repo_zip_generate','location'/);
  assert.doesNotMatch(baseSeed, /\('NeoFinTech','NeoFinTech'/);
  assert.doesNotMatch(baseSeed, /\('SkyServer','SkyServer'/);
  assert.match(baseSeed, /JOIN core\.repositories r ON r\.repo_code = 'SkyCommand'/);

  const cleanupMigration = fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      'packages/db_build/src/migrations/00097__repository_registry_legacy_cleanup.sql',
    ),
    'utf8',
  );
  assert.match(cleanupMigration, /repo_code = 'SkyServer'/);
  assert.match(cleanupMigration, /repo_code = 'NeoFinTech'/);
  assert.match(cleanupMigration, /script_repo_id = skycommand_repo_id/);
  assert.match(cleanupMigration, /repo_map_generate/);
  assert.match(cleanupMigration, /repo_zip_generate/);

  console.log('[SkyCommand] Repository artifact configuration self-test passed.');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { run };
