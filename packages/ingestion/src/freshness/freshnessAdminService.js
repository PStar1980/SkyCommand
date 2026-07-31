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

function normalizeNullableNonNegativeInteger(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw serviceError(`${field} must be a non-negative integer or null.`);
  }
  return parsed;
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
  return value;
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
  if (!result.rows[0]) {
    throw serviceError(`Data source not found in the selected domain: ${code}`, 404);
  }
  return result.rows[0];
}

async function requireFrequency(client, frequencyCode) {
  const code = normalizeCode(frequencyCode, 'frequencyCode');
  const result = await client.query(
    `SELECT frequency_code FROM data.freshness_frequency_policies WHERE frequency_code = $1 AND active = TRUE LIMIT 1`,
    [code],
  );
  if (!result.rows[0]) throw serviceError(`Freshness frequency policy not found: ${code}`, 404);
  return code;
}

async function requireAsset(client, domainId, assetCode) {
  const code = normalizeCode(assetCode, 'assetCode');
  const result = await client.query(
    `SELECT asset_id, asset_code, configuration FROM data.assets WHERE domain_id = $1 AND asset_code = $2 LIMIT 1`,
    [domainId, code],
  );
  if (!result.rows[0]) throw serviceError(`Data asset not found in the selected domain: ${code}`, 404);
  return result.rows[0];
}

async function listPolicyOptions(filters = {}, options = {}) {
  const client = options.client || getDatabasePool();
  const domainCode = filters.domainCode ? normalizeCode(filters.domainCode, 'domainCode') : null;
  const values = [];
  const domainFilter = domainCode ? `WHERE domain.domain_code = $1` : '';
  if (domainCode) values.push(domainCode);

  const [frequencyResult, sourceResult, assetResult] = await Promise.all([
    client.query(`
      SELECT frequency_code, period_unit_code, period_length, release_lag_days,
             freshness_tolerance_days, active, configuration
      FROM data.freshness_frequency_policies
      ORDER BY frequency_code
    `),
    client.query(`
      SELECT domain.domain_code, source.source_code, source.name AS source_name,
             policy.frequency_code, policy.release_lag_days,
             policy.freshness_tolerance_days, policy.active, policy.configuration
      FROM data.sources source
      JOIN data.domains domain ON domain.domain_id = source.domain_id
      LEFT JOIN data.source_freshness_policies policy ON policy.source_id = source.source_id
      ${domainFilter}
      ORDER BY domain.domain_code, source.source_code, policy.frequency_code NULLS FIRST
    `, values),
    client.query(`
      SELECT domain.domain_code, asset.asset_code, asset.name AS asset_name,
             asset.frequency_code, asset.release_lag_days, asset.freshness_tolerance_days,
             asset.configuration
      FROM data.assets asset
      JOIN data.domains domain ON domain.domain_id = asset.domain_id
      ${domainFilter}
      ORDER BY domain.domain_code, asset.asset_code
    `, values),
  ]);

  return {
    frequencyPolicies: frequencyResult.rows.map((row) => ({
      frequencyCode: row.frequency_code,
      periodUnitCode: row.period_unit_code,
      periodLength: Number(row.period_length),
      releaseLagDays: Number(row.release_lag_days),
      freshnessToleranceDays: Number(row.freshness_tolerance_days),
      active: row.active === true,
      configuration: row.configuration || {},
    })),
    sourcePolicies: sourceResult.rows.map((row) => ({
      domainCode: row.domain_code,
      sourceCode: row.source_code,
      sourceName: row.source_name,
      frequencyCode: row.frequency_code || null,
      releaseLagDays: row.release_lag_days === null ? null : Number(row.release_lag_days),
      freshnessToleranceDays:
        row.freshness_tolerance_days === null ? null : Number(row.freshness_tolerance_days),
      active: row.active === null ? null : row.active === true,
      configuration: row.configuration || {},
    })),
    assetPolicies: assetResult.rows.map((row) => ({
      domainCode: row.domain_code,
      assetCode: row.asset_code,
      assetName: row.asset_name,
      frequencyCode: row.frequency_code || null,
      releaseLagDays: row.release_lag_days === null ? null : Number(row.release_lag_days),
      freshnessToleranceDays:
        row.freshness_tolerance_days === null ? null : Number(row.freshness_tolerance_days),
      publicationStatus: row.configuration?.publicationStatus || null,
    })),
  };
}

async function saveSourcePolicy(domainCode, sourceCode, frequencyCode, payload = {}, options = {}) {
  const releaseLagDays = normalizeNullableNonNegativeInteger(payload.releaseLagDays, 'releaseLagDays');
  const freshnessToleranceDays = normalizeNullableNonNegativeInteger(
    payload.freshnessToleranceDays,
    'freshnessToleranceDays',
  );
  const active = normalizeBoolean(payload.active, true);
  const configuration = normalizeObject(payload.configuration, 'configuration');

  return runManagedWrite(async (client) => {
    const domain = await requireDomain(client, domainCode);
    const source = await requireSource(client, domain.domain_id, sourceCode);
    const frequency = await requireFrequency(client, frequencyCode);

    const result = await client.query(
      `
        INSERT INTO data.source_freshness_policies (
          source_id, frequency_code, release_lag_days, freshness_tolerance_days, active, configuration
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb)
        ON CONFLICT (source_id, frequency_code)
        DO UPDATE SET
          release_lag_days = EXCLUDED.release_lag_days,
          freshness_tolerance_days = EXCLUDED.freshness_tolerance_days,
          active = EXCLUDED.active,
          configuration = EXCLUDED.configuration,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [
        source.source_id,
        frequency,
        releaseLagDays,
        freshnessToleranceDays,
        active,
        JSON.stringify(configuration),
      ],
    );
    return result.rows[0];
  }, options);
}

async function saveAssetPolicy(domainCode, assetCode, payload = {}, options = {}) {
  const releaseLagDays = normalizeNullableNonNegativeInteger(payload.releaseLagDays, 'releaseLagDays');
  const freshnessToleranceDays = normalizeNullableNonNegativeInteger(
    payload.freshnessToleranceDays,
    'freshnessToleranceDays',
  );
  const publicationStatus = payload.publicationStatus
    ? normalizeCode(payload.publicationStatus, 'publicationStatus')
    : null;

  return runManagedWrite(async (client) => {
    const domain = await requireDomain(client, domainCode);
    const asset = await requireAsset(client, domain.domain_id, assetCode);
    const configuration = { ...(asset.configuration || {}) };

    if (publicationStatus) configuration.publicationStatus = publicationStatus;
    else if (payload.publicationStatus === null) delete configuration.publicationStatus;

    const result = await client.query(
      `
        UPDATE data.assets
        SET release_lag_days = $3,
            freshness_tolerance_days = $4,
            configuration = $5::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE domain_id = $1 AND asset_code = $2
        RETURNING *
      `,
      [
        domain.domain_id,
        asset.asset_code,
        releaseLagDays,
        freshnessToleranceDays,
        JSON.stringify(configuration),
      ],
    );
    return result.rows[0];
  }, options);
}

module.exports = {
  listPolicyOptions,
  saveAssetPolicy,
  saveSourcePolicy,
};
