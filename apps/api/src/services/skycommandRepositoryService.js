const fs = require('fs');
const path = require('path');

const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';
const MANAGED_TOOLS_RELATIVE_PATH = 'packages/tools/custom';

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function usesWindowsPath(value) {
  const text = String(value || '');
  return /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\');
}

function getPathApi(rootPath) {
  return usesWindowsPath(rootPath) ? path.win32 : path;
}

function resolveManagedToolsRoot(rootPath) {
  const normalizedRootPath = String(rootPath || '').trim();

  if (!normalizedRootPath) {
    throw createHttpError(409, 'SkyCommand repository root path is not configured.', {
      code: 'SKYCOMMAND_REPOSITORY_PATH_NOT_CONFIGURED',
      profileCode: PROFILE_CODE,
    });
  }

  const pathApi = getPathApi(normalizedRootPath);
  const resolvedRootPath = pathApi.resolve(normalizedRootPath);
  const managedToolsRoot = pathApi.resolve(
    resolvedRootPath,
    ...MANAGED_TOOLS_RELATIVE_PATH.split('/'),
  );
  const relativePath = pathApi.relative(resolvedRootPath, managedToolsRoot);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativePath)
  ) {
    throw createHttpError(409, 'Managed tool root escapes the SkyCommand repository.', {
      code: 'SKYCOMMAND_TOOL_DESTINATION_UNSAFE',
      rootPath: resolvedRootPath,
      managedToolsRoot,
    });
  }

  return {
    resolvedRootPath,
    managedToolsRoot,
    managedToolsRelativePath: MANAGED_TOOLS_RELATIVE_PATH,
    pathStyle: pathApi === path.win32 ? 'windows' : 'posix',
  };
}

async function inspectDirectory(targetPath) {
  try {
    const stats = await fs.promises.stat(targetPath);

    if (!stats.isDirectory()) {
      return {
        exists: true,
        directory: false,
        readable: false,
        writable: false,
      };
    }

    let readable = true;
    let writable = true;

    try {
      await fs.promises.access(targetPath, fs.constants.R_OK);
    } catch {
      readable = false;
    }

    try {
      await fs.promises.access(targetPath, fs.constants.W_OK);
    } catch {
      writable = false;
    }

    return {
      exists: true,
      directory: true,
      readable,
      writable,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        exists: false,
        directory: false,
        readable: false,
        writable: false,
      };
    }

    return {
      exists: false,
      directory: false,
      readable: false,
      writable: false,
      errorCode: error.code || null,
    };
  }
}

async function inspectSkycommandRepositoryPath(rootPath) {
  const resolved = resolveManagedToolsRoot(rootPath);
  const rootState = await inspectDirectory(resolved.resolvedRootPath);
  const managedRootState = await inspectDirectory(resolved.managedToolsRoot);

  const rootReady =
    rootState.exists && rootState.directory && rootState.readable && rootState.writable;
  const managedRootReady =
    !managedRootState.exists ||
    (managedRootState.directory && managedRootState.readable && managedRootState.writable);

  return {
    ...resolved,
    rootState,
    managedRootState,
    ready: rootReady && managedRootReady,
  };
}

function buildUnavailableReadiness({ code, message, repository = null, rootPath = null }) {
  return {
    ready: false,
    status: 'BLOCKED',
    errorCode: code,
    message,
    profileCode: PROFILE_CODE,
    managedToolsRelativePath: MANAGED_TOOLS_RELATIVE_PATH,
    repository,
    path: rootPath
      ? {
          rootPath,
          managedToolsRoot: null,
        }
      : null,
  };
}

async function getSkycommandRepositoryReadiness() {
  const { query } = require('../../../../packages/db/src/connection');
  const result = await query(
    `
      SELECT
        r.repo_id,
        r.repo_code,
        r.repo_name,
        r.active AS repo_active,
        r.is_skycommand_repository,
        cp.profile_id,
        cp.profile_code,
        cp.profile_name,
        rp.repo_path_id,
        rp.root_path,
        rp.active AS path_active
      FROM core.repositories r
      LEFT JOIN core.config_profiles cp
        ON cp.profile_code = $1
       AND cp.active = TRUE
      LEFT JOIN core.repository_paths rp
        ON rp.repo_id = r.repo_id
       AND rp.profile_id = cp.profile_id
      WHERE r.is_skycommand_repository = TRUE
      ORDER BY r.updated_at DESC
      LIMIT 1
    `,
    [PROFILE_CODE],
  );

  const row = result.rows[0];

  if (!row || !row.repo_id || !row.repo_active) {
    return buildUnavailableReadiness({
      code: 'SKYCOMMAND_REPOSITORY_NOT_CONFIGURED',
      message: 'No active repository is designated as the SkyCommand repository.',
    });
  }

  const repository = {
    repoId: row.repo_id,
    repoCode: row.repo_code,
    repoName: row.repo_name,
    active: row.repo_active,
    isSkycommandRepository: row.is_skycommand_repository,
  };

  if (
    !row.profile_id ||
    !row.repo_path_id ||
    !row.path_active ||
    !String(row.root_path || '').trim()
  ) {
    return buildUnavailableReadiness({
      code: 'SKYCOMMAND_REPOSITORY_PATH_NOT_CONFIGURED',
      message: `The SkyCommand repository has no active path for profile ${PROFILE_CODE}.`,
      repository,
      rootPath: row.root_path || null,
    });
  }

  const pathInspection = await inspectSkycommandRepositoryPath(row.root_path);

  if (!pathInspection.ready) {
    return {
      ready: false,
      status: 'BLOCKED',
      errorCode: 'SKYCOMMAND_REPOSITORY_PATH_INVALID',
      message: `The SkyCommand repository path for profile ${PROFILE_CODE} is missing, inaccessible, or not writable.`,
      profileCode: PROFILE_CODE,
      managedToolsRelativePath: MANAGED_TOOLS_RELATIVE_PATH,
      repository,
      path: {
        profileId: row.profile_id,
        profileCode: row.profile_code,
        profileName: row.profile_name,
        rootPath: row.root_path,
        resolvedRootPath: pathInspection.resolvedRootPath,
        managedToolsRoot: pathInspection.managedToolsRoot,
        rootState: pathInspection.rootState,
        managedRootState: pathInspection.managedRootState,
      },
    };
  }

  return {
    ready: true,
    status: 'READY',
    errorCode: null,
    message: pathInspection.managedRootState.exists
      ? 'SkyCommand repository and managed tool root are ready.'
      : 'SkyCommand repository is ready; the managed tool root can be created during registration.',
    profileCode: PROFILE_CODE,
    managedToolsRelativePath: MANAGED_TOOLS_RELATIVE_PATH,
    repository,
    path: {
      profileId: row.profile_id,
      profileCode: row.profile_code,
      profileName: row.profile_name,
      rootPath: row.root_path,
      resolvedRootPath: pathInspection.resolvedRootPath,
      managedToolsRoot: pathInspection.managedToolsRoot,
      rootState: pathInspection.rootState,
      managedRootState: pathInspection.managedRootState,
    },
  };
}

async function assertSkycommandRepositoryReady() {
  const readiness = await getSkycommandRepositoryReadiness();

  if (!readiness.ready) {
    throw createHttpError(409, readiness.message, {
      code: readiness.errorCode,
      profileCode: readiness.profileCode,
      repository: readiness.repository,
      path: readiness.path,
    });
  }

  return readiness;
}

module.exports = {
  PROFILE_CODE,
  MANAGED_TOOLS_RELATIVE_PATH,
  resolveManagedToolsRoot,
  inspectSkycommandRepositoryPath,
  getSkycommandRepositoryReadiness,
  assertSkycommandRepositoryReady,
};
