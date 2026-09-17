const assert = require('node:assert/strict');
const path = require('node:path');

process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGUSER = process.env.PGUSER || 'self-test';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'self-test';
process.env.PGDATABASE = process.env.PGDATABASE || 'self-test';

const ROOT = path.resolve(__dirname, '../../../../../..');
const service = require(path.join(ROOT, 'apps/api/src/services/workflowAgentExecutionService'));
const { WorkflowServiceError } = require(
  path.join(ROOT, 'apps/api/src/services/workflowServiceError'),
);

const ENV = Object.freeze({
  SKYCOMMAND_CONFIG_PROFILE: 'DEV_LOCAL',
  SKYCOMMAND_ENVIRONMENT_CODE: 'DEV_LOCAL',
  SKYCOMMAND_R4_DISPATCH_LOCK_WAIT_MS: '2000',
});

const PERMISSIONS = [
  'WORKFLOW_RUN',
  'REPO_MAP_GENERATE',
  'REPO_ZIP_GENERATE',
  'CAPABILITY_CATALOG_EXPORT',
  'CORE_RUN_LOW_RISK_SCRIPT',
];
const REQUIRED_BEHAVIORAL_CASE_COUNT = 26;

const IDS = Object.freeze({
  principal: '00000000-0000-4000-8000-000000000001',
  otherPrincipal: '00000000-0000-4000-8000-000000000002',
  grant: '00000000-0000-4000-8000-000000000011',
  otherGrant: '00000000-0000-4000-8000-000000000012',
  definition: '00000000-0000-4000-8000-000000000021',
  version4: '00000000-0000-4000-8000-000000000022',
  version5: '00000000-0000-4000-8000-000000000023',
  childDefinition: '00000000-0000-4000-8000-000000000024',
  childVersion: '00000000-0000-4000-8000-000000000025',
});

function createError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { code, ...details };
  return error;
}

function createCrashError() {
  return createError('simulated process crash', 'R4_TEST_PROCESS_CRASH');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefinition(overrides = {}) {
  return {
    workflowDefinitionId: IDS.definition,
    workflowCode: 'repo-map-zip',
    displayName: 'Workflow Repo Files Generator',
    status: 'ACTIVE',
    enabled: true,
    publishedVersionId: IDS.version4,
    publishedVersionNumber: 4,
    publishedVersionStatus: 'PUBLISHED',
    startPermissionCode: 'WORKFLOW_RUN',
    config: {
      runtimeParameters: [
        { key: 'repoName', type: 'repo', required: true, maxLength: 80 },
        { key: 'includeTests', type: 'boolean', required: false },
      ],
    },
    nodes: [
      {
        nodeKey: 'repo_map',
        nodeTypeCode: 'TOOL',
        targetCode: 'repo-map-tool',
        inputParameters: {},
      },
    ],
    edges: [],
    ...overrides,
  };
}

function createState() {
  return {
    principals: {
      'assistant-http': {
        id: IDS.principal,
        code: 'assistant-http',
        displayName: 'SkyCommand Assistant HTTP integration',
        authMode: 'ASSISTANT_SERVICE_TOKEN',
        status: 'ACTIVE',
      },
      'other-principal': {
        id: IDS.otherPrincipal,
        code: 'other-principal',
        displayName: 'Other registered principal',
        authMode: 'ASSISTANT_SERVICE_TOKEN',
        status: 'ACTIVE',
      },
    },
    grants: [
      {
        id: IDS.grant,
        principalId: IDS.principal,
        repositoryCode: 'SkyCommand',
        environmentCode: 'DEV_LOCAL',
        configProfileCode: 'DEV_LOCAL',
        workflowCode: 'repo-map-zip',
        allowedPermissionCodes: [...PERMISSIONS],
        status: 'ACTIVE',
      },
    ],
    bindings: [{ repositoryCode: 'SkyCommand', profileCode: 'DEV_LOCAL' }],
    definitions: {
      'repo-map-zip': createDefinition(),
    },
    toolAuthority: {
      'repo-map-tool': {
        toolCode: 'repo-map-tool',
        permissionCode: 'REPO_MAP_GENERATE',
        riskCode: 'LOW',
        enabled: true,
        profileCode: 'DEV_LOCAL',
      },
    },
    admissions: new Map(),
    runs: new Map(),
    temporal: new Map(),
    audits: [],
    lockHeld: false,
    dispatchCalls: 0,
    temporalExecutions: 0,
    runCreateCount: 0,
    dispatchDelayMs: 0,
    runtimeDenied: false,
    crashAfterRunOnce: false,
    executorError: null,
    pollStatuses: [],
    approvals: [],
    detailSecret: null,
    lastActor: null,
    lastContext: null,
    lastWorkflowVersionId: null,
    hooks: {},
  };
}

function principalRow(principal) {
  return {
    workflow_execution_principal_id: principal.id,
    principal_code: principal.code,
    display_name: principal.displayName,
    auth_mode: principal.authMode,
    status: principal.status,
  };
}

function grantRow(grant) {
  return {
    workflow_execution_resource_grant_id: grant.id,
    workflow_execution_principal_id: grant.principalId,
    repository_code: grant.repositoryCode,
    environment_code: grant.environmentCode,
    config_profile_code: grant.configProfileCode,
    workflow_code: grant.workflowCode,
    allowed_permission_codes: grant.allowedPermissionCodes,
    status: grant.status,
  };
}

function admissionRow(params) {
  return {
    workflow_execution_admission_id: params[0],
    workflow_execution_principal_id: params[1],
    workflow_execution_resource_grant_id: params[2],
    workflow_run_record_id: params[3],
    idempotency_key_hash: params[4],
    request_digest: params[5],
    workflow_code: params[6],
    workflow_definition_id: params[7],
    workflow_version_id: params[8],
    version_number: params[9],
    repository_code: params[10],
    environment_code: params[11],
    config_profile_code: params[12],
    validated_parameters: JSON.parse(params[13]),
    parameter_contract: JSON.parse(params[14]),
    status: 'ADMITTED',
    temporal_workflow_id: null,
    temporal_run_id: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-17T12:00:00.000Z',
    started_at: null,
    completed_at: null,
    updated_at: '2026-09-17T12:00:00.000Z',
  };
}

function createDatabase(state) {
  const query = async (sql, params = []) => {
    const statement = String(sql).replace(/\s+/g, ' ').trim();
    const lower = statement.toLowerCase();

    if (lower.includes('insert into worker.workflow_execution_admissions')) {
      const existing = [...state.admissions.values()].find(
        (row) =>
          row.workflow_execution_principal_id === params[1] &&
          row.idempotency_key_hash === params[4],
      );
      if (existing) throw createError('duplicate idempotency key', '23505');
      const row = admissionRow(params);
      state.admissions.set(row.workflow_execution_admission_id, row);
      return { rows: [clone(row)] };
    }

    if (
      lower.includes('update worker.workflow_execution_admissions') &&
      lower.includes("set status = 'starting'")
    ) {
      const row = state.admissions.get(params[0]);
      if (row && row.status === 'ADMITTED') {
        row.status = 'STARTING';
        row.updated_at = '2026-09-17T12:00:01.000Z';
        return { rows: [clone(row)] };
      }
      return { rows: [] };
    }

    if (lower.includes('update worker.workflow_execution_admissions')) {
      const row = state.admissions.get(params[0]);
      if (!row) return { rows: [] };
      if (params[1] !== null && params[1] !== undefined) row.status = params[1];
      if (params[2] !== null && params[2] !== undefined) row.temporal_workflow_id = params[2];
      if (params[3] !== null && params[3] !== undefined) row.temporal_run_id = params[3];
      if (params[4] !== null && params[4] !== undefined) row.failure_code = params[4];
      if (params[5] !== null && params[5] !== undefined) row.failure_message = params[5];
      if (params[1] === 'STARTED' && !row.started_at) row.started_at = '2026-09-17T12:00:02.000Z';
      if (['FAILED', 'CANCELED'].includes(params[1])) {
        row.completed_at = '2026-09-17T12:00:03.000Z';
      }
      row.updated_at = '2026-09-17T12:00:03.000Z';
      return { rows: [clone(row)] };
    }

    if (lower.includes('from auth.workflow_execution_principals')) {
      const code = String(params[0] || '').toLowerCase();
      const authMode = params[1] ? String(params[1]).toLowerCase() : null;
      return {
        rows: Object.values(state.principals)
          .filter(
            (principal) =>
              principal.status === 'ACTIVE' &&
              principal.code.toLowerCase() === code &&
              (!authMode || principal.authMode.toLowerCase() === authMode),
          )
          .map(principalRow),
      };
    }

    if (lower.includes('from worker.workflow_execution_resource_grants')) {
      const [principalId, workflowCode, repositoryCode, environmentCode, profileCode] = params;
      return {
        rows: state.grants
          .filter(
            (grant) =>
              grant.status === 'ACTIVE' &&
              grant.principalId === principalId &&
              grant.workflowCode.toLowerCase() === String(workflowCode).toLowerCase() &&
              (!repositoryCode ||
                grant.repositoryCode.toLowerCase() === String(repositoryCode).toLowerCase()) &&
              grant.environmentCode.toLowerCase() === String(environmentCode).toLowerCase() &&
              grant.configProfileCode.toLowerCase() === String(profileCode).toLowerCase(),
          )
          .sort((left, right) => left.repositoryCode.localeCompare(right.repositoryCode))
          .map(grantRow),
      };
    }

    if (lower.includes('from core.vw_repository_paths')) {
      const [repositoryCode, profileCode] = params;
      return {
        rows: state.bindings
          .filter(
            (binding) =>
              binding.repositoryCode.toLowerCase() === String(repositoryCode).toLowerCase() &&
              binding.profileCode.toLowerCase() === String(profileCode).toLowerCase(),
          )
          .map((binding) => ({
            repo_code: binding.repositoryCode,
            profile_code: binding.profileCode,
          })),
      };
    }

    if (lower.includes('from core.tools tool')) {
      const toolCode = String(params[1] || '').toLowerCase();
      const profileCode = String(params[2] || '').toLowerCase();
      const tool = state.toolAuthority[toolCode];
      if (!tool || tool.profileCode.toLowerCase() !== profileCode || !tool.enabled) {
        return { rows: [] };
      }
      return {
        rows: [
          {
            tool_code: tool.toolCode,
            permission_code: tool.permissionCode,
            risk_code: tool.riskCode,
            enabled: tool.enabled,
          },
        ],
      };
    }

    if (lower.includes('from worker.workflow_execution_admissions')) {
      const [principalId, value] = params;
      const isRunLookup = lower.includes('workflow_run_record_id = $2');
      return {
        rows: [...state.admissions.values()]
          .filter(
            (row) =>
              row.workflow_execution_principal_id === principalId &&
              (isRunLookup
                ? row.workflow_run_record_id === value
                : row.idempotency_key_hash === value),
          )
          .map(clone),
      };
    }

    throw new Error('Unexpected fake SQL: ' + statement.slice(0, 180));
  };

  const pool = {
    async connect() {
      return {
        async query(sql) {
          const text = String(sql).toLowerCase();
          if (text.includes('pg_try_advisory_lock')) {
            if (state.lockHeld) return { rows: [{ locked: false }] };
            state.lockHeld = true;
            return { rows: [{ locked: true }] };
          }
          if (text.includes('pg_advisory_unlock')) {
            state.lockHeld = false;
            return { rows: [{ pg_advisory_unlock: true }] };
          }
          throw new Error('Unexpected fake pool SQL: ' + sql);
        },
        release() {},
      };
    },
  };

  return { query, pool };
}

function createExecutor(state) {
  return {
    async getWorkflowDefinition(workflowCode) {
      const definition = state.definitions[workflowCode];
      if (!definition) throw createError('Workflow not found', 'WORKFLOW_NOT_FOUND');
      return clone(definition);
    },

    async validateWorkflowRuntimeInput(definition, input) {
      const params = input.params || {};
      const definitions = definition.config?.runtimeParameters || [];
      const allowedKeys = new Set(definitions.map((item) => item.key));
      const unknown = Object.keys(params).filter((key) => !allowedKeys.has(key));
      if (unknown.length > 0) {
        throw new WorkflowServiceError('Unknown Workflow parameter.', 400, {
          code: 'WORKFLOW_UNKNOWN_PARAMETER',
          unknownParameterKeys: unknown,
        });
      }
      for (const parameter of definitions) {
        if (
          parameter.required &&
          (params[parameter.key] === undefined || params[parameter.key] === null)
        ) {
          throw new WorkflowServiceError('Required Workflow parameter is missing.', 400, {
            code: 'WORKFLOW_REQUIRED_PARAMETER_MISSING',
            parameterKey: parameter.key,
          });
        }
      }
      if (
        params.repoName !== undefined &&
        (typeof params.repoName !== 'string' || params.repoName.length > 80)
      ) {
        throw new WorkflowServiceError('Invalid repository parameter.', 400, {
          code: 'WORKFLOW_PARAMETER_INVALID',
        });
      }
      return { params: clone(params) };
    },

    async startWorkflowWithTemporal(args) {
      state.dispatchCalls += 1;
      state.lastActor = clone(args.user);
      state.lastContext = clone(args.context);
      state.lastWorkflowVersionId = args.workflowVersionId;
      if (state.dispatchDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, state.dispatchDelayMs));
      }
      if (state.runtimeDenied) {
        throw createError('Runtime denied after preflight', 'WORKFLOW_RUNTIME_PERMISSION_DENIED');
      }
      if (state.executorError) throw state.executorError;
      let run = state.runs.get(args.workflowRunRecordId);
      if (!run) {
        run = {
          workflowRunRecordId: args.workflowRunRecordId,
          workflowCode: args.workflowCode,
          workflowVersionId: args.workflowVersionId,
          versionNumber: args.input.workflowVersionId === IDS.version5 ? 5 : 4,
          status: 'RUNNING',
          summary: 'Workflow started.',
          temporalWorkflowId: null,
          temporalRunId: null,
        };
        state.runs.set(run.workflowRunRecordId, run);
        state.runCreateCount += 1;
      }
      if (state.crashAfterRunOnce) {
        state.crashAfterRunOnce = false;
        throw createCrashError();
      }
      let temporal = state.temporal.get(args.input.workflowId);
      let reused = false;
      if (!temporal) {
        temporal = {
          workflowId: args.input.workflowId,
          runId:
            '00000000-0000-4000-8000-' + String(state.temporalExecutions + 100).padStart(12, '0'),
        };
        state.temporal.set(temporal.workflowId, temporal);
        state.temporalExecutions += 1;
      } else {
        reused = true;
      }
      run.temporalWorkflowId = temporal.workflowId;
      run.temporalRunId = temporal.runId;
      run.status = 'RUNNING';
      return {
        ok: true,
        run,
        temporalWorkflow: {
          workflowId: temporal.workflowId,
          runId: temporal.runId,
          reused,
        },
      };
    },

    async getWorkflowRun(workflowRunRecordId) {
      const run = state.runs.get(workflowRunRecordId);
      if (!run) throw new WorkflowServiceError('Run not found.', 404, { code: 'RUN_NOT_FOUND' });
      const status = state.pollStatuses.length > 0 ? state.pollStatuses.shift() : run.status;
      const secret = state.detailSecret;
      return {
        run: {
          ...run,
          status,
          summary: secret ? 'Underlying tool summary: ' + secret : run.summary,
          temporalRuntime: {
            available: true,
            workflowId: run.temporalWorkflowId,
            runId: run.temporalRunId,
            status,
            warnings: secret ? ['Temporal warning: ' + secret] : [],
          },
        },
        nodeRuns: [
          {
            workflowNodeRunRecordId: '00000000-0000-4000-8000-000000000031',
            nodeKey: 'repo_map',
            nodeTypeCode: 'TOOL',
            targetCode: 'repo-map-tool',
            status: status,
            attemptCount: 1,
            errorMessage: secret ? 'Node error: ' + secret : null,
          },
        ],
        nodeOutputs: [
          {
            nodeKey: 'repo_map',
            outputKey: 'summary',
            outputType: 'text',
            outputSummary: secret ? 'Node output: ' + secret : 'safe output',
            status,
            attemptCount: 1,
            createdAt: '2026-09-17T12:00:04.000Z',
          },
        ],
        approvals: state.approvals.length ? state.approvals : [],
      };
    },
  };
}

function createAuth(state) {
  return {
    async recordAuditEvent(event) {
      state.audits.push(clone(event));
      return { ok: true };
    },
  };
}

function request(key, parameters = { repoName: 'SkyCommand' }) {
  return {
    workflowCode: 'repo-map-zip',
    parameters,
    idempotencyKey: key,
  };
}

async function invoke(state, requestValue, options = {}) {
  return service.startWorkflow({
    request: requestValue,
    principalCode: options.principalCode || 'assistant-http',
    authMode: options.authMode || 'ASSISTANT_SERVICE_TOKEN',
    actor: options.actor || { displayName: 'caller-controlled-label' },
    session: options.session || null,
    context: options.context || {},
    environment: options.environment || ENV,
  });
}

async function readRun(state, workflowRunRecordId, principalCode = 'assistant-http') {
  return service.getWorkflowRun({
    workflowRunRecordId,
    principalCode,
    authMode: 'ASSISTANT_SERVICE_TOKEN',
  });
}

async function withState(state, callback) {
  const database = createDatabase(state);
  const executor = createExecutor(state);
  const auth = createAuth(state);
  return service.withTestDependencies(
    {
      query: database.query,
      pool: database.pool,
      workflowExecutor: executor,
      auth,
      hooks: state.hooks,
    },
    callback,
  );
}

async function expectCode(callback, code) {
  await assert.rejects(callback, (error) => error?.details?.code === code || error?.code === code);
}

async function scenarioRecognizedPrincipal() {
  const state = createState();
  await withState(state, async () => {
    const receipt = await invoke(state, request('recognized'));
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.status, 'STARTED');
    assert.equal(state.temporalExecutions, 1);
    assert.equal(state.lastActor.displayName, 'SkyCommand Assistant HTTP integration');
    assert.equal(state.lastContext.executionContext.principalCode, 'assistant-http');
  });
}

async function scenarioPrincipalAndCallerLabelDenial() {
  const state = createState();
  await withState(state, async () => {
    await expectCode(
      () => invoke(state, request('unknown-principal'), { principalCode: 'not-registered' }),
      'WORKFLOW_PRINCIPAL_NOT_REGISTERED',
    );
    await expectCode(
      () => invoke(state, { ...request('fake-label'), agentId: 'caller-controlled' }),
      'INVALID_REQUEST',
    );
    assert.equal(state.admissions.size, 0);
  });
}

async function scenarioMissingWorkflowRunPermission() {
  const state = createState();
  state.grants[0].allowedPermissionCodes = PERMISSIONS.filter((code) => code !== 'WORKFLOW_RUN');
  await withState(state, async () => {
    await expectCode(
      () => invoke(state, request('missing-run-permission')),
      'WORKFLOW_AUTHORITY_CLOSURE_MISSING',
    );
    assert.equal(state.admissions.size, 0);
  });
}

async function scenarioMissingGrantAndProfileMismatch() {
  const missingGrant = createState();
  missingGrant.grants = [];
  await withState(missingGrant, async () => {
    await expectCode(
      () => invoke(missingGrant, request('missing-grant')),
      'WORKFLOW_RESOURCE_GRANT_DENIED',
    );
    assert.equal(missingGrant.admissions.size, 0);
  });

  const mismatch = createState();
  await withState(mismatch, async () => {
    await expectCode(
      () =>
        invoke(mismatch, request('profile-mismatch'), {
          environment: {
            SKYCOMMAND_CONFIG_PROFILE: 'DOCKER_LOCAL',
            SKYCOMMAND_ENVIRONMENT_CODE: 'DOCKER_LOCAL',
          },
        }),
      'WORKFLOW_RESOURCE_GRANT_DENIED',
    );
  });
}

async function scenarioInactiveAndUnpublished() {
  const inactive = createState();
  inactive.definitions['repo-map-zip'].status = 'INACTIVE';
  await withState(inactive, async () => {
    await expectCode(() => invoke(inactive, request('inactive')), 'WORKFLOW_INACTIVE');
    assert.equal(inactive.admissions.size, 0);
  });

  const unpublished = createState();
  unpublished.definitions['repo-map-zip'].publishedVersionId = null;
  await withState(unpublished, async () => {
    await expectCode(
      () => invoke(unpublished, request('unpublished')),
      'WORKFLOW_PUBLISHED_VERSION_REQUIRED',
    );
    assert.equal(unpublished.admissions.size, 0);
  });
}

async function scenarioParameterAndInjectionDenial() {
  const state = createState();
  await withState(state, async () => {
    await expectCode(
      () =>
        invoke(state, {
          ...request('unknown-parameter'),
          parameters: { repoName: 'SkyCommand', unknown: true },
        }),
      'WORKFLOW_UNKNOWN_PARAMETER',
    );
    await expectCode(
      () => invoke(state, request('required-omission', { includeTests: true })),
      'WORKFLOW_REQUIRED_PARAMETER_MISSING',
    );
    for (const field of ['securityContext', 'actor', 'runSource', 'permissions']) {
      await expectCode(
        () => invoke(state, { ...request('inject-' + field), [field]: 'caller-value' }),
        'INVALID_REQUEST',
      );
    }
    assert.equal(state.admissions.size, 0);
  });
}

async function scenarioAuthorityClosure() {
  const missingTool = createState();
  missingTool.definitions['repo-map-zip'].nodes[0].targetCode = 'missing-tool';
  await withState(missingTool, async () => {
    await expectCode(
      () => invoke(missingTool, request('missing-tool')),
      'WORKFLOW_AUTHORITY_CLOSURE_TOOL_MISSING',
    );
    assert.equal(missingTool.temporalExecutions, 0);
  });

  const missingPermission = createState();
  missingPermission.grants[0].allowedPermissionCodes = PERMISSIONS.filter(
    (code) => code !== 'REPO_MAP_GENERATE',
  );
  await withState(missingPermission, async () => {
    await expectCode(
      () => invoke(missingPermission, request('missing-tool-permission')),
      'WORKFLOW_AUTHORITY_CLOSURE_MISSING',
    );
    assert.equal(missingPermission.temporalExecutions, 0);
  });

  const child = createState();
  child.definitions.parent = createDefinition({
    workflowDefinitionId: IDS.definition,
    workflowCode: 'parent',
    nodes: [
      {
        nodeKey: 'child',
        nodeTypeCode: 'WORKFLOW',
        targetCode: 'child-workflow',
        inputParameters: {},
      },
    ],
  });
  child.definitions['child-workflow'] = createDefinition({
    workflowDefinitionId: IDS.childDefinition,
    publishedVersionId: IDS.childVersion,
    workflowCode: 'child-workflow',
  });
  child.grants[0].workflowCode = 'parent';
  await withState(child, async () => {
    await expectCode(
      () => invoke(child, { ...request('ungranted-child'), workflowCode: 'parent' }),
      'WORKFLOW_RESOURCE_GRANT_DENIED',
    );
    assert.equal(child.temporalExecutions, 0);
  });
}

async function scenarioRuntimeAuthorization() {
  const state = createState();
  state.runtimeDenied = true;
  await withState(state, async () => {
    await expectCode(
      () => invoke(state, request('runtime-denied')),
      'WORKFLOW_RUNTIME_PERMISSION_DENIED',
    );
    assert.equal(state.dispatchCalls, 1);
    assert.equal(state.temporalExecutions, 0);
    const admission = [...state.admissions.values()][0];
    assert.equal(admission.status, 'FAILED');
  });
}

async function scenarioIdempotencyAndConflict() {
  const state = createState();
  await withState(state, async () => {
    const first = await invoke(state, request('same-key'));
    const second = await invoke(state, request('same-key'));
    assert.equal(second.reused, true);
    assert.equal(second.admissionId, first.admissionId);
    assert.equal(second.workflowRunRecordId, first.workflowRunRecordId);
    assert.equal(state.temporalExecutions, 1);
  });

  const conflict = createState();
  await withState(conflict, async () => {
    await invoke(conflict, request('payload-key', { repoName: 'SkyCommand', includeTests: false }));
    await expectCode(
      () =>
        invoke(conflict, request('payload-key', { repoName: 'SkyCommand', includeTests: true })),
      'WORKFLOW_IDEMPOTENCY_CONFLICT',
    );
  });
}

async function scenarioConcurrentDuplicate() {
  const state = createState();
  state.dispatchDelayMs = 60;
  await withState(state, async () => {
    const receipts = await Promise.all([
      invoke(state, request('concurrent-key')),
      invoke(state, request('concurrent-key')),
    ]);
    assert.equal(state.temporalExecutions, 1);
    assert.equal(state.runCreateCount, 1);
    assert.equal(receipts[0].workflowRunRecordId, receipts[1].workflowRunRecordId);
    assert.equal(receipts[0].admissionId, receipts[1].admissionId);
  });
}

async function scenarioVersionPinning() {
  const conflict = createState();
  await withState(conflict, async () => {
    await invoke(conflict, request('version-key'));
    conflict.definitions['repo-map-zip'] = createDefinition({
      publishedVersionId: IDS.version5,
      publishedVersionNumber: 5,
    });
    await expectCode(
      () => invoke(conflict, request('version-key')),
      'WORKFLOW_IDEMPOTENCY_CONFLICT',
    );
  });

  const republish = createState();
  republish.hooks.afterAdmissionClaim = () => {
    republish.definitions['repo-map-zip'] = createDefinition({
      publishedVersionId: IDS.version5,
      publishedVersionNumber: 5,
    });
  };
  await withState(republish, async () => {
    const receipt = await invoke(republish, request('republish-key'));
    assert.equal(receipt.resource.versionNumber, 4);
    assert.equal(republish.lastWorkflowVersionId, IDS.version4);
  });
}

async function scenarioOwnershipAndPolling() {
  const state = createState();
  let runId;
  await withState(state, async () => {
    const receipt = await invoke(state, request('ownership-key'));
    runId = receipt.workflowRunRecordId;
    const own = await readRun(state, runId);
    assert.equal(own.principal.principalCode, 'assistant-http');
    await expectCode(
      () => readRun(state, runId, 'other-principal'),
      'WORKFLOW_RUN_NOT_FOUND_OR_NOT_OWNED',
    );
    await expectCode(
      () => readRun(state, runId, 'other-principal'),
      'WORKFLOW_RUN_NOT_FOUND_OR_NOT_OWNED',
    );
  });

  const polling = createState();
  await withState(polling, async () => {
    const receipt = await invoke(polling, request('polling-key'));
    polling.pollStatuses = ['RUNNING', 'COMPLETED'];
    const first = await readRun(polling, receipt.workflowRunRecordId);
    const second = await readRun(polling, receipt.workflowRunRecordId);
    assert.equal(first.state, 'RUNNING');
    assert.equal(first.terminal, false);
    assert.equal(second.state, 'COMPLETED');
    assert.equal(second.terminal, true);
  });

  const waiting = createState();
  waiting.approvals = [
    { approvalRequestId: 'approval-1', nodeKey: 'repo_map', status: 'PENDING', decision: null },
  ];
  await withState(waiting, async () => {
    const receipt = await invoke(waiting, request('approval-key'));
    const detail = await readRun(waiting, receipt.workflowRunRecordId);
    assert.equal(detail.state, 'WAITING');
    assert.equal(detail.terminal, false);
  });
}

async function scenarioAmbiguousGrant() {
  const state = createState();
  state.grants.push({
    id: IDS.otherGrant,
    principalId: IDS.principal,
    repositoryCode: 'OtherRepo',
    environmentCode: 'DEV_LOCAL',
    configProfileCode: 'DEV_LOCAL',
    workflowCode: 'repo-map-zip',
    allowedPermissionCodes: [...PERMISSIONS],
    status: 'ACTIVE',
  });
  state.bindings.push({ repositoryCode: 'OtherRepo', profileCode: 'DEV_LOCAL' });
  await withState(state, async () => {
    await expectCode(
      () => invoke(state, request('ambiguous-grant')),
      'WORKFLOW_RESOURCE_GRANT_AMBIGUOUS',
    );
    assert.equal(state.admissions.size, 0);
  });
}

async function scenarioCrashRecovery() {
  const beforeDispatch = createState();
  let crashBeforeDispatch = true;
  beforeDispatch.hooks.afterAdmissionClaim = () => {
    if (crashBeforeDispatch) {
      crashBeforeDispatch = false;
      throw createCrashError();
    }
  };
  await withState(beforeDispatch, async () => {
    await expectCode(
      () => invoke(beforeDispatch, request('crash-before-dispatch')),
      'R4_TEST_PROCESS_CRASH',
    );
  });
  assert.equal([...beforeDispatch.admissions.values()][0].status, 'STARTING');
  const resumedBeforeDispatch = await withState(beforeDispatch, () =>
    invoke(beforeDispatch, request('crash-before-dispatch')),
  );
  assert.equal(resumedBeforeDispatch.status, 'STARTED');
  assert.equal(beforeDispatch.runCreateCount, 1);

  const afterRun = createState();
  afterRun.crashAfterRunOnce = true;
  await withState(afterRun, async () => {
    await expectCode(() => invoke(afterRun, request('crash-after-run')), 'R4_TEST_PROCESS_CRASH');
  });
  assert.equal(afterRun.runCreateCount, 1);
  assert.equal(afterRun.temporalExecutions, 0);
  const resumedAfterRun = await withState(afterRun, () =>
    invoke(afterRun, request('crash-after-run')),
  );
  assert.equal(resumedAfterRun.status, 'STARTED');
  assert.equal(afterRun.runCreateCount, 1);
  assert.equal(afterRun.temporalExecutions, 1);

  const afterTemporal = createState();
  let crashAfterTemporal = true;
  afterTemporal.hooks.beforeAdmissionUpdate = () => {
    if (crashAfterTemporal) {
      crashAfterTemporal = false;
      throw createCrashError();
    }
  };
  await withState(afterTemporal, async () => {
    await expectCode(
      () => invoke(afterTemporal, request('crash-after-temporal')),
      'R4_TEST_PROCESS_CRASH',
    );
  });
  assert.equal(afterTemporal.temporalExecutions, 1);
  const resumedAfterTemporal = await withState(afterTemporal, () =>
    invoke(afterTemporal, request('crash-after-temporal')),
  );
  assert.equal(resumedAfterTemporal.reused, true);
  assert.equal(afterTemporal.temporalExecutions, 1);
}

async function scenarioSafeRedaction() {
  const secret = 'super-secret-test-token-123';
  const failed = createState();
  const underlying = createError(
    'Tool failed with password=' + secret + ' token=' + secret,
    'UNDERLYING_FAILURE',
  );
  failed.executorError = underlying;
  await withState(failed, async () => {
    await expectCode(
      () =>
        invoke(failed, request('redaction-failure'), {
          context: { userAgent: 'agent ' + secret },
        }),
      'UNDERLYING_FAILURE',
    );
  });
  const failedAdmission = [...failed.admissions.values()][0];
  assert.doesNotMatch(JSON.stringify(failedAdmission), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(failed.audits), new RegExp(secret));

  const readable = createState();
  await withState(readable, async () => {
    const receipt = await invoke(readable, request('redaction-read'));
    readable.detailSecret = secret;
    const detail = await readRun(readable, receipt.workflowRunRecordId);
    assert.doesNotMatch(JSON.stringify(detail), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(readable.audits), new RegExp(secret));
  });
}

const scenarios = [
  ['recognized principal starts allowlisted Workflow', scenarioRecognizedPrincipal],
  [
    'invalid principal and caller label cannot create ownership',
    scenarioPrincipalAndCallerLabelDenial,
  ],
  ['missing WORKFLOW_RUN permission denied', scenarioMissingWorkflowRunPermission],
  ['missing grant and profile mismatch denied', scenarioMissingGrantAndProfileMismatch],
  ['inactive and unpublished Workflows denied', scenarioInactiveAndUnpublished],
  [
    'unknown/required parameters and security injection denied',
    scenarioParameterAndInjectionDenial,
  ],
  ['Tool and child-Workflow authority closure enforced', scenarioAuthorityClosure],
  ['runtime authorization remains active after preflight', scenarioRuntimeAuthorization],
  ['idempotent resend and changed-payload conflict', scenarioIdempotencyAndConflict],
  ['concurrent duplicate creates one execution', scenarioConcurrentDuplicate],
  ['version pinning and republish race preserved', scenarioVersionPinning],
  ['ownership, artifact denial, and polling states', scenarioOwnershipAndPolling],
  ['ambiguous resource grants fail closed', scenarioAmbiguousGrant],
  ['all three crash windows and restart re-entry recover', scenarioCrashRecovery],
  ['safe error and run-detail redaction', scenarioSafeRedaction],
];

async function main() {
  for (const [name, scenario] of scenarios) {
    await scenario();
    console.log('[workflow-agent-execution:integration] PASS ' + name);
  }
  console.log(
    '[workflow-agent-execution:integration] PASS (' +
      REQUIRED_BEHAVIORAL_CASE_COUNT +
      ' required behavioral cases across ' +
      scenarios.length +
      ' fixture scenarios)',
  );
}

main().catch((error) => {
  console.error('[workflow-agent-execution:integration] FAIL', error);
  process.exitCode = 1;
});
