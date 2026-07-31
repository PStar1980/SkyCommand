#!/usr/bin/env node
const assert = require('assert');
const {
  normalizeCode,
  normalizeBoolean,
  normalizeObject,
} = require('./dataCatalogueAdminService');

function run() {
  assert.strictEqual(normalizeCode('client_services'), 'CLIENT_SERVICES');
  assert.strictEqual(normalizeBoolean('false', true), false);
  assert.deepStrictEqual(normalizeObject(undefined, 'configuration'), {});
  assert.throws(() => normalizeCode('bad-code'), /uppercase letters/);
  assert.throws(() => normalizeObject([], 'configuration'), /JSON object/);
  console.log('✅ Managed portable data catalogue validation self-test passed.');
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { run };
