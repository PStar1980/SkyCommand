const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { analyzePackageContent } = require('./toolOnboardingService');

function readTemplate(filename) {
  return fs.readFileSync(
    path.resolve(process.cwd(), 'packages', 'tools', 'custom', '_template', filename),
    'utf8',
  );
}

function run() {
  const valid = analyzePackageContent({
    script: { filename: 'tool.js', content: readTemplate('tool.js') },
    descriptor: {
      filename: 'skycommand.tool.json',
      content: readTemplate('skycommand.tool.json'),
    },
    schema: {
      filename: 'example_greeting_summary.v1.schema.json',
      content: readTemplate('example_greeting_summary.v1.schema.json'),
    },
  });

  assert.strictEqual(valid.summary.status, 'READY');
  assert.strictEqual(valid.summary.error, 0);
  assert.strictEqual(valid.suggestions.toolCode, 'example_greeting');
  assert.strictEqual(valid.suggestions.parameters.length, 1);
  assert.strictEqual(valid.analysis, undefined);
  assert.strictEqual(valid.sourceAnalysis.usesRunToolCli, true);
  assert.strictEqual(valid.schemaAnalysis.rootType, 'object');

  const invalid = analyzePackageContent({
    script: {
      filename: 'bad.js',
      content: 'const broken = ;\nconsole.log(process.env);\n',
    },
    schema: {
      filename: 'bad.schema.json',
      content: JSON.stringify({
        type: 'object',
        properties: { item: { $ref: 'https://example.com/schema' } },
      }),
    },
  });

  assert.strictEqual(invalid.summary.status, 'BLOCKED');
  assert.ok(invalid.findings.some((finding) => finding.code === 'SCRIPT_SYNTAX_INVALID'));
  assert.ok(
    invalid.findings.some((finding) => finding.code === 'SCHEMA_REMOTE_REFERENCE_FORBIDDEN'),
  );

  console.log('Tool onboarding static-analysis self-test passed.');
}

run();
