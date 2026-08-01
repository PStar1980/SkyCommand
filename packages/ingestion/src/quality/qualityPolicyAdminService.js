let databasePool = null;

function getDatabasePool() {
  if (!databasePool) {
    ({ pool: databasePool } = require('../../../db/src/connection'));
  }
  return databasePool;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function serviceError(message, statusCode = 400, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeCode(value, field) {
  const code = String(value || '').trim().toUpperCase();
  if (!code || !CODE_PATTERN.test(code)) {
    throw serviceError(`${field} must use uppercase letters, numbers, and underscores and begin with a letter.`);
  }
  return code;
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if ([true, 'true', 't', '1', 1].includes(value)) return true;
  if ([false, 'false', 'f', '0', 0].includes(value)) return false;
  throw serviceError(`Invalid boolean value: ${value}`);
}

function normalizeObject(value, field) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw serviceError(`${field} must be a JSON object.`);
  }
  return { ...value };
}

function normalizeOptionalNonNegativeInteger(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw serviceError(`${field} must be a non-negative integer or null.`);
  }
  return parsed;
}

function normalizeQualityPolicyPayload(checkCode, payload = {}) {
  const check = normalizeCode(checkCode, 'checkCode');
  const enabled = normalizeBoolean(payload.enabled, true);
  const blocking = normalizeBoolean(payload.blocking, false);
  const active = normalizeBoolean(payload.active, true);
  const severityCode = normalizeCode(payload.severityCode || 'WARNING', 'severityCode');
  const parameters = normalizeObject(payload.parameters, 'parameters');

  if (check === 'UNEXPECTED_GAP' && enabled) {
    const maxGapDays = normalizeOptionalNonNegativeInteger(parameters.maxGapDays, 'parameters.maxGapDays');
    if (maxGapDays === null) {
      throw serviceError('UNEXPECTED_GAP requires parameters.maxGapDays when enabled.');
    }
    parameters.maxGapDays = maxGapDays;
  }

  if (check === 'ROW_COUNT_ANOMALY' && enabled) {
    const minRows = normalizeOptionalNonNegativeInteger(parameters.minRows, 'parameters.minRows');
    const maxRows = normalizeOptionalNonNegativeInteger(parameters.maxRows, 'parameters.maxRows');
    if (minRows === null && maxRows === null) {
      throw serviceError('ROW_COUNT_ANOMALY requires parameters.minRows, parameters.maxRows, or both when enabled.');
    }
    if (minRows !== null && maxRows !== null && minRows > maxRows) {
      throw serviceError('parameters.minRows cannot be greater than parameters.maxRows.');
    }
    parameters.minRows = minRows;
    parameters.maxRows = maxRows;
  }

  return {
    checkCode: check,
    enabled,
    severityCode,
    blocking,
    parameters,
    active,
  };
}

async function runManagedWrite(work, options = {}) {
  if (options.client) return work(options.client);
  const client = await getDatabasePool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function requireDomain(client, domainCode) {
  const code = normalizeCode(domainCode, 'domainCode');
  const result = await client.query(
    `SELECT domain_id, domain_code FROM data.domains WHERE domain_code = $1 LIMIT 1`,
    [code],
  );
  if (!result.rows[0]) throw serviceError(`Data domain not found: ${code}`, 404);
  return result.rows[0];
}

async function requireSource(client, domainId, sourceCode) {
  const code = normalizeCode(sourceCode, 'sourceCode');
  const result = await client.query(
    `SELECT source_id, source_code FROM data.sources WHERE domain_id = $1 AND source_code = $2 LIMIT 1`,
    [domainId, code],
  );
  if (!result.rows[0]) throw serviceError(`Data source not found in the selected domain: ${code}`, 404);
  return result.rows[0];
}

async function requireAsset(client, domainId, assetCode) {
  const code = normalizeCode(assetCode, 'assetCode');
  const result = await client.query(
    `SELECT asset_id, asset_code FROM data.assets WHERE domain_id = $1 AND asset_code = $2 LIMIT 1`,
    [domainId, code],
  );
  if (!result.rows[0]) throw serviceError(`Data asset not found in the selected domain: ${code}`, 404);
  return result.rows[0];
}

async function requireCheckAndSeverity(client, checkCode, severityCode) {
  const [checkResult, severityResult] = await Promise.all([
    client.query(
      `SELECT check_code FROM data.ingestion_quality_check_codes WHERE check_code = $1 AND active = TRUE`,
      [checkCode],
    ),
    client.query(
      `SELECT severity_code FROM data.ingestion_quality_severity_codes WHERE severity_code = $1 AND active = TRUE`,
      [severityCode],
    ),
  ]);
  if (!checkResult.rows[0]) throw serviceError(`Unknown or inactive quality check: ${checkCode}`, 404);
  if (!severityResult.rows[0]) throw serviceError(`Unknown or inactive quality severity: ${severityCode}`, 404);
}

function sanitizePolicy(row, originCode) {
  if (!row) return null;
  return {
    domainCode: row.domain_code,
    sourceCode: row.source_code || null,
    assetCode: row.asset_code || null,
    checkCode: row.check_code,
    enabled: row.enabled === true,
    severityCode: row.severity_code,
    blocking: row.blocking === true,
    parameters: row.parameters || {},
    active: row.active === true,
    policyOriginCode: originCode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listPolicyOptions(filters = {}, options = {}) {
  const client = options.client || getDatabasePool();
  const domainCode = filters.domainCode ? normalizeCode(filters.domainCode, 'domainCode') : null;
  const sourceCode = filters.sourceCode ? normalizeCode(filters.sourceCode, 'sourceCode') : null;
  const assetCode = filters.assetCode ? normalizeCode(filters.assetCode, 'assetCode') : null;
  const sourceValues = [];
  const assetValues = [];
  const sourceClauses = [];
  const assetClauses = [];

  if (domainCode) {
    sourceValues.push(domainCode);
    sourceClauses.push(`domain.domain_code = $${sourceValues.length}`);
    assetValues.push(domainCode);
    assetClauses.push(`domain.domain_code = $${assetValues.length}`);
  }
  if (sourceCode) {
    sourceValues.push(sourceCode);
    sourceClauses.push(`source.source_code = $${sourceValues.length}`);
  }
  if (assetCode) {
    assetValues.push(assetCode);
    assetClauses.push(`asset.asset_code = $${assetValues.length}`);
  }

  const sourceWhere = sourceClauses.length ? `WHERE ${sourceClauses.join(' AND ')}` : '';
  const assetWhere = assetClauses.length ? `WHERE ${assetClauses.join(' AND ')}` : '';

  const [checksResult, severitiesResult, sourceResult, assetResult] = await Promise.all([
    client.query(`
      SELECT check_code, name, description, default_severity_code,
             blocking_default, enabled_default, active
      FROM data.ingestion_quality_check_codes
      ORDER BY check_code
    `),
    client.query(`
      SELECT severity_code, name, description, display_order, active
      FROM data.ingestion_quality_severity_codes
      ORDER BY display_order, severity_code
    `),
    client.query(`
      SELECT domain.domain_code, source.source_code, policy.check_code,
             policy.enabled, policy.severity_code, policy.blocking,
             policy.parameters, policy.active, policy.created_at, policy.updated_at
      FROM data.source_quality_policies policy
      JOIN data.sources source ON source.source_id = policy.source_id
      JOIN data.domains domain ON domain.domain_id = source.domain_id
      ${sourceWhere}
      ORDER BY domain.domain_code, source.source_code, policy.check_code
    `, sourceValues),
    client.query(`
      SELECT domain.domain_code, asset.asset_code, policy.check_code,
             policy.enabled, policy.severity_code, policy.blocking,
             policy.parameters, policy.active, policy.created_at, policy.updated_at
      FROM data.asset_quality_policies policy
      JOIN data.assets asset ON asset.asset_id = policy.asset_id
      JOIN data.domains domain ON domain.domain_id = asset.domain_id
      ${assetWhere}
      ORDER BY domain.domain_code, asset.asset_code, policy.check_code
    `, assetValues),
  ]);

  return {
    checks: checksResult.rows.map((row) => ({
      checkCode: row.check_code,
      name: row.name,
      description: row.description,
      defaultSeverityCode: row.default_severity_code,
      blockingDefault: row.blocking_default === true,
      enabledDefault: row.enabled_default === true,
      active: row.active === true,
    })),
    severities: severitiesResult.rows.map((row) => ({
      severityCode: row.severity_code,
      name: row.name,
      description: row.description,
      displayOrder: Number(row.display_order),
      active: row.active === true,
    })),
    sourcePolicies: sourceResult.rows.map((row) => sanitizePolicy(row, 'SOURCE')),
    assetPolicies: assetResult.rows.map((row) => sanitizePolicy(row, 'ASSET')),
  };
}

async function saveSourcePolicy(domainCode, sourceCode, checkCode, payload = {}, options = {}) {
  const policy = normalizeQualityPolicyPayload(checkCode, payload);
  return runManagedWrite(async (client) => {
    const domain = await requireDomain(client, domainCode);
    const source = await requireSource(client, domain.domain_id, sourceCode);
    await requireCheckAndSeverity(client, policy.checkCode, policy.severityCode);

    const result = await client.query(
      `
        INSERT INTO data.source_quality_policies (
          source_id, check_code, enabled, severity_code, blocking, parameters, active
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
        ON CONFLICT (source_id, check_code)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          severity_code = EXCLUDED.severity_code,
          blocking = EXCLUDED.blocking,
          parameters = EXCLUDED.parameters,
          active = EXCLUDED.active,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [
        source.source_id,
        policy.checkCode,
        policy.enabled,
        policy.severityCode,
        policy.blocking,
        JSON.stringify(policy.parameters),
        policy.active,
      ],
    );

    return sanitizePolicy({
      ...result.rows[0],
      domain_code: domain.domain_code,
      source_code: source.source_code,
    }, 'SOURCE');
  }, options);
}

async function saveAssetPolicy(domainCode, assetCode, checkCode, payload = {}, options = {}) {
  const policy = normalizeQualityPolicyPayload(checkCode, payload);
  return runManagedWrite(async (client) => {
    const domain = await requireDomain(client, domainCode);
    const asset = await requireAsset(client, domain.domain_id, assetCode);
    await requireCheckAndSeverity(client, policy.checkCode, policy.severityCode);

    const result = await client.query(
      `
        INSERT INTO data.asset_quality_policies (
          asset_id, check_code, enabled, severity_code, blocking, parameters, active
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
        ON CONFLICT (asset_id, check_code)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          severity_code = EXCLUDED.severity_code,
          blocking = EXCLUDED.blocking,
          parameters = EXCLUDED.parameters,
          active = EXCLUDED.active,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [
        asset.asset_id,
        policy.checkCode,
        policy.enabled,
        policy.severityCode,
        policy.blocking,
        JSON.stringify(policy.parameters),
        policy.active,
      ],
    );

    return sanitizePolicy({
      ...result.rows[0],
      domain_code: domain.domain_code,
      asset_code: asset.asset_code,
    }, 'ASSET');
  }, options);
}

async function getResolvedAssetPolicies(domainCode, assetCode, options = {}) {
  const domain = normalizeCode(domainCode, 'domainCode');
  const asset = normalizeCode(assetCode, 'assetCode');
  const client = options.client || getDatabasePool();
  const result = await client.query(
    `
      SELECT domain_code, source_code, asset_code, check_code, check_name,
             enabled, severity_code, blocking, parameters, policy_origin_code
      FROM data.vw_asset_quality_policies
      WHERE domain_code = $1 AND asset_code = $2
      ORDER BY check_code
    `,
    [domain, asset],
  );
  if (result.rows.length === 0) throw serviceError(`Data asset quality policy not found: ${domain}/${asset}`, 404);
  return result.rows.map((row) => ({
    domainCode: row.domain_code,
    sourceCode: row.source_code,
    assetCode: row.asset_code,
    checkCode: row.check_code,
    checkName: row.check_name,
    enabled: row.enabled === true,
    severityCode: row.severity_code,
    blocking: row.blocking === true,
    parameters: row.parameters || {},
    policyOriginCode: row.policy_origin_code,
  }));
}

module.exports = {
  getResolvedAssetPolicies,
  listPolicyOptions,
  normalizeQualityPolicyPayload,
  saveAssetPolicy,
  saveSourcePolicy,
};
