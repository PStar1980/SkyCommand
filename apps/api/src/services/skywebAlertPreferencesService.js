const { query } = require('../../../../packages/db/src/connection');

const ALERT_PREFERENCES_KEY = 'alert_delivery';

const DEFAULT_ALERT_PREFERENCES = Object.freeze({
  inAppEnabled: true,
  minimumSeverity: 'low',
  notifyLow: true,
  notifyMedium: true,
  notifyHigh: true,
  notifyCritical: true,
  deliveryMode: 'immediate',
  digestCadence: 'daily',
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  quietHoursTimezone: 'America/Toronto',
  emailEnabled: false,
  browserEnabled: false,
});

const ALLOWED_VALUES = Object.freeze({
  minimumSeverity: new Set(['low', 'medium', 'high', 'critical']),
  deliveryMode: new Set(['immediate', 'digest']),
  digestCadence: new Set(['daily', 'weekly']),
});

const BOOLEAN_FIELDS = new Set([
  'inAppEnabled',
  'notifyLow',
  'notifyMedium',
  'notifyHigh',
  'notifyCritical',
  'quietHoursEnabled',
  'emailEnabled',
  'browserEnabled',
]);

const TIME_FIELDS = new Set(['quietHoursStart', 'quietHoursEnd']);

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
    preferences: normalizeStoredAlertPreferences(row.preference_value),
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

function normalizeBoolean(value, fallback) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return fallback;
  }

  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }

  throw createHttpError(400, 'Invalid boolean SkyWeb alert preference value.', { value });
}

function normalizeTimeValue(fieldName, value) {
  if (value === undefined) {
    return undefined;
  }

  const fallback = DEFAULT_ALERT_PREFERENCES[fieldName];
  const normalizedValue = String(value || '').trim() || fallback;

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizedValue)) {
    throw createHttpError(400, `Invalid SkyWeb alert preference value for ${fieldName}.`, {
      fieldName,
      value,
      format: 'HH:mm',
    });
  }

  return normalizedValue;
}

function normalizeTimezone(value) {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue =
    String(value || '').trim() || DEFAULT_ALERT_PREFERENCES.quietHoursTimezone;

  if (normalizedValue.length > 80 || !/^[A-Za-z0-9_+\-/]+$/.test(normalizedValue)) {
    throw createHttpError(400, 'Invalid SkyWeb alert preference value for quietHoursTimezone.', {
      fieldName: 'quietHoursTimezone',
      value,
    });
  }

  return normalizedValue;
}

function normalizePreferenceValue(fieldName, value) {
  if (value === undefined) {
    return undefined;
  }

  if (BOOLEAN_FIELDS.has(fieldName)) {
    return normalizeBoolean(value, DEFAULT_ALERT_PREFERENCES[fieldName]);
  }

  if (TIME_FIELDS.has(fieldName)) {
    return normalizeTimeValue(fieldName, value);
  }

  if (fieldName === 'quietHoursTimezone') {
    return normalizeTimezone(value);
  }

  const rawValue = String(value || '').trim() || DEFAULT_ALERT_PREFERENCES[fieldName];
  const allowedValues = ALLOWED_VALUES[fieldName];

  if (allowedValues && !allowedValues.has(rawValue)) {
    throw createHttpError(400, `Invalid SkyWeb alert preference value for ${fieldName}.`, {
      fieldName,
      value,
      allowedValues: Array.from(allowedValues),
    });
  }

  return rawValue;
}

function normalizeIncomingAlertPreferences(body = {}) {
  const source = getBodyPreferences(body);
  const normalizedPreferences = {};

  for (const fieldName of Object.keys(DEFAULT_ALERT_PREFERENCES)) {
    const normalizedValue = normalizePreferenceValue(fieldName, source[fieldName]);

    if (normalizedValue !== undefined) {
      normalizedPreferences[fieldName] = normalizedValue;
    }
  }

  return normalizedPreferences;
}

function normalizeStoredAlertPreferences(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return Object.keys(DEFAULT_ALERT_PREFERENCES).reduce((preferences, fieldName) => {
    try {
      const normalizedValue = normalizePreferenceValue(fieldName, source[fieldName]);
      preferences[fieldName] =
        normalizedValue === undefined ? DEFAULT_ALERT_PREFERENCES[fieldName] : normalizedValue;
    } catch {
      preferences[fieldName] = DEFAULT_ALERT_PREFERENCES[fieldName];
    }

    return preferences;
  }, {});
}

async function ensureAlertPreferences(userId) {
  await query(
    `
      INSERT INTO skyweb.user_preferences (user_id, preference_key, preference_value)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (user_id, preference_key) DO NOTHING
    `,
    [userId, ALERT_PREFERENCES_KEY, JSON.stringify(DEFAULT_ALERT_PREFERENCES)],
  );
}

async function getAlertPreferences(userId) {
  await ensureAlertPreferences(userId);

  const result = await query(
    `
      SELECT *
      FROM skyweb.vw_user_preferences
      WHERE user_id = $1
        AND preference_key = $2
      LIMIT 1
    `,
    [userId, ALERT_PREFERENCES_KEY],
  );

  return sanitizePreferenceRow(result.rows[0]);
}

async function updateAlertPreferences(userId, body = {}) {
  await ensureAlertPreferences(userId);

  const incomingPreferences = normalizeIncomingAlertPreferences(body);

  if (Object.keys(incomingPreferences).length === 0) {
    return getAlertPreferences(userId);
  }

  const currentPreferenceRow = await getAlertPreferences(userId);
  const nextPreferences = {
    ...DEFAULT_ALERT_PREFERENCES,
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
    [userId, ALERT_PREFERENCES_KEY, JSON.stringify(nextPreferences)],
  );

  return getAlertPreferences(userId);
}

module.exports = {
  DEFAULT_ALERT_PREFERENCES,
  getAlertPreferences,
  updateAlertPreferences,
};
