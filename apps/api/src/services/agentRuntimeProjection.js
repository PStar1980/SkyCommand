function normalizeRuntimeIdentity(value) {
  const normalized = String(value ?? '').trim();
  return normalized || 'UNKNOWN';
}

function projectRuntimeIdentity(row = {}) {
  return normalizeRuntimeIdentity(row.runtime_code || row.runtime_cell?.runtimeKind);
}

module.exports = {
  normalizeRuntimeIdentity,
  projectRuntimeIdentity,
};
