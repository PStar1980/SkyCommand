'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const {
  ATTESTATION_SCHEMA,
  installedPackageArtifactSha256,
} = require('./packageArtifactAttestation');

const execFileAsync = promisify(execFile);
const CODEX_VERSION = '0.154.0';
const CODEX_WRAPPER_INTEGRITY = 'sha512-FV/x1OHXYv/ifjf3mXj9ThTTAWcUZN6cGIRQRhRxkKNOPuImu1WW0c8ev1vUkE9XGH90dEnYG1tBjIkxRikg0w==';
const CODEX_LINUX_X64_INTEGRITY = 'sha512-a4FI3A8sGtwGrOqltrPbrS2hajrHQG591EwmRfiRoLMb10VxdBtUGW4gu6IJVYENiYGA7k3P4jlRHEoCZU/s9Q==';
const RUNTIME_CERTIFICATION_SCHEMA = 'SKYCOMMAND_CODEX_RUNTIME_CERTIFICATION_V1';
const LOGIN_VERIFICATION_URL = 'https://auth.openai.com/codex/device';
const SAFE_RPC_METHODS = new Set([
  'account/read',
  'account/login/start',
  'account/login/cancel',
  'account/logout',
  'account/rateLimits/read',
  'account/usage/read',
  'model/list',
  'mcpServerStatus/list',
]);
const REAL_EXECUTION_RPC_METHODS = new Set([
  ...SAFE_RPC_METHODS,
  'thread/start',
  'thread/resume',
  'turn/start',
  'turn/interrupt',
]);
const RPC_STAGE_BY_METHOD = Object.freeze({
  'account/read': 'ACCOUNT_READ',
  'account/login/start': 'DEVICE_CODE_LOGIN_START',
  'account/login/cancel': 'DEVICE_CODE_LOGIN_CANCEL',
  'account/logout': 'ACCOUNT_LOGOUT',
  'account/rateLimits/read': 'ACCOUNT_RATE_LIMITS_READ',
  'account/usage/read': 'ACCOUNT_USAGE_READ',
  'model/list': 'MODEL_LIST',
  'mcpServerStatus/list': 'MCP_SERVER_STATUS_LIST',
  'thread/start': 'THREAD_START',
  'thread/resume': 'THREAD_RESUME',
  'turn/start': 'TURN_START',
  'turn/interrupt': 'TURN_INTERRUPT',
});
const SAFE_RPC_OUTCOMES = new Set(['SUCCEEDED', 'JSON_RPC_ERROR', 'TIMEOUT', 'TRANSPORT_ERROR']);
const ACCOUNT_READ_ERROR_CLASSIFICATIONS = new Set([
  'WORKSPACE_ROUTING_DUPLICATE',
  'WORKSPACE_ROUTING_TIMEOUT',
  'WORKSPACE_ROUTING_UNAUTHORIZED',
  'WORKSPACE_ROUTING_UNAVAILABLE',
  'WORKSPACE_ROUTING_DISCOVERY_ERROR',
  'ACCOUNT_READ_INTERNAL_ERROR',
]);
const ACCOUNT_READ_DATA_KINDS = new Set(['NULL', 'STRING', 'OBJECT', 'ARRAY', 'OTHER']);
const ACCOUNT_READ_LEXICAL_SIGNAL_NAMES = Object.freeze([
  'workspace', 'routing', 'discovery', 'duplicate', 'timeout',
  'unauthorized', 'unavailable', 'account', 'auth',
]);
const ACCOUNT_READ_LEXICAL_SIGNAL_PATTERNS = Object.freeze({
  workspace: /\bworkspace\b/i,
  routing: /\brouting\b/i,
  discovery: /\bdiscovery\b/i,
  duplicate: /\bduplicate\b/i,
  timeout: /\btimeout\b|\btimed\s+out\b/i,
  unauthorized: /\bunauthorized\b/i,
  unavailable: /\bunavailable\b/i,
  account: /\baccount\b/i,
  auth: /\bauth\w*/i,
});
const SAFE_DIAGNOSTIC_SECRET_MARKERS = new Set([
  'TOKEN', 'SECRET', 'COOKIE', 'CREDENTIAL', 'PASSWORD', 'BEARER', 'AUTHORIZATION',
  'ACCESS', 'REFRESH', 'DEVICE', 'USER', 'VERIFICATION', 'URL', 'LOGIN_ID', 'EMAIL', 'HEADER',
]);
const LOGIN_NOTIFICATION_TYPES = new Set(['account/login/completed', 'account/updated']);
const SAFE_PROVIDER_ERROR_KINDS = new Set([
  'ContextWindowExceeded',
  'UsageLimitExceeded',
  'HttpConnectionFailed',
  'ResponseStreamConnectionFailed',
  'ResponseStreamDisconnected',
  'ResponseTooManyFailedAttempts',
  'BadRequest',
  'Unauthorized',
  'SandboxError',
  'InternalServerError',
  'Other',
]);
const PROVIDER_ERROR_MESSAGE_CLASSES = Object.freeze([
  ['APPROVAL_REQUIRED', /approval|approve|consent|permission request/i],
  ['MCP_FAILURE', /\bmcp\b|tool.+(?:unavailable|failed|error|timeout|not found)|(?:unavailable|failed|error|timeout|not found).+tool/i],
  ['AUTHENTICATION_FAILURE', /auth(?:entication|orization)?|unauthori[sz]ed|login|credential|token/i],
  ['RATE_LIMITED', /rate.?limit|quota|usage limit|too many requests/i],
  ['MODEL_UNAVAILABLE', /model.+(?:unavailable|not found|unsupported)|(?:unavailable|not found|unsupported).+model/i],
  ['NETWORK_FAILURE', /network|connection|upstream|socket|dns|http/i],
]);
const PROVIDER_ERROR_KIND_ALIASES = new Map([
  ['contextwindowexceeded', 'ContextWindowExceeded'],
  ['usagelimitexceeded', 'UsageLimitExceeded'],
  ['httpconnectionfailed', 'HttpConnectionFailed'],
  ['responsestreamconnectionfailed', 'ResponseStreamConnectionFailed'],
  ['responsestreamdisconnected', 'ResponseStreamDisconnected'],
  ['responsetoomanyfailedattempts', 'ResponseTooManyFailedAttempts'],
  ['badrequest', 'BadRequest'],
  ['unauthorized', 'Unauthorized'],
  ['sandboxerror', 'SandboxError'],
  ['internalservererror', 'InternalServerError'],
  ['other', 'Other'],
]);

class CodexAppServerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CodexAppServerError';
    this.code = code;
    this.details = details;
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function safeText(value, max = 160) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, max);
}

function safeDiagnosticCode(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,5}$/.test(normalized)) return null;
  if (normalized.split('_').some((part) => SAFE_DIAGNOSTIC_SECRET_MARKERS.has(part))) return null;
  return normalized;
}

function safeTimestamp(value) {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function classifyAccountReadError(method, outcome, message) {
  if (method !== 'account/read' || outcome !== 'JSON_RPC_ERROR') return null;
  const normalized = typeof message === 'string' ? message.toLowerCase() : '';
  if (/\bduplicate workspace in routing discovery\b/.test(normalized)) return 'WORKSPACE_ROUTING_DUPLICATE';
  if (/\bworkspace routing discovery timed out\b/.test(normalized)) return 'WORKSPACE_ROUTING_TIMEOUT';
  if (/\bworkspace routing discovery unauthorized\b/.test(normalized)) return 'WORKSPACE_ROUTING_UNAUTHORIZED';
  if (/\bworkspace routing is unavailable\b/.test(normalized)) return 'WORKSPACE_ROUTING_UNAVAILABLE';
  const signals = lexicalSignals(normalized);
  if (signals.workspace && signals.routing && signals.discovery) return 'WORKSPACE_ROUTING_DISCOVERY_ERROR';
  return 'ACCOUNT_READ_INTERNAL_ERROR';
}

function normalizeDiagnosticText(value) {
  return value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\s+/gu, ' ').trim();
}

function lexicalSignals(value) {
  return Object.fromEntries(ACCOUNT_READ_LEXICAL_SIGNAL_NAMES.map((name) => [
    name,
    ACCOUNT_READ_LEXICAL_SIGNAL_PATTERNS[name].test(value),
  ]));
}

function dataKind(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return 'STRING';
  if (Array.isArray(value)) return 'ARRAY';
  if (typeof value === 'object') return 'OBJECT';
  return 'OTHER';
}

function accountReadErrorEvidence(error) {
  const message = error?.message;
  const data = error?.data;
  const normalizedMessage = typeof message === 'string' ? normalizeDiagnosticText(message) : null;
  const normalizedData = typeof data === 'string' ? normalizeDiagnosticText(data) : null;
  return {
    messagePresent: message !== undefined && message !== null,
    dataKind: dataKind(data),
    messageDigest: normalizedMessage === null ? null : digest(normalizedMessage),
    messageSignals: lexicalSignals(normalizedMessage || ''),
    dataDigest: normalizedData === null ? null : digest(normalizedData),
    dataSignals: normalizedData === null ? null : lexicalSignals(normalizedData),
  };
}

function safeLexicalSignals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(ACCOUNT_READ_LEXICAL_SIGNAL_NAMES.map((name) => [name, value[name] === true]));
}

function safeDiagnosticDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toUpperCase() : null;
}

function safeAdditionalDetails(value) {
  if (value === undefined || value === null) return null;
  const fieldNames = new Set();
  const safeCodes = new Set();
  const httpStatusCodes = new Set();
  const shape = [];
  let fieldCount = 0;
  function safeFieldName(name) {
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name)) return null;
    const parts = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    return parts.some((part) => SAFE_DIAGNOSTIC_SECRET_MARKERS.has(part)) ? null : name;
  }
  function walk(node, prefix = '', depth = 0) {
    if (depth > 3 || fieldCount >= 48) return;
    if (Array.isArray(node)) {
      shape.push(`${prefix || '$'}:ARRAY`);
      node.slice(0, 8).forEach((item, index) => walk(item, `${prefix}[${index}]`, depth + 1));
      return;
    }
    if (!node || typeof node !== 'object') {
      shape.push(`${prefix || '$'}:${dataKind(node)}`);
      return;
    }
    shape.push(`${prefix || '$'}:OBJECT`);
    for (const [key, child] of Object.entries(node).slice(0, 24)) {
      if (fieldCount >= 48) break;
      fieldCount += 1;
      const safeName = safeFieldName(key);
      if (safeName) fieldNames.add(safeName);
      const childPath = `${prefix ? `${prefix}.` : ''}${safeName || '<redacted>'}`;
      shape.push(`${childPath}:${dataKind(child)}`);
      if (safeName && /(?:code|type|reason|status|kind|category)$/i.test(safeName) && typeof child === 'string') {
        const code = safeDiagnosticCode(child);
        if (code) safeCodes.add(code);
      }
      if (safeName && /(?:httpstatus|httpstatuscode|statuscode)$/i.test(safeName)
        && Number.isInteger(child) && child >= 100 && child <= 599) httpStatusCodes.add(child);
      if (child && typeof child === 'object') walk(child, childPath, depth + 1);
    }
  }
  walk(value);
  return {
    kind: dataKind(value),
    fieldCount,
    fieldNames: [...fieldNames].slice(0, 24),
    safeCodes: [...safeCodes].slice(0, 16),
    httpStatusCodes: [...httpStatusCodes].slice(0, 8),
    shapeDigest: digest(shape.sort().join('|')),
  };
}

function safeNotificationMessage(value) {
  const message = typeof value === 'string' ? normalizeDiagnosticText(value) : null;
  if (!message) return { messageDigest: null, messageClass: null };
  return {
    messageDigest: digest(message),
    messageClass: PROVIDER_ERROR_MESSAGE_CLASSES.find(([, pattern]) => pattern.test(message))?.[0] || 'OTHER',
  };
}

function safeModelCatalog(value, { requestedModel = null, requestedReasoningEffort = null } = {}) {
  const rows = Array.isArray(value?.data) ? value.data : [];
  const models = rows.slice(0, 100).map((row) => {
    const model = safeText(row?.model || row?.id, 80) || null;
    const efforts = (Array.isArray(row?.supportedReasoningEfforts) ? row.supportedReasoningEfforts : [])
      .map((entry) => safeText(entry?.reasoningEffort || entry, 24).toLowerCase())
      .filter((effort) => /^[a-z][a-z0-9_-]{0,23}$/.test(effort))
      .slice(0, 12);
    return {
      model,
      hidden: row?.hidden === true,
      isDefault: row?.isDefault === true,
      defaultReasoningEffort: safeText(row?.defaultReasoningEffort, 24).toLowerCase() || null,
      supportedReasoningEfforts: [...new Set(efforts)],
      inputModalities: (Array.isArray(row?.inputModalities) ? row.inputModalities : [])
        .map((item) => safeText(item, 24).toLowerCase())
        .filter((item) => /^[a-z][a-z0-9_-]{0,23}$/.test(item))
        .slice(0, 8),
    };
  }).filter((row) => row.model);
  const requested = safeText(requestedModel, 80) || null;
  const effort = safeText(requestedReasoningEffort, 24).toLowerCase() || null;
  const match = requested ? models.find((row) => row.model === requested) || null : null;
  return {
    semantics: 'APP_SERVER_CATALOG_NOT_ENTITLEMENT_PROOF',
    modelCount: models.length,
    models,
    requestedModel: requested,
    requestedReasoningEffort: effort,
    requestedModelListed: Boolean(match),
    requestedReasoningEffortListed: Boolean(match && effort && match.supportedReasoningEfforts.includes(effort)),
    nextCursorPresent: typeof value?.nextCursor === 'string' && value.nextCursor.length > 0,
  };
}

function safeMcpServerStatus(value) {
  const rows = Array.isArray(value?.data) ? value.data : Array.isArray(value?.servers) ? value.servers : [];
  return {
    serverCount: rows.length,
    servers: rows.slice(0, 32).map((row) => {
      const tools = Array.isArray(row?.tools)
        ? row.tools
        : row?.tools && typeof row.tools === 'object'
          ? Object.keys(row.tools)
          : [];
      return {
        name: safeText(row?.name || row?.serverName || row?.id, 80) || null,
        status: safeText(row?.status || row?.startupStatus || row?.state, 40) || null,
        authStatus: safeText(row?.authStatus || row?.auth?.status || row?.auth?.state, 40) || null,
        toolNames: tools.map((tool) => safeText(tool?.name || tool, 120)).filter(Boolean).slice(0, 64),
      };
    }).filter((row) => row.name),
    nextCursorPresent: typeof value?.nextCursor === 'string' && value.nextCursor.length > 0,
  };
}

function safeProviderTurnError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawInfo = value.codexErrorInfo;
  const info = rawInfo && typeof rawInfo === 'object' && !Array.isArray(rawInfo) ? rawInfo : {};
  const kindCandidate = typeof rawInfo === 'string' ? rawInfo : (info.type || info.code || null);
  const kind = PROVIDER_ERROR_KIND_ALIASES.get(String(kindCandidate || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()) || null;
  const code = safeDiagnosticCode(value.code);
  const message = typeof value.message === 'string' ? normalizeDiagnosticText(value.message) : null;
  const messageClass = message
    ? (PROVIDER_ERROR_MESSAGE_CLASSES.find(([, pattern]) => pattern.test(message))?.[0] || 'OTHER')
    : null;
  const httpStatusCode = Number.isInteger(info.httpStatusCode) && info.httpStatusCode >= 100 && info.httpStatusCode <= 599
    ? info.httpStatusCode
    : null;
  const additionalDetails = safeAdditionalDetails(value.additionalDetails);
  if (!kind && !code && !message && httpStatusCode === null && !additionalDetails) return null;
  return {
    code,
    kind,
    httpStatusCode,
    messageDigest: message ? digest(message) : null,
    messageClass,
    additionalDetails,
  };
}

function safeRpcDiagnostic(value, { allowRealExecution = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowedMethods = allowRealExecution ? REAL_EXECUTION_RPC_METHODS : SAFE_RPC_METHODS;
  const method = allowedMethods.has(value.method) ? value.method : null;
  const stage = method ? RPC_STAGE_BY_METHOD[method] : null;
  const outcome = SAFE_RPC_OUTCOMES.has(value.outcome) ? value.outcome : null;
  const observedAt = safeTimestamp(value.observedAt);
  if (!method || !stage || !outcome || !observedAt) return null;
  const rpcCode = Number.isSafeInteger(value.rpcCode) && Math.abs(value.rpcCode) <= 1_000_000_000
    ? value.rpcCode
    : null;
  if (outcome === 'JSON_RPC_ERROR' && rpcCode === null) return null;
  const requestId = Number.isSafeInteger(value.requestId) && value.requestId > 0
    ? value.requestId
    : null;
  if (requestId === null) return null;
  const diagnostic = {
    method,
    requestId,
    rpcCode,
    type: safeDiagnosticCode(value.type),
    reason: safeDiagnosticCode(value.reason),
    stage,
    outcome,
    failureCode: safeDiagnosticCode(value.failureCode),
    observedAt,
  };
  if (method === 'account/read' && outcome === 'JSON_RPC_ERROR') {
    diagnostic.accountReadClassification = ACCOUNT_READ_ERROR_CLASSIFICATIONS.has(value.accountReadClassification)
      ? value.accountReadClassification
      : 'ACCOUNT_READ_INTERNAL_ERROR';
    const messageSignals = safeLexicalSignals(value.messageSignals);
    const dataSignals = value.dataKind === 'STRING' ? safeLexicalSignals(value.dataSignals) : null;
    if (typeof value.messagePresent === 'boolean'
      && ACCOUNT_READ_DATA_KINDS.has(value.dataKind)
      && messageSignals
      && (value.dataKind !== 'STRING' || dataSignals)) {
      diagnostic.messagePresent = value.messagePresent;
      diagnostic.dataKind = value.dataKind;
      diagnostic.messageDigest = safeDiagnosticDigest(value.messageDigest);
      diagnostic.messageSignals = messageSignals;
      diagnostic.dataDigest = value.dataKind === 'STRING' ? safeDiagnosticDigest(value.dataDigest) : null;
      diagnostic.dataSignals = dataSignals;
    }
  }
  return diagnostic;
}

function safeLoginStateDiagnostic(value = {}, options = {}) {
  const operationId = typeof value.enrollmentOperationId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.enrollmentOperationId)
    ? value.enrollmentOperationId
    : null;
  const appServerGeneration = typeof value.appServerGeneration === 'string'
    && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value.appServerGeneration)
    ? value.appServerGeneration
    : null;
  const state = ['PENDING_USER', 'COMPLETED', 'FAILED'].includes(value.state) ? value.state : 'UNKNOWN';
  const latestNotificationType = LOGIN_NOTIFICATION_TYPES.has(value.latestNotificationType)
    ? value.latestNotificationType
    : null;
  const timestamps = value.timestamps && typeof value.timestamps === 'object' ? value.timestamps : {};
  return {
    enrollmentOperationId: operationId,
    appServerGeneration,
    state,
    latestNotificationType,
    latestRpc: safeRpcDiagnostic(value.latestRpc, options),
    timestamps: {
      loginStartedAt: safeTimestamp(timestamps.loginStartedAt),
      loginCompletedAt: safeTimestamp(timestamps.loginCompletedAt),
      latestNotificationAt: safeTimestamp(timestamps.latestNotificationAt),
      latestRpcAt: safeTimestamp(timestamps.latestRpcAt),
    },
  };
}

function createRpcDiagnostic({ method, requestId, outcome, error, failureCode, observedAt = new Date().toISOString() }) {
  const data = error?.data && typeof error.data === 'object' && !Array.isArray(error.data) ? error.data : {};
  const accountReadEvidence = method === 'account/read' && outcome === 'JSON_RPC_ERROR'
    ? accountReadErrorEvidence(error)
    : {};
  return safeRpcDiagnostic({
    method,
    requestId,
    rpcCode: Number.isSafeInteger(error?.code) ? error.code : null,
    type: error?.type ?? data.type,
    reason: error?.reason ?? data.reason,
    stage: RPC_STAGE_BY_METHOD[method],
    outcome,
    failureCode,
    accountReadClassification: classifyAccountReadError(method, outcome, error?.message),
    observedAt,
    ...accountReadEvidence,
  }, { allowRealExecution: REAL_EXECUTION_RPC_METHODS.has(method) });
}

function controlChildEnvironment() {
  const allowed = ['PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'TMPDIR'];
  const env = Object.fromEntries(allowed.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  for (const key of ['http_proxy', 'https_proxy', 'no_proxy']) {
    const upper = key.toUpperCase();
    if (env[upper]) env[key] = env[upper];
  }
  env.HOME = process.env.CODEX_HOME || '/var/lib/codex';
  env.CODEX_HOME = process.env.CODEX_HOME || '/var/lib/codex';
  env.LANG = 'C.UTF-8';
  env.CODEX_DISABLE_AUTOUPDATE = '1';
  return env;
}

function safeAccountResult(value = {}) {
  const account = value.account && typeof value.account === 'object' ? value.account : null;
  return {
    accountType: account ? safeText(account.type, 40) || null : null,
    authMode: account ? safeText(account.type, 40) || null : null,
    planType: account ? safeText(account.planType, 40) || null : null,
    requiresOpenaiAuth: value.requiresOpenaiAuth === true,
    // requiresOpenaiAuth describes the selected provider configuration, not the
    // presence of a persisted account. A ChatGPT account object is the auth signal.
    authenticated: account?.type === 'chatgpt',
  };
}

function safeRateLimits(value = {}) {
  const source = value.rateLimitsByLimitId && typeof value.rateLimitsByLimitId === 'object'
    ? value.rateLimitsByLimitId
    : value.rateLimits ? { [safeText(value.rateLimits.limitId, 40) || 'codex']: value.rateLimits } : {};
  const limits = {};
  for (const [key, item] of Object.entries(source)) {
    if (!item || typeof item !== 'object') continue;
    const primary = item.primary && typeof item.primary === 'object' ? item.primary : null;
    const secondary = item.secondary && typeof item.secondary === 'object' ? item.secondary : null;
    limits[safeText(key, 40)] = {
      usedPercent: Number.isFinite(primary?.usedPercent) ? primary.usedPercent : null,
      windowDurationMins: Number.isFinite(primary?.windowDurationMins) ? primary.windowDurationMins : null,
      resetsAt: Number.isFinite(primary?.resetsAt) ? primary.resetsAt : null,
      secondaryUsedPercent: Number.isFinite(secondary?.usedPercent) ? secondary.usedPercent : null,
      rateLimitReachedType: safeText(item.rateLimitReachedType, 40) || null,
    };
  }
  return { limits };
}

function safeUsage(value = {}) {
  const safe = {};
  const allowedKey = /^(?:total|daily|weekly|used|input|output|cached|reasoning|tokens|requests|date|start|end|model|bucket|limit|remaining|available|period|unit|count|value|timestamp|from|to)$/i;
  function visit(source, target, depth = 0) {
    if (depth > 6 || !source || typeof source !== 'object') return;
    if (Array.isArray(source)) {
      target.items = source.slice(0, 64).map((item) => {
        if (item && typeof item === 'object') {
          const next = {};
          visit(item, next, depth + 1);
          return next;
        }
        return Number.isFinite(item) ? item : null;
      });
      return;
    }
    for (const [key, child] of Object.entries(source)) {
      if (!allowedKey.test(key) || /email|token|credential|secret|password|account|user|auth/i.test(key)) continue;
      if (Number.isFinite(child) || typeof child === 'boolean') target[key] = child;
      else if (typeof child === 'string' && child.length <= 80) target[key] = child;
      else if (child && typeof child === 'object') {
        const next = Array.isArray(child) ? [] : {};
        visit(child, next, depth + 1);
        target[key] = next;
      }
    }
  }
  visit(value, safe);
  return safe;
}

async function generateSchema(codexJsPath) {
  const schemaDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skycommand-codex-schema-'));
  const env = controlChildEnvironment();
  try {
    await execFileAsync(process.execPath, [codexJsPath, 'app-server', 'generate-json-schema', '--experimental', '--out', schemaDir], {
      cwd: '/tmp', env, timeout: 60000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
    });
    const primaryPath = path.join(schemaDir, 'codex_app_server_protocol.schemas.json');
    const v2Path = path.join(schemaDir, 'codex_app_server_protocol.v2.schemas.json');
    const primary = await fs.promises.readFile(primaryPath);
    const v2 = await fs.promises.readFile(v2Path).catch(() => Buffer.alloc(0));
    let primaryDocument = null;
    try { primaryDocument = JSON.parse(primary.toString('utf8')); } catch (_error) { primaryDocument = null; }
    const contains = (value, expected) => {
      if (typeof value === 'string') return value === expected;
      if (Array.isArray(value)) return value.some((item) => contains(item, expected));
      if (value && typeof value === 'object') return Object.entries(value).some(([key, child]) => key === expected || contains(child, expected));
      return false;
    };
    return {
      primarySchemaDigest: digest(primary),
      v2SchemaDigest: v2.length ? digest(v2) : null,
      schemaBytes: primary.length,
      realExecutionSurface: Object.fromEntries([...REAL_EXECUTION_RPC_METHODS].map((method) => [method, contains(primaryDocument, method)])),
    };
  } catch (_error) {
    throw new CodexAppServerError('CODEX_SCHEMA_GENERATION_FAILED', 'The pinned app-server schema could not be generated.');
  } finally {
    await fs.promises.rm(schemaDir, { recursive: true, force: true });
  }
}

function normalizeEpoch(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const milliseconds = value < 1000000000000 ? value * 1000 : value;
  return new Date(milliseconds).toISOString();
}

function parseCodexVersion(output) {
  const match = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/.exec(String(output || ''));
  return match?.[0] || null;
}

function readRuntimeCertification(filePath = path.resolve(__dirname, '../../../docker/codex-agent-runtime/package.json')) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const packageMetadata = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const parsed = packageMetadata.skycommandRuntimeCertification;
    const digestPattern = /^[0-9A-F]{64}$/i;
    if (parsed?.schema !== RUNTIME_CERTIFICATION_SCHEMA
      || parsed.packageVersion !== CODEX_VERSION
      || parsed.wrapperPackageIntegrity !== CODEX_WRAPPER_INTEGRITY
      || parsed.linuxX64PackageIntegrity !== CODEX_LINUX_X64_INTEGRITY
      || packageMetadata.dependencies?.['@openai/codex'] !== CODEX_VERSION
      || !digestPattern.test(String(parsed.installedArtifactSha256 || ''))
      || !digestPattern.test(String(parsed.primaryProtocolSchemaDigest || ''))
      || !digestPattern.test(String(parsed.versionedProtocolSchemaDigests?.v2 || ''))) return null;
    return {
      installedArtifactSha256: parsed.installedArtifactSha256.toUpperCase(),
      primaryProtocolSchemaDigest: parsed.primaryProtocolSchemaDigest.toUpperCase(),
      protocolSchemaV2Digest: parsed.versionedProtocolSchemaDigests.v2.toUpperCase(),
    };
  } catch (_error) {
    return null;
  }
}

async function readJsonFile(filePath) {
  try { return JSON.parse(await fs.promises.readFile(filePath, 'utf8')); }
  catch (_error) { return null; }
}

async function readPackageIdentity(options = {}) {
  const rootPath = options.rootPath || path.resolve(__dirname, '../../../');
  const sourcePackageLockPath = options.packageLockPath
    || path.join(rootPath, 'docker/codex-agent-runtime/package-lock.json');
  const runtimePackagePath = options.runtimePackagePath
    || path.join(rootPath, 'docker/codex-agent-runtime/package.json');
  const installedPackageLockPath = options.installedPackageLockPath
    || path.join(rootPath, 'node_modules/.package-lock.json');
  const wrapperManifestPath = options.wrapperManifestPath
    || path.join(rootPath, 'node_modules/@openai/codex/package.json');
  const linuxManifestPath = options.linuxManifestPath
    || path.join(rootPath, 'node_modules/@openai/codex-linux-x64/package.json');
  const codexJsPath = options.codexJsPath
    || path.join(rootPath, 'node_modules/@openai/codex/bin/codex.js');

  let sourceBytes;
  let sourceLock;
  try {
    sourceBytes = await fs.promises.readFile(sourcePackageLockPath);
    sourceLock = JSON.parse(sourceBytes.toString('utf8'));
  } catch (_error) {
    throw new CodexAppServerError('CODEX_PACKAGE_SOURCE_IDENTITY_INVALID', 'The source-controlled Codex package identity is unavailable.');
  }
  const expectedWrapper = sourceLock.packages?.['node_modules/@openai/codex'];
  const expectedLinux = sourceLock.packages?.['node_modules/@openai/codex-linux-x64'];
  const runtimeCertification = readRuntimeCertification(runtimePackagePath);
  if (
    expectedWrapper?.version !== CODEX_VERSION
    || expectedWrapper?.integrity !== CODEX_WRAPPER_INTEGRITY
    || expectedLinux?.version !== `${CODEX_VERSION}-linux-x64`
    || expectedLinux?.integrity !== CODEX_LINUX_X64_INTEGRITY
  ) {
    throw new CodexAppServerError('CODEX_PACKAGE_SOURCE_IDENTITY_INVALID', 'The source-controlled Codex package identity does not match its pinned artifact.');
  }

  const [installedLockBytes, installedLock, wrapperManifest, linuxManifest] = await Promise.all([
    fs.promises.readFile(installedPackageLockPath).catch(() => null),
    readJsonFile(installedPackageLockPath),
    readJsonFile(wrapperManifestPath),
    readJsonFile(linuxManifestPath),
  ]);
  const [artifactAttestation, observedInstalledArtifactSha256] = await Promise.all([
    readJsonFile(options.attestationPath || path.join(rootPath, 'codex-runtime-artifact-attestation.json')),
    installedPackageArtifactSha256(rootPath).catch(() => null),
  ]);
  const installedWrapper = installedLock?.packages?.['node_modules/@openai/codex'];
  const installedLinux = installedLock?.packages?.['node_modules/@openai/codex-linux-x64'];
  let observedCodexVersion = null;
  try {
    const result = await (options.runVersionCommand || execFileAsync)(
      process.execPath,
      [codexJsPath, '--version'],
      { cwd: '/tmp', env: controlChildEnvironment(), timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 },
    );
    observedCodexVersion = parseCodexVersion(result?.stdout);
  } catch (_error) { /* preserve unavailable as null; never substitute the pin */ }

  const observedPackageIntegrity = typeof installedLinux?.integrity === 'string'
    && /^sha512-[A-Za-z0-9+/]{86}==$/.test(installedLinux.integrity)
    ? installedLinux.integrity
    : null;
  const observedWrapperPackageIntegrity = typeof installedWrapper?.integrity === 'string'
    && /^sha512-[A-Za-z0-9+/]{86}==$/.test(installedWrapper.integrity)
    ? installedWrapper.integrity
    : null;
  const expectedPackageLockSha256 = digest(sourceBytes);
  const expectedInstalledArtifactSha256 = runtimeCertification?.installedArtifactSha256 || null;
  const mismatchFields = [];
  if (!observedCodexVersion) mismatchFields.push('observedCodexVersion');
  else if (observedCodexVersion !== CODEX_VERSION) mismatchFields.push('observedCodexVersion');
  if (!observedPackageIntegrity) mismatchFields.push('observedPackageIntegrity');
  else if (observedPackageIntegrity !== CODEX_LINUX_X64_INTEGRITY) mismatchFields.push('observedPackageIntegrity');
  if (!observedWrapperPackageIntegrity) mismatchFields.push('observedWrapperPackageIntegrity');
  else if (observedWrapperPackageIntegrity !== CODEX_WRAPPER_INTEGRITY) mismatchFields.push('observedWrapperPackageIntegrity');
  if (!runtimeCertification) mismatchFields.push('runtimeCertification');
  if (
    wrapperManifest?.name !== '@openai/codex'
    || wrapperManifest?.version !== CODEX_VERSION
    || linuxManifest?.name !== '@openai/codex'
    || linuxManifest?.version !== `${CODEX_VERSION}-linux-x64`
  ) mismatchFields.push('installedPackageManifest');
  if (
    installedWrapper?.version !== CODEX_VERSION
    || installedWrapper?.integrity !== CODEX_WRAPPER_INTEGRITY
    || installedLinux?.version !== `${CODEX_VERSION}-linux-x64`
    || installedLinux?.integrity !== CODEX_LINUX_X64_INTEGRITY
  ) mismatchFields.push('installedPackageLock');
  if (
    artifactAttestation?.schema !== ATTESTATION_SCHEMA
    || artifactAttestation.packageVersion !== CODEX_VERSION
    || artifactAttestation.packageIntegrity !== CODEX_LINUX_X64_INTEGRITY
    || artifactAttestation.installedArtifactSha256 !== expectedInstalledArtifactSha256
    || artifactAttestation.sourcePackageLockSha256 !== expectedPackageLockSha256
    || !expectedInstalledArtifactSha256
  ) mismatchFields.push('artifactAttestation');
  if (!observedInstalledArtifactSha256) mismatchFields.push('observedInstalledArtifactSha256');
  else if (expectedInstalledArtifactSha256 && observedInstalledArtifactSha256 !== expectedInstalledArtifactSha256) {
    mismatchFields.push('observedInstalledArtifactSha256');
  }

  return {
    observedCodexVersion,
    expectedCodexVersion: CODEX_VERSION,
    observedPackageIntegrity,
    expectedPackageIntegrity: CODEX_LINUX_X64_INTEGRITY,
    observedWrapperPackageIntegrity,
    expectedWrapperPackageIntegrity: CODEX_WRAPPER_INTEGRITY,
    observedPlatformPackageVersion: typeof linuxManifest?.version === 'string'
      && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(linuxManifest.version)
      ? linuxManifest.version
      : null,
    expectedPlatformPackageVersion: `${CODEX_VERSION}-linux-x64`,
    observedPackageLockSha256: installedLockBytes ? digest(installedLockBytes) : null,
    expectedPackageLockSha256,
    observedInstalledArtifactSha256,
    expectedInstalledArtifactSha256,
    expectedProtocolSchemaDigest: runtimeCertification?.primaryProtocolSchemaDigest || null,
    expectedProtocolSchemaV2Digest: runtimeCertification?.protocolSchemaV2Digest || null,
    identityMismatchFields: [...new Set(mismatchFields)],
    identityAttestation: mismatchFields.length ? 'FAILED' : 'VERIFIED',
    platformPackage: '@openai/codex-linux-x64',
  };
}

class CodexAppServerClient {
  constructor(options = {}) {
    this.codexJsPath = options.codexJsPath || path.resolve(__dirname, '../../../node_modules/@openai/codex/bin/codex.js');
    this.spawnImpl = options.spawnImpl || spawn;
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.initialized = false;
    this.starting = null;
    this.loginState = null;
    this.lastAccountUpdate = null;
    this.latestRelevantNotification = null;
    this.latestRpcDiagnostic = null;
    this.mcpStartup = new Map();
    this.events = [];
    this.schema = null;
    this.executionEnabled = options.executionEnabled ?? process.env.CODEX_AGENT_EXECUTION_ENABLED === 'true';
    this.providerTurns = new Map();
    this.latestProviderError = null;
    this.latestUsage = null;
    this.configDigest = null;
    this.packageIdentity = null;
    this.startedAt = null;
    this.generation = `${safeText(process.env.CODEX_RUNTIME_GENERATION, 'phase19-3a0')}-${crypto.randomUUID()}`;
    this.onEvent = options.onEvent || (() => {});
  }

  async prepareHome() {
    const home = process.env.CODEX_HOME || '/var/lib/codex';
    const configPath = path.join(home, 'config.toml');
    const managedConfig = process.env.CODEX_MANAGED_CONFIG || '/etc/skycommand/codex/config.toml';
    await fs.promises.mkdir(home, { recursive: true, mode: 0o700 });
    const expected = await fs.promises.readFile(managedConfig);
    try {
      const actual = await fs.promises.readFile(configPath);
      if (!actual.equals(expected)) {
        throw new CodexAppServerError('CODEX_CONFIG_DRIFT', 'The managed Codex configuration differs from its pinned profile.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.promises.writeFile(configPath, expected, { mode: 0o400, flag: 'wx' });
    }
    this.configDigest = digest(expected);
    return configPath;
  }

  async start() {
    if (this.starting) return this.starting;
    this.starting = this.#start();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async #start() {
    await this.prepareHome();
    this.packageIdentity = await readPackageIdentity();
    this.schema = await generateSchema(this.codexJsPath);
    if (this.executionEnabled) {
      const requiredMethods = ['thread/start', 'thread/resume', 'turn/start', 'turn/interrupt'];
      const missing = requiredMethods.filter((method) => this.schema.realExecutionSurface?.[method] !== true);
      if (missing.length > 0) {
        throw new CodexAppServerError('CODEX_EXECUTION_SCHEMA_UNAVAILABLE', 'The pinned Codex app-server schema does not certify the bounded read-only execution surface.', { missingMethods: missing });
      }
    }
    const child = this.spawnImpl(process.execPath, [this.codexJsPath, 'app-server', '--listen', 'stdio://'], {
      cwd: '/tmp', env: controlChildEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.process = child;
    this.startedAt = new Date().toISOString();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#consume(chunk));
    child.stderr.on('data', () => {
      // Provider/auth responses and command output may contain credentials; never relay child stderr.
    });
    child.once('error', () => this.#failPending('CODEX_PROCESS_START_FAILED'));
    child.once('exit', () => {
      this.initialized = false;
      this.process = null;
      this.#failPending('CODEX_PROCESS_EXITED');
      this.onEvent({ type: 'process-exited', observedAt: new Date().toISOString() });
    });
    await this.#rpc('initialize', {
      clientInfo: { name: 'skycommand-managed-codex', title: 'SkyCommand Managed Codex Read-Only Pilot', version: this.executionEnabled ? '19.3A1' : '19.3A0' },
      capabilities: {},
    }, { allowBeforeInitialize: true, timeoutMs: 20000 });
    this.#notify('initialized', {});
    this.initialized = true;
    this.onEvent({
      type: 'initialized',
      observedVersion: this.packageIdentity?.observedCodexVersion || null,
      expectedVersion: this.packageIdentity?.expectedCodexVersion || CODEX_VERSION,
      observedAt: new Date().toISOString(),
    });
    return this.identity();
  }

  #consume(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) {
      this.process?.kill('SIGKILL');
      this.#failPending('CODEX_PROTOCOL_BUFFER_LIMIT');
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (_error) {
        this.#failPending('CODEX_PROTOCOL_INVALID_JSON');
        continue;
      }
      this.handleProtocolMessage(message);
    }
  }

  handleProtocolMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.id !== undefined && this.pending.has(String(message.id))) {
      const pending = this.pending.get(String(message.id));
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error) {
        const diagnostic = createRpcDiagnostic({
          method: pending.method,
          requestId: pending.requestId,
          outcome: 'JSON_RPC_ERROR',
          error: message.error,
          failureCode: 'CODEX_RPC_ERROR',
        });
        this.latestRpcDiagnostic = diagnostic;
        pending.reject(new CodexAppServerError(
          'CODEX_RPC_ERROR',
          'The Codex app-server rejected an allowlisted request.',
          diagnostic ? { rpcDiagnostic: diagnostic } : {},
        ));
      } else {
        this.latestRpcDiagnostic = createRpcDiagnostic({
          method: pending.method,
          requestId: pending.requestId,
          outcome: 'SUCCEEDED',
        });
        pending.resolve(message.result || {});
      }
      return;
    }
    if (message.method === 'account/login/completed') {
      const params = message.params && typeof message.params === 'object' ? message.params : {};
      const observedAt = new Date().toISOString();
      const success = params.success === true;
      this.latestRelevantNotification = { type: 'account/login/completed', observedAt };
      if (this.loginState && (!params.loginId || params.loginId === this.loginState.loginId)) {
        this.loginState = {
          ...this.loginState,
          state: success ? 'COMPLETED' : 'FAILED',
          success,
          safeFailureCode: success ? null : 'PROVIDER_LOGIN_FAILED',
          completedAt: observedAt,
        };
      }
      this.#recordEvent({ type: 'login-completed', loginId: safeText(params.loginId, 80) || null, success, safeFailureCode: success ? null : 'PROVIDER_LOGIN_FAILED', observedAt });
      return;
    }
    if (message.method === 'account/updated') {
      const params = message.params && typeof message.params === 'object' ? message.params : {};
      const observedAt = new Date().toISOString();
      this.latestRelevantNotification = { type: 'account/updated', observedAt };
      this.lastAccountUpdate = { authMode: safeText(params.authMode, 40) || null, planType: safeText(params.planType, 40) || null, observedAt };
      this.#recordEvent({ type: 'account-updated', ...this.lastAccountUpdate });
      return;
    }
    if (message.method === 'mcpServer/startupStatus/updated') {
      const params = message.params && typeof message.params === 'object' ? message.params : {};
      const observedAt = new Date().toISOString();
      const serverName = safeText(params.name, 80);
      if (serverName) this.mcpStartup.set(serverName, { status: safeText(params.status, 40), failureReason: safeText(params.failureReason, 80) || null, observedAt });
      this.#recordEvent({ type: 'mcp-startup', serverName: serverName || null, status: safeText(params.status, 40) || null, failureReason: safeText(params.failureReason, 80) || null, observedAt });
      return;
    }
    if (!this.executionEnabled) return;
    const params = message.params && typeof message.params === 'object' ? message.params : {};
    if (message.method === 'model/rerouted') {
      const reason = safeNotificationMessage(params.reason);
      this.#recordEvent({
        type: 'provider-model-rerouted',
        threadId: safeText(params.threadId, 160) || null,
        turnId: safeText(params.turnId, 160) || null,
        fromModel: safeText(params.fromModel, 80) || null,
        toModel: safeText(params.toModel, 80) || null,
        reasonDigest: reason.messageDigest,
        reasonClass: reason.messageClass,
        observedAt: new Date().toISOString(),
      });
      return;
    }
    if (message.method === 'model/verification') {
      const verifications = Array.isArray(params.verifications) ? params.verifications : [];
      this.#recordEvent({
        type: 'provider-model-verification',
        threadId: safeText(params.threadId, 160) || null,
        turnId: safeText(params.turnId, 160) || null,
        verificationCount: verifications.length,
        verificationKinds: verifications.map((item) => safeDiagnosticCode(item?.type || item?.kind || item?.code || item)).filter(Boolean).slice(0, 16),
        observedAt: new Date().toISOString(),
      });
      return;
    }
    if (message.method === 'warning' || message.method === 'configWarning') {
      const summary = safeNotificationMessage(params.message || params.summary);
      const details = safeNotificationMessage(params.details);
      this.#recordEvent({
        type: message.method === 'warning' ? 'provider-warning' : 'provider-config-warning',
        threadId: safeText(params.threadId, 160) || null,
        messageDigest: summary.messageDigest,
        messageClass: summary.messageClass,
        detailsDigest: details.messageDigest,
        detailsClass: details.messageClass,
        observedAt: new Date().toISOString(),
      });
      return;
    }
    const threadId = safeText(params.threadId || params.thread?.id, 160) || null;
    const turnId = safeText(params.turnId || params.turn?.id, 160) || null;
    if (message.method === 'error') {
      const error = safeProviderTurnError(params.error || params);
      const state = (turnId ? this.providerTurns.get(turnId) : null)
        || [...this.providerTurns.values()].reverse().find((candidate) => candidate.status === 'IN_PROGRESS');
      if (state && error) state.error = error;
      this.latestProviderError = error;
      this.#recordEvent({
        type: 'provider-error',
        threadId,
        turnId,
        code: error?.code || null,
        kind: error?.kind || null,
        httpStatusCode: error?.httpStatusCode || null,
        messageDigest: error?.messageDigest || null,
        messageClass: error?.messageClass || null,
        additionalDetails: error?.additionalDetails || null,
        observedAt: new Date().toISOString(),
      });
      return;
    }
    if (message.method === 'turn/started') {
      if (threadId && turnId) {
        this.providerTurns.set(turnId, {
          ...(this.providerTurns.get(turnId) || {}),
          threadId,
          turnId,
          status: 'IN_PROGRESS',
          observedModel: safeText(params.model || params.turn?.model || params.effectiveModel, 80) || null,
          observedReasoningEffort: safeText(params.reasoningEffort || params.effort || params.turn?.reasoningEffort || params.turn?.effort, 40) || null,
          startedAt: new Date().toISOString(),
        });
        this.latestProviderError = null;
        this.#recordEvent({
          type: 'provider-turn-started',
          threadId,
          turnId,
          observedModel: safeText(params.model || params.turn?.model || params.effectiveModel, 80) || null,
          observedReasoningEffort: safeText(params.reasoningEffort || params.effort || params.turn?.reasoningEffort || params.turn?.effort, 40) || null,
          observedAt: new Date().toISOString(),
        });
      }
      return;
    }
    if (message.method === 'item/agentMessage/delta') {
      const state = turnId ? this.providerTurns.get(turnId) : null;
      const delta = typeof params.delta === 'string' ? params.delta : '';
      if (state && delta) state.message = `${state.message || ''}${delta}`.slice(0, 16000);
      return;
    }
    if (message.method === 'thread/tokenUsage/updated') {
      this.latestUsage = safeUsage(params.usage || params);
      if (turnId && this.providerTurns.has(turnId)) this.providerTurns.get(turnId).usage = this.latestUsage;
      this.#recordEvent({ type: 'provider-usage-updated', threadId, turnId, observedAt: new Date().toISOString() });
      return;
    }
    if (message.method === 'item/completed' || message.method === 'item/started') {
      const item = params.item && typeof params.item === 'object' ? params.item : params;
      const itemType = safeText(item.type, 80);
      const state = turnId ? this.providerTurns.get(turnId) : null;
      if (state && itemType === 'agentMessage') {
        const content = Array.isArray(item.content) ? item.content : [];
        const textValue = content.map((part) => typeof part?.text === 'string' ? part.text : '').join('');
        if (textValue) state.message = textValue.slice(0, 16000);
      }
      if (state && itemType === 'mcpToolCall') {
        const server = safeText(item.server || item.serverName, 80);
        const tool = safeText(item.tool || item.toolName, 120);
        if (server && tool) {
          state.capabilityInvocations = [...(state.capabilityInvocations || []), {
            server,
            tool,
            status: safeText(item.status, 40) || null,
            result: item.result && typeof item.result === 'object' ? item.result : null,
          }].slice(-8);
        }
      }
      if (state && itemType) this.#recordEvent({
        type: message.method === 'item/started' ? 'provider-item-started' : 'provider-item-completed',
        threadId,
        turnId,
        itemType,
        server: itemType === 'mcpToolCall' ? safeText(item.server || item.serverName, 80) || null : null,
        tool: itemType === 'mcpToolCall' ? safeText(item.tool || item.toolName, 120) || null : null,
        observedAt: new Date().toISOString(),
      });
      return;
    }
    if (message.method === 'turn/completed') {
      const state = turnId ? this.providerTurns.get(turnId) : null;
      if (state) {
        state.status = safeText(params.status || params.turn?.status, 40) || 'COMPLETED';
        state.observedModel = safeText(params.model || params.turn?.model || params.effectiveModel, 80) || state.observedModel || null;
        state.observedReasoningEffort = safeText(params.reasoningEffort || params.effort || params.turn?.reasoningEffort || params.turn?.effort, 40) || state.observedReasoningEffort || null;
        state.completedAt = new Date().toISOString();
        state.error = safeProviderTurnError(params.error || params.turn?.error) || state.error || this.latestProviderError;
        this.#recordEvent({
          type: 'provider-turn-completed',
          threadId,
          turnId,
          status: state.status,
          observedModel: state.observedModel,
          observedReasoningEffort: state.observedReasoningEffort,
          errorCode: state.error?.code || null,
          errorKind: state.error?.kind || null,
          errorHttpStatusCode: state.error?.httpStatusCode || null,
          errorMessageDigest: state.error?.messageDigest || null,
          errorMessageClass: state.error?.messageClass || null,
          errorAdditionalDetails: state.error?.additionalDetails || null,
          observedAt: state.completedAt,
        });
        state.resolve?.(state);
        state.resolve = null;
      }
      return;
    }
  }

  #recordEvent(event) {
    this.events.push(event);
    if (this.events.length > 100) this.events.shift();
    this.onEvent(event);
  }

  #rpc(method, params = {}, options = {}) {
    const allowlisted = this.executionEnabled ? REAL_EXECUTION_RPC_METHODS : SAFE_RPC_METHODS;
    if (!allowlisted.has(method) && !(options.allowBeforeInitialize && method === 'initialize')) {
      return Promise.reject(new CodexAppServerError('CODEX_RPC_METHOD_NOT_ALLOWED', this.executionEnabled
        ? 'Only the certified Phase 19.3A1 read-only Codex app-server protocol is exposed.'
        : 'Only the Phase 19.3A0 account/bootstrap protocol is exposed.'));
    }
    if (!options.allowBeforeInitialize && !this.initialized) return Promise.reject(new CodexAppServerError('CODEX_APP_SERVER_NOT_INITIALIZED', 'Codex app-server is not initialized.'));
    if (!this.process || this.process.exitCode !== null) return Promise.reject(new CodexAppServerError('CODEX_APP_SERVER_OFFLINE', 'Codex app-server is offline.'));
    const id = this.nextId++;
    const timeoutMs = Number(options.timeoutMs || 15000);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        const diagnostic = createRpcDiagnostic({
          method,
          requestId: id,
          outcome: 'TIMEOUT',
          failureCode: 'CODEX_RPC_TIMEOUT',
        });
        this.latestRpcDiagnostic = diagnostic;
        reject(new CodexAppServerError(
          'CODEX_RPC_TIMEOUT',
          'An allowlisted Codex app-server request timed out.',
          diagnostic ? { rpcDiagnostic: diagnostic } : {},
        ));
      }, timeoutMs);
      this.pending.set(String(id), { method, requestId: id, resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  #notify(method, params = {}) {
    if (!this.process || this.process.exitCode !== null) return;
    this.process.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  #failPending(code) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      const diagnostic = createRpcDiagnostic({
        method: pending.method,
        requestId: pending.requestId,
        outcome: 'TRANSPORT_ERROR',
        failureCode: code,
      });
      this.latestRpcDiagnostic = diagnostic;
      pending.reject(new CodexAppServerError(
        code,
        'The Codex app-server process is unavailable.',
        diagnostic ? { rpcDiagnostic: diagnostic } : {},
      ));
      this.pending.delete(id);
    }
  }

  loginStateDiagnostic() {
    const loginState = this.loginState || {};
    return safeLoginStateDiagnostic({
      enrollmentOperationId: loginState.operationId || null,
      appServerGeneration: this.generation,
      state: loginState.state,
      latestNotificationType: this.latestRelevantNotification?.type || null,
      latestRpc: this.latestRpcDiagnostic,
      timestamps: {
        loginStartedAt: loginState.startedAt || null,
        loginCompletedAt: loginState.completedAt || null,
        latestNotificationAt: this.latestRelevantNotification?.observedAt || null,
        latestRpcAt: this.latestRpcDiagnostic?.observedAt || null,
      },
    }, { allowRealExecution: this.executionEnabled });
  }

  identity() {
    const packageIdentity = this.packageIdentity || {};
    const observedProtocolSchemaDigest = this.schema?.primarySchemaDigest || null;
    return {
      runtimeKind: this.executionEnabled ? 'OPENAI_CODEX_APP_SERVER' : 'CODEX_APP_SERVER_BOOTSTRAP',
      executionProfile: this.executionEnabled ? 'CODEX_READ_ONLY_PILOT' : 'CODEX_MANAGED_BOOTSTRAP',
      executionEnabled: this.executionEnabled === true,
      codexVersion: packageIdentity.observedCodexVersion || null,
      observedCodexVersion: packageIdentity.observedCodexVersion || null,
      expectedCodexVersion: packageIdentity.expectedCodexVersion || CODEX_VERSION,
      packageIntegrity: packageIdentity.observedPackageIntegrity || null,
      observedPackageIntegrity: packageIdentity.observedPackageIntegrity || null,
      expectedPackageIntegrity: packageIdentity.expectedPackageIntegrity || CODEX_LINUX_X64_INTEGRITY,
      observedWrapperPackageIntegrity: packageIdentity.observedWrapperPackageIntegrity || null,
      expectedWrapperPackageIntegrity: packageIdentity.expectedWrapperPackageIntegrity || CODEX_WRAPPER_INTEGRITY,
      observedPlatformPackageVersion: packageIdentity.observedPlatformPackageVersion || null,
      expectedPlatformPackageVersion: packageIdentity.expectedPlatformPackageVersion || `${CODEX_VERSION}-linux-x64`,
      packageLockSha256: packageIdentity.observedPackageLockSha256 || null,
      observedPackageLockSha256: packageIdentity.observedPackageLockSha256 || null,
      expectedPackageLockSha256: packageIdentity.expectedPackageLockSha256 || null,
      observedInstalledArtifactSha256: packageIdentity.observedInstalledArtifactSha256 || null,
      expectedInstalledArtifactSha256: packageIdentity.expectedInstalledArtifactSha256 || null,
      identityMismatchFields: packageIdentity.identityMismatchFields || [],
      identityAttestation: packageIdentity.identityAttestation || 'UNAVAILABLE',
      platformPackage: packageIdentity.platformPackage || '@openai/codex-linux-x64',
      runtimeGeneration: this.generation,
      processId: this.process?.pid || null,
      processStartedAt: this.startedAt,
      protocolSchemaDigest: observedProtocolSchemaDigest,
      observedProtocolSchemaDigest,
      expectedProtocolSchemaDigest: packageIdentity.expectedProtocolSchemaDigest || null,
      protocolSchemaV2Digest: this.schema?.v2SchemaDigest || null,
      expectedProtocolSchemaV2Digest: packageIdentity.expectedProtocolSchemaV2Digest || null,
      realExecutionSurface: this.schema?.realExecutionSurface || {},
      configurationDigest: this.configDigest,
      initialized: this.initialized,
      mcpServers: Object.fromEntries(this.mcpStartup.entries()),
    };
  }

  #assertExecutionEnabled() {
    if (!this.executionEnabled) throw new CodexAppServerError('CODEX_AGENT_EXECUTION_DISABLED', 'The managed Codex runtime is not enabled for Agent Run execution.');
    if (!this.initialized) throw new CodexAppServerError('CODEX_APP_SERVER_NOT_INITIALIZED', 'Codex app-server is not initialized.');
  }

  async submitManagedTurn({ instruction, model = null, reasoningEffort = null, operationReference } = {}) {
    this.#assertExecutionEnabled();
    const textValue = safeText(instruction, 20000);
    if (!textValue) throw new CodexAppServerError('CODEX_AGENT_INSTRUCTION_INVALID', 'A bounded Agent instruction is required.');
    let threadResponse;
    try {
      threadResponse = await this.#rpc('thread/start', model ? { model } : {}, { timeoutMs: 30000 });
    } catch (error) {
      if (error.code !== 'CODEX_RPC_TIMEOUT') throw error;
      return {
        runtimeKind: 'OPENAI_CODEX_APP_SERVER',
        adapterVersion: 'codex-app-server-readonly.v1',
        sendAcceptance: 'UNKNOWN',
        outcomeCertainty: 'UNKNOWN',
        providerSessionReference: null,
        providerTurnId: null,
        threadId: null,
        providerOperationReference: operationReference || null,
        requestedModel: model || null,
        requestedReasoningEffort: reasoningEffort || null,
        observedModel: null,
        observedReasoningEffort: null,
        usage: this.latestUsage,
        physicalStop: { state: 'NOT_REQUESTED', evidence: 'provider_thread_submission_timeout' },
        worker: null,
        events: [],
        capabilityInvocations: [],
        taskOutputCandidate: null,
        recoveryRequired: true,
      };
    }
    const thread = threadResponse?.thread && typeof threadResponse.thread === 'object' ? threadResponse.thread : threadResponse;
    const threadId = safeText(thread?.id || threadResponse?.threadId, 160);
    const providerSessionReference = safeText(thread?.sessionId || threadResponse?.sessionId, 160) || null;
    if (!threadId) throw new CodexAppServerError('CODEX_THREAD_REFERENCE_MISSING', 'The pinned Codex app-server did not return a thread reference.');

    let turnResponse;
    try {
      const turnParameters = {
        threadId,
        input: [{ type: 'text', text: textValue }],
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      };
      turnResponse = await this.#rpc('turn/start', {
        ...turnParameters,
      }, { timeoutMs: 30000 });
    } catch (error) {
      if (error.code !== 'CODEX_RPC_TIMEOUT') throw error;
      return {
        runtimeKind: 'OPENAI_CODEX_APP_SERVER',
        adapterVersion: 'codex-app-server-readonly.v1',
        sendAcceptance: 'UNKNOWN',
        outcomeCertainty: 'UNKNOWN',
        providerSessionReference,
        providerTurnId: null,
        threadId,
        providerOperationReference: operationReference || `codex:${threadId}:unknown-turn`,
        requestedModel: model || null,
        requestedReasoningEffort: reasoningEffort || null,
        observedModel: null,
        observedReasoningEffort: null,
        usage: this.latestUsage,
        physicalStop: { state: 'NOT_REQUESTED', evidence: 'provider_turn_submission_timeout' },
        worker: null,
        events: [],
        capabilityInvocations: [],
        taskOutputCandidate: null,
        recoveryRequired: true,
      };
    }
    const turn = turnResponse?.turn && typeof turnResponse.turn === 'object' ? turnResponse.turn : turnResponse;
    const providerTurnId = safeText(turn?.id || turnResponse?.turnId, 160);
    if (!providerTurnId) throw new CodexAppServerError('CODEX_TURN_REFERENCE_MISSING', 'The pinned Codex app-server did not return a turn reference.');
    const state = {
      threadId,
      turnId: providerTurnId,
      providerSessionReference,
      status: 'IN_PROGRESS',
      startedAt: new Date().toISOString(),
      message: '',
      capabilityInvocations: [],
      usage: null,
      observedModel: null,
      observedReasoningEffort: null,
    };
    this.providerTurns.set(providerTurnId, state);
    return {
      runtimeKind: 'OPENAI_CODEX_APP_SERVER',
      adapterVersion: 'codex-app-server-readonly.v1',
      sendAcceptance: 'ACKNOWLEDGED',
      outcomeCertainty: 'ACKNOWLEDGED',
      providerSessionReference,
      providerTurnId,
      threadId,
      providerOperationReference: operationReference || null,
      requestedModel: model || null,
      requestedReasoningEffort: reasoningEffort || null,
      observedModel: state.observedModel,
      observedReasoningEffort: state.observedReasoningEffort,
      usage: this.latestUsage,
      physicalStop: { state: 'NOT_REQUESTED', evidence: 'provider_turn_accepted' },
      worker: null,
      events: [],
      capabilityInvocations: [],
      taskOutputCandidate: null,
      recoveryRequired: false,
    };
  }

  async observeManagedTurn({ providerTurnId, providerSessionReference = null, threadId = null, operationReference, model = null, reasoningEffort = null, deadlineAt = null, timeoutMs = 120000 } = {}) {
    this.#assertExecutionEnabled();
    const completed = await this.waitForManagedTurn({ providerTurnId, deadlineAt, timeoutMs });
    return this.#normalizeManagedTurnResult({
      state: completed,
      providerSessionReference,
      providerTurnId,
      threadId,
      operationReference,
      model,
      reasoningEffort,
    });
  }

  async startManagedTurn({ instruction, model = null, reasoningEffort = null, operationReference, deadlineAt = null } = {}) {
    const accepted = await this.submitManagedTurn({ instruction, model, reasoningEffort, operationReference });
    if (accepted.sendAcceptance !== 'ACKNOWLEDGED') return accepted;
    return this.observeManagedTurn({
      providerTurnId: accepted.providerTurnId,
      providerSessionReference: accepted.providerSessionReference,
      threadId: accepted.threadId,
      operationReference: accepted.providerOperationReference,
      model,
      reasoningEffort,
      deadlineAt,
    });
  }

  async waitForManagedTurn({ providerTurnId, deadlineAt = null, timeoutMs = 120000 } = {}) {
    this.#assertExecutionEnabled();
    const state = this.providerTurns.get(String(providerTurnId));
    if (!state) throw new CodexAppServerError('CODEX_PROVIDER_OPERATION_UNKNOWN', 'The provider turn is not present in the current runtime generation.');
    if (state.status !== 'IN_PROGRESS') return state;
    const deadline = deadlineAt ? Date.parse(deadlineAt) : Date.now() + timeoutMs;
    const bounded = Math.max(1000, Math.min(timeoutMs, Number.isFinite(deadline) ? deadline - Date.now() : timeoutMs));
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.resolve = null;
        resolve({ ...state, status: 'UNKNOWN', timeout: true });
      }, bounded);
      state.resolve = (completed) => {
        clearTimeout(timer);
        resolve(completed);
      };
    });
  }

  #normalizeManagedTurnResult({ state, providerSessionReference, providerTurnId, threadId = null, operationReference, model, reasoningEffort }) {
    const completed = state?.status && state.status !== 'IN_PROGRESS' && state.status !== 'UNKNOWN';
    const providerStatus = safeText(state?.status, 40).toUpperCase();
    const rejected = providerStatus === 'REJECTED' || providerStatus === 'FAILED' || Boolean(state?.error);
    const canceled = providerStatus === 'CANCELED' || providerStatus === 'CANCELLED';
    const uncertain = Boolean(state?.timeout) || (!completed && !rejected && !canceled);
    const capabilityInvocations = (state?.capabilityInvocations || []).map((invocation) => ({
      server: safeText(invocation.server, 80),
      tool: safeText(invocation.tool, 120),
      status: safeText(invocation.status, 40) || null,
      result: invocation.result && typeof invocation.result === 'object' ? invocation.result : null,
    }));
    const observedModel = state?.observedModel || model || null;
    const observedReasoningEffort = state?.observedReasoningEffort || null;
    const taskOutputCandidate = state?.message ? {
      kind: 'CODEX_AGENT_MESSAGE',
      message: safeText(state.message, 16000),
      providerStatus: providerStatus || 'UNKNOWN',
      requestedModel: model || null,
      observedModel,
      requestedReasoningEffort: reasoningEffort || null,
      observedReasoningEffort,
      mcpCapabilityCount: capabilityInvocations.length,
    } : null;
    return {
      runtimeKind: 'OPENAI_CODEX_APP_SERVER',
      adapterVersion: 'codex-app-server-readonly.v1',
      // A provider Turn reference proves submission acceptance even when that Turn later
      // fails, is canceled, or becomes outcome-unknown. Keep submission acceptance
      // separate from the provider Turn's terminal execution status.
      sendAcceptance: 'ACKNOWLEDGED',
      outcomeCertainty: uncertain ? 'UNKNOWN' : canceled ? 'CANCELED' : completed ? 'ACKNOWLEDGED' : 'UNKNOWN',
      providerTerminalStatus: providerStatus || 'UNKNOWN',
      providerTerminalFailure: rejected,
      providerSessionReference: providerSessionReference || state?.providerSessionReference || null,
      providerTurnId: providerTurnId || state?.turnId || null,
      threadId: threadId || state?.threadId || null,
      providerOperationReference: operationReference || null,
      requestedModel: model || null,
      requestedReasoningEffort: reasoningEffort || null,
      observedModel,
      observedReasoningEffort,
      providerErrorCode: state?.error?.code || null,
      providerErrorKind: state?.error?.kind || null,
      providerErrorHttpStatusCode: state?.error?.httpStatusCode || null,
      providerErrorMessageDigest: state?.error?.messageDigest || null,
      providerErrorMessageClass: state?.error?.messageClass || null,
      providerErrorAdditionalDetails: state?.error?.additionalDetails || null,
      usage: state?.usage || this.latestUsage || null,
      physicalStop: { state: 'NOT_REQUESTED', evidence: 'provider_turn_terminal_observed' },
      worker: null,
      events: [],
      capabilityInvocations,
      taskOutputCandidate,
      recoveryRequired: Boolean(state?.timeout),
    };
  }

  async reconcileManagedTurn({ providerTurnId, providerSessionReference, operationReference, model = null, reasoningEffort = null } = {}) {
    this.#assertExecutionEnabled();
    const state = this.providerTurns.get(String(providerTurnId || ''));
    if (!state) {
      return {
        disposition: 'RECOVERY_REQUIRED',
        operationReference: operationReference || null,
        providerSessionReference: providerSessionReference || null,
        providerTurnId: providerTurnId || null,
        reason: 'PROVIDER_OPERATION_NOT_PRESENT_AFTER_RUNTIME_GENERATION_CHANGE',
      };
    }
    if (state.status === 'IN_PROGRESS') {
      return { disposition: 'RECOVERY_REQUIRED', operationReference: operationReference || null, providerSessionReference: providerSessionReference || null, providerTurnId: providerTurnId || null, reason: 'PROVIDER_TURN_REMAINS_UNCERTAIN' };
    }
    const result = this.#normalizeManagedTurnResult({ state, providerSessionReference, providerTurnId, operationReference, model, reasoningEffort });
    return { disposition: result.sendAcceptance === 'UNKNOWN' ? 'RECOVERY_REQUIRED' : 'RECONCILED', ...result };
  }

  async interruptManagedTurn({ providerTurnId, threadId = null } = {}) {
    this.#assertExecutionEnabled();
    const state = this.providerTurns.get(String(providerTurnId || ''));
    const resolvedThreadId = safeText(threadId || state?.threadId, 160);
    const resolvedTurnId = safeText(providerTurnId || state?.turnId, 160);
    if (!resolvedThreadId || !resolvedTurnId) throw new CodexAppServerError('CODEX_INTERRUPT_REFERENCE_MISSING', 'A known provider thread and turn reference are required for interruption.');
    await this.#rpc('turn/interrupt', { threadId: resolvedThreadId, turnId: resolvedTurnId }, { timeoutMs: 20000 });
    if (state) {
      state.interruptRequestedAt = new Date().toISOString();
    }
    return { providerTurnId: resolvedTurnId, threadId: resolvedThreadId, physicalStop: { state: 'CONFIRMED', evidence: 'turn_interrupt_acknowledged' } };
  }

  async readCompatibilityDiagnostics({ requestedModel = null, requestedReasoningEffort = null } = {}) {
    this.#assertExecutionEnabled();
    const diagnostics = {
      observedAt: new Date().toISOString(),
      runtimeGeneration: this.generation,
      modelCatalog: null,
      mcpServerStatus: null,
      rpcDiagnostics: [],
    };
    try {
      const catalog = await this.#rpc('model/list', { limit: 100, includeHidden: true }, { timeoutMs: 20000 });
      diagnostics.modelCatalog = safeModelCatalog(catalog, { requestedModel, requestedReasoningEffort });
      if (this.latestRpcDiagnostic) diagnostics.rpcDiagnostics.push(safeRpcDiagnostic(this.latestRpcDiagnostic, { allowRealExecution: true }));
    } catch (error) {
      diagnostics.modelCatalog = { errorCode: safeDiagnosticCode(error?.code) || 'MODEL_CATALOG_UNAVAILABLE' };
      if (error?.details?.rpcDiagnostic) diagnostics.rpcDiagnostics.push(safeRpcDiagnostic(error.details.rpcDiagnostic, { allowRealExecution: true }));
    }
    try {
      const status = await this.#rpc('mcpServerStatus/list', { limit: 100, detail: 'toolsAndAuthOnly' }, { timeoutMs: 20000 });
      diagnostics.mcpServerStatus = safeMcpServerStatus(status);
      if (this.latestRpcDiagnostic) diagnostics.rpcDiagnostics.push(safeRpcDiagnostic(this.latestRpcDiagnostic, { allowRealExecution: true }));
    } catch (error) {
      diagnostics.mcpServerStatus = { errorCode: safeDiagnosticCode(error?.code) || 'MCP_STATUS_UNAVAILABLE' };
      if (error?.details?.rpcDiagnostic) diagnostics.rpcDiagnostics.push(safeRpcDiagnostic(error.details.rpcDiagnostic, { allowRealExecution: true }));
    }
    diagnostics.rpcDiagnostics = diagnostics.rpcDiagnostics.filter(Boolean).slice(-4);
    return diagnostics;
  }

  async readAccount(options = {}) {
    return safeAccountResult(await this.#rpc('account/read', { refreshToken: false }, options));
  }

  async startDeviceCodeLogin(operationId) {
    if (this.loginState && ['STARTING', 'PENDING_USER'].includes(this.loginState.state)) {
      if (this.loginState.operationId !== operationId) throw new CodexAppServerError('CODEX_LOGIN_ALREADY_PENDING', 'A managed Codex enrollment is already pending.');
      return { ...this.loginState };
    }
    const result = await this.#rpc('account/login/start', { type: 'chatgptDeviceCode' }, { timeoutMs: 45000 });
    const verificationUrl = safeText(result.verificationUrl, 512);
    let parsedUrl;
    try { parsedUrl = new URL(verificationUrl); } catch (_error) { parsedUrl = null; }
    const userCode = safeText(result.userCode, 32);
    const loginId = safeText(result.loginId, 100);
    if (result.type !== 'chatgptDeviceCode' || !parsedUrl || parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'auth.openai.com' || parsedUrl.pathname !== '/codex/device' || !userCode || !loginId) {
      throw new CodexAppServerError('CODEX_DEVICE_LOGIN_RESPONSE_INVALID', 'The pinned app-server returned an unexpected device-code response.');
    }
    this.loginState = {
      operationId,
      loginId,
      verificationUrl,
      userCode,
      state: 'PENDING_USER',
      expiresAt: normalizeEpoch(result.expiresAt),
      startedAt: new Date().toISOString(),
      completedAt: null,
      success: null,
      safeFailureCode: null,
    };
    this.#recordEvent({ type: 'login-started', loginId, observedAt: new Date().toISOString() });
    return { ...this.loginState };
  }

  async reconcileLogin(operationId) {
    if (this.loginState?.operationId === operationId) {
      return { ...this.loginState, account: await this.readAccount() };
    }
    const account = await this.readAccount();
    return {
      operationId,
      state: account.authenticated ? 'COMPLETED' : 'RECONCILIATION_REQUIRED',
      success: account.authenticated,
      account,
      recoveryRequired: !account.authenticated,
    };
  }

  async readRateLimits() {
    return safeRateLimits(await this.#rpc('account/rateLimits/read', {}));
  }

  async readUsage() {
    try {
      return safeUsage(await this.#rpc('account/usage/read', {}));
    } catch (error) {
      if (error.code === 'CODEX_RPC_ERROR') return null;
      throw error;
    }
  }

  async cancelLogin(loginId) {
    const result = await this.#rpc('account/login/cancel', { loginId }, { timeoutMs: 15000 });
    if (this.loginState?.loginId === loginId) this.loginState = { ...this.loginState, state: 'CANCELLED', verificationUrl: null, userCode: null, completedAt: new Date().toISOString() };
    return result;
  }

  async logout() {
    await this.#rpc('account/logout', {});
    this.loginState = null;
    return this.readAccount();
  }

  async stop() {
    const child = this.process;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    this.process = null;
    this.initialized = false;
    this.#failPending('CODEX_APP_SERVER_STOPPED');
  }
}

module.exports = {
  CODEX_VERSION,
  CODEX_WRAPPER_INTEGRITY,
  CODEX_LINUX_X64_INTEGRITY,
  CodexAppServerClient,
  CodexAppServerError,
  LOGIN_VERIFICATION_URL,
  REAL_EXECUTION_RPC_METHODS,
  SAFE_RPC_METHODS,
  digest,
  normalizeEpoch,
  readPackageIdentity,
  readRuntimeCertification,
  safeAccountResult,
  safeAdditionalDetails,
  safeModelCatalog,
  safeMcpServerStatus,
  safeLoginStateDiagnostic,
  safeRateLimits,
  safeRpcDiagnostic,
  safeUsage,
};
