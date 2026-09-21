const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const connectionPath = require.resolve(path.join(root, 'packages/db/src/connection'));
const authServicePath = require.resolve(path.join(root, 'apps/api/src/services/authService'));
const registryServicePath = require.resolve(path.join(root, 'apps/api/src/services/agentRegistryService'));

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const adminUser = '33333333-3333-4333-8333-333333333333';
const projectA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const agentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const agentB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
const workspaceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11';

const projects = [
  {
    project_id: projectA,
    project_code: 'PROJECT_A',
    project_name: 'Project A',
    description: 'User A project',
    lifecycle_state: 'ACTIVE',
    data_classification: 'INTERNAL',
    policy_revision: 'project-policy-a.v1',
    authority_policy: {},
    record_version: 1,
    active: true,
    created_at: '2026-09-21T00:00:00.000Z',
    updated_at: '2026-09-21T00:00:00.000Z',
  },
  {
    project_id: projectB,
    project_code: 'PROJECT_B',
    project_name: 'Project B',
    description: 'User B project',
    lifecycle_state: 'ACTIVE',
    data_classification: 'INTERNAL',
    policy_revision: 'project-policy-b.v1',
    authority_policy: {},
    record_version: 1,
    active: true,
    created_at: '2026-09-21T00:00:00.000Z',
    updated_at: '2026-09-21T00:00:00.000Z',
  },
];

const memberships = [
  { project_id: projectA, project_member_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21', user_id: userA, membership_state: 'ACTIVE', right_code: 'PROJECT_READ', active: true },
  { project_id: projectA, project_member_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21', user_id: userA, membership_state: 'ACTIVE', right_code: 'PROJECT_MANAGE', active: true },
  { project_id: projectA, project_member_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21', user_id: userA, membership_state: 'ACTIVE', right_code: 'AUTHORITY_PREVIEW', active: true },
  { project_id: projectB, project_member_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb21', user_id: userB, membership_state: 'ACTIVE', right_code: 'PROJECT_READ', active: true },
];

const agents = [
  { definition_id: agentA, agent_code: 'AGENT_A', agent_name: 'Agent A', description: null, lifecycle_state: 'ACTIVE', active: true, record_version: 1 },
  { definition_id: agentB, agent_code: 'AGENT_B', agent_name: 'Agent B', description: null, lifecycle_state: 'ACTIVE', active: true, record_version: 1 },
];

const versions = [
  {
    definition_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa31',
    definition_id: agentA,
    revision: 1,
    content_digest: 'A'.repeat(64),
    instruction_reference: null,
    instruction_digest: null,
    installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa41',
    account_binding_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa51',
    capability_profile_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa61',
    policy_revision: 'agent-a.v1',
    configuration: {},
    created_at: '2026-09-21T00:00:00.000Z',
  },
  {
    definition_version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb31',
    definition_id: agentB,
    revision: 1,
    content_digest: 'B'.repeat(64),
    instruction_reference: null,
    instruction_digest: null,
    installation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb41',
    account_binding_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb51',
    capability_profile_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb61',
    policy_revision: 'agent-b.v1',
    configuration: {},
    created_at: '2026-09-21T00:00:00.000Z',
  },
];

const allowRules = [
  { project_id: projectA, definition_id: agentA, definition_version_id: null, allow_state: 'ACTIVE' },
  { project_id: projectB, definition_id: agentB, definition_version_id: null, allow_state: 'ACTIVE' },
];

function visibleProjectIds(userId) {
  return new Set(
    memberships
      .filter((membership) => membership.user_id === userId && membership.membership_state === 'ACTIVE' && membership.right_code === 'PROJECT_READ' && membership.active)
      .map((membership) => membership.project_id),
  );
}

function allowedDefinitionIds(projectId) {
  return new Set(
    allowRules
      .filter((rule) => rule.project_id === projectId && rule.allow_state === 'ACTIVE')
      .map((rule) => rule.definition_id),
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fakeQuery(sql, params = []) {
  const statement = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

  if (statement.includes('select exists') && statement.includes('from auth.user_roles')) {
    return Promise.resolve({ rows: [{ verified_admin_all: params[0] === adminUser }] });
  }

  if (statement.includes('from core.project_members pm') && statement.includes('pmr.right_code = $3')) {
    const row = memberships.find((membership) => (
      membership.project_id === params[0]
      && membership.user_id === params[1]
      && membership.right_code === params[2]
      && membership.membership_state === 'ACTIVE'
      && membership.active
    ));
    return Promise.resolve({ rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 });
  }

  if (statement.includes('count(distinct p.project_id)')) {
    const allowed = params[0] ? visibleProjectIds(params[0]) : new Set(projects.map((project) => project.project_id));
    return Promise.resolve({ rows: [{ total: projects.filter((project) => allowed.has(project.project_id)).length }] });
  }

  if (statement.includes('select distinct p.* from core.projects p')) {
    const allowed = params.length > 2 ? visibleProjectIds(params[0]) : new Set(projects.map((project) => project.project_id));
    return Promise.resolve({ rows: projects.filter((project) => allowed.has(project.project_id)).map(clone) });
  }

  if (statement.includes('select * from core.projects where project_id = $1')) {
    const project = projects.find((candidate) => candidate.project_id === params[0]);
    return Promise.resolve({ rows: project ? [clone(project)] : [], rowCount: project ? 1 : 0 });
  }

  if (statement.includes('select distinct d.* from core.agent_definitions d')) {
    const exactDefinition = statement.includes('where d.definition_id = $1');
    const projectId = exactDefinition ? params[1] : params[0];
    const allowed = projectId ? allowedDefinitionIds(projectId) : new Set();
    const rows = agents.filter((agent) => (
      (!exactDefinition || agent.definition_id === params[0])
      && allowed.has(agent.definition_id)
    ));
    return Promise.resolve({ rows: rows.map(clone), rowCount: rows.length });
  }

  if (statement.includes('select distinct v.* from core.agent_definition_versions v')) {
    const exactDefinition = statement.includes('where v.definition_id = $1');
    const projectId = exactDefinition ? params[1] : params[0];
    const allowed = projectId ? allowedDefinitionIds(projectId) : new Set();
    const rows = versions.filter((version) => (
      (!exactDefinition || version.definition_id === params[0])
      && allowed.has(version.definition_id)
    ));
    return Promise.resolve({ rows: rows.map(clone), rowCount: rows.length });
  }

  if (statement.includes('from core.project_repositories')) return Promise.resolve({ rows: [] });
  if (statement.includes('from core.project_workspaces')) {
    return Promise.resolve({ rows: params[0] === workspaceA ? [{ project_workspace_id: workspaceA, project_id: projectA, repo_path_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa71', environment_code: 'DEV_LOCAL', workspace_mode: 'READ_ONLY', policy_revision: 'workspace.v1', record_version: 1, active: true, repo_code: 'SKYCOMMAND', repo_name: 'SkyCommand', profile_code: 'DEV_LOCAL' }] : [] });
  }
  if (statement.includes('from core.project_members pm') && statement.includes('join auth.users')) return Promise.resolve({ rows: [] });
  if (statement.includes('from core.project_agent_allow_rules par')) return Promise.resolve({ rows: [] });

  throw new Error(`Unexpected isolated registry query: ${statement}`);
}

function loadRegistryService() {
  const originalLoad = Module._load;
  const previousService = require.cache[registryServicePath];
  delete require.cache[registryServicePath];
  Module._load = function loadWithIsolationFixture(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === connectionPath) return { query: fakeQuery, pool: { connect: async () => { throw new Error('Mutation path is not part of this self-test.'); } } };
    if (resolved === authServicePath) return { recordAuditEvent: async () => {}, getRequestContext: () => ({}) };
    return originalLoad.apply(this, arguments);
  };
  try {
    return require(registryServicePath);
  } finally {
    Module._load = originalLoad;
    if (previousService) require.cache[registryServicePath] = previousService;
    else delete require.cache[registryServicePath];
  }
}

function request(userId, permissions, roleCodes = []) {
  return { user: { userId, roleCodes }, permissions };
}

async function expectServiceError(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code, `expected ${code}`);
}

async function run() {
  const service = loadRegistryService();
  const userARequest = request(userA, ['AGENT_PROJECT_READ', 'AGENT_PROJECT_MANAGE', 'AGENT_READ']);
  const userBRequest = request(userB, ['AGENT_PROJECT_READ', 'AGENT_READ']);
  const adminRequest = request(adminUser, ['AGENT_PROJECT_READ', 'AGENT_PROJECT_MANAGE', 'AGENT_READ'], ['SUPER_ADMIN']);

  const visibleToA = await service.listProjects(userARequest);
  const visibleToB = await service.listProjects(userBRequest);
  assert.deepEqual(visibleToA.items.map((project) => project.projectId), [projectA]);
  assert.deepEqual(visibleToB.items.map((project) => project.projectId), [projectB]);
  assert.equal(visibleToA.total, 1);
  assert.equal(visibleToB.total, 1);

  await expectServiceError(() => service.getProject(projectB, userARequest), 'AGENT_PROJECT_NOT_FOUND');
  await expectServiceError(() => service.previewAuthority(userARequest, {
    projectId: projectB,
    definitionId: agentB,
    projectWorkspaceId: workspaceA,
    requestedScope: {},
  }), 'AGENT_PROJECT_NOT_FOUND');

  const agentsForA = await service.listAgents(userARequest, { projectId: projectA });
  assert.deepEqual(agentsForA.items.map((agent) => agent.definitionId), [agentA]);
  await expectServiceError(() => service.getAgent(agentB, userARequest, { projectId: projectA }), 'AGENT_DEFINITION_NOT_FOUND');
  await expectServiceError(() => service.listAgents(userARequest), 'AGENT_PROJECT_SCOPE_REQUIRED');

  const membershipOnly = request(userA, ['AGENT_PROJECT_READ']);
  await expectServiceError(() => service.listAgents(membershipOnly, { projectId: projectA }), 'AGENT_PERMISSION_REQUIRED');
  await expectServiceError(() => service.getProject(projectB, userARequest), 'AGENT_PROJECT_NOT_FOUND');

  const adminVisible = await service.listProjects(adminRequest);
  assert.deepEqual(adminVisible.items.map((project) => project.projectId).sort(), [projectA, projectB].sort());

  console.log('✅ Phase 19.1 real two-user/two-Project isolation self-test passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
