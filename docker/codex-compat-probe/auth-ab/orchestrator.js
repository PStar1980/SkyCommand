'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { validateContract, CONTRACT, sha256 } = require('../contract');
const {
  AuthAbError,
  AuthAbSequencer,
  isAcceptedBaselineDeviceAuthFailure,
  projectSafeStageEvidence,
} = require('./contract');
const { POLICY_DIGEST } = require('./runner');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const COMPOSE_FILE = path.join(__dirname, 'compose.yaml');
const PROJECT = 'skycommand-codex-auth-ab';
const PROFILE = 'isolated-codex-auth-ab';
const SERVICE_BY_STAGE = Object.freeze({ baseline: 'auth-ab-baseline', candidate: 'auth-ab-candidate' });
const ALLOWLIST_PATH = path.join(REPO_ROOT, 'docker/codex-provider-allowlist.txt');
const POLICY_HOSTS = Object.freeze(['auth.openai.com', 'chatgpt.com']);
const RESULT_PREFIX = 'SKYCOMMAND_AUTH_AB_RESULT_V1 ';
const MAX_PROXY_EVENTS = 80;
const SAFE_PROXY_REASONS = new Set([
  'INVALID_AUTHORITY', 'DNS_LOOKUP_FAILED', 'PORT_NOT_ALLOWED', 'HOST_NOT_ALLOWLISTED',
  'NON_PUBLIC_DNS_RESULT', 'UPSTREAM_CONNECT_FAILED', 'PUBLIC_ALLOWLISTED_TLS',
]);
const BASELINE_FAILURE_FIELDS = Object.freeze([
  'attemptId', 'failureCode', 'observedAt', 'outcome', 'protocolMethods', 'rpc', 'schema', 'stage',
]);
const BASELINE_FAILURE_PHASE_FIELDS = Object.freeze([
  ...BASELINE_FAILURE_FIELDS, 'phaseEgress',
]);
const BASELINE_FAILURE_DIAGNOSTIC_FIELDS = Object.freeze([
  ...BASELINE_FAILURE_FIELDS, 'authTransportDiagnostic', 'phaseEgress',
]);
const BASELINE_FAILURE_RPC_FIELDS = Object.freeze(['method', 'observedAt', 'outcome', 'requestId', 'rpcCode']);
const PROXY_SNAPSHOT_SCRIPT = "Promise.all(['/healthz','/diagnostics'].map(async p=>{const r=await fetch('http://127.0.0.1:3128'+p);if(!r.ok)throw Error();return r.json()})).then(([health,diagnostics])=>process.stdout.write(JSON.stringify({health,cursor:diagnostics.cursor,count:diagnostics.count,events:diagnostics.events}))).catch(()=>process.exit(1))";

function validateSourcePolicy() {
  validateContract();
  const raw = fs.readFileSync(ALLOWLIST_PATH);
  const hosts = raw.toString('utf8').split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim().toLowerCase()).filter(Boolean);
  if (JSON.stringify(hosts) !== JSON.stringify(POLICY_HOSTS) || sha256(raw) !== POLICY_DIGEST) {
    throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
  }
}

function parseStageResultMarker(line, expectedStage) {
  if (typeof line !== 'string' || !line.startsWith(RESULT_PREFIX)) return null;
  try {
    const envelope = JSON.parse(line.slice(RESULT_PREFIX.length));
    const result = projectSafeStageEvidence(envelope, expectedStage);
    if (isAcceptedBaselineDeviceAuthFailure(result) && !hasExactBaselineFailureMarkerShape(envelope)) {
      throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
    }
    return result;
  } catch (_error) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
}

function hasExactBaselineFailureMarkerShape(envelope) {
  const exactTopLevelFields = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
    && [BASELINE_FAILURE_FIELDS, BASELINE_FAILURE_PHASE_FIELDS, BASELINE_FAILURE_DIAGNOSTIC_FIELDS]
      .some((fields) => JSON.stringify(Object.keys(envelope).sort()) === JSON.stringify([...fields].sort()));
  return exactTopLevelFields
    && envelope.rpc && typeof envelope.rpc === 'object' && !Array.isArray(envelope.rpc)
    && JSON.stringify(Object.keys(envelope.rpc).sort()) === JSON.stringify(BASELINE_FAILURE_RPC_FIELDS);
}

function decodeRecordedBaselineMarker(encodedMarker) {
  if (typeof encodedMarker !== 'string' || encodedMarker.length < 1 || encodedMarker.length > 8192
    || !/^[A-Za-z0-9_-]+$/.test(encodedMarker)) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  const bytes = Buffer.from(encodedMarker, 'base64url');
  if (bytes.toString('base64url') !== encodedMarker) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  const markerLine = bytes.toString('utf8').replace(/\r?\n$/, '');
  if (/[\r\n]/.test(markerLine) || !markerLine.startsWith(RESULT_PREFIX)) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  let envelope;
  try { envelope = JSON.parse(markerLine.slice(RESULT_PREFIX.length)); }
  catch (_error) { throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID'); }
  if (!hasExactBaselineFailureMarkerShape(envelope)) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  const result = parseStageResultMarker(markerLine, 'baseline');
  if (!result || !isAcceptedBaselineDeviceAuthFailure(result)) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  return result;
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function projectSafeProxySnapshot(value, stage) {
  const health = value?.health;
  if (!['baseline', 'candidate'].includes(stage)
    || !value || typeof value !== 'object' || Array.isArray(value)
    || health?.ok !== true || health.profile !== 'CODEX_PROVIDER_ALLOWLIST'
    || health.allowedHostCount !== POLICY_HOSTS.length || health.policyDigest !== POLICY_DIGEST
    || !Number.isSafeInteger(value.cursor) || value.cursor < 0
    || !Number.isSafeInteger(value.count) || value.count !== value.events?.length
    || value.events.length > MAX_PROXY_EVENTS || value.cursor < value.count) {
    throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
  }
  const events = value.events.map((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)
      || Object.hasOwn(event, 'host') || Object.hasOwn(event, 'hostname')
      || !Number.isSafeInteger(event.cursor) || event.cursor < 1 || event.cursor > value.cursor
      || !['APPROVED_AUTH_HOST', 'OTHER_HOST_REDACTED'].includes(event.destinationClassification)
      || !/^[A-F0-9]{64}$/.test(event.destinationFingerprint || '')
      || !Number.isSafeInteger(event.port) || event.port < 1 || event.port > 65535
      || !['ALLOW', 'DENY'].includes(event.decision) || !SAFE_PROXY_REASONS.has(event.reason)
      || !isIsoTimestamp(event.observedAt)
      || typeof event.observedMonotonicNs !== 'string' || !/^\d{1,40}$/.test(event.observedMonotonicNs)
      || event.count !== 1) {
      throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
    }
    return {
      cursor: event.cursor,
      destinationClassification: event.destinationClassification,
      destinationFingerprint: event.destinationFingerprint,
      port: event.port,
      decision: event.decision,
      reason: event.reason,
      observedAt: event.observedAt,
      observedMonotonicNs: event.observedMonotonicNs,
      count: event.count,
    };
  });
  if (new Set(events.map((event) => event.cursor)).size !== events.length) {
    throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
  }
  return { stage, cursor: value.cursor, count: value.count, events };
}

function correlateStageEgress(before, after, stage) {
  if (!before || !after || before.stage !== stage || after.stage !== stage
    || before.count !== before.events?.length || after.count !== after.events?.length
    || !Number.isSafeInteger(before.cursor) || !Number.isSafeInteger(after.cursor)
    || before.cursor !== 0 || before.count !== 0 || after.cursor < before.cursor
    || after.count < before.count) {
    throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
  }
  const events = after.events.slice(before.count);
  if (events.some((event, index) => event.cursor !== before.cursor + index + 1)
    || after.cursor !== before.cursor + events.length) {
    throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
  }
  return {
    stage,
    beforeCursor: before.cursor,
    afterCursor: after.cursor,
    beforeCount: before.count,
    afterCount: after.count,
    count: events.reduce((total, event) => total + event.count, 0),
    events,
  };
}

function hasEgressPolicyViolation(evidence) {
  return evidence.events.some((event) => event.destinationClassification !== 'APPROVED_AUTH_HOST'
    || event.port !== 443 || event.decision !== 'ALLOW' || event.reason !== 'PUBLIC_ALLOWLISTED_TLS');
}

class DockerComposeAdapter {
  constructor(dependencies = {}) {
    this.spawnImpl = dependencies.spawn || spawn;
    this.execFileImpl = dependencies.execFile || execFileAsync;
    this.discarded = new Set();
    this.destinationFingerprintKey = (dependencies.randomBytes || crypto.randomBytes)(32).toString('hex').toUpperCase();
  }

  composeArgs(args) {
    return ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, '--profile', PROFILE, ...args];
  }

  async docker(args) {
    try {
      return await this.execFileImpl('docker', args, {
        cwd: REPO_ROOT, windowsHide: true, timeout: 30000, maxBuffer: 128 * 1024,
      });
    } catch (_error) {
      throw new AuthAbError('AUTH_AB_RUN_FAILED');
    }
  }

  async assertNoProjectResources() {
    const [containers, networks, volumes] = await Promise.all([
      this.docker(['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${PROJECT}`]),
      this.docker(['network', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${PROJECT}`]),
      this.docker(['volume', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${PROJECT}`]),
    ]);
    if ([containers, networks, volumes].some((result) => String(result.stdout || '').trim())) {
      throw new AuthAbError('AUTH_AB_RUN_FAILED');
    }
  }

  async assertFresh() {
    validateSourcePolicy();
    await this.assertNoProjectResources();
    const images = await this.docker(['image', 'inspect',
      'skycommand-codex-auth-ab-runtime:local', 'skycommand-codex-auth-ab-egress:local', '--format', '{{.Id}}']);
    if (String(images.stdout || '').trim().split(/\r?\n/).filter(Boolean).length !== 2) {
      throw new AuthAbError('AUTH_AB_RUN_FAILED');
    }
  }

  async startProxy(stage) {
    if (stage === 'candidate' && !this.discarded.has('baseline')) throw new AuthAbError('AUTH_AB_RUN_FAILED');
    try {
      await this.execFileImpl('docker', this.composeArgs([
        'up', '--detach', '--wait', '--wait-timeout', '60', '--no-build', 'auth-egress-proxy',
      ]), {
        cwd: REPO_ROOT,
        windowsHide: true,
        timeout: 90000,
        maxBuffer: 128 * 1024,
        env: { ...process.env, CODEX_EGRESS_AUTH_AB_FINGERPRINT_KEY: this.destinationFingerprintKey },
      });
    } catch (_error) { throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH'); }
  }

  async captureProxyDiagnostics(stage) {
    const result = await this.docker(this.composeArgs([
      'exec', '--no-TTY', 'auth-egress-proxy', 'node', '-e', PROXY_SNAPSHOT_SCRIPT,
    ]));
    try {
      return projectSafeProxySnapshot(JSON.parse(String(result.stdout || '')), stage);
    } catch (error) {
      if (error instanceof AuthAbError) throw error;
      throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
    }
  }

  correlateStageEgress(before, after, stage) {
    return correlateStageEgress(before, after, stage);
  }

  hasEgressPolicyViolation(evidence) {
    return hasEgressPolicyViolation(evidence);
  }

  async runVersion(stage) {
    if (stage === 'candidate' && !this.discarded.has('baseline')) throw new AuthAbError('AUTH_AB_RUN_FAILED');
    const service = SERVICE_BY_STAGE[stage];
    if (!service) throw new AuthAbError('AUTH_AB_RUN_FAILED');
    const args = this.composeArgs(['run', '--rm', '--no-deps', '--interactive', '--no-TTY', service]);
    return new Promise((resolve, reject) => {
      let output = '';
      let result = null;
      let overflow = false;
      let child;
      try {
        child = this.spawnImpl('docker', args, { cwd: REPO_ROOT, windowsHide: true, stdio: ['inherit', 'pipe', 'inherit'] });
      } catch (_error) { reject(new AuthAbError('AUTH_AB_RUN_FAILED')); return; }
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (Buffer.byteLength(output, 'utf8') > 128 * 1024) { overflow = true; child.kill(); return; }
        for (const line of output.split(/\r?\n/)) {
          try {
            const parsed = parseStageResultMarker(line, stage);
            if (parsed) result = parsed;
          }
          catch (_error) { result = null; }
        }
        const lastNewline = Math.max(output.lastIndexOf('\n'), output.lastIndexOf('\r'));
        if (lastNewline >= 0) output = output.slice(lastNewline + 1);
      });
      child.once('error', () => reject(new AuthAbError('AUTH_AB_RUN_FAILED')));
      child.once('close', (code) => {
        output = '';
        if (overflow || !result) { reject(new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID')); return; }
        if (code !== 0 && result.outcome !== 'FAIL') { reject(new AuthAbError('AUTH_AB_RUN_FAILED')); return; }
        resolve(result);
      });
    });
  }

  async teardown() {
    try {
      await this.execFileImpl('docker', this.composeArgs(['down', '--remove-orphans']), {
        cwd: REPO_ROOT, windowsHide: true, timeout: 90000, maxBuffer: 128 * 1024,
      });
    } catch (_error) { throw new AuthAbError('AUTH_AB_RUN_FAILED'); }
  }

  async verifyDiscarded(stage) {
    await this.assertNoProjectResources();
    this.discarded.add(stage);
  }

  async markDiscarded(stage) {
    if (!this.discarded.has(stage)) throw new AuthAbError('AUTH_AB_RUN_FAILED');
  }
}

async function runAuthenticatedAb(adapter = new DockerComposeAdapter(), priorBaselineResult = null) {
  if (priorBaselineResult === null) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  return new AuthAbSequencer(adapter).execute(priorBaselineResult);
}

async function continueWithRecordedBaseline(encodedBaselineMarker, adapter = new DockerComposeAdapter()) {
  const baselineResult = decodeRecordedBaselineMarker(encodedBaselineMarker);
  return runAuthenticatedAb(adapter, baselineResult);
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--run-isolated-auth-ab') {
    process.stdout.write('{"schema":"SKYCOMMAND_CODEX_AUTH_AB_RESULT_V1","outcome":"NOT_STARTED","reason":"BASELINE_RESULT_ALREADY_RECORDED"}\n');
    return;
  }
  if (args.length === 2 && args[0] === '--continue-isolated-auth-ab-candidate') {
    try {
      const result = await continueWithRecordedBaseline(args[1]);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      const safeResults = error instanceof AuthAbError ? error.safeResults : [];
      process.stdout.write(`${JSON.stringify({
        schema: 'SKYCOMMAND_CODEX_AUTH_AB_RESULT_V1',
        outcome: 'FAIL',
        failureCode: error instanceof AuthAbError ? error.code : 'AUTH_AB_RUN_FAILED',
        stages: safeResults,
      })}\n`);
      process.exitCode = 1;
    }
    return;
  }
  process.stdout.write('{"schema":"SKYCOMMAND_CODEX_AUTH_AB_RESULT_V1","outcome":"NOT_STARTED","reason":"EXPLICIT_AUTHORIZATION_REQUIRED"}\n');
}

if (require.main === module) main();

module.exports = {
  DockerComposeAdapter,
  correlateStageEgress,
  continueWithRecordedBaseline,
  decodeRecordedBaselineMarker,
  hasEgressPolicyViolation,
  main,
  parseStageResultMarker,
  projectSafeProxySnapshot,
  runAuthenticatedAb,
  validateSourcePolicy,
};
