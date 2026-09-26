#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_BACKEND_REBUILD_SERVICES,
  DEFAULT_RUNTIME_SERVICES,
  CODEX_BOOTSTRAP_REBUILD_SERVICES,
  getSupervisorConfig,
  parseBackendRebuildServices,
  parseRuntimeServices,
} = require('./config');
const {
  buildComposeArgs,
  getRuntimeStatus,
  isDockerEngineUnavailable,
  parseComposePsOutput,
  rebuildBackend,
  rebuildCodexBootstrap,
  rebuildWeb,
} = require('./runtimeLifecycle');

assert.deepEqual(parseRuntimeServices(''), DEFAULT_RUNTIME_SERVICES);
assert.deepEqual(parseRuntimeServices(DEFAULT_RUNTIME_SERVICES.join(',')), DEFAULT_RUNTIME_SERVICES);
assert.deepEqual(parseBackendRebuildServices(''), DEFAULT_BACKEND_REBUILD_SERVICES);

const repositoryRoot = path.resolve(sourceDir, '../../..');
function withEnvironment(overrides, callback) {
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const originalWarn = console.warn;
const serviceOverrideWarnings = [];
let configWithLegacyServiceOverrides;
let configWithBroadenedServiceOverrides;
try {
  console.warn = (message) => serviceOverrideWarnings.push(String(message));
  configWithLegacyServiceOverrides = withEnvironment(
    {
      SKYCOMMAND_SUPERVISOR_RUNTIME_SERVICES:
        'postgres,temporal,temporal-worker,browser-worker,node-worker,api',
      SKYCOMMAND_SUPERVISOR_BACKEND_REBUILD_SERVICES:
        'api,temporal-worker,browser-worker,node-worker',
    },
    () => getSupervisorConfig(repositoryRoot),
  );
  configWithBroadenedServiceOverrides = withEnvironment(
    {
      SKYCOMMAND_SUPERVISOR_RUNTIME_SERVICES:
        [...DEFAULT_RUNTIME_SERVICES, 'unapproved-service'].join(','),
      SKYCOMMAND_SUPERVISOR_BACKEND_REBUILD_SERVICES:
        [...DEFAULT_BACKEND_REBUILD_SERVICES, 'unapproved-service'].join(','),
    },
    () => getSupervisorConfig(repositoryRoot),
  );
} finally {
  console.warn = originalWarn;
}
assert.deepEqual(configWithLegacyServiceOverrides.runtimeServices, DEFAULT_RUNTIME_SERVICES);
assert.deepEqual(
  configWithLegacyServiceOverrides.backendRebuildServices,
  DEFAULT_BACKEND_REBUILD_SERVICES,
);
assert.deepEqual(configWithBroadenedServiceOverrides.runtimeServices, DEFAULT_RUNTIME_SERVICES);
assert.deepEqual(
  configWithBroadenedServiceOverrides.backendRebuildServices,
  DEFAULT_BACKEND_REBUILD_SERVICES,
);
assert.equal(serviceOverrideWarnings.length, 4);
assert.ok(serviceOverrideWarnings[0].includes('SKYCOMMAND_SUPERVISOR_RUNTIME_SERVICES'));
assert.ok(serviceOverrideWarnings[1].includes('SKYCOMMAND_SUPERVISOR_BACKEND_REBUILD_SERVICES'));

const { buildChildProcessEnvironmentFromContent } = require(
  path.join(repositoryRoot, 'packages/core/src/repositoryEnvironment'),
);
const parentEnvironment = {
  PGHOST: 'host.docker.internal',
  PGPORT: '5432',
  PGDATABASE: 'skyserver_dev',
  SKYCOMMAND_DATABASE_HOST: 'host.docker.internal',
  SKYCOMMAND_DATABASE_PORT: '5432',
  SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN: 'process-only-control-token',
  PATH: 'process-only-path',
  SKYCOMMAND_TEST_UNRELATED: 'preserve-me',
};
const childEnvironment = buildChildProcessEnvironmentFromContent(
  [
    'PGHOST=127.0.0.1',
    'PGPORT=55432',
    'PGDATABASE=skyserver_dev',
    'SKYCOMMAND_DATABASE_HOST=postgres',
    'SKYCOMMAND_DATABASE_PORT=5432',
    'SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN=file-value-must-not-replace-process-control',
  ].join('\n'),
  parentEnvironment,
);
assert.equal(childEnvironment.PGHOST, '127.0.0.1');
assert.equal(childEnvironment.PGPORT, '55432');
assert.equal(childEnvironment.SKYCOMMAND_DATABASE_HOST, 'postgres');
assert.equal(childEnvironment.SKYCOMMAND_DATABASE_PORT, '5432');
assert.equal(childEnvironment.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN, 'process-only-control-token');
assert.equal(childEnvironment.PATH, 'process-only-path');
assert.equal(childEnvironment.SKYCOMMAND_TEST_UNRELATED, 'preserve-me');
const config = getSupervisorConfig(repositoryRoot);
assert.equal(
  config.projectName,
  process.env.SKYCOMMAND_SUPERVISOR_PROJECT_NAME ||
    process.env.SKYCOMMAND_DOCKER_SELF_PROJECT_NAME ||
    'skycommand',
);
assert.ok(config.runtimeServices.includes('api'));
assert.ok(config.runtimeServices.includes('browser-worker'));
assert.ok(config.runtimeServices.includes('agent-runtime-worker'));
assert.ok(config.runtimeServices.includes('codex-egress-proxy'));
assert.ok(config.runtimeServices.includes('codex-mcp-gateway'));
assert.ok(config.runtimeServices.includes('codex-agent-runtime-worker'));
assert.ok(config.runtimeServices.includes('codex-control-bridge'));
assert.ok(config.backendRebuildServices.includes('browser-worker'));
assert.ok(config.backendRebuildServices.includes('agent-runtime-worker'));
assert.ok(config.backendRebuildServices.includes('codex-egress-proxy'));
assert.ok(config.backendRebuildServices.includes('codex-mcp-gateway'));
assert.ok(config.backendRebuildServices.includes('codex-agent-runtime-worker'));
assert.ok(config.backendRebuildServices.includes('codex-control-bridge'));
assert.ok(!config.runtimeServices.includes('web'));
assert.deepEqual(config.backendRebuildServices, DEFAULT_BACKEND_REBUILD_SERVICES);

const args = buildComposeArgs(config, ['stop', 'api']);
assert.deepEqual(args.slice(0, 5), [
  'compose',
  '--project-name',
  config.projectName,
  '--file',
  config.composeFile,
]);
assert.equal(args.at(-2), 'stop');
assert.equal(args.at(-1), 'api');

const parsedArray = parseComposePsOutput(
  '[{"Service":"api","State":"running","Health":"healthy"}]',
);
assert.equal(parsedArray.length, 1);
assert.equal(parsedArray[0].Service, 'api');

const parsedLines = parseComposePsOutput(
  '{"Service":"api","State":"running"}\n{"Service":"postgres","State":"exited"}',
);
assert.equal(parsedLines.length, 2);

assert.equal(
  isDockerEngineUnavailable(
    'Could not connect to deb.debian.org:80 (151.101.126.132). - connect (111: Connection refused)',
  ),
  false,
  'remote build-network failures must not be reported as Docker Engine outages',
);
assert.equal(
  isDockerEngineUnavailable(
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
  ),
  true,
);
assert.equal(
  isDockerEngineUnavailable(
    'error during connect: open //./pipe/docker_engine: The system cannot find the file specified.',
  ),
  true,
);

const fakeExecutor = async (_command, dockerArgs) => {
  assert.ok(dockerArgs.includes('ps'));
  return {
    stdout: config.runtimeServices
      .map((service) =>
        JSON.stringify({
          Service: service,
          State: 'running',
          Health: service === 'api' ? 'healthy' : '',
        }),
      )
      .join('\n'),
    stderr: '',
  };
};

getRuntimeStatus(config, { executor: fakeExecutor })
  .then((status) => {
    assert.equal(status.engineStatus, 'ONLINE');
    assert.equal(status.runtimeStatus, 'ONLINE');
    assert.equal(status.runningCount, config.runtimeServices.length);

    let rebuildObserved = false;
    const rebuildExecutor = async (_command, dockerArgs) => {
      if (dockerArgs.includes('--build')) {
        rebuildObserved = true;
        assert.deepEqual(dockerArgs.slice(-4), ['up', '-d', '--build', config.webService]);
        return { stdout: 'web rebuilt', stderr: '' };
      }
      return fakeExecutor(_command, dockerArgs);
    };

    return rebuildWeb(config, { executor: rebuildExecutor }).then(async (result) => {
      assert.equal(result.action, 'REBUILD_WEB');
      assert.equal(rebuildObserved, true);

      let backendRebuildObserved = false;
      const backendRebuildExecutor = async (_command, dockerArgs) => {
        if (dockerArgs.includes('--force-recreate')) {
          backendRebuildObserved = true;
          assert.deepEqual(dockerArgs.slice(-(4 + config.backendRebuildServices.length)), [
            'up',
            '-d',
            '--build',
            '--force-recreate',
            ...config.backendRebuildServices,
          ]);
          return { stdout: 'backend rebuilt', stderr: '' };
        }
        return fakeExecutor(_command, dockerArgs);
      };

      const backendResult = await rebuildBackend(config, { executor: backendRebuildExecutor });
      assert.equal(backendResult.action, 'REBUILD_BACKEND');
      assert.equal(backendRebuildObserved, true);

      let codexRebuildObserved = false;
      const codexRebuildExecutor = async (_command, dockerArgs, executionOptions) => {
        if (dockerArgs.includes('--force-recreate')) {
          codexRebuildObserved = true;
          assert.equal(executionOptions.cwd, config.repositoryRoot);
          assert.equal(
            dockerArgs[dockerArgs.indexOf('--file') + 1],
            config.composeFile,
            'the narrow rebuild must use the configured effective Compose definition',
          );
          assert.deepEqual(dockerArgs.slice(-CODEX_BOOTSTRAP_REBUILD_SERVICES.length), CODEX_BOOTSTRAP_REBUILD_SERVICES);
          assert.deepEqual(dockerArgs.slice(-CODEX_BOOTSTRAP_REBUILD_SERVICES.length - 4, -CODEX_BOOTSTRAP_REBUILD_SERVICES.length), ['up', '-d', '--build', '--force-recreate']);
          const effectiveCompose = fs.readFileSync(config.composeFile, 'utf8');
          assert.ok(effectiveCompose.includes('http://codex-control-bridge-api-control:4220/healthz'));
          assert.ok(effectiveCompose.includes('codex-agent-runtime-worker-runtime-control'));
          return { stdout: 'fixed Codex bootstrap rebuilt', stderr: '' };
        }
        return fakeExecutor(_command, dockerArgs);
      };
      const codexResult = await rebuildCodexBootstrap(config, { executor: codexRebuildExecutor });
      assert.equal(codexResult.action, 'REBUILD_CODEX_BOOTSTRAP');
      assert.deepEqual(codexResult.services, CODEX_BOOTSTRAP_REBUILD_SERVICES);
      assert.equal(codexRebuildObserved, true);
      console.log('✅ SkyCommand Supervisor self-test passed.');
    });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
