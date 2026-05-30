const { query } = require('../../../../packages/db/src/connection');
const macroReadService = require('./macroReadService');

const MAX_DISPLAY_LABEL_LENGTH = 160;
const MAX_NOTE_LENGTH = 800;

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeOptionalString(value, options = {}) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmedValue = String(value).trim();

  if (!trimmedValue) {
    return null;
  }

  if (options.maxLength && trimmedValue.length > options.maxLength) {
    throw createHttpError(400, `${options.fieldName || 'Value'} is too long.`, {
      fieldName: options.fieldName,
      maxLength: options.maxLength,
    });
  }

  return trimmedValue;
}

function normalizeViewKey(viewKey) {
  const normalizedViewKey = normalizeOptionalString(viewKey, { fieldName: 'viewKey' });

  if (!normalizedViewKey) {
    throw createHttpError(400, 'viewKey is required.', { fieldName: 'viewKey' });
  }

  const canonicalViewKey = normalizedViewKey
    .replace(/^macro\.vw_/i, '')
    .replace(/^vw_/i, '')
    .replace(/_/g, '-')
    .toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(canonicalViewKey)) {
    throw createHttpError(400, 'viewKey contains invalid characters.', {
      fieldName: 'viewKey',
      value: viewKey,
    });
  }

  return canonicalViewKey;
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }

  return fallback;
}

function normalizeSortOrder(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const sortOrder = Number.parseInt(value, 10);

  if (!Number.isInteger(sortOrder)) {
    throw createHttpError(400, 'sortOrder must be an integer.', {
      fieldName: 'sortOrder',
      value,
    });
  }

  return sortOrder;
}

function sanitizeSavedView(row, viewByKey = new Map()) {
  if (!row) {
    return null;
  }

  const view = viewByKey.get(row.view_key) || null;

  return {
    savedViewId: row.saved_view_id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    viewKey: row.view_key,
    displayLabel: row.display_label,
    note: row.note,
    pinned: row.pinned,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    view,
  };
}

async function getMacroViewMap(options = {}) {
  const payload = await macroReadService.listMacroViews({ includeStats: options.includeStats });
  return new Map((payload.items || []).map((view) => [view.viewKey, view]));
}

async function assertMacroViewExists(viewKey) {
  const viewByKey = await getMacroViewMap({ includeStats: true });
  const view = viewByKey.get(viewKey);

  if (!view) {
    throw createHttpError(404, 'Macro view not found.', { viewKey });
  }

  return { view, viewByKey };
}

function getBodyViewKey(body = {}, fallbackViewKey = null) {
  return body.viewKey || body.view_key || fallbackViewKey;
}

function normalizeSavedViewBody(body = {}, fallbackViewKey = null) {
  const viewKey = normalizeViewKey(getBodyViewKey(body, fallbackViewKey));
  const displayLabel = normalizeOptionalString(body.displayLabel || body.display_label, {
    fieldName: 'displayLabel',
    maxLength: MAX_DISPLAY_LABEL_LENGTH,
  });
  const note = normalizeOptionalString(body.note, {
    fieldName: 'note',
    maxLength: MAX_NOTE_LENGTH,
  });
  const pinned = normalizeBoolean(body.pinned, true);
  const sortOrder = normalizeSortOrder(body.sortOrder ?? body.sort_order, 0);

  return {
    viewKey,
    displayLabel,
    note,
    pinned,
    sortOrder,
  };
}

function normalizeSavedViewPatchBody(body = {}) {
  const patch = {};

  if (body.displayLabel !== undefined || body.display_label !== undefined) {
    patch.displayLabel = normalizeOptionalString(body.displayLabel || body.display_label, {
      fieldName: 'displayLabel',
      maxLength: MAX_DISPLAY_LABEL_LENGTH,
    });
  }

  if (body.note !== undefined) {
    patch.note = normalizeOptionalString(body.note, {
      fieldName: 'note',
      maxLength: MAX_NOTE_LENGTH,
    });
  }

  if (body.pinned !== undefined) {
    patch.pinned = normalizeBoolean(body.pinned, true);
  }

  if (body.sortOrder !== undefined || body.sort_order !== undefined) {
    patch.sortOrder = normalizeSortOrder(body.sortOrder ?? body.sort_order, 0);
  }

  return patch;
}

async function listSavedViews(userId) {
  const [viewByKey, result] = await Promise.all([
    getMacroViewMap({ includeStats: true }),
    query(
      `
        SELECT *
        FROM skyweb.vw_saved_macro_views
        WHERE user_id = $1
        ORDER BY pinned DESC, sort_order ASC, updated_at DESC, view_key ASC
      `,
      [userId],
    ),
  ]);

  return result.rows.map((row) => sanitizeSavedView(row, viewByKey));
}

async function getSavedView(userId, viewKey) {
  const normalizedViewKey = normalizeViewKey(viewKey);
  const [viewByKey, result] = await Promise.all([
    getMacroViewMap({ includeStats: true }),
    query(
      `
        SELECT *
        FROM skyweb.vw_saved_macro_views
        WHERE user_id = $1
          AND view_key = $2
        LIMIT 1
      `,
      [userId, normalizedViewKey],
    ),
  ]);

  if (result.rowCount === 0) {
    return null;
  }

  return sanitizeSavedView(result.rows[0], viewByKey);
}

async function saveView(userId, body = {}) {
  const savedView = normalizeSavedViewBody(body);
  const { viewByKey } = await assertMacroViewExists(savedView.viewKey);

  const result = await query(
    `
      INSERT INTO skyweb.saved_macro_views (
        user_id,
        view_key,
        display_label,
        note,
        pinned,
        sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, view_key)
      DO UPDATE SET
        display_label = EXCLUDED.display_label,
        note = EXCLUDED.note,
        pinned = EXCLUDED.pinned,
        sort_order = EXCLUDED.sort_order,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
    [
      userId,
      savedView.viewKey,
      savedView.displayLabel,
      savedView.note,
      savedView.pinned,
      savedView.sortOrder,
    ],
  );

  return sanitizeSavedView(result.rows[0], viewByKey);
}

async function updateSavedView(userId, viewKey, body = {}) {
  const normalizedViewKey = normalizeViewKey(viewKey);
  const patch = normalizeSavedViewPatchBody(body);

  if (Object.keys(patch).length === 0) {
    const currentSavedView = await getSavedView(userId, normalizedViewKey);

    if (!currentSavedView) {
      throw createHttpError(404, 'Saved macro view not found.', { viewKey: normalizedViewKey });
    }

    return currentSavedView;
  }

  const assignments = [];
  const values = [userId, normalizedViewKey];

  if (Object.prototype.hasOwnProperty.call(patch, 'displayLabel')) {
    values.push(patch.displayLabel);
    assignments.push(`display_label = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'note')) {
    values.push(patch.note);
    assignments.push(`note = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'pinned')) {
    values.push(patch.pinned);
    assignments.push(`pinned = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'sortOrder')) {
    values.push(patch.sortOrder);
    assignments.push(`sort_order = $${values.length}`);
  }

  const result = await query(
    `
      UPDATE skyweb.saved_macro_views
      SET ${assignments.join(', ')},
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND view_key = $2
      RETURNING *
    `,
    values,
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Saved macro view not found.', { viewKey: normalizedViewKey });
  }

  const viewByKey = await getMacroViewMap({ includeStats: true });
  return sanitizeSavedView(result.rows[0], viewByKey);
}

async function removeSavedView(userId, viewKey) {
  const normalizedViewKey = normalizeViewKey(viewKey);
  const result = await query(
    `
      DELETE FROM skyweb.saved_macro_views
      WHERE user_id = $1
        AND view_key = $2
      RETURNING view_key
    `,
    [userId, normalizedViewKey],
  );

  return {
    removed: result.rowCount > 0,
    viewKey: normalizedViewKey,
  };
}

module.exports = {
  listSavedViews,
  removeSavedView,
  saveView,
  updateSavedView,
};
