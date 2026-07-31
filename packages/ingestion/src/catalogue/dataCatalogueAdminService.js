let databasePool = null;

function getDatabasePool() {
  if (!databasePool) {
    ({ pool: databasePool } = require('../../../db/src/connection'));
  }

  return databasePool;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const CONTRACT_PATTERN = /^[a-z][a-z0-9_]*(\.v[1-9][0-9]*)?$/;

function serviceError(message, statusCode = 400, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function normalizeText(value, { required = false, field = 'value' } = {}) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (required && !text) {
    throw serviceError(`${field} is required.`);
  }
  return text || null;
}

function normalizeCode(value, { required = true, field = 'code' } = {}) {
  const text = normalizeText(value, { required, field });
  if (!text) {
    return null;
  }

  const code = text.toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw serviceError(`${field} must use uppercase letters, numbers, and underscores and begin with a letter.`);
  }
  return code;
}

function normalizeContractVersion(value, fallback) {
  const text = normalizeText(value) || fallback;
  if (!CONTRACT_PATTERN.test(text)) {
    throw serviceError('contractVersion is not a valid portable contract identifier.');
  }
  return text;
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if ([true, 'true', 't', '1', 1].includes(value)) return true;
  if ([false, 'false', 'f', '0', 0].includes(value)) return false;
  throw serviceError(`Invalid boolean value: ${value}`);
}

function normalizeNonNegativeInteger(value, field) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw serviceError(`${field} must be a non-negative integer.`);
  }
  return parsed;
}

function normalizePositiveInteger(value, field, fallback = 1) {
  const resolved = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw serviceError(`${field} must be a positive integer.`);
  }
  return resolved;
}

function normalizeObject(value, field) {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw serviceError(`${field} must be a JSON object.`);
  }
  return value;
}

function normalizeNullableBoolean(value, field) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return normalizeBoolean(value, null, field);
}

async function runManagedWrite(work, options = {}) {
  if (options.client) {
    return work(options.client);
  }

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
  const code = normalizeCode(domainCode, { field: 'domainCode' });
  const result = await client.query(
    `SELECT * FROM data.domains WHERE domain_code = $1 LIMIT 1`,
    [code],
  );
  if (!result.rows[0]) {
    throw serviceError(`Data domain not found: ${code}`, 404);
  }
  return result.rows[0];
}

async function requireSource(client, domainId, sourceCode) {
  const code = normalizeCode(sourceCode, { field: 'sourceCode' });
  const result = await client.query(
    `SELECT * FROM data.sources WHERE domain_id = $1 AND source_code = $2 LIMIT 1`,
    [domainId, code],
  );
  if (!result.rows[0]) {
    throw serviceError(`Data source not found in the selected domain: ${code}`, 404);
  }
  return result.rows[0];
}

async function saveDomain(domainCode, payload = {}, options = {}) {
  const code = normalizeCode(domainCode, { field: 'domainCode' });
  const name = normalizeText(payload.name || payload.domainName, {
    required: true,
    field: 'name',
  });
  const description = normalizeText(payload.description);
  const schemaName = normalizeText(payload.schemaName);
  const contractVersion = normalizeContractVersion(payload.contractVersion, 'data_domain.v1');
  const active = normalizeBoolean(payload.active, true);
  const configuration = normalizeObject(payload.configuration, 'configuration');

  return runManagedWrite(async (client) => {
    const result = await client.query(
      `
        INSERT INTO data.domains (
          domain_code, name, description, schema_name, contract_version, active, configuration
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (domain_code)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          schema_name = EXCLUDED.schema_name,
          contract_version = EXCLUDED.contract_version,
          active = EXCLUDED.active,
          configuration = EXCLUDED.configuration,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [code, name, description, schemaName, contractVersion, active, JSON.stringify(configuration)],
    );
    return result.rows[0];
  }, options);
}

async function saveSource(domainCode, sourceCode, payload = {}, options = {}) {
  const code = normalizeCode(sourceCode, { field: 'sourceCode' });
  const name = normalizeText(payload.name || payload.sourceName, { required: true, field: 'name' });
  const providerName = normalizeText(payload.providerName);
  const providerType = normalizeCode(payload.providerType || 'OTHER', { field: 'providerType' });
  const description = normalizeText(payload.description);
  const observabilityEnabled = normalizeBoolean(payload.observabilityEnabled, true);
  const active = normalizeBoolean(payload.active, true);
  const configuration = normalizeObject(payload.configuration, 'configuration');

  return runManagedWrite(async (client) => {
    const domain = await requireDomain(client, domainCode);
    const result = await client.query(
      `
        INSERT INTO data.sources (
          domain_id, source_code, name, provider_name, provider_type,
          description, observability_enabled, active, configuration
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (domain_id, source_code)
        DO UPDATE SET
          name = EXCLUDED.name,
          provider_name = EXCLUDED.provider_name,
          provider_type = EXCLUDED.provider_type,
          description = EXCLUDED.description,
          observability_enabled = EXCLUDED.observability_enabled,
          active = EXCLUDED.active,
          configuration = EXCLUDED.configuration,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [
        domain.domain_id,
        code,
        name,
        providerName,
        providerType,
        description,
        observabilityEnabled,
        active,
        JSON.stringify(configuration),
      ],
    );
    return result.rows[0];
  }, options);
}

async function saveAsset(domainCode, assetCode, payload = {}, options = {}) {
  const code = normalizeCode(assetCode, { field: 'assetCode' });
  const name = normalizeText(payload.name || payload.assetName, { required: true, field: 'name' });
  const description = normalizeText(payload.description || payload.assetDescription);
  const assetKindCode = normalizeCode(payload.assetKindCode || 'TIME_SERIES', { field: 'assetKindCode' });
  const frequencyCode = normalizeCode(payload.frequencyCode, { required: false, field: 'frequencyCode' });
  const unitCode = normalizeCode(payload.unitCode, { required: false, field: 'unitCode' });
  const scaleCode = normalizeCode(payload.scaleCode, { required: false, field: 'scaleCode' });
  const geographyCode = normalizeCode(payload.geographyCode, { required: false, field: 'geographyCode' });
  const seasonalAdjustmentCode = normalizeCode(payload.seasonalAdjustmentCode, {
    required: false,
    field: 'seasonalAdjustmentCode',
  });
  const transformCode = normalizeCode(payload.transformCode, { required: false, field: 'transformCode' });
  const releaseLagDays = normalizeNonNegativeInteger(payload.releaseLagDays, 'releaseLagDays');
  const freshnessToleranceDays = normalizeNonNegativeInteger(
    payload.freshnessToleranceDays,
    'freshnessToleranceDays',
  );
  const revisionsExpected = normalizeNullableBoolean(payload.revisionsExpected, 'revisionsExpected');
  const criticalityCode = normalizeCode(payload.criticalityCode || 'STANDARD', { field: 'criticalityCode' });
  const storage = normalizeObject(payload.storage, 'storage');
  const contractVersion = normalizeContractVersion(payload.contractVersion, 'data_asset.v1');
  const active = normalizeBoolean(payload.active, true);
  const configuration = normalizeObject(payload.configuration, 'configuration');
  const source = payload.source ? normalizeObject(payload.source, 'source') : null;

  return runManagedWrite(async (client) => {
    const domain = await requireDomain(client, domainCode);

    const kind = await client.query(
      `SELECT asset_kind_code FROM data.asset_kinds WHERE asset_kind_code = $1 AND active = TRUE`,
      [assetKindCode],
    );
    if (!kind.rows[0]) {
      throw serviceError(`Unknown or inactive asset kind: ${assetKindCode}`);
    }

    const result = await client.query(
      `
        INSERT INTO data.assets (
          domain_id, asset_code, name, description, asset_kind_code, frequency_code,
          unit_code, scale_code, geography_code, seasonal_adjustment_code, transform_code,
          release_lag_days, freshness_tolerance_days, revisions_expected, criticality_code,
          storage_schema_name, storage_relation_name, storage_date_column, storage_value_column,
          contract_version, active, configuration
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb
        )
        ON CONFLICT (domain_id, asset_code)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          asset_kind_code = EXCLUDED.asset_kind_code,
          frequency_code = EXCLUDED.frequency_code,
          unit_code = EXCLUDED.unit_code,
          scale_code = EXCLUDED.scale_code,
          geography_code = EXCLUDED.geography_code,
          seasonal_adjustment_code = EXCLUDED.seasonal_adjustment_code,
          transform_code = EXCLUDED.transform_code,
          release_lag_days = EXCLUDED.release_lag_days,
          freshness_tolerance_days = EXCLUDED.freshness_tolerance_days,
          revisions_expected = EXCLUDED.revisions_expected,
          criticality_code = EXCLUDED.criticality_code,
          storage_schema_name = EXCLUDED.storage_schema_name,
          storage_relation_name = EXCLUDED.storage_relation_name,
          storage_date_column = EXCLUDED.storage_date_column,
          storage_value_column = EXCLUDED.storage_value_column,
          contract_version = EXCLUDED.contract_version,
          active = EXCLUDED.active,
          configuration = EXCLUDED.configuration,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [
        domain.domain_id,
        code,
        name,
        description,
        assetKindCode,
        frequencyCode,
        unitCode,
        scaleCode,
        geographyCode,
        seasonalAdjustmentCode,
        transformCode,
        releaseLagDays,
        freshnessToleranceDays,
        revisionsExpected,
        criticalityCode,
        normalizeText(storage.schemaName),
        normalizeText(storage.relationName),
        normalizeText(storage.dateColumn),
        normalizeText(storage.valueColumn),
        contractVersion,
        active,
        JSON.stringify(configuration),
      ],
    );

    const asset = result.rows[0];

    if (source) {
      const sourceCode = normalizeCode(source.sourceCode, { field: 'source.sourceCode' });
      const sourceRecord = await requireSource(client, domain.domain_id, sourceCode);
      const providerAssetCode = normalizeText(source.providerAssetCode, {
        required: true,
        field: 'source.providerAssetCode',
      });
      const bindingConfiguration = normalizeObject(source.configuration, 'source.configuration');

      const existingPrimary = await client.query(
        `SELECT binding_id FROM data.asset_source_bindings WHERE asset_id = $1 AND primary_binding = TRUE LIMIT 1`,
        [asset.asset_id],
      );

      if (existingPrimary.rows[0]) {
        await client.query(
          `
            UPDATE data.asset_source_bindings
            SET source_id = $2,
                provider_asset_code = $3,
                provider_resource_code = $4,
                provider_locator = $5,
                source_frequency_code = $6,
                transform_code = $7,
                active = $8,
                configuration = $9::jsonb,
                updated_at = CURRENT_TIMESTAMP
            WHERE binding_id = $1
          `,
          [
            existingPrimary.rows[0].binding_id,
            sourceRecord.source_id,
            providerAssetCode,
            normalizeText(source.providerResourceCode),
            normalizeText(source.providerLocator),
            normalizeCode(source.sourceFrequencyCode, { required: false, field: 'source.sourceFrequencyCode' }),
            normalizeCode(source.transformCode, { required: false, field: 'source.transformCode' }),
            normalizeBoolean(source.active, true),
            JSON.stringify(bindingConfiguration),
          ],
        );
      } else {
        await client.query(
          `
            INSERT INTO data.asset_source_bindings (
              asset_id, source_id, provider_asset_code, provider_resource_code, provider_locator,
              source_frequency_code, transform_code, primary_binding, active, configuration
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9::jsonb)
          `,
          [
            asset.asset_id,
            sourceRecord.source_id,
            providerAssetCode,
            normalizeText(source.providerResourceCode),
            normalizeText(source.providerLocator),
            normalizeCode(source.sourceFrequencyCode, { required: false, field: 'source.sourceFrequencyCode' }),
            normalizeCode(source.transformCode, { required: false, field: 'source.transformCode' }),
            normalizeBoolean(source.active, true),
            JSON.stringify(bindingConfiguration),
          ],
        );
      }
    }

    return asset;
  }, options);
}

async function saveMetric(domainCode, metricCode, payload = {}, options = {}) {
  const code = normalizeCode(metricCode, { field: 'metricCode' });
  const name = normalizeText(payload.name || payload.metricName, { required: true, field: 'name' });
  const description = normalizeText(payload.description || payload.metricDescription);
  const metricKindCode = normalizeCode(payload.metricKindCode || 'KPI', { field: 'metricKindCode' });
  const frequencyCode = normalizeCode(payload.frequencyCode, { required: false, field: 'frequencyCode' });
  const unitCode = normalizeCode(payload.unitCode, { required: false, field: 'unitCode' });
  const scaleCode = normalizeCode(payload.scaleCode, { required: false, field: 'scaleCode' });
  const definition = normalizeObject(payload.definition, 'definition');
  const contractVersion = normalizeContractVersion(payload.contractVersion, 'data_metric.v1');
  const active = normalizeBoolean(payload.active, true);
  const configuration = normalizeObject(payload.configuration, 'configuration');
  const dependencies = payload.dependencies === undefined ? [] : payload.dependencies;

  if (!Array.isArray(dependencies)) {
    throw serviceError('dependencies must be an array.');
  }

  return runManagedWrite(async (client) => {
    const domain = await requireDomain(client, domainCode);
    const kind = await client.query(
      `SELECT metric_kind_code FROM data.metric_kinds WHERE metric_kind_code = $1 AND active = TRUE`,
      [metricKindCode],
    );
    if (!kind.rows[0]) {
      throw serviceError(`Unknown or inactive metric kind: ${metricKindCode}`);
    }

    const result = await client.query(
      `
        INSERT INTO data.metrics (
          domain_id, metric_code, name, description, metric_kind_code, frequency_code,
          unit_code, scale_code, definition, contract_version, active, configuration
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb)
        ON CONFLICT (domain_id, metric_code)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          metric_kind_code = EXCLUDED.metric_kind_code,
          frequency_code = EXCLUDED.frequency_code,
          unit_code = EXCLUDED.unit_code,
          scale_code = EXCLUDED.scale_code,
          definition = EXCLUDED.definition,
          contract_version = EXCLUDED.contract_version,
          active = EXCLUDED.active,
          configuration = EXCLUDED.configuration,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [
        domain.domain_id,
        code,
        name,
        description,
        metricKindCode,
        frequencyCode,
        unitCode,
        scaleCode,
        JSON.stringify(definition),
        contractVersion,
        active,
        JSON.stringify(configuration),
      ],
    );

    const metric = result.rows[0];
    await client.query(`DELETE FROM data.metric_dependencies WHERE metric_id = $1`, [metric.metric_id]);

    for (let index = 0; index < dependencies.length; index += 1) {
      const dependency = normalizeObject(dependencies[index], `dependencies[${index}]`);
      const roleCode = normalizeCode(dependency.roleCode || 'INPUT', {
        field: `dependencies[${index}].roleCode`,
      });
      const dependencyOrder = normalizePositiveInteger(
        dependency.order,
        `dependencies[${index}].order`,
        index + 1,
      );
      const dependencyConfiguration = normalizeObject(
        dependency.configuration,
        `dependencies[${index}].configuration`,
      );
      let assetId = null;
      let dependsOnMetricId = null;

      if (dependency.assetCode && dependency.metricCode) {
        throw serviceError(`dependencies[${index}] must reference either assetCode or metricCode, not both.`);
      }

      if (dependency.assetCode) {
        const assetCode = normalizeCode(dependency.assetCode, {
          field: `dependencies[${index}].assetCode`,
        });
        const assetResult = await client.query(
          `SELECT asset_id FROM data.assets WHERE domain_id = $1 AND asset_code = $2 LIMIT 1`,
          [domain.domain_id, assetCode],
        );
        if (!assetResult.rows[0]) {
          throw serviceError(`Metric dependency asset not found in domain ${domain.domain_code}: ${assetCode}`);
        }
        assetId = assetResult.rows[0].asset_id;
      } else if (dependency.metricCode) {
        const dependencyMetricCode = normalizeCode(dependency.metricCode, {
          field: `dependencies[${index}].metricCode`,
        });
        if (dependencyMetricCode === code) {
          throw serviceError('A metric cannot depend on itself.');
        }
        const metricResult = await client.query(
          `SELECT metric_id FROM data.metrics WHERE domain_id = $1 AND metric_code = $2 LIMIT 1`,
          [domain.domain_id, dependencyMetricCode],
        );
        if (!metricResult.rows[0]) {
          throw serviceError(
            `Metric dependency metric not found in domain ${domain.domain_code}: ${dependencyMetricCode}`,
          );
        }
        dependsOnMetricId = metricResult.rows[0].metric_id;
      } else {
        throw serviceError(`dependencies[${index}] must include assetCode or metricCode.`);
      }

      await client.query(
        `
          INSERT INTO data.metric_dependencies (
            metric_id, asset_id, depends_on_metric_id, dependency_role_code,
            dependency_order, active, configuration
          )
          VALUES ($1,$2,$3,$4,$5,TRUE,$6::jsonb)
        `,
        [
          metric.metric_id,
          assetId,
          dependsOnMetricId,
          roleCode,
          dependencyOrder,
          JSON.stringify(dependencyConfiguration),
        ],
      );
    }

    return metric;
  }, options);
}

async function listAdminOptions(domainCode = null) {
  const pool = getDatabasePool();
  const values = [];
  let sourceWhere = '';
  if (domainCode) {
    values.push(normalizeCode(domainCode, { field: 'domainCode' }));
    sourceWhere = 'WHERE domain.domain_code = $1';
  }

  const [domains, sources, assetKinds, metricKinds] = await Promise.all([
    pool.query(`SELECT domain_id, domain_code, name, active FROM data.domains ORDER BY domain_code`),
    pool.query(
      `
        SELECT source.source_id, domain.domain_code, source.source_code, source.name,
               source.provider_type, source.observability_enabled, source.active
        FROM data.sources source
        JOIN data.domains domain ON domain.domain_id = source.domain_id
        ${sourceWhere}
        ORDER BY domain.domain_code, source.source_code
      `,
      values,
    ),
    pool.query(`SELECT asset_kind_code, name, active FROM data.asset_kinds ORDER BY asset_kind_code`),
    pool.query(`SELECT metric_kind_code, name, active FROM data.metric_kinds ORDER BY metric_kind_code`),
  ]);

  return {
    domains: domains.rows,
    sources: sources.rows,
    assetKinds: assetKinds.rows,
    metricKinds: metricKinds.rows,
  };
}

module.exports = {
  normalizeText,
  normalizeCode,
  normalizeBoolean,
  normalizeObject,
  saveDomain,
  saveSource,
  saveAsset,
  saveMetric,
  listAdminOptions,
  serviceError,
};
