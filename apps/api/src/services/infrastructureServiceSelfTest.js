const assert = require('node:assert/strict');

const {
  buildContainerControl,
  buildDockerTarget,
  buildProjectControl,
  buildUnavailableDockerOverview,
  controlDockerComposeProject,
  controlDockerContainer,
  controlDockerResource,
  getDockerContainerDetail,
  getDockerOverview,
  getDockerResourceDetail,
  listDockerOperations,
} = require('./infrastructureService');

const target = buildDockerTarget({
  enabled: true,
  online: true,
  status: 'ONLINE',
  taskQueue: 'skycommand-host-local',
  availabilitySource: 'HEARTBEAT',
  latestHeartbeat: {
    hostname: 'dev-host',
    metadata: { profileCode: 'DEV_LOCAL' },
  },
});
assert.equal(target.providerCode, 'DOCKER');
assert.equal(target.transport, 'HOST_AGENT');
assert.equal(target.status, 'ONLINE');
assert.equal(target.hostname, 'dev-host');

const unavailable = buildUnavailableDockerOverview({
  enabled: false,
  online: false,
  status: 'DISABLED',
  taskQueue: 'skycommand-host-local',
});
assert.equal(unavailable.provider.status, 'DISABLED');
assert.equal(unavailable.error.code, 'SKYCOMMAND_HOST_AGENT_DISABLED');

const externalControl = buildProjectControl({
  name: 'skydata',
  state: 'STOPPED',
  configFileList: ['C:\\SkyDataStudio\\compose.yaml'],
});
assert.equal(externalControl.allowed, true);
assert.equal(externalControl.actions.start, true);
assert.equal(externalControl.actions.stop, false);

const selfControl = buildProjectControl({
  name: 'skycommand',
  state: 'RUNNING',
  configFileList: ['C:\\SkyCommand\\compose.yaml'],
});
assert.equal(selfControl.allowed, false);
assert.equal(selfControl.mode, 'SELF_MANAGED_PROTECTED');

const externalContainerControl = buildContainerControl({
  id: 'abcdef123456',
  name: 'skydata-api-1',
  project: 'infra',
  state: 'RUNNING',
});
assert.equal(externalContainerControl.allowed, true);
assert.equal(externalContainerControl.actions.stop, true);
assert.equal(externalContainerControl.actions.pause, true);
assert.equal(externalContainerControl.actions.start, false);

const selfContainerControl = buildContainerControl({
  id: '123456abcdef',
  name: 'skycommand-api-1',
  project: 'skycommand',
  state: 'RUNNING',
});
assert.equal(selfContainerControl.allowed, false);
assert.equal(selfContainerControl.mode, 'SELF_MANAGED_PROTECTED');

(async () => {
  const overview = await getDockerOverview({
    availabilityLoader: async () => ({
      enabled: true,
      online: true,
      status: 'ONLINE',
      taskQueue: 'skycommand-host-local',
      availabilitySource: 'TEMPORAL_PROBE',
      liveProbe: { hostname: 'dev-host', profileCode: 'DEV_LOCAL' },
    }),
    dispatcher: async () => ({
      ok: true,
      result: {
        provider: { code: 'DOCKER', status: 'ONLINE', engineVersion: '28.0.0' },
        host: { hostname: 'dev-host' },
        counts: { projects: 1, containers: 2 },
        projects: [
          {
            name: 'skycommand',
            state: 'RUNNING',
            configFiles: 'C:\\SkyCommand\\compose.yaml',
          },
        ],
        containers: [],
        images: [],
        volumes: [],
        networks: [],
        capturedAt: new Date().toISOString(),
      },
    }),
  });

  assert.equal(overview.target.providerCode, 'DOCKER');
  assert.equal(overview.target.status, 'ONLINE');
  assert.equal(overview.provider.engineVersion, '28.0.0');
  assert.equal(overview.counts.projects, 1);
  assert.equal(overview.projects[0].control.mode, 'SELF_MANAGED_PROTECTED');
  assert.equal(overview.error, null);

  const audits = [];
  const snapshots = [
    {
      target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
      error: null,
      projects: [
        {
          name: 'skydata',
          state: 'STOPPED',
          configFileList: ['C:\\SkyDataStudio\\compose.yaml'],
        },
      ],
    },
    {
      target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
      error: null,
      projects: [
        {
          name: 'skydata',
          state: 'RUNNING',
          configFileList: ['C:\\SkyDataStudio\\compose.yaml'],
        },
      ],
    },
  ];
  let overviewIndex = 0;
  const controlResult = await controlDockerComposeProject({
    projectName: 'skydata',
    action: 'START',
    confirmed: true,
    actor: { userId: '11111111-1111-1111-1111-111111111111' },
    session: { appCode: 'SKYSERVER_ADMIN' },
    overviewLoader: async () => snapshots[Math.min(overviewIndex++, snapshots.length - 1)],
    dispatcher: async (input) => {
      assert.equal(input.projectName, 'skydata');
      assert.equal(input.action, 'START');
      assert.equal(input.configFiles.length, 1);
      return { ok: true, result: { status: 'SUCCESS' } };
    },
    auditRecorder: async (event) => audits.push(event),
  });

  assert.equal(controlResult.operation.status, 'SUCCESS');
  assert.equal(controlResult.operation.previousState, 'STOPPED');
  assert.equal(controlResult.operation.resultingState, 'RUNNING');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].eventType, 'DOCKER_COMPOSE_CONTROL');
  assert.equal(audits[0].success, true);

  const blockedAudits = [];
  await assert.rejects(
    () => controlDockerComposeProject({
      projectName: 'skycommand',
      action: 'STOP',
      confirmed: true,
      overviewLoader: async () => ({
        target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
        error: null,
        projects: [
          {
            name: 'skycommand',
            state: 'RUNNING',
            configFileList: ['C:\\SkyCommand\\compose.yaml'],
          },
        ],
      }),
      dispatcher: async () => {
        throw new Error('dispatcher should not run for self control');
      },
      auditRecorder: async (event) => blockedAudits.push(event),
    }),
    (error) => error.details?.code === 'SKYCOMMAND_DOCKER_SELF_CONTROL_BLOCKED',
  );
  assert.equal(blockedAudits.length, 1);
  assert.equal(blockedAudits[0].success, false);

  const containerOverview = {
    target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
    error: null,
    containers: [
      {
        id: 'abcdef123456',
        name: 'skydata-api-1',
        project: 'infra',
        service: 'api',
        state: 'RUNNING',
        health: 'HEALTHY',
      },
    ],
  };
  const detailResult = await getDockerContainerDetail({
    containerId: 'abcdef123456',
    tail: 75,
    overviewLoader: async () => containerOverview,
    dispatcher: async (input) => {
      assert.equal(input.containerId, 'abcdef123456');
      assert.equal(input.tail, 75);
      return {
        ok: true,
        result: {
          container: {
            id: 'abcdef1234567890',
            name: 'skydata-api-1',
            project: 'infra',
            service: 'api',
            state: { status: 'RUNNING', health: 'HEALTHY' },
            security: { environmentRedacted: true },
          },
          logs: { stdout: 'hello', stderr: '', tail: 75, available: true },
          capturedAt: new Date().toISOString(),
        },
      };
    },
  });
  assert.equal(detailResult.container.name, 'skydata-api-1');
  assert.equal(detailResult.container.control.actions.pause, true);
  assert.equal(detailResult.logs.stdout, 'hello');
  assert.equal(detailResult.container.security.environmentRedacted, true);

  const containerAudits = [];
  const containerSnapshots = [
    {
      target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
      error: null,
      containers: [
        {
          id: 'abcdef123456',
          name: 'skydata-api-1',
          project: 'infra',
          service: 'api',
          state: 'RUNNING',
        },
      ],
    },
    {
      target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
      error: null,
      containers: [
        {
          id: 'abcdef123456',
          name: 'skydata-api-1',
          project: 'infra',
          service: 'api',
          state: 'PAUSED',
        },
      ],
    },
  ];
  let containerOverviewIndex = 0;
  const containerControlResult = await controlDockerContainer({
    containerId: 'abcdef123456',
    action: 'PAUSE',
    confirmed: true,
    actor: { userId: '11111111-1111-1111-1111-111111111111' },
    session: { appCode: 'SKYSERVER_ADMIN' },
    overviewLoader: async () => containerSnapshots[
      Math.min(containerOverviewIndex++, containerSnapshots.length - 1)
    ],
    dispatcher: async (input) => {
      assert.equal(input.containerId, 'abcdef123456');
      assert.equal(input.action, 'PAUSE');
      return { ok: true, result: { status: 'SUCCESS' } };
    },
    auditRecorder: async (event) => containerAudits.push(event),
  });
  assert.equal(containerControlResult.operation.status, 'SUCCESS');
  assert.equal(containerControlResult.operation.previousState, 'RUNNING');
  assert.equal(containerControlResult.operation.resultingState, 'PAUSED');
  assert.equal(containerAudits.length, 1);
  assert.equal(containerAudits[0].eventType, 'DOCKER_CONTAINER_CONTROL');
  assert.equal(containerAudits[0].metadata.projectName, 'infra');

  const blockedContainerAudits = [];
  await assert.rejects(
    () => controlDockerContainer({
      containerId: '123456abcdef',
      action: 'STOP',
      confirmed: true,
      overviewLoader: async () => ({
        target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
        error: null,
        containers: [
          {
            id: '123456abcdef',
            name: 'skycommand-api-1',
            project: 'skycommand',
            service: 'api',
            state: 'RUNNING',
          },
        ],
      }),
      dispatcher: async () => {
        throw new Error('dispatcher should not run for protected SkyCommand container');
      },
      auditRecorder: async (event) => blockedContainerAudits.push(event),
    }),
    (error) => error.details?.code === 'SKYCOMMAND_DOCKER_SELF_CONTROL_BLOCKED',
  );
  assert.equal(blockedContainerAudits.length, 1);
  assert.equal(blockedContainerAudits[0].success, false);

  const resourceOverview = {
    target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
    error: null,
    images: [
      {
        id: 'abc123def456',
        repository: 'demo',
        tag: 'test',
        reference: 'demo:test',
        cleanup: { mode: 'GUARDED_REMOVE', eligible: true, usageCount: 0 },
      },
    ],
    volumes: [
      {
        name: 'demo_data',
        cleanup: { mode: 'DATA_PROTECTED', eligible: false, usageCount: 0 },
      },
    ],
    networks: [
      {
        id: 'network123456',
        name: 'demo_default',
        cleanup: { mode: 'GUARDED_REMOVE', eligible: true, usageCount: 0 },
      },
    ],
  };
  const imageDetail = await getDockerResourceDetail({
    resourceType: 'IMAGE',
    reference: 'demo:test',
    overviewLoader: async () => resourceOverview,
    dispatcher: async (input) => {
      assert.equal(input.resourceType, 'IMAGE');
      assert.equal(input.reference, 'demo:test');
      return {
        ok: true,
        result: {
          resource: {
            resourceType: 'IMAGE',
            reference: 'demo:test',
            id: 'sha256:abc123def456',
            usageCount: 0,
            cleanup: { mode: 'GUARDED_REMOVE', eligible: true },
          },
        },
      };
    },
  });
  assert.equal(imageDetail.resource.reference, 'demo:test');
  assert.equal(imageDetail.resource.cleanup.eligible, true);

  const resourceAudits = [];
  const resourceControlResult = await controlDockerResource({
    resourceType: 'NETWORK',
    reference: 'demo_default',
    action: 'REMOVE',
    confirmed: true,
    actor: { userId: '11111111-1111-1111-1111-111111111111' },
    session: { appCode: 'SKYSERVER_ADMIN' },
    overviewLoader: async () => resourceOverview,
    dispatcher: async (input) => {
      assert.equal(input.resourceType, 'NETWORK');
      assert.equal(input.reference, 'demo_default');
      assert.equal(input.action, 'REMOVE');
      return { ok: true, result: { status: 'SUCCESS' } };
    },
    auditRecorder: async (event) => resourceAudits.push(event),
  });
  assert.equal(resourceControlResult.operation.status, 'SUCCESS');
  assert.equal(resourceControlResult.operation.resourceType, 'NETWORK');
  assert.equal(resourceAudits[0].eventType, 'DOCKER_RESOURCE_CONTROL');

  await assert.rejects(
    () => controlDockerResource({
      resourceType: 'VOLUME',
      reference: 'demo_data',
      action: 'REMOVE',
      confirmed: true,
      overviewLoader: async () => resourceOverview,
    }),
    (error) => error.details?.code === 'SKYCOMMAND_DOCKER_VOLUME_DATA_PROTECTED',
  );

  const operationQueries = [];
  const operationList = await listDockerOperations(
    { scope: 'CONTAINER', projectName: 'infra', action: 'PAUSE', success: 'true', limit: 10 },
    {
      queryExecutor: async (text, params) => {
        operationQueries.push({ text, params });
        if (/COUNT\(\*\)/.test(text)) return { rows: [{ total: 1 }] };
        return {
          rows: [
            {
              audit_event_id: 'audit-1',
              user_id: 'user-1',
              display_name: 'Paul-SuperAdmin',
              event_type: 'DOCKER_CONTAINER_CONTROL',
              resource_type: 'docker_container',
              resource_id: 'skydata-api-1',
              action: 'pause',
              success: true,
              message: 'PAUSE completed.',
              metadata: {
                operationId: 'op-1',
                projectName: 'infra',
                containerId: 'abcdef123456',
                containerName: 'skydata-api-1',
                serviceName: 'api',
                previousState: 'RUNNING',
                resultingState: 'PAUSED',
                durationMs: 123,
              },
              created_at: new Date().toISOString(),
            },
          ],
        };
      },
    },
  );
  assert.equal(operationList.total, 1);
  assert.equal(operationList.items[0].resourceType, 'CONTAINER');
  assert.equal(operationList.items[0].resourceName, 'skydata-api-1');
  assert.equal(operationList.items[0].projectName, 'infra');
  assert.equal(operationList.items[0].action, 'PAUSE');
  assert.deepEqual(operationQueries[0].params[0], ['DOCKER_CONTAINER_CONTROL']);
  assert.equal(operationQueries[0].params[1], 'infra');

  const resourceOperationList = await listDockerOperations(
    { scope: 'RESOURCE', action: 'REMOVE', success: 'true', limit: 10 },
    {
      queryExecutor: async (text, params) => {
        if (/COUNT\(\*\)/.test(text)) return { rows: [{ total: 1 }] };
        assert.deepEqual(params[0], ['DOCKER_RESOURCE_CONTROL']);
        return {
          rows: [
            {
              audit_event_id: 'audit-resource-1',
              user_id: 'user-1',
              display_name: 'Paul-SuperAdmin',
              event_type: 'DOCKER_RESOURCE_CONTROL',
              resource_type: 'docker_network',
              resource_id: 'demo_default',
              action: 'remove',
              success: true,
              message: 'REMOVE completed.',
              metadata: {
                operationId: 'op-resource-1',
                dockerResourceType: 'NETWORK',
                resourceReference: 'demo_default',
                previousState: 'AVAILABLE',
                resultingState: 'REMOVED',
              },
              created_at: new Date().toISOString(),
            },
          ],
        };
      },
    },
  );
  assert.equal(resourceOperationList.items[0].resourceType, 'NETWORK');
  assert.equal(resourceOperationList.items[0].resourceName, 'demo_default');
  assert.equal(resourceOperationList.items[0].action, 'REMOVE');

  console.log('✅ SkyCommand infrastructure service self-test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
