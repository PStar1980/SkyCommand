const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../');
const seedPath = path.join(
  repositoryRoot,
  'packages/db_build/src/seeds/00159__managed_codex_account_binding_repair.sql',
);
const seed = fs.readFileSync(seedPath, 'utf8');

assert.match(seed, /WHERE installation_code = 'phase19-3a0-managed-codex'/);
assert.match(seed, /IF installation_count <> 1 THEN[\s\S]*?RAISE EXCEPTION/);
assert.match(seed, /IF account_binding_count = 0 THEN[\s\S]*?INSERT INTO core\.agent_runtime_accounts/);
assert.match(seed, /'phase19-3a0-managed-account'/);
assert.match(seed, /'UNCONFIGURED'/);
assert.match(seed, /'openai-managed-codex'/);
assert.match(seed, /'OWNER_ONLY'/);
assert.match(seed, /'phase19\.3a0\.managed-account\.v1'/);
assert.match(seed, /'providerCode', 'OPENAI_CODEX'/);
assert.match(seed, /'authMode', 'chatgptDeviceCode'/);
assert.match(seed, /'managedCredentialStoreReference', 'docker-volume:skycommand_codex_managed_home'/);
assert.match(seed, /'executionEnabled', FALSE/);
assert.match(seed, /\n      FALSE,\n      jsonb_build_object/);
assert.match(seed, /ON CONFLICT \(installation_id, account_code\) DO NOTHING/);
assert.match(seed, /SELECT COUNT\(\*\)::INTEGER[\s\S]*?IF account_binding_count <> 1 THEN[\s\S]*?RAISE EXCEPTION/);
assert.doesNotMatch(seed, /\bUPDATE\s+core\.agent_runtime_accounts\b/i);
assert.doesNotMatch(seed, /ON CONFLICT[\s\S]*?DO UPDATE/i);
assert.doesNotMatch(seed, /\bDELETE\s+FROM\s+core\.agent_runtime_accounts\b/i);

console.log('[managed Codex account-binding repair seed] all contract checks passed');
