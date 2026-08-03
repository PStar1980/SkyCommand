const fs = require('fs');
const path = require('path');

const PROFILE_CODE =
  process.env.SKYCOMMAND_CONFIG_PROFILE || process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYCOMMAND_CORE_PROFILE || process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';
const PACKAGES_RELATIVE_PATH = 'packages';
const DEFAULT_TOOL_PACKAGE_RELATIVE_PATH = 'packages/tools/custom';

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

function isContainedPath(pathApi, parentPath, childPath) {
  const relativePath = pathApi.relative(parentPath, childPath);
  return (
    relativePath === '' ||
    (!pathApi.isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${pathApi.sep}`))
  );
}

function resolvePackagesRoot(rootPath) {
  const normalizedRootPath = String(rootPath || '').trim();

  if (!normalizedRootPath) {
    throw createHttpError(409, 'SkyCommand repository root path is not configured.', {
      code: 'SKYCOMMAND_REPOSITORY_PATH_NOT_CONFIGURED',
      profileCode: PROFILE_CODE,
    });
  }

  const pathApi = getPathApi(normalizedRootPath);
  const resolvedRootPath = pathApi.resolve(normalizedRootPath);
  const packagesRoot = pathApi.resolve(resolvedRootPath, PACKAGES_RELATIVE_PATH);

  if (!isContainedPath(pathApi, resolvedRootPath, packagesRoot)) {
    throw createHttpError(409, 'The packages root escapes the SkyCommand repository.', {
      code: 'SKYCOMMAND_TOOL_DESTINATION_UNSAFE',
      rootPath: resolvedRootPath,
      packagesRoot,
    });
  }

  return {
    resolvedRootPath,
    packagesRoot,
    packagesRelativePath: PACKAGES_RELATIVE_PATH,
    defaultToolPackageRelativePath: DEFAULT_TOOL_PACKAGE_RELATIVE_PATH,
    pathStyle: pathApi === path.win32 ? 'windows' : 'posix',
  };
}

function normalizeToolPackageRelativePath(value, { toolCode = '' } = {}) {
  const defaultPath = toolCode
    ? `${DEFAULT_TOOL_PACKAGE_RELATIVE_PATH}/${toolCode}`
    : DEFAULT_TOOL_PACKAGE_RELATIVE_PATH;
  const rawValue = String(value || defaultPath)
    .trim()
    .replace(/\\/g, '/');

  if (!rawValue || rawValue.includes('\0') || rawValue.startsWith('/')) {
    throw createHttpError(400, 'Tool package path must be a repository-relative path.', {
      code: 'SKYCOMMAND_TOOL_DESTINATION_UNSAFE',
      destination: rawValue || null,
    });
  }

  if (/^[A-Za-z]:/.test(rawValue) || rawValue.startsWith('//')) {
    throw createHttpError(400, 'Tool package path cannot be absolute.', {
      code: 'SKYCOMMAND_TOOL_DESTINATION_UNSAFE',
      destination: rawValue,
    });
  }

  const normalized = path.posix.normalize(rawValue).replace(/^\.\//, '').replace(/\/$/, '');
  const segments = normalized.split('/');
  const hasUnsafeSegment = segments.some(
    (segment) =>
      !segment || segment === '.' || segment === '..' || /[<>:"|?*\u0000-\u001F]/.test(segment),
  );

  if (
    hasUnsafeSegment ||
    normalized === PACKAGES_RELATIVE_PATH ||
    !normalized.startsWith(`${PACKAGES_RELATIVE_PATH}/`)
  ) {
    throw createHttpError(
      400,
      'Tool package path must identify a new directory inside the repository packages folder.',
      {
        code: 'SKYCOMMAND_TOOL_DESTINATION_UNSAFE',
        destination: rawValue,
        allowedRoot: PACKAGES_RELATIVE_PATH,
      },
    );
  }

  return normalized;
}

function resolveToolPackageDestination(rootPath, packageRelativePath, options = {}) {
  const resolved = resolvePackagesRoot(rootPath);
  const normalizedRelativePath = normalizeToolPackageRelativePath(packageRelativePath, options);
  const pathApi = getPathApi(resolved.resolvedRootPath);
  const packagePhysicalPath = pathApi.resolve(
    resolved.resolvedRootPath,
    ...normalizedRelativePath.split('/'),
  );

  if (!isContainedPath(pathApi, resolved.packagesRoot, packagePhysicalPath)) {
    throw createHttpError(400, 'Tool package destination escapes the repository packages folder.', {
      code: 'SKYCOMMAND_TOOL_DESTINATION_UNSAFE',
      destination: normalizedRelativePath,
      packagesRoot: resolved.packagesRoot,
    });
  }

  return {
    ...resolved,
    packageRelativePath: normalizedRelativePath,
    packagePhysicalPath,
    packageParentPhysicalPath: pathApi.dirname(packagePhysicalPath),
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
  const resolved = resolvePackagesRoot(rootPath);
  const rootState = await inspectDirectory(resolved.resolvedRootPath);
  const packagesState = await inspectDirectory(resolved.packagesRoot);

  const rootReady =
    rootState.exists && rootState.directory && rootState.readable && rootState.writable;
  const packagesReady =
    packagesState.exists &&
    packagesState.directory &&
    packagesState.readable &&
    packagesState.writable;

  return {
    ...resolved,
    rootState,
    packagesState,
    ready: rootReady && packagesReady,
  };
}

function buildUnavailableReadiness({ code, message, repository = null, rootPath = null }) {
  return {
    ready: false,
    status: 'BLOCKED',
    errorCode: code,
    message,
    profileCode: PROFILE_CODE,
    packagesRelativePath: PACKAGES_RELATIVE_PATH,
    defaultToolPackageRelativePath: DEFAULT_TOOL_PACKAGE_RELATIVE_PATH,
    repository,
    path: rootPath
      ? {
          rootPath,
          packagesRoot: null,
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
      message: `The SkyCommand repository or packages folder for profile ${PROFILE_CODE} is missing, inaccessible, or not writable.`,
      profileCode: PROFILE_CODE,
      packagesRelativePath: PACKAGES_RELATIVE_PATH,
      defaultToolPackageRelativePath: DEFAULT_TOOL_PACKAGE_RELATIVE_PATH,
      repository,
      path: {
        profileId: row.profile_id,
        profileCode: row.profile_code,
        profileName: row.profile_name,
        rootPath: row.root_path,
        resolvedRootPath: pathInspection.resolvedRootPath,
        packagesRoot: pathInspection.packagesRoot,
        rootState: pathInspection.rootState,
        packagesState: pathInspection.packagesState,
      },
    };
  }

  return {
    ready: true,
    status: 'READY',
    errorCode: null,
    message:
      'SkyCommand repository and packages folder are ready for administrator-selected tool destinations.',
    profileCode: PROFILE_CODE,
    packagesRelativePath: PACKAGES_RELATIVE_PATH,
    defaultToolPackageRelativePath: DEFAULT_TOOL_PACKAGE_RELATIVE_PATH,
    repository,
    path: {
      profileId: row.profile_id,
      profileCode: row.profile_code,
      profileName: row.profile_name,
      rootPath: row.root_path,
      resolvedRootPath: pathInspection.resolvedRootPath,
      packagesRoot: pathInspection.packagesRoot,
      rootState: pathInspection.rootState,
      packagesState: pathInspection.packagesState,
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
  PACKAGES_RELATIVE_PATH,
  DEFAULT_TOOL_PACKAGE_RELATIVE_PATH,
  resolvePackagesRoot,
  normalizeToolPackageRelativePath,
  resolveToolPackageDestination,
  inspectSkycommandRepositoryPath,
  getSkycommandRepositoryReadiness,
  assertSkycommandRepositoryReady,
};
