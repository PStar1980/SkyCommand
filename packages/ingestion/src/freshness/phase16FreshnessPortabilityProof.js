const dotenv = require('dotenv');
const { pool, query } = require('../../../db/src/connection');
const dataCatalogueAdminService = require('../catalogue/dataCatalogueAdminService');
const freshnessAdminService = require('./freshnessAdminService');
const freshnessService = require('./freshnessService');

dotenv.config();

function proofCode(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`.toUpperCase();
}

async function runProof() {
  const baselineResult = await query(`
    SELECT COUNT(*)::int AS total
    FROM data.vw_asset_freshness
    WHERE domain_code <> 'MACRO'
  `);
  const baselineNonMacro = Number(baselineResult.rows[0]?.total || 0);

  const domainCode = proofCode('OPERATIONS_PROOF');
  const sourceCode = 'LOCAL_DB';
  const assetCode = 'DAILY_SERVICE_EVENTS';
  const schemaName = `phase16_freshness_proof_${Date.now()}`.toLowerCase();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const txQuery = (text, params) => client.query(text, params);

    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`
      CREATE TABLE "${schemaName}"."service_events" (
        observed_on DATE NOT NULL,
        event_count NUMERIC NOT NULL
      )
    `);
    await client.query(
      `INSERT INTO "${schemaName}"."service_events" (observed_on, event_count)
       VALUES (CURRENT_DATE - 2, 8), (CURRENT_DATE - 1, 11), (CURRENT_DATE, 13)`,
    );

    await dataCatalogueAdminService.saveDomain(
      domainCode,
      {
        name: 'Operations Freshness Portability Proof',
        description: 'Temporary non-macro domain used to prove generic freshness behaviour.',
        schemaName,
        active: true,
      },
      { client },
    );

    await dataCatalogueAdminService.saveSource(
      domainCode,
      sourceCode,
      {
        name: 'Local Operations Database',
        providerName: 'Phase 16 proof fixture',
        providerType: 'DATABASE',
        observabilityEnabled: true,
        active: true,
      },
      { client },
    );

    await dataCatalogueAdminService.saveAsset(
      domainCode,
      assetCode,
      {
        name: 'Daily Service Events',
        assetKindCode: 'TIME_SERIES',
        frequencyCode: 'DAILY',
        storage: {
          schemaName,
          relationName: 'service_events',
          dateColumn: 'observed_on',
          valueColumn: 'event_count',
        },
        source: {
          sourceCode,
          providerAssetCode: 'SERVICE_EVENTS',
        },
        active: true,
      },
      { client },
    );

    await freshnessAdminService.saveSourcePolicy(
      domainCode,
      sourceCode,
      'DAILY',
      { releaseLagDays: 0, freshnessToleranceDays: 1, active: true },
      { client },
    );

    await freshnessService.refreshFreshnessSnapshots({ query: txQuery, persist: true });
    const sourcePolicyItem = await freshnessService.getFreshness(domainCode, assetCode, { query: txQuery });

    if (!sourcePolicyItem) throw new Error('Non-macro freshness item was not discoverable.');
    if (sourcePolicyItem.freshness.reasonCode !== 'CURRENT') {
      throw new Error(`Expected CURRENT non-macro result, got ${sourcePolicyItem.freshness.reasonCode}.`);
    }
    if (sourcePolicyItem.policy.originCode !== 'SOURCE') {
      throw new Error(`Expected SOURCE policy origin, got ${sourcePolicyItem.policy.originCode}.`);
    }

    await freshnessAdminService.saveAssetPolicy(
      domainCode,
      assetCode,
      { releaseLagDays: 1, freshnessToleranceDays: 2 },
      { client },
    );
    await freshnessService.refreshFreshnessSnapshots({ query: txQuery, persist: true });
    const assetPolicyItem = await freshnessService.getFreshness(domainCode, assetCode, { query: txQuery });

    if (assetPolicyItem.policy.originCode !== 'ASSET') {
      throw new Error(`Expected ASSET policy precedence, got ${assetPolicyItem.policy.originCode}.`);
    }

    console.log('\nSkyCommand Phase 16.3.2 non-macro freshness portability proof');
    console.log('-----------------------------------------------------------');
    console.log(`Domain: ${domainCode}`);
    console.log(`Source: ${sourceCode}`);
    console.log(`Asset: ${assetCode}`);
    console.log(`Freshness: ${assetPolicyItem.freshness.reasonCode}`);
    console.log(`Expected latest: ${assetPolicyItem.policy.expectedLatestDate}`);
    console.log(`Target latest: ${assetPolicyItem.evidence.targetLatestDate}`);
    console.log(`Policy origin after source policy: ${sourcePolicyItem.policy.originCode}`);
    console.log(`Policy origin after asset override: ${assetPolicyItem.policy.originCode}`);
    console.log('✅ A non-macro asset received freshness through the same generic engine.');
    console.log('✅ Source-level freshness administration was applied without domain-specific code.');
    console.log('✅ Asset-level policy override correctly took precedence over the source policy.');

    await client.query('ROLLBACK');

    const afterResult = await query(`
      SELECT COUNT(*)::int AS total
      FROM data.vw_asset_freshness
      WHERE domain_code <> 'MACRO'
    `);
    const afterNonMacro = Number(afterResult.rows[0]?.total || 0);
    if (afterNonMacro !== baselineNonMacro) {
      throw new Error(`Rollback mismatch: baseline non-macro count ${baselineNonMacro}, after ${afterNonMacro}.`);
    }

    console.log('✅ Proof transaction rolled back cleanly and catalogue/freshness counts returned to baseline.');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runProof()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`❌ ${error.message}`);
      process.exit(1);
    });
}

module.exports = { runProof };
