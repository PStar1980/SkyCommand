const CONTAINMENT_LABELS = Object.freeze({
  liveCheckoutMount: 'Live checkout mount',
  arbitraryHostFilesystem: 'Unauthorized host filesystem',
  dockerSocket: 'Docker socket',
  githubCredentials: 'GitHub credential',
  hostAgentCredentials: 'Host Agent credential',
  supervisorCredentials: 'Supervisor/control-plane credential',
  apiControlPlaneSecrets: 'API/control-plane secret',
  providerCredentials: 'Provider credential',
  browserState: 'Browser state',
  directGit: 'Direct Git',
});

export function runtimeIdentity(value) {
  const normalized = String(value ?? '').trim();
  return normalized || 'UNKNOWN';
}

export function containmentValue(value) {
  if (value === false) return 'ABSENT (FALSE)';
  if (value === true) return 'PRESENT (TRUE)';
  if (value === null || value === undefined || String(value).trim() === '') return 'UNKNOWN';
  return String(value).trim().toUpperCase();
}

export function containmentEntries(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return [];
  return Object.entries(profile).map(([key, value]) => ({
    key,
    label: CONTAINMENT_LABELS[key] || key,
    value: containmentValue(value),
  }));
}
