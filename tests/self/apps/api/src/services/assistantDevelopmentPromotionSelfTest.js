const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../../..');
// The service imports the existing workflow executor, whose DB module validates
// connection configuration at load time. These local dummy values are never used
// for a query; all execution and audit calls below are injected stubs.
process.env.PGHOST ||= '127.0.0.1';
process.env.PGDATABASE ||= 'skycommand_self_test';
process.env.PGUSER ||= 'skycommand_self_test';
process.env.PGPASSWORD ||= 'skycommand_self_test';
const assistant = require(path.join(ROOT, 'apps/api/src/services/assistantIntegrationService'));
const middlewareModule = require(path.join(ROOT, 'apps/api/src/middleware/assistantIntegrationMiddleware'));

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function setPromotionEnv({ enabled, repository }) {
  if (enabled === undefined) delete process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_ENABLED;
  else process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_ENABLED = enabled;
  if (repository === undefined) delete process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_REPOSITORY;
  else process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_REPOSITORY = repository;
}

function permissionObjects(permissionCodes) {
  return permissionCodes.map((permissionCode) => ({ permissionCode }));
}

async function assertRejected(action, expectedCode) {
  await assert.rejects(action, (error) => {
    assert.equal(error.details?.code || error.code, expectedCode);
    return true;
  });
}

async function run() {
  const routes = read('apps/api/src/routes/assistantIntegration.routes.js');
  const controller = read('apps/api/src/controllers/assistantIntegrationController.js');
  const service = read('apps/api/src/services/assistantIntegrationService.js');
  const middleware = read('apps/api/src/middleware/assistantIntegrationMiddleware.js');

  const originalEnabled = process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_ENABLED;
  const originalRepository = process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_REPOSITORY;

  try {
    setPromotionEnv({ enabled: undefined, repository: undefined });
    const disabledConfig = assistant.getDevelopmentPromotionConfig();
    assert.equal(disabledConfig.enabled, false);
    assert.equal(disabledConfig.blockedReason, 'ASSISTANT_DEV_PROMOTION_DISABLED');
    assert.equal(
      assistant.getCapabilities({ permissionCodes: [] }).developmentPromotion.enabled,
      false,
    );
    assert.equal(
      assistant.getOpenApiDocument().paths['/development-promotion/runs'].post.operationId,
      'skycommand_development_promotion_start',
    );
    await assertRejected(
      () =>
        assistant.startDevelopmentPromotion({
          body: { commitMessage: 'disabled' },
          permissions: [{ permissionCode: 'WORKFLOW_RUN' }],
          workflowExecutor: {
            startWorkflowWithTemporal: async () => {
              throw new Error('must not execute');
            },
          },
        }),
      'ASSISTANT_DEV_PROMOTION_DISABLED',
    );

    setPromotionEnv({ enabled: 'true', repository: 'SkyCommand' });
    assert.equal(assistant.getDevelopmentPromotionConfig().enabled, true);
    const requiredPermissionCodes = assistant.DEVELOPMENT_PROMOTION_REQUIRED_PERMISSION_CODES;
    const completePermissions = permissionObjects(requiredPermissionCodes);
    const promotionOpenApi = assistant.getOpenApiDocument().paths['/development-promotion/runs'].post;
    assert.deepEqual(promotionOpenApi['x-required-permission-codes'], requiredPermissionCodes);
    const partialCapability = assistant.getCapabilities({ permissionCodes: ['WORKFLOW_RUN'] });
    assert.equal(partialCapability.developmentPromotion.configured, true);
    assert.equal(partialCapability.developmentPromotion.enabled, false);
    assert.equal(partialCapability.developmentPromotion.executable, false);
    assert.equal(
      partialCapability.developmentPromotion.blockedReason,
      'ASSISTANT_DEV_PROMOTION_PERMISSION_SCOPE_MISSING',
    );
    assert.deepEqual(
      partialCapability.developmentPromotion.requiredPermissionCodes,
      requiredPermissionCodes,
    );
    assert.deepEqual(
      partialCapability.developmentPromotion.missingPermissionCodes,
      requiredPermissionCodes.slice(1),
    );
    assert.equal(
      assistant.getCapabilities({ permissionCodes: requiredPermissionCodes }).developmentPromotion
        .enabled,
      true,
    );
    assert.deepEqual(
      assistant.getCapabilities({ permissionCodes: requiredPermissionCodes }).developmentPromotion
        .missingPermissionCodes,
      [],
    );

    for (const missingPermissionCode of requiredPermissionCodes) {
      let workflowStartCalls = 0;
      const permissions = permissionObjects(
        requiredPermissionCodes.filter((permissionCode) => permissionCode !== missingPermissionCode),
      );
      await assert.rejects(
        () =>
          assistant.startDevelopmentPromotion({
            body: { commitMessage: `missing ${missingPermissionCode}` },
            permissions,
            workflowExecutor: {
              startWorkflowWithTemporal: async () => {
                workflowStartCalls += 1;
              },
            },
          }),
        (error) => {
          assert.equal(error.statusCode, 403);
          assert.equal(error.details?.code, 'ASSISTANT_DEV_PROMOTION_PERMISSION_SCOPE_MISSING');
          assert.deepEqual(Object.keys(error.details).sort(), ['code', 'missingPermissionCodes']);
          assert.deepEqual(error.details?.missingPermissionCodes, [missingPermissionCode]);
          return true;
        },
      );
      assert.equal(workflowStartCalls, 0);
    }

    for (const body of [
      { commitMessage: 'choose workflow', workflowCode: 'other-workflow' },
      { commitMessage: 'choose repository', repoName: 'OtherRepo' },
      { commitMessage: 'choose repository', repositoryCode: 'OtherRepo' },
      { commitMessage: 'choose executor', executorMode: 'inline' },
      { commitMessage: 'choose approval', approvalDecision: 'APPROVE' },
      { commitMessage: 'choose run source', runSource: 'manual' },
      { commitMessage: 'choose trigger', triggerType: 'MANUAL' },
      { commitMessage: 'choose params', parameters: { anything: true } },
    ]) {
      await assertRejected(
        () =>
          assistant.startDevelopmentPromotion({
            body,
            permissions: completePermissions,
          }),
        'ASSISTANT_DEV_PROMOTION_UNEXPECTED_FIELDS',
      );
    }

    for (const commitMessage of [
      '',
      '   ',
      'line one\nline two',
      '\nleading newline',
      'trailing newline\n',
      `x${'a'.repeat(assistant.DEVELOPMENT_PROMOTION_MAX_COMMIT_MESSAGE_LENGTH)}`,
    ]) {
      await assertRejected(
        () =>
          assistant.startDevelopmentPromotion({
            body: { commitMessage },
            permissions: completePermissions,
          }),
        commitMessage.length > assistant.DEVELOPMENT_PROMOTION_MAX_COMMIT_MESSAGE_LENGTH
          ? 'ASSISTANT_DEV_PROMOTION_COMMIT_MESSAGE_TOO_LONG'
          : 'ASSISTANT_DEV_PROMOTION_INVALID_COMMIT_MESSAGE',
      );
    }

    const calls = [];
    const result = await assistant.startDevelopmentPromotion({
      body: {
        commitMessage: 'Development Control Plane Bootstrap - governed MCP development promotion',
      },
      permissions: completePermissions,
      actor: { userId: null, displayName: 'SkyCommand Agent (codex-local)' },
      session: { authMode: 'ASSISTANT_SERVICE_TOKEN' },
      context: { ipAddress: '127.0.0.1', userAgent: 'self-test' },
      workflowExecutor: {
        startWorkflowWithTemporal: async (input) => {
          calls.push(input);
          return {
            started: true,
            run: { workflowRunRecordId: 'run-self-test' },
            temporalWorkflow: { workflowId: 'temporal-self-test' },
          };
        },
      },
    });

    assert.deepEqual(calls, [
      {
        workflowCode: 'skyserver_dev_commit',
        input: {
          params: {
            commitMessage:
              'Development Control Plane Bootstrap - governed MCP development promotion',
            repoName: 'SkyCommand',
          },
          runSource: 'assistant',
          triggerType: 'ASSISTANT',
        },
        user: { userId: null, displayName: 'SkyCommand Agent (codex-local)' },
        session: { authMode: 'ASSISTANT_SERVICE_TOKEN' },
        permissions: completePermissions,
        context: { ipAddress: '127.0.0.1', userAgent: 'self-test' },
      },
    ]);
    assert.deepEqual(result, {
      accepted: true,
      started: true,
      workflowCode: 'skyserver_dev_commit',
      repositoryCode: 'SkyCommand',
      workflowRunRecordId: 'run-self-test',
      temporalWorkflowId: 'temporal-self-test',
      triggerSource: 'ASSISTANT',
      humanApprovalRequired: true,
      agentMustStop: true,
    });

    const auditEvents = [];
    const request = {
      ip: '127.0.0.1',
      headers: { authorization: 'Bearer must-not-be-audit-value' },
      session: { appCode: 'SKYSERVER_ADMIN' },
      assistantIntegration: { agentId: 'codex-local' },
      get: () => 'self-test',
    };
    await assistant.recordDevelopmentPromotionAudit({
      req: request,
      result,
      success: true,
      auditRecorder: async (event) => auditEvents.push(event),
    });
    await assistant.recordDevelopmentPromotionAudit({
      req: request,
      success: false,
      error: { details: { code: 'ASSISTANT_DEV_PROMOTION_PERMISSION_SCOPE_MISSING' } },
      auditRecorder: async (event) => auditEvents.push(event),
    });
    assert.equal(auditEvents[0].eventType, 'ASSISTANT_DEVELOPMENT_PROMOTION');
    assert.equal(auditEvents[0].action, 'assistant_development_promotion_start');
    assert.equal(auditEvents[0].metadata.agentId, 'codex-local');
    assert.equal(auditEvents[0].metadata.workflowCode, 'skyserver_dev_commit');
    assert.equal(auditEvents[0].metadata.repositoryCode, 'SkyCommand');
    assert.equal(auditEvents[1].success, false);
    assert.equal(
      auditEvents[1].metadata.authorizationErrorCode,
      'ASSISTANT_DEV_PROMOTION_PERMISSION_SCOPE_MISSING',
    );
    assert.ok(!JSON.stringify(auditEvents).includes('must-not-be-audit-value'));

    assert.ok(routes.includes("'/development-promotion/runs'"));
    assert.ok(controller.includes('recordDevelopmentPromotionAudit'));
    assert.ok(service.includes("runSource: 'assistant'"));
    assert.ok(service.includes('triggerType: DEVELOPMENT_PROMOTION_TRIGGER_TYPE'));
    assert.ok(service.includes('DEVELOPMENT_PROMOTION_REQUIRED_PERMISSION_CODES'));
    assert.ok(!routes.includes('approval'));
    assert.ok(!service.includes('WORKFLOW_APPROVAL_DECIDE'));
    assert.ok(middleware.includes("'BROWSER_AUTOMATION_READ'"));
    assert.ok(middleware.includes("'BROWSER_AUTOMATION_RUN'"));
    assert.deepEqual(middlewareModule.DEFAULT_ASSISTANT_PERMISSION_CODES, [
      'BROWSER_AUTOMATION_READ',
      'BROWSER_AUTOMATION_RUN',
    ]);
    for (const permissionCode of requiredPermissionCodes) {
      assert.ok(!middlewareModule.DEFAULT_ASSISTANT_PERMISSION_CODES.includes(permissionCode));
    }

    console.log('[assistant-development-promotion:self-test] PASS');
  } finally {
    if (originalEnabled === undefined)
      delete process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_ENABLED;
    else process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_ENABLED = originalEnabled;
    if (originalRepository === undefined)
      delete process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_REPOSITORY;
    else process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_REPOSITORY = originalRepository;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
