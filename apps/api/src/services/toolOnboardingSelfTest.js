const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { analyzePackageContent, buildRegistrationPlan } = require('./toolOnboardingService');

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

  const registrationPlan = buildRegistrationPlan({
    session: {
      sessionId: '11111111-1111-4111-8111-111111111111',
      metadata: {
        findings: valid.findings.map(({ severity, code, message }) => ({
          severity,
          code,
          message,
        })),
      },
      files: {
        script: {
          filename: 'tool.js',
          content: readTemplate('tool.js'),
        },
        descriptor: {
          filename: 'skycommand.tool.json',
          content: readTemplate('skycommand.tool.json'),
        },
        schema: {
          filename: 'example_greeting_summary.v1.schema.json',
          content: readTemplate('example_greeting_summary.v1.schema.json'),
        },
      },
    },
    payload: {
      toolCode: 'example_greeting',
      name: 'example_greeting',
      label: 'Example Greeting',
      description: 'Creates a greeting.',
      categoryId: '22222222-2222-4222-8222-222222222222',
      scriptRepoId: '33333333-3333-4333-8333-333333333333',
      scriptPath: 'packages/tools/custom/example_greeting/tool.js',
      runtimeCode: 'node',
      permissionCode: 'CORE_VIEW_TOOLS',
      riskCode: 'low',
      requiresConfirmation: false,
      confirmationText: null,
      capturesOutput: true,
      allowParams: true,
      displayOrder: 999,
      enabled: false,
      outputType: 'example_greeting_summary.v1',
      outputSchemaPath:
        'packages/tools/custom/example_greeting/example_greeting_summary.v1.schema.json',
      visibility: ['admin-web', 'api', 'cli', 'worker'],
      parameters: [
        {
          parameterName: 'name',
          label: 'Name',
          paramTypeCode: 'string',
          prompt: 'Enter a name.',
          required: false,
          defaultValue: 'SkyCommand',
          optionSourceCode: null,
          displayOrder: 1,
          enabled: true,
          options: [],
        },
      ],
    },
    readiness: {
      managedToolsRelativePath: 'packages/tools/custom',
      path: { managedToolsRoot: '/tmp/skycommand/packages/tools/custom' },
    },
    catalogueOptions: {
      categories: [
        {
          categoryId: '22222222-2222-4222-8222-222222222222',
          categoryCode: 'file_tools',
        },
      ],
      runtimes: [{ runtimeCode: 'node', executable: 'node' }],
    },
  });

  assert.strictEqual(registrationPlan.status, 'READY');
  assert.strictEqual(registrationPlan.canRegister, true);
  assert.strictEqual(
    registrationPlan.paths.scriptRelativePath,
    'packages/tools/custom/example_greeting/tool.js',
  );
  assert.strictEqual(registrationPlan.databasePreview.tool.enabled, false);
  assert.strictEqual(registrationPlan.descriptor.toolCode, 'example_greeting');
  assert.strictEqual(registrationPlan.files.length, 3);
  assert.strictEqual(registrationPlan.fingerprint.length, 64);

  console.log('Tool onboarding static-analysis and registration-plan self-test passed.');
}

run();
