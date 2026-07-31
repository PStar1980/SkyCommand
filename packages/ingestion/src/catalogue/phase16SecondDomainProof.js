#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const admin = require('./dataCatalogueAdminService');
const reader = require('./dataCatalogueService');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function createPool() {
  return new Pool({
    host: requireEnv('PGHOST'),
    port: Number(process.env.PGPORT || 5432),
    database: requireEnv('PGDATABASE'),
    user: requireEnv('PGUSER'),
    password: requireEnv('PGPASSWORD'),
  });
}

async function runProof() {
  const pool = createPool();
  const client = await pool.connect();
  const suffix = `${Date.now()}_${process.pid}`;
  const domainCode = `CLIENT_SERVICES_PROOF_${suffix}`;
  const sourceCode = 'CASE_SYSTEM';
  const assetCode = 'SERVICE_EPISODES';
  const metricCode = 'SAME_DAY_ACCESS_RATE';
  const query = client.query.bind(client);

  try {
    const baselineDomains = await reader.listDomains({}, { query });
    await client.query('BEGIN');

    await admin.saveDomain(domainCode, {
      name: 'Client Services Portability Proof',
      description: 'Temporary non-macro domain used only for the Phase 16.2 portability proof.',
      active: true,
      configuration: { proof: true },
    }, { client });

    await admin.saveSource(domainCode, sourceCode, {
      name: 'Case Management System',
      providerName: 'Synthetic proof provider',
      providerType: 'DATABASE',
      observabilityEnabled: true,
      active: true,
      configuration: { proof: true },
    }, { client });

    let crossDomainRejected = false;
    try {
      await admin.saveAsset(domainCode, assetCode, {
        name: 'Service Episodes',
        assetKindCode: 'RECORD_SET',
        active: true,
        source: { sourceCode: 'FRED', providerAssetCode: 'invalid_cross_domain_probe' },
      }, { client });
    } catch (error) {
      crossDomainRejected = error.statusCode === 404;
    }
    if (!crossDomainRejected) {
      throw new Error('Managed catalogue validation did not reject a cross-domain source reference.');
    }

    await admin.saveAsset(domainCode, assetCode, {
      name: 'Service Episodes',
      description: 'Synthetic client-service episode record set.',
      assetKindCode: 'RECORD_SET',
      frequencyCode: 'DAILY',
      geographyCode: 'LOCAL',
      criticalityCode: 'STANDARD',
      active: true,
      storage: {
        schemaName: 'proof_client_services',
        relationName: 'service_episodes',
        dateColumn: 'first_contact_date',
        valueColumn: null,
      },
      source: {
        sourceCode,
        providerAssetCode: 'service_episodes',
        providerResourceCode: 'case_management',
        active: true,
      },
      configuration: { proof: true },
    }, { client });

    await admin.saveMetric(domainCode, metricCode, {
      name: 'Same-day Access Rate',
      description: 'Share of service episodes reaching service on the first-contact date.',
      metricKindCode: 'AGGREGATE',
      frequencyCode: 'DAILY',
      unitCode: 'PERCENT',
      definition: {
        operator: 'RATIO',
        numerator: 'same_day_service_episodes',
        denominator: 'served_service_episodes',
      },
      dependencies: [{ assetCode, roleCode: 'INPUT', order: 1 }],
      active: true,
      configuration: { proof: true },
    }, { client });

    const domains = await reader.listDomains({}, { query });
    const assets = await reader.listAssets({ domainCode, limit: 10 }, { query });
    const metrics = await reader.listMetrics({ domainCode, limit: 10 }, { query });

    const domain = domains.find((item) => item.domainCode === domainCode);
    const asset = assets.items.find((item) => item.assetCode === assetCode);
    const metric = metrics.items.find((item) => item.metricCode === metricCode);

    if (!domain || !asset || !metric) {
      throw new Error('Second-domain fixture was not discoverable through the generic catalogue reader.');
    }
    if (asset.source?.sourceCode !== sourceCode || asset.discoverable !== true) {
      throw new Error('Second-domain asset source binding was not discoverable as expected.');
    }
    if (!metric.dependencies.some((dependency) => dependency.assetCode === assetCode)) {
      throw new Error('Second-domain metric dependency was not exposed by the generic catalogue reader.');
    }

    console.log('\nSkyCommand Phase 16.2.2 second-domain catalogue proof');
    console.log('----------------------------------------------------');
    console.log(`Database: ${process.env.PGDATABASE}`);
    console.log(`Domain: ${domain.domainCode}`);
    console.log(`Source: ${asset.source.sourceCode}`);
    console.log(`Asset: ${asset.assetCode} (${asset.assetKindCode})`);
    console.log(`Metric: ${metric.metricCode}`);
    console.log(`Dependency: ${metric.dependencies[0]?.assetCode || 'missing'}`);
    console.log(`Generic contract: ${reader.CATALOGUE_CONTRACT_VERSION}`);
    console.log('✅ Managed validation rejected a cross-domain source reference before discovery.');
    console.log('✅ Non-macro domain, source, asset, and metric are visible through the same generic catalogue service.');
    console.log('✅ No macro schema object or domain-specific route was required.');

    await client.query('ROLLBACK');

    const afterDomains = await reader.listDomains({}, { query });
    const afterAssets = await reader.listAssets({ domainCode, limit: 10 }, { query });
    if (afterDomains.some((item) => item.domainCode === domainCode) || afterAssets.total !== 0) {
      throw new Error('Proof rollback did not remove all temporary catalogue metadata.');
    }
    if (afterDomains.length !== baselineDomains.length) {
      throw new Error('Domain discovery count did not return to baseline after rollback.');
    }
    console.log('✅ Proof transaction rolled back cleanly and catalogue counts returned to baseline.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no-op */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runProof().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { runProof };
