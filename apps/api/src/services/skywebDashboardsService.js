const { query } = require('../../../../packages/db/src/connection');
const macroReadService = require('./macroReadService');

const MAX_TITLE_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 800;
const MAX_ITEM_NOTE_LENGTH = 800;

const ALLOWED_LAYOUT_PRESETS = new Set(['executive', 'research', 'compact']);
const ALLOWED_ITEM_MODES = new Set([
  'view_card',
  'wide_card',
  'compact_card',
  'metric_card',
  'mini_chart',
  'latest_row',
  'table_preview',
]);

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

function normalizeRequiredString(value, options = {}) {
  const normalizedValue = normalizeOptionalString(value, options);

  if (!normalizedValue) {
    throw createHttpError(400, `${options.fieldName || 'Value'} is required.`, {
      fieldName: options.fieldName,
    });
  }

  return normalizedValue;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function normalizeDashboardKey(value) {
  const normalizedValue = normalizeRequiredString(value, { fieldName: 'dashboardKey' })
    .replace(/_/g, '-')
    .toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(normalizedValue)) {
    throw createHttpError(400, 'dashboardKey contains invalid characters.', {
      fieldName: 'dashboardKey',
      value,
    });
  }

  return normalizedValue;
}

function normalizeViewKey(viewKey) {
  const normalizedViewKey = normalizeRequiredString(viewKey, { fieldName: 'viewKey' })
    .replace(/^macro\.vw_/i, '')
    .replace(/^vw_/i, '')
    .replace(/_/g, '-')
    .toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(normalizedViewKey)) {
    throw createHttpError(400, 'viewKey contains invalid characters.', {
      fieldName: 'viewKey',
      value: viewKey,
    });
  }

  return normalizedViewKey;
}

function normalizeIndicatorCode(indicatorCode) {
  const normalizedIndicatorCode = normalizeRequiredString(indicatorCode, {
    fieldName: 'indicatorCode',
  })
    .replace(/-/g, '_')
    .toUpperCase();

  if (!/^[A-Z0-9_]{1,128}$/.test(normalizedIndicatorCode)) {
    throw createHttpError(400, 'indicatorCode contains invalid characters.', {
      fieldName: 'indicatorCode',
      value: indicatorCode,
    });
  }

  return normalizedIndicatorCode;
}

function normalizeItemSource(value, body = {}) {
  const rawValue =
    value ||
    body.item_source ||
    body.itemType ||
    body.item_type ||
    body.sourceType ||
    body.source_type;

  if (rawValue) {
    const normalizedValue = String(rawValue).trim().toLowerCase();

    if (normalizedValue === 'indicator' || normalizedValue === 'macro_indicator') {
      return 'indicator';
    }

    if (normalizedValue === 'view' || normalizedValue === 'macro_view') {
      return 'view';
    }

    throw createHttpError(400, 'Invalid dashboard item source.', {
      fieldName: 'itemSource',
      value,
      allowedValues: ['view', 'indicator'],
    });
  }

  return body.indicatorCode || body.indicator_code ? 'indicator' : 'view';
}

function normalizeBoolean(value, fallback = false) {
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

function normalizeInteger(value, fallback = 0, options = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const numberValue = Number.parseInt(value, 10);

  if (!Number.isInteger(numberValue)) {
    throw createHttpError(400, `${options.fieldName || 'Value'} must be an integer.`, {
      fieldName: options.fieldName,
      value,
    });
  }

  if (options.min !== undefined && numberValue < options.min) {
    throw createHttpError(400, `${options.fieldName || 'Value'} is too small.`, {
      fieldName: options.fieldName,
      min: options.min,
      value,
    });
  }

  if (options.max !== undefined && numberValue > options.max) {
    throw createHttpError(400, `${options.fieldName || 'Value'} is too large.`, {
      fieldName: options.fieldName,
      max: options.max,
      value,
    });
  }

  return numberValue;
}

function normalizeLayoutPreset(value, fallback = 'executive') {
  const normalizedValue = String(value || fallback)
    .trim()
    .toLowerCase();

  if (!ALLOWED_LAYOUT_PRESETS.has(normalizedValue)) {
    throw createHttpError(400, 'Invalid dashboard layout preset.', {
      fieldName: 'layoutPreset',
      value,
      allowedValues: Array.from(ALLOWED_LAYOUT_PRESETS),
    });
  }

  return normalizedValue;
}

function normalizeItemMode(value, fallback = 'view_card') {
  const normalizedValue = String(value || fallback)
    .trim()
    .toLowerCase();

  if (!ALLOWED_ITEM_MODES.has(normalizedValue)) {
    throw createHttpError(400, 'Invalid dashboard item mode.', {
      fieldName: 'itemMode',
      value,
      allowedValues: Array.from(ALLOWED_ITEM_MODES),
    });
  }

  return normalizedValue;
}

async function getMacroViewMap(options = {}) {
  const payload = await macroReadService.listMacroViews({ includeStats: options.includeStats });
  return new Map((payload.items || []).map((view) => [view.viewKey, view]));
}

async function getMacroIndicatorMap(options = {}) {
  const payload = await macroReadService.listMacroIndicators({ active: true, limit: 5000 });
  const indicators = payload.items || [];

  if (!options.includeStats) {
    return new Map(indicators.map((indicator) => [indicator.indicatorCode, indicator]));
  }

  const enrichedIndicators = await Promise.all(
    indicators.map(async (indicator) => {
      try {
        const indicatorPayload = await macroReadService.getMacroIndicator(indicator.indicatorCode);
        return indicatorPayload.indicator
          ? { ...indicatorPayload.indicator, stats: indicatorPayload.stats || null }
          : indicator;
      } catch (error) {
        return indicator;
      }
    }),
  );

  return new Map(enrichedIndicators.map((indicator) => [indicator.indicatorCode, indicator]));
}

async function assertMacroViewExists(viewKey) {
  const viewByKey = await getMacroViewMap({ includeStats: true });
  const view = viewByKey.get(viewKey);

  if (!view) {
    throw createHttpError(404, 'Macro view not found.', { viewKey });
  }

  return { view, viewByKey };
}

async function assertMacroIndicatorExists(indicatorCode) {
  try {
    const payload = await macroReadService.getMacroIndicator(indicatorCode);

    if (!payload.indicator) {
      throw createHttpError(404, 'Macro indicator not found.', { indicatorCode });
    }

    return payload;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw createHttpError(404, 'Macro indicator not found.', { indicatorCode });
  }
}

async function assertSavedViewExists(userId, viewKey) {
  const result = await query(
    `
      SELECT view_key
      FROM skyweb.saved_macro_views
      WHERE user_id = $1
        AND view_key = $2
      LIMIT 1
    `,
    [userId, viewKey],
  );

  if (result.rowCount === 0) {
    throw createHttpError(400, 'Save the macro view before adding it to a dashboard.', {
      fieldName: 'viewKey',
      viewKey,
    });
  }
}

async function createUniqueDashboardKey(userId, title, requestedKey = null) {
  const baseKey = requestedKey
    ? normalizeDashboardKey(requestedKey)
    : slugify(title) || 'dashboard';
  let candidateKey = baseKey;
  let suffix = 2;

  while (suffix < 1000) {
    const result = await query(
      `
        SELECT dashboard_key
        FROM skyweb.user_dashboards
        WHERE user_id = $1
          AND dashboard_key = $2
        LIMIT 1
      `,
      [userId, candidateKey],
    );

    if (result.rowCount === 0) {
      return candidateKey;
    }

    candidateKey = `${baseKey.slice(0, 120)}-${suffix}`;
    suffix += 1;
  }

  throw createHttpError(409, 'Unable to create a unique dashboard key.', { title });
}

function sanitizeDashboard(row, items = []) {
  if (!row) {
    return null;
  }

  return {
    dashboardId: row.dashboard_id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    dashboardKey: row.dashboard_key,
    title: row.title,
    description: row.description,
    layoutPreset: row.layout_preset,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    itemCount: Number(row.item_count || items.length || 0),
    pinnedItemCount: Number(row.pinned_item_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

function sanitizeDashboardItem(row, viewByKey = new Map(), indicatorByCode = new Map()) {
  if (!row) {
    return null;
  }

  const itemSource = row.item_source || (row.indicator_code ? 'indicator' : 'view');
  const indicator =
    itemSource === 'indicator' ? indicatorByCode.get(row.indicator_code) || null : null;
  const view = itemSource === 'view' ? viewByKey.get(row.view_key) || null : null;
  const savedDisplayLabel = row.saved_display_label || null;
  const itemTitle =
    row.item_title ||
    savedDisplayLabel ||
    view?.label ||
    indicator?.description ||
    row.indicator_code ||
    row.view_key ||
    null;
  const itemNote = row.item_note || row.saved_note || null;

  return {
    itemId: row.item_id,
    dashboardId: row.dashboard_id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    dashboardKey: row.dashboard_key,
    dashboardTitle: row.dashboard_title,
    itemSource,
    viewKey: row.view_key,
    indicatorCode: row.indicator_code,
    itemTitle,
    itemNote,
    itemMode: row.item_mode,
    sortOrder: row.sort_order,
    positionRow: row.position_row,
    positionCol: row.position_col,
    widthUnits: row.width_units,
    heightUnits: row.height_units,
    savedViewId: row.saved_view_id,
    savedDisplayLabel,
    savedNote: row.saved_note,
    savedPinned: row.saved_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    view,
    indicator,
  };
}

async function getDashboardRow(userId, dashboardKey) {
  const normalizedDashboardKey = normalizeDashboardKey(dashboardKey);
  const result = await query(
    `
      SELECT *
      FROM skyweb.vw_user_dashboards
      WHERE user_id = $1
        AND dashboard_key = $2
      LIMIT 1
    `,
    [userId, normalizedDashboardKey],
  );

  return result.rows[0] || null;
}

async function getDashboardItems(userId, dashboardKey, viewByKey = null, indicatorByCode = null) {
  const normalizedDashboardKey = normalizeDashboardKey(dashboardKey);
  const [macroViewByKey, macroIndicatorByCode] = await Promise.all([
    viewByKey ? Promise.resolve(viewByKey) : getMacroViewMap({ includeStats: true }),
    indicatorByCode
      ? Promise.resolve(indicatorByCode)
      : getMacroIndicatorMap({ includeStats: true }),
  ]);
  const result = await query(
    `
      SELECT *
      FROM skyweb.vw_user_dashboard_items
      WHERE user_id = $1
        AND dashboard_key = $2
      ORDER BY sort_order ASC, updated_at DESC, COALESCE(view_key, indicator_code) ASC
    `,
    [userId, normalizedDashboardKey],
  );

  return result.rows.map((row) => sanitizeDashboardItem(row, macroViewByKey, macroIndicatorByCode));
}

async function listDashboards(userId) {
  const [viewByKey, indicatorByCode] = await Promise.all([
    getMacroViewMap({ includeStats: true }),
    getMacroIndicatorMap({ includeStats: true }),
  ]);
  const [dashboardResult, itemResult] = await Promise.all([
    query(
      `
        SELECT *
        FROM skyweb.vw_user_dashboards
        WHERE user_id = $1
        ORDER BY is_default DESC, sort_order ASC, updated_at DESC, dashboard_key ASC
      `,
      [userId],
    ),
    query(
      `
        SELECT *
        FROM skyweb.vw_user_dashboard_items
        WHERE user_id = $1
        ORDER BY sort_order ASC, updated_at DESC, COALESCE(view_key, indicator_code) ASC
      `,
      [userId],
    ),
  ]);

  const itemsByDashboardKey = new Map();

  for (const row of itemResult.rows) {
    const items = itemsByDashboardKey.get(row.dashboard_key) || [];
    items.push(sanitizeDashboardItem(row, viewByKey, indicatorByCode));
    itemsByDashboardKey.set(row.dashboard_key, items);
  }

  return dashboardResult.rows.map((row) =>
    sanitizeDashboard(row, itemsByDashboardKey.get(row.dashboard_key) || []),
  );
}

async function getDashboard(userId, dashboardKey) {
  const normalizedDashboardKey = normalizeDashboardKey(dashboardKey);
  const [dashboardRow, viewByKey, indicatorByCode] = await Promise.all([
    getDashboardRow(userId, normalizedDashboardKey),
    getMacroViewMap({ includeStats: true }),
    getMacroIndicatorMap({ includeStats: true }),
  ]);

  if (!dashboardRow) {
    return null;
  }

  const items = await getDashboardItems(userId, normalizedDashboardKey, viewByKey, indicatorByCode);
  return sanitizeDashboard(dashboardRow, items);
}

function normalizeDashboardBody(body = {}) {
  const title = normalizeRequiredString(body.title, {
    fieldName: 'title',
    maxLength: MAX_TITLE_LENGTH,
  });

  return {
    dashboardKey: body.dashboardKey || body.dashboard_key || null,
    title,
    description: normalizeOptionalString(body.description, {
      fieldName: 'description',
      maxLength: MAX_DESCRIPTION_LENGTH,
    }),
    layoutPreset: normalizeLayoutPreset(body.layoutPreset || body.layout_preset),
    isDefault: normalizeBoolean(body.isDefault ?? body.is_default, false),
    sortOrder: normalizeInteger(body.sortOrder ?? body.sort_order, 0, { fieldName: 'sortOrder' }),
  };
}

function normalizeDashboardPatchBody(body = {}) {
  const patch = {};

  if (body.title !== undefined) {
    patch.title = normalizeRequiredString(body.title, {
      fieldName: 'title',
      maxLength: MAX_TITLE_LENGTH,
    });
  }

  if (body.description !== undefined) {
    patch.description = normalizeOptionalString(body.description, {
      fieldName: 'description',
      maxLength: MAX_DESCRIPTION_LENGTH,
    });
  }

  if (body.layoutPreset !== undefined || body.layout_preset !== undefined) {
    patch.layoutPreset = normalizeLayoutPreset(body.layoutPreset || body.layout_preset);
  }

  if (body.isDefault !== undefined || body.is_default !== undefined) {
    patch.isDefault = normalizeBoolean(body.isDefault ?? body.is_default, false);
  }

  if (body.sortOrder !== undefined || body.sort_order !== undefined) {
    patch.sortOrder = normalizeInteger(body.sortOrder ?? body.sort_order, 0, {
      fieldName: 'sortOrder',
    });
  }

  return patch;
}

function normalizeDashboardItemBody(body = {}) {
  const itemSource = normalizeItemSource(body.itemSource, body);
  const viewKey = itemSource === 'view' ? normalizeViewKey(body.viewKey || body.view_key) : null;
  const indicatorCode =
    itemSource === 'indicator'
      ? normalizeIndicatorCode(body.indicatorCode || body.indicator_code)
      : null;

  return {
    itemSource,
    viewKey,
    indicatorCode,
    itemTitle: normalizeOptionalString(body.itemTitle || body.item_title, {
      fieldName: 'itemTitle',
      maxLength: MAX_TITLE_LENGTH,
    }),
    itemNote: normalizeOptionalString(body.itemNote || body.item_note, {
      fieldName: 'itemNote',
      maxLength: MAX_ITEM_NOTE_LENGTH,
    }),
    itemMode: normalizeItemMode(body.itemMode || body.item_mode),
    sortOrder: normalizeInteger(body.sortOrder ?? body.sort_order, 0, { fieldName: 'sortOrder' }),
    positionRow: normalizeInteger(body.positionRow ?? body.position_row, 0, {
      fieldName: 'positionRow',
      min: 0,
    }),
    positionCol: normalizeInteger(body.positionCol ?? body.position_col, 0, {
      fieldName: 'positionCol',
      min: 0,
    }),
    widthUnits: normalizeInteger(body.widthUnits ?? body.width_units, 1, {
      fieldName: 'widthUnits',
      min: 1,
      max: 4,
    }),
    heightUnits: normalizeInteger(body.heightUnits ?? body.height_units, 1, {
      fieldName: 'heightUnits',
      min: 1,
      max: 4,
    }),
  };
}

function normalizeDashboardItemPatchBody(body = {}) {
  const patch = {};

  if (body.itemTitle !== undefined || body.item_title !== undefined) {
    patch.itemTitle = normalizeOptionalString(body.itemTitle || body.item_title, {
      fieldName: 'itemTitle',
      maxLength: MAX_TITLE_LENGTH,
    });
  }

  if (body.itemNote !== undefined || body.item_note !== undefined) {
    patch.itemNote = normalizeOptionalString(body.itemNote || body.item_note, {
      fieldName: 'itemNote',
      maxLength: MAX_ITEM_NOTE_LENGTH,
    });
  }

  if (body.itemMode !== undefined || body.item_mode !== undefined) {
    patch.itemMode = normalizeItemMode(body.itemMode || body.item_mode);
  }

  if (body.sortOrder !== undefined || body.sort_order !== undefined) {
    patch.sortOrder = normalizeInteger(body.sortOrder ?? body.sort_order, 0, {
      fieldName: 'sortOrder',
    });
  }

  if (body.positionRow !== undefined || body.position_row !== undefined) {
    patch.positionRow = normalizeInteger(body.positionRow ?? body.position_row, 0, {
      fieldName: 'positionRow',
      min: 0,
    });
  }

  if (body.positionCol !== undefined || body.position_col !== undefined) {
    patch.positionCol = normalizeInteger(body.positionCol ?? body.position_col, 0, {
      fieldName: 'positionCol',
      min: 0,
    });
  }

  if (body.widthUnits !== undefined || body.width_units !== undefined) {
    patch.widthUnits = normalizeInteger(body.widthUnits ?? body.width_units, 1, {
      fieldName: 'widthUnits',
      min: 1,
      max: 4,
    });
  }

  if (body.heightUnits !== undefined || body.height_units !== undefined) {
    patch.heightUnits = normalizeInteger(body.heightUnits ?? body.height_units, 1, {
      fieldName: 'heightUnits',
      min: 1,
      max: 4,
    });
  }

  return patch;
}

async function createDashboard(userId, body = {}) {
  const dashboard = normalizeDashboardBody(body);
  const dashboardKey = await createUniqueDashboardKey(
    userId,
    dashboard.title,
    dashboard.dashboardKey,
  );

  if (dashboard.isDefault) {
    await query('UPDATE skyweb.user_dashboards SET is_default = FALSE WHERE user_id = $1', [
      userId,
    ]);
  }

  const result = await query(
    `
      INSERT INTO skyweb.user_dashboards (
        user_id,
        dashboard_key,
        title,
        description,
        layout_preset,
        is_default,
        sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      userId,
      dashboardKey,
      dashboard.title,
      dashboard.description,
      dashboard.layoutPreset,
      dashboard.isDefault,
      dashboard.sortOrder,
    ],
  );

  return sanitizeDashboard({ ...result.rows[0], item_count: 0, pinned_item_count: 0 }, []);
}

async function updateDashboard(userId, dashboardKey, body = {}) {
  const normalizedDashboardKey = normalizeDashboardKey(dashboardKey);
  const patch = normalizeDashboardPatchBody(body);

  if (Object.keys(patch).length === 0) {
    const dashboard = await getDashboard(userId, normalizedDashboardKey);

    if (!dashboard) {
      throw createHttpError(404, 'Dashboard not found.', { dashboardKey: normalizedDashboardKey });
    }

    return dashboard;
  }

  if (patch.isDefault) {
    await query(
      `
        UPDATE skyweb.user_dashboards
        SET is_default = FALSE
        WHERE user_id = $1
          AND dashboard_key <> $2
      `,
      [userId, normalizedDashboardKey],
    );
  }

  const assignments = [];
  const values = [userId, normalizedDashboardKey];

  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    values.push(patch.title);
    assignments.push(`title = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
    values.push(patch.description);
    assignments.push(`description = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'layoutPreset')) {
    values.push(patch.layoutPreset);
    assignments.push(`layout_preset = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'isDefault')) {
    values.push(patch.isDefault);
    assignments.push(`is_default = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'sortOrder')) {
    values.push(patch.sortOrder);
    assignments.push(`sort_order = $${values.length}`);
  }

  const result = await query(
    `
      UPDATE skyweb.user_dashboards
      SET ${assignments.join(', ')},
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND dashboard_key = $2
      RETURNING dashboard_key
    `,
    values,
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Dashboard not found.', { dashboardKey: normalizedDashboardKey });
  }

  return getDashboard(userId, normalizedDashboardKey);
}

async function removeDashboard(userId, dashboardKey) {
  const normalizedDashboardKey = normalizeDashboardKey(dashboardKey);
  const result = await query(
    `
      DELETE FROM skyweb.user_dashboards
      WHERE user_id = $1
        AND dashboard_key = $2
      RETURNING dashboard_key
    `,
    [userId, normalizedDashboardKey],
  );

  return {
    removed: result.rowCount > 0,
    dashboardKey: normalizedDashboardKey,
  };
}

async function addDashboardItem(userId, dashboardKey, body = {}) {
  const normalizedDashboardKey = normalizeDashboardKey(dashboardKey);
  const item = normalizeDashboardItemBody(body);

  if (item.itemSource === 'indicator') {
    await assertMacroIndicatorExists(item.indicatorCode);
  } else {
    await assertMacroViewExists(item.viewKey);
    await assertSavedViewExists(userId, item.viewKey);
  }

  const dashboardResult = await query(
    `
      SELECT dashboard_id
      FROM skyweb.user_dashboards
      WHERE user_id = $1
        AND dashboard_key = $2
      LIMIT 1
    `,
    [userId, normalizedDashboardKey],
  );

  if (dashboardResult.rowCount === 0) {
    throw createHttpError(404, 'Dashboard not found.', { dashboardKey: normalizedDashboardKey });
  }

  const dashboardId = dashboardResult.rows[0].dashboard_id;
  const existingResult = await query(
    `
      SELECT item_id
      FROM skyweb.user_dashboard_items
      WHERE dashboard_id = $1
        AND item_source = $2
        AND (
          ($2 = 'view' AND view_key = $3)
          OR ($2 = 'indicator' AND indicator_code = $4)
        )
      LIMIT 1
    `,
    [dashboardId, item.itemSource, item.viewKey, item.indicatorCode],
  );

  const existingItemId = existingResult.rows[0]?.item_id || null;
  let result;

  if (existingItemId) {
    result = await query(
      `
        UPDATE skyweb.user_dashboard_items
        SET item_title = $2,
            item_note = $3,
            item_mode = $4,
            sort_order = $5,
            position_row = $6,
            position_col = $7,
            width_units = $8,
            height_units = $9,
            updated_at = CURRENT_TIMESTAMP
        WHERE item_id = $1
        RETURNING item_id
      `,
      [
        existingItemId,
        item.itemTitle,
        item.itemNote,
        item.itemMode,
        item.sortOrder,
        item.positionRow,
        item.positionCol,
        item.widthUnits,
        item.heightUnits,
      ],
    );
  } else {
    result = await query(
      `
        INSERT INTO skyweb.user_dashboard_items (
          dashboard_id,
          item_source,
          view_key,
          indicator_code,
          item_title,
          item_note,
          item_mode,
          sort_order,
          position_row,
          position_col,
          width_units,
          height_units
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING item_id
      `,
      [
        dashboardId,
        item.itemSource,
        item.viewKey,
        item.indicatorCode,
        item.itemTitle,
        item.itemNote,
        item.itemMode,
        item.sortOrder,
        item.positionRow,
        item.positionCol,
        item.widthUnits,
        item.heightUnits,
      ],
    );
  }

  const dashboard = await getDashboard(userId, normalizedDashboardKey);
  const itemId = result.rows[0]?.item_id;

  return {
    dashboard,
    item: dashboard.items.find((dashboardItem) => dashboardItem.itemId === itemId) || null,
  };
}

async function updateDashboardItem(userId, dashboardKey, itemId, body = {}) {
  const normalizedDashboardKey = normalizeDashboardKey(dashboardKey);
  const normalizedItemId = normalizeRequiredString(itemId, { fieldName: 'itemId' });
  const patch = normalizeDashboardItemPatchBody(body);

  if (Object.keys(patch).length === 0) {
    const dashboard = await getDashboard(userId, normalizedDashboardKey);
    const item = dashboard?.items.find(
      (dashboardItem) => dashboardItem.itemId === normalizedItemId,
    );

    if (!dashboard || !item) {
      throw createHttpError(404, 'Dashboard item not found.', {
        dashboardKey: normalizedDashboardKey,
        itemId: normalizedItemId,
      });
    }

    return { dashboard, item };
  }

  const assignments = [];
  const values = [userId, normalizedDashboardKey, normalizedItemId];

  if (Object.prototype.hasOwnProperty.call(patch, 'itemTitle')) {
    values.push(patch.itemTitle);
    assignments.push(`item_title = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'itemNote')) {
    values.push(patch.itemNote);
    assignments.push(`item_note = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'itemMode')) {
    values.push(patch.itemMode);
    assignments.push(`item_mode = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'sortOrder')) {
    values.push(patch.sortOrder);
    assignments.push(`sort_order = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'positionRow')) {
    values.push(patch.positionRow);
    assignments.push(`position_row = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'positionCol')) {
    values.push(patch.positionCol);
    assignments.push(`position_col = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'widthUnits')) {
    values.push(patch.widthUnits);
    assignments.push(`width_units = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'heightUnits')) {
    values.push(patch.heightUnits);
    assignments.push(`height_units = $${values.length}`);
  }

  const result = await query(
    `
      UPDATE skyweb.user_dashboard_items item
      SET ${assignments.join(', ')},
          updated_at = CURRENT_TIMESTAMP
      FROM skyweb.user_dashboards dashboard
      WHERE item.dashboard_id = dashboard.dashboard_id
        AND dashboard.user_id = $1
        AND dashboard.dashboard_key = $2
        AND item.item_id = $3
      RETURNING item.item_id
    `,
    values,
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Dashboard item not found.', {
      dashboardKey: normalizedDashboardKey,
      itemId: normalizedItemId,
    });
  }

  const dashboard = await getDashboard(userId, normalizedDashboardKey);

  return {
    dashboard,
    item:
      dashboard.items.find((dashboardItem) => dashboardItem.itemId === normalizedItemId) || null,
  };
}

async function removeDashboardItem(userId, dashboardKey, itemId) {
  const normalizedDashboardKey = normalizeDashboardKey(dashboardKey);
  const normalizedItemId = normalizeRequiredString(itemId, { fieldName: 'itemId' });
  const result = await query(
    `
      DELETE FROM skyweb.user_dashboard_items item
      USING skyweb.user_dashboards dashboard
      WHERE item.dashboard_id = dashboard.dashboard_id
        AND dashboard.user_id = $1
        AND dashboard.dashboard_key = $2
        AND item.item_id = $3
      RETURNING item.item_id
    `,
    [userId, normalizedDashboardKey, normalizedItemId],
  );

  const dashboard = await getDashboard(userId, normalizedDashboardKey);

  return {
    dashboard,
    itemId: normalizedItemId,
    removed: result.rowCount > 0,
  };
}

module.exports = {
  addDashboardItem,
  createDashboard,
  getDashboard,
  listDashboards,
  removeDashboard,
  removeDashboardItem,
  updateDashboard,
  updateDashboardItem,
};
