const { query } = require('../../../../packages/db/src/connection');

function sanitizeProfile(row) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    userDisplayName: row.user_display_name,
    profileDisplayName: row.profile_display_name,
    displayName: row.profile_display_name || row.user_display_name || row.username || row.email,
    headline: row.headline,
    bio: row.bio,
    timezone: row.timezone,
    locale: row.locale,
    avatarUrl: row.avatar_url,
    metadata: row.profile_metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeNullableString(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

async function ensureProfile(userId) {
  await query(
    `
      INSERT INTO skyweb.user_profiles (user_id, display_name)
      SELECT u.user_id, u.display_name
      FROM auth.users u
      WHERE u.user_id = $1
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );
}

async function getProfile(userId) {
  await ensureProfile(userId);

  const result = await query(
    `
      SELECT *
      FROM skyweb.vw_user_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return sanitizeProfile(result.rows[0]);
}

async function updateProfile(userId, body = {}) {
  await ensureProfile(userId);

  const fields = [
    ['display_name', normalizeNullableString(body.displayName)],
    ['headline', normalizeNullableString(body.headline)],
    ['bio', normalizeNullableString(body.bio)],
    ['timezone', normalizeNullableString(body.timezone)],
    ['locale', normalizeNullableString(body.locale)],
    ['avatar_url', normalizeNullableString(body.avatarUrl)],
  ];

  const assignments = [];
  const values = [userId];

  for (const [columnName, value] of fields) {
    if (value !== undefined) {
      values.push(value);
      assignments.push(`${columnName} = $${values.length}`);
    }
  }

  if (body.metadata !== undefined) {
    values.push(JSON.stringify(body.metadata || {}));
    assignments.push(`profile_metadata = $${values.length}::jsonb`);
  }

  if (assignments.length === 0) {
    return getProfile(userId);
  }

  await query(
    `
      UPDATE skyweb.user_profiles
      SET ${assignments.join(', ')},
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
    `,
    values,
  );

  return getProfile(userId);
}

module.exports = {
  getProfile,
  updateProfile,
};
