const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { repositoryRoot } = require('../../../../_support/sourceTestBootstrap.js');
const gate = require(path.join(repositoryRoot, 'packages/dev-finalization/src/secretLeakGate.js'));
const { writeZipArchive } = require(path.join(repositoryRoot, 'packages/files/src/generateRepoZip.js'));
const { runToolCli } = require(path.join(repositoryRoot, 'packages/tools/src/toolCliAdapter.js'));

function token(parts) {
  return parts.join('');
}

async function buildFixture({ sourceText = 'const value = 42;\n', mapText = '# map\n', archiveText = 'safe archive text' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-secret-leak-gate-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), sourceText);
  fs.writeFileSync(path.join(root, '.env.example'), 'API_TOKEN=${API_TOKEN}\nPASSWORD=CHANGE_ME\n');
  fs.writeFileSync(path.join(root, 'catalog.json'), '{"status":"safe"}\n');
  fs.writeFileSync(path.join(root, 'map.md'), mapText);

  const archiveEntryPath = path.join(root, 'archive-entry.txt');
  fs.writeFileSync(archiveEntryPath, archiveText);
  await writeZipArchive(
    [{ fullPath: archiveEntryPath, relativePath: 'archive-entry.txt' }],
    'fixture',
    path.join(root, 'catalog.xlsx'),
  );
  await writeZipArchive(
    [{ fullPath: archiveEntryPath, relativePath: 'archive-entry.txt' }],
    'fixture',
    path.join(root, 'repo.zip'),
  );

  const artifacts = {
    capabilityCatalogJsonPath: 'catalog.json',
    capabilityCatalogXlsxPath: 'catalog.xlsx',
    repositoryMapPath: 'map.md',
    repositoryZipPath: 'repo.zip',
  };
  const dependencies = {
    repositoryRoot: root,
    getGitStatusOutput: () => Buffer.from('?? src/app.js\0'),
  };
  return { root, artifacts, dependencies };
}

async function run() {
  const cleanFixture = await buildFixture();
  const clean = gate.inspectPromotionScope({
    repositoryRoot: cleanFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: cleanFixture.artifacts,
    dependencies: cleanFixture.dependencies,
  });
  assert.equal(clean.ok, true);
  assert.equal(clean.outcome, 'PASS');

  const safeFixture = await buildFixture({
    sourceText: [
      'const sha256 = 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef;',
      'const requestId = 00000000-0000-4000-8000-000000000001;',
    ].join('\n'),
  });
  const safe = gate.inspectPromotionScope({
    repositoryRoot: safeFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: safeFixture.artifacts,
    dependencies: safeFixture.dependencies,
  });
  assert.equal(safe.ok, true);

  const codeReferenceFixture = await buildFixture({
    sourceText: [
      'const token = api.getSessionToken();',
      "const password = requireEnv('PGPASSWORD');",
      'const authorization = safeObject(requestContext.authorization);',
      'const credential = managedCredential;',
      "const category = /password|passwd/i.test(key) ? 'PASSWORD' : 'CREDENTIAL_VALUE';",
    ].join('\n'),
  });
  const codeReference = gate.inspectPromotionScope({
    repositoryRoot: codeReferenceFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: codeReferenceFixture.artifacts,
    dependencies: codeReferenceFixture.dependencies,
  });
  assert.equal(codeReference.ok, true);

  const integrityFixture = await buildFixture({
    archiveText: '"integrity": "sha512-is96t8F/1//UHAjNPHpbsNY46ELPpftGUoSVNXwUfMk/qdjSylYrWSu1XavVTBOn526kFiOR733ATgNBCQyH0g=="',
  });
  const integrity = gate.inspectPromotionScope({
    repositoryRoot: integrityFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: integrityFixture.artifacts,
    dependencies: integrityFixture.dependencies,
  });
  assert.equal(integrity.ok, true);

  const bearerPlaceholderFixture = await buildFixture({
    sourceText: "const headers = { authorization: 'Bearer must-not-be-audit-value' };\n",
  });
  const bearerPlaceholder = gate.inspectPromotionScope({
    repositoryRoot: bearerPlaceholderFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: bearerPlaceholderFixture.artifacts,
    dependencies: bearerPlaceholderFixture.dependencies,
  });
  assert.equal(bearerPlaceholder.ok, true);

  const literalCredentialFixture = await buildFixture({
    sourceText: `const credential = '${token(['N7vQ2mX9pL4s', 'K8dR6wT3zB5c'])}';\n`,
  });
  const literalCredential = gate.inspectPromotionScope({
    repositoryRoot: literalCredentialFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: literalCredentialFixture.artifacts,
    dependencies: literalCredentialFixture.dependencies,
  });
  assert.equal(literalCredential.ok, false);
  assert.ok(literalCredential.findings.some((finding) => finding.ruleId === 'CREDENTIAL_LIKE_ASSIGNMENT'));

  const providerFixture = await buildFixture({
    sourceText: `const tokenValue = '${token(['sk-', 'proj-', 'A'.repeat(32)])}';\n`,
  });
  const provider = gate.inspectPromotionScope({
    repositoryRoot: providerFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: providerFixture.artifacts,
    dependencies: providerFixture.dependencies,
  });
  assert.equal(provider.ok, false);
  assert.ok(provider.findings.some((finding) => finding.ruleId === 'OPENAI_TOKEN'));

  const githubFixture = await buildFixture({
    sourceText: `const tokenValue = '${token(['ghp_', 'B'.repeat(32)])}';\n`,
  });
  const github = gate.inspectPromotionScope({
    repositoryRoot: githubFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: githubFixture.artifacts,
    dependencies: githubFixture.dependencies,
  });
  assert.equal(github.ok, false);
  assert.ok(github.findings.some((finding) => finding.ruleId === 'GITHUB_TOKEN'));

  const privateKeyFixture = await buildFixture({
    sourceText: ['-----BEGIN RSA ', 'PRIVATE KEY-----', '\n'].join(''),
  });
  const privateKey = gate.inspectPromotionScope({
    repositoryRoot: privateKeyFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: privateKeyFixture.artifacts,
    dependencies: privateKeyFixture.dependencies,
  });
  assert.equal(privateKey.ok, false);
  assert.ok(privateKey.findings.some((finding) => finding.ruleId === 'PRIVATE_KEY_MARKER'));

  const filenameFixture = await buildFixture();
  fs.writeFileSync(path.join(filenameFixture.root, '.env'), '');
  filenameFixture.dependencies.getGitStatusOutput = () => Buffer.from('?? .env\0?? src/app.js\0');
  const filename = gate.inspectPromotionScope({
    repositoryRoot: filenameFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: filenameFixture.artifacts,
    dependencies: filenameFixture.dependencies,
  });
  assert.ok(filename.findings.some((finding) => finding.ruleId === 'TRACKED_SECRET_ENV_FILE'));

  const archiveFixture = await buildFixture({
    archiveText: `credential = ${token(['ghp_', 'C'.repeat(32)])}`,
  });
  const archive = gate.inspectPromotionScope({
    repositoryRoot: archiveFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: archiveFixture.artifacts,
    dependencies: archiveFixture.dependencies,
  });
  assert.ok(archive.findings.some((finding) => finding.ruleId === 'GITHUB_TOKEN'));
  const archiveSerialized = JSON.stringify(archive);
  assert.equal(archiveSerialized.includes(token(['ghp_', 'C'.repeat(32)])), false);

  const artifactFixture = await buildFixture({
    mapText: `ACCESS_TOKEN=${token(['D'.repeat(32), 'E'.repeat(16)])}\n`,
  });
  const artifactFinding = gate.inspectPromotionScope({
    repositoryRoot: artifactFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: artifactFixture.artifacts,
    dependencies: artifactFixture.dependencies,
  });
  assert.equal(artifactFinding.ok, false);
  assert.ok(artifactFinding.findings.some((finding) => finding.ruleId === 'CREDENTIAL_LIKE_ASSIGNMENT'));

  const driftFixture = await buildFixture();
  const baseline = gate.inspectPromotionScope({
    repositoryRoot: driftFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: driftFixture.artifacts,
    dependencies: driftFixture.dependencies,
  });
  fs.writeFileSync(path.join(driftFixture.root, 'src', 'app.js'), 'const changed = true;\n');
  const drifted = gate.inspectPromotionScope({
    repositoryRoot: driftFixture.root,
    repositoryName: 'fixture',
    workflowRunId: 'fixture-run',
    artifactPaths: driftFixture.artifacts,
    expectedSourceIdentityDigest: baseline.sourceIdentityDigest,
    expectedArtifactIdentityDigest: baseline.artifactIdentityDigest,
    dependencies: driftFixture.dependencies,
  });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.blockedReason, 'SOURCE_IDENTITY_DRIFT');

  const scannerErrorSecret = token(['sk-', 'proj-', 'E'.repeat(32)]);
  const logs = [];
  const runToolResult = await runToolCli({
    toolCode: gate.TOOL_CODE,
    outputType: gate.OUTPUT_TYPE,
    execute: async () => {
      throw new gate.SecretLeakGateError('SECRET_LEAK_GATE_ZIP_INSPECTION_FAILED', 'safe scanner error');
    },
    createToolResult: gate.createSecretLeakGateToolResult,
    createFailureToolResult: (error) => gate.createSecretLeakGateFailureToolResult({ error }),
    emitResult: () => null,
    logger: (...values) => logs.push(values.join(' ')),
    setExitCode: () => {},
  });
  assert.equal(runToolResult.toolResult.success, false);
  assert.equal(JSON.stringify(runToolResult.toolResult).includes(scannerErrorSecret), false);
  assert.equal(logs.some((line) => line.includes(scannerErrorSecret)), false);

  for (const fixture of [
    cleanFixture,
    safeFixture,
    codeReferenceFixture,
    integrityFixture,
    bearerPlaceholderFixture,
    literalCredentialFixture,
    providerFixture,
    githubFixture,
    privateKeyFixture,
    filenameFixture,
    archiveFixture,
    artifactFixture,
    driftFixture,
  ]) {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
  console.log('Secret Leak Gate self-test passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
