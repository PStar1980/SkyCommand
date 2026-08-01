let databaseQuery = null;

function getDatabaseQuery() {
  if (!databaseQuery) {
    ({ query: databaseQuery } = require('../../../db/src/connection'));
  }
  return databaseQuery;
}

function normalizeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return code || null;
}

function normalizeParameters(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function normalizePolicyRow(row = {}) {
  return {
    checkCode: normalizeCode(row.checkCode ?? row.check_code),
    enabled: row.enabled !== false,
    severityCode: normalizeCode(row.severityCode ?? row.severity_code) || 'WARNING',
    blocking: Boolean(row.blocking),
    parameters: normalizeParameters(row.parameters),
    originCode: normalizeCode(row.policyOriginCode ?? row.policy_origin_code) || 'CHECK_DEFAULT',
  };
}

function normalizeQualityContext(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0];
  const checks = {};

  for (const row of rows) {
    const policy = normalizePolicyRow(row);
    if (policy.checkCode) checks[policy.checkCode] = policy;
  }

  const bindingConfiguration = normalizeParameters(
    first.bindingConfiguration ?? first.binding_configuration,
  );

  return {
    domainCode: normalizeCode(first.domainCode ?? first.domain_code),
    sourceCode: normalizeCode(first.sourceCode ?? first.source_code),
    assetCode: normalizeCode(first.assetCode ?? first.asset_code),
    assetFrequencyCode: normalizeCode(first.assetFrequencyCode ?? first.asset_frequency_code),
    sourceFrequencyCode: normalizeCode(first.sourceFrequencyCode ?? first.source_frequency_code),
    assetUnitCode: normalizeCode(first.assetUnitCode ?? first.asset_unit_code),
    sourceUnitCode: normalizeCode(
      first.sourceUnitCode ?? first.source_unit_code ?? bindingConfiguration.unitCode,
    ),
    assetTransformCode: normalizeCode(first.assetTransformCode ?? first.asset_transform_code),
    sourceTransformCode: normalizeCode(first.sourceTransformCode ?? first.source_transform_code),
    bindingConfiguration,
    checks,
  };
}

async function getAssetQualityContext(domainCode, sourceCode, assetCode, options = {}) {
  const domain = normalizeCode(domainCode);
  const source = normalizeCode(sourceCode);
  const asset = normalizeCode(assetCode);
  if (!domain || !source || !asset) {
    throw new Error('domainCode, sourceCode, and assetCode are required to resolve quality policy.');
  }

  const query = options.query || getDatabaseQuery();
  const result = await query(
    `
      SELECT
        domain_code,
        source_code,
        asset_code,
        asset_frequency_code,
        source_frequency_code,
        asset_unit_code,
        binding_configuration,
        asset_transform_code,
        source_transform_code,
        check_code,
        enabled,
        severity_code,
        blocking,
        parameters,
        policy_origin_code
      FROM data.vw_asset_quality_policies
      WHERE domain_code = $1
        AND source_code = $2
        AND asset_code = $3
      ORDER BY check_code
    `,
    [domain, source, asset],
  );

  const context = normalizeQualityContext(result.rows);
  if (!context) {
    const error = new Error(`No active quality-policy context exists for ${domain}/${source}/${asset}.`);
    error.code = 'ASSET_QUALITY_POLICY_MISSING';
    throw error;
  }
  return context;
}

function getCheckPolicy(context, checkCode, fallback = {}) {
  const code = normalizeCode(checkCode);
  const policy = context?.checks?.[code];
  return policy || {
    checkCode: code,
    enabled: fallback.enabled === true,
    severityCode: normalizeCode(fallback.severityCode) || 'WARNING',
    blocking: Boolean(fallback.blocking),
    parameters: normalizeParameters(fallback.parameters),
    originCode: normalizeCode(fallback.originCode) || 'LOADER_DEFAULT',
  };
}

function createMetadataIssue(context, checkCode, message, evidence = {}) {
  const policy = getCheckPolicy(context, checkCode);
  if (!policy.enabled) return null;
  return {
    checkCode: policy.checkCode,
    severityCode: policy.severityCode,
    blocking: policy.blocking,
    observationKey: null,
    sourceRowNumber: null,
    message,
    evidence: {
      ...evidence,
      policyOriginCode: policy.originCode,
      policyParameters: policy.parameters,
    },
  };
}

function buildMetadataQualityIssues(context) {
  if (!context) return [];
  const issues = [];

  if (
    context.assetFrequencyCode
    && context.sourceFrequencyCode
    && context.assetFrequencyCode !== context.sourceFrequencyCode
  ) {
    const issue = createMetadataIssue(
      context,
      'FREQUENCY_INCOMPATIBLE',
      `Source frequency ${context.sourceFrequencyCode} is incompatible with asset frequency ${context.assetFrequencyCode}.`,
      {
        assetFrequencyCode: context.assetFrequencyCode,
        sourceFrequencyCode: context.sourceFrequencyCode,
      },
    );
    if (issue) issues.push(issue);
  }

  if (
    context.assetUnitCode
    && context.sourceUnitCode
    && context.assetUnitCode !== context.sourceUnitCode
  ) {
    const issue = createMetadataIssue(
      context,
      'UNIT_INCOMPATIBLE',
      `Source unit ${context.sourceUnitCode} is incompatible with asset unit ${context.assetUnitCode}.`,
      {
        assetUnitCode: context.assetUnitCode,
        sourceUnitCode: context.sourceUnitCode,
      },
    );
    if (issue) issues.push(issue);
  }

  return issues;
}

module.exports = {
  buildMetadataQualityIssues,
  createMetadataIssue,
  getAssetQualityContext,
  getCheckPolicy,
  normalizePolicyRow,
  normalizeQualityContext,
};
