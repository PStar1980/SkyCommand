const { query } = require('../../../../packages/db/src/connection');

const DASHBOARD_DEFAULTS_KEY = 'dashboard_defaults';

const DEFAULT_PREFERENCES = Object.freeze({
  defaultMacroRegion: 'ALL',
  defaultMacroCategory: 'ALL',
  defaultChartWindow: '120',
  dashboardDensity: 'comfortable',
  preferredLandingPage: '/macro',
});

const ALLOWED_VALUES = Object.freeze({
  defaultMacroRegion: new Set(['ALL', 'US', 'CA', 'US_CA']),
  defaultMacroCategory: new Set([
    'ALL',
    'inflation',
    'rates',
    'growth',
    'labor',
    'credit',
    'housing',
    'trade',
    'liquidity',
    'regime',
    'comparison',
    'rates_fx',
  ]),
  defaultChartWindow: new Set(['30', '60', '120', 'ALL']),
  dashboardDensity: new Set(['comfortable', 'compact', 'roomy']),
  preferredLandingPage: new Set(['/', '/macro', '/macro/views', '/macro/indicators', '/account']),
});

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function sanitizePreferenceRow(row) {
  if (!row) {
    return null;
  }

  return {
    preferenceId: row.preference_id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    preferenceKey: row.preference_key,
    preferences: normalizeStoredPreferences(row.preference_value),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getBodyPreferences(body = {}) {
  if (
    body.preferences &&
    typeof body.preferences === 'object' &&
    !Array.isArray(body.preferences)
  ) {
    return body.preferences;
  }

  return body;
}

function normalizePreferenceValue(fieldName, value) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = String(value || '').trim() || DEFAULT_PREFERENCES[fieldName];
  const allowedValues = ALLOWED_VALUES[fieldName];

  if (!allowedValues.has(normalized)) {
    throw createHttpError(400, `Invalid SkyWeb preference value for ${fieldName}.`, {
      fieldName,
      value,
      allowedValues: Array.from(allowedValues),
    });
  }

  return normalized;
}

function normalizeIncomingPreferences(body = {}) {
  const source = getBodyPreferences(body);
  const normalizedPreferences = {};

  for (const fieldName of Object.keys(DEFAULT_PREFERENCES)) {
    const normalizedValue = normalizePreferenceValue(fieldName, source[fieldName]);

    if (normalizedValue !== undefined) {
      normalizedPreferences[fieldName] = normalizedValue;
    }
  }

  return normalizedPreferences;
}

function normalizeStoredPreferences(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return Object.keys(DEFAULT_PREFERENCES).reduce((preferences, fieldName) => {
    const candidateValue = String(source[fieldName] || '').trim();

    preferences[fieldName] = ALLOWED_VALUES[fieldName].has(candidateValue)
      ? candidateValue
      : DEFAULT_PREFERENCES[fieldName];

    return preferences;
  }, {});
}

async function ensurePreferences(userId) {
  await query(
    `
      INSERT INTO skyweb.user_preferences (user_id, preference_key, preference_value)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (user_id, preference_key) DO NOTHING
    `,
    [userId, DASHBOARD_DEFAULTS_KEY, JSON.stringify(DEFAULT_PREFERENCES)],
  );
}

async function getPreferences(userId) {
  await ensurePreferences(userId);

  const result = await query(
    `
      SELECT *
      FROM skyweb.vw_user_preferences
      WHERE user_id = $1
        AND preference_key = $2
      LIMIT 1
    `,
    [userId, DASHBOARD_DEFAULTS_KEY],
  );

  return sanitizePreferenceRow(result.rows[0]);
}

async function updatePreferences(userId, body = {}) {
  await ensurePreferences(userId);

  const incomingPreferences = normalizeIncomingPreferences(body);

  if (Object.keys(incomingPreferences).length === 0) {
    return getPreferences(userId);
  }

  const currentPreferenceRow = await getPreferences(userId);
  const nextPreferences = {
    ...DEFAULT_PREFERENCES,
    ...(currentPreferenceRow?.preferences || {}),
    ...incomingPreferences,
  };

  await query(
    `
      INSERT INTO skyweb.user_preferences (user_id, preference_key, preference_value)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (user_id, preference_key)
      DO UPDATE SET
        preference_value = EXCLUDED.preference_value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [userId, DASHBOARD_DEFAULTS_KEY, JSON.stringify(nextPreferences)],
  );

  return getPreferences(userId);
}

module.exports = {
  DEFAULT_PREFERENCES,
  getPreferences,
  updatePreferences,
};
