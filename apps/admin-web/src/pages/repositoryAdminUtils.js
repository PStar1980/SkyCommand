export const REPOSITORY_PAGE_SIZE = 10;

export const DEFAULT_REPOSITORY_FILTERS = {
  q: '',
  active: '',
  skycommand: '',
};

export const DEFAULT_REPOSITORY_FORM = {
  repoCode: '',
  repoName: '',
  description: '',
  remoteUrl: '',
  mainBranch: 'main',
  devBranch: 'dev',
  repoMapFileName: '',
  repoMapOutputPath: '',
  repoZipFileName: '',
  repoZipOutputPath: '',
  displayOrder: 999,
  active: true,
  paths: [],
};

export function formatRepositoryDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function repositoryStatusClass(active) {
  return active ? 'sky-pill-success' : 'sky-pill-danger';
}

export function repositoryStatusLabel(active) {
  return active ? 'ACTIVE' : 'DISABLED';
}

export function repositoryReadinessClass(readiness) {
  if (readiness?.ready) {
    return 'sky-pill-success';
  }

  return readiness?.errorCode ? 'sky-pill-danger' : 'sky-pill-warning';
}

export function repositoryReadinessLabel(readiness) {
  if (readiness?.ready) {
    return 'READY';
  }

  return readiness?.errorCode ? 'BLOCKED' : 'CHECKING';
}

export function buildRepositoryPathForm(profiles = [], paths = []) {
  const pathsByProfileId = new Map(paths.map((path) => [path.profileId, path]));

  return profiles.map((profile) => {
    const existingPath = pathsByProfileId.get(profile.profileId);

    return {
      profileId: profile.profileId,
      profileCode: profile.profileCode,
      profileName: profile.profileName,
      rootPath: existingPath?.rootPath || '',
      active: existingPath?.active ?? true,
    };
  });
}

export function createRepositoryForm(profiles = []) {
  return {
    ...DEFAULT_REPOSITORY_FORM,
    paths: buildRepositoryPathForm(profiles, []),
  };
}

export function populateRepositoryForm(repository, paths = [], profiles = []) {
  return {
    repoCode: repository?.repoCode || '',
    repoName: repository?.repoName || '',
    description: repository?.description || '',
    remoteUrl: repository?.remoteUrl || '',
    mainBranch: repository?.mainBranch || 'main',
    devBranch: repository?.devBranch || 'dev',
    repoMapFileName: repository?.repoMapFileName || '',
    repoMapOutputPath: repository?.repoMapOutputPath || '',
    repoZipFileName: repository?.repoZipFileName || '',
    repoZipOutputPath: repository?.repoZipOutputPath || '',
    displayOrder: repository?.displayOrder ?? 999,
    active: repository?.active ?? true,
    paths: buildRepositoryPathForm(profiles, paths),
  };
}

function normalizeNumberInput(value, fallback = 999) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function sanitizeRepositoryPayload(form) {
  return {
    repoCode: form.repoCode.trim(),
    repoName: form.repoName.trim(),
    description: form.description.trim() || null,
    remoteUrl: form.remoteUrl.trim() || null,
    mainBranch: form.mainBranch.trim() || 'main',
    devBranch: form.devBranch.trim() || 'dev',
    repoMapFileName: form.repoMapFileName.trim() || null,
    repoMapOutputPath: form.repoMapOutputPath.trim() || null,
    repoZipFileName: form.repoZipFileName.trim() || null,
    repoZipOutputPath: form.repoZipOutputPath.trim() || null,
    displayOrder: normalizeNumberInput(form.displayOrder),
    active: Boolean(form.active),
    paths: form.paths
      .filter((path) => path.rootPath.trim() || path.active === false)
      .map((path) => ({
        profileId: path.profileId,
        rootPath: path.rootPath.trim(),
        active: Boolean(path.active),
      })),
  };
}
