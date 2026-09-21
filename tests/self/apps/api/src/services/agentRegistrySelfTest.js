const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const migration = fs.readFileSync(path.join(root, 'packages/db_build/src/migrations/00149__agent_registry_foundation.sql'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'packages/db_build/src/seeds/00150__agent_registry_permissions.sql'), 'utf8');
const service = fs.readFileSync(path.join(root, 'apps/api/src/services/agentRegistryService.js'), 'utf8');
const routes = [
  'apps/api/src/routes/agent.routes.js',
  'apps/api/src/routes/agentDefinition.routes.js',
  'apps/api/src/routes/agentRuntime.routes.js',
  'apps/api/src/routes/agentExecution.routes.js',
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

assert.match(migration, /CREATE TABLE IF NOT EXISTS core\.projects/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS core\.agent_definition_versions/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS auth\.execution_principals/);
assert.match(migration, /agent_installations_execution_disabled CHECK \(execution_enabled = FALSE\)/);
assert.match(migration, /agent_accounts_execution_disabled CHECK \(execution_enabled = FALSE\)/);
assert.match(migration, /agent_capability_profiles_execution_disabled CHECK \(execution_enabled = FALSE\)/);
assert.match(migration, /agent_definition_versions_immutable/);
assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS worker\.(agent|execution|session)/i);
assert.doesNotMatch(migration, /(?:CREATE|ALTER|DROP|INSERT|UPDATE)[\s\S]{0,160}auth\.workflow_execution_principals\b/i);

for (const permission of [
  'AGENT_READ', 'AGENT_MANAGE', 'AGENT_PROJECT_READ', 'AGENT_PROJECT_MANAGE',
  'AGENT_RUNTIME_READ', 'AGENT_RUNTIME_MANAGE', 'AGENT_ACCOUNT_USE', 'AGENT_AUTHORITY_PREVIEW',
]) assert.match(seed, new RegExp(`'${permission}'`));
assert.match(seed, /WHERE r\.role_code = 'SUPER_ADMIN'/);
assert.doesNotMatch(seed, /['"]AGENT_RUN['"]|['"]PROVIDER_LAUNCH['"]|['"]START_RUN['"]/);

assert.match(service, /REGISTERED_WORKSPACE_ONLY/);
assert.match(service, /AGENT_EXECUTION_DISABLED_PHASE_19_1/);
assert.match(service, /hasVerifiedAdminAll/);
assert.match(service, /AGENT_PROJECT_SCOPE_REQUIRED/);
assert.match(service, /RUNTIME_ACCOUNT_ENTITLEMENT_REQUIRED/);
assert.match(service, /intersectConstraints/);
assert.match(service, /async function updateAgent/);
assert.doesNotMatch(service, /if \(hasGlobalPermission\(req, 'AGENT_PROJECT_MANAGE'\)\)/);
assert.match(service, /assertNoForbiddenKeys/);
assert.match(service, /FORBIDDEN_KEYS\s*=/);
assert.match(service, /authService\.recordAuditEventWithClient/);
for (const action of [
  'create_project', 'update_project', 'create_project_owner_membership', 'upsert_project_membership',
  'bind_project_repository', 'bind_project_workspace', 'set_project_agent_allow_rule',
  'create_agent_definition', 'update_agent_definition', 'create_agent_revision',
  'register_runtime', 'register_runtime_installation', 'register_runtime_account', 'register_capability_profile',
]) assert.match(service, new RegExp(`action: '${action}'`));
assert.match(service, /recordRegistryAuditWithClient\(client, req/);
assert.match(service, /'UNVERIFIED', FALSE/);
assert.match(service, /'UNKNOWN', \$17::jsonb/);
assert.match(service, /body\.runtimeProfile, 120\) \|\| 'UNKNOWN'/);
assert.match(service, /accountState, 'UNCONFIGURED'/);
assert.match(service, /policyEffectiveAuthority/);
assert.match(service, /runtimeCompatibleAuthority/);
assert.match(service, /executionAdmission/);
assert.match(service, /evaluateRuntimeCompatibility/);
assert.doesNotMatch(service, /SELECT[^;]*root_path/is);
assert.doesNotMatch(routes, /agent-runs|sessions|launch|start/i);
assert.match(routes, /router\.post\(\s*['"]\/preview['"]/);
assert.match(routes, /memberships/);
assert.match(routes, /router\.patch\(.*:definitionId/);

console.log('✅ Phase 19.1 Agent registry API self-test passed.');
