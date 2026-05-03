Phase 6 remaining work

1. Small cleanup first: move the auth SQL view files

Your repo map shows the auth view script files currently under:

scripts/db/views/New folder/

That should be cleaned up before we stack more on top of it. I’d move them to either:

scripts/db/views/auth/

or directly under:

scripts/db/views/

The cleaner version is probably:

scripts/db/views/auth/auth.vw_user_permissions.sql
scripts/db/views/auth/auth.vw_role_permissions.sql
...

The migrations are already working, so this is documentation/source-script hygiene, not a database issue. But it matters because RepoMap + README = continuity spine, and “New folder” is little gremlin energy. Cute, but not invited. 😄

2. Expand SkyServer.json into a proper Admin/Web manifest

Right now, SkyServer.json drives SkyServer Core CLI. The README already positions the CLI as config-driven, where new tools can be added by updating the manifest instead of editing launcher code.

For Admin-Web, the same manifest should gain fields like:

{
"id": "db_health",
"label": "Database Health Check",
"category": "Database Tools",
"scriptFile": "packages/db/src/db_health.js",
"visibility": ["cli", "admin-web"],
"permission": "DB_HEALTH_RUN",
"risk": "low",
"requiresConfirmation": false,
"capturesOutput": true
}

Add these concepts:

visibility
permission
risk
requiresConfirmation
allowParams
param schema
description
displayOrder
enabled

This becomes the bridge between SkyServer Core and Admin-Web.

3. Build the API auth layer

Your repo already has the right empty structure for this under:

apps/api/src/controllers
apps/api/src/middleware
apps/api/src/routes
apps/api/src/services

That means the skeleton is ready.

I’d add:

apps/api/src/routes/auth.routes.js
apps/api/src/controllers/authController.js
apps/api/src/services/authService.js
apps/api/src/middleware/authMiddleware.js
apps/api/src/middleware/permissionMiddleware.js

Minimum endpoints:

POST /api/auth/login
POST /api/auth/logout
GET /api/auth/me
GET /api/auth/permissions

Use the new auth tables:

auth.users
auth.sessions
auth.login_events
auth.audit_events
auth.vw_user_permissions

Password hashing should use bcrypt or argon2. Token storage should keep only hashes in auth.sessions.

4. Add first admin user creation path

Before login can work, we need a safe way to create the first user.

Options:

Option A: SQL seed script for local dev
Option B: one-time CLI script createAdminUser.js
Option C: temporary setup endpoint disabled after first user exists

I’d choose Option B:

packages/auth/src/createAdminUser.js

or:

packages/core/src/tools/createAdminUser.js

It should prompt for:

email
display_name
password
role_code

Then insert:

auth.users
auth.user_roles
auth.audit_events

This avoids hardcoding your password into SQL seeds.

5. Build permission checking

This is the first real payoff from the RBAC foundation.

Core helper:

hasPermission(userId, permissionCode)

Using:

SELECT 1
FROM auth.vw_user_permissions
WHERE user_id = $1
AND permission_code = $2;

Then API middleware:

requirePermission('DB_HEALTH_RUN')

That gives us clean protection around every Admin-Web action.

6. Add manifest API endpoints

Admin-Web should not read SkyServer.json directly from the browser. The API should read it, filter it by permissions, and return only what the logged-in user can see.

Endpoints:

GET /api/tools
GET /api/tools/:id
POST /api/tools/:id/run

The API should:

read SkyServer.json
filter by visibility includes "admin-web"
filter by user permissions
hide blocked/high-risk tools unless authorized
return display-safe metadata

This is where Admin-Web starts becoming a real control panel instead of a static React app.

7. Build script execution service

This is the dangerous-but-delicious part. Controlled execution.

Add:

apps/api/src/services/toolManifestService.js
apps/api/src/services/scriptExecutionService.js

Execution flow:

receive tool id
load manifest entry
check permission
check risk/confirmation
create auth.script_execution_log row STARTED
spawn node/powershell safely
capture stdout/stderr
update execution row SUCCESS/FAILED
write audit event
return output summary

Start with safe tools only:

db_health
git_repo_status
generateRepoMap

Delay these until confirmation/UI logging is solid:

db_build
dev_commit
main_merge
ingestion loaders 8. Build Admin-Web auth UI

Your current admin-web has Login.jsx, Home.jsx, Dashboard.jsx, services, and components already scaffolded.

Now wire it properly:

AuthContext
ProtectedRoute
Login page
Logout button
current user display
permission-aware navigation

Frontend files to add or revise:

apps/admin-web/src/context/AuthContext.jsx
apps/admin-web/src/components/ProtectedRoute.jsx
apps/admin-web/src/services/authService.js
apps/admin-web/src/services/toolService.js 9. Build the first real dashboard pages

Start simple. No need to get fancy yet.

Recommended Admin-Web pages:

Dashboard
Tools
ToolDetail
ScriptExecutions
AuditEvents
Users
Roles
Permissions
MacroViews
IngestionStatus

For Phase 6 completion, I’d only require:

Login
Dashboard
Tools
ScriptExecutions
AuditEvents

Users/Roles/Permissions can come next unless you want Phase 6 to include full user management.

10. Add read-only admin data endpoints

These are safe and useful immediately:

GET /api/admin/audit-events
GET /api/admin/script-executions
GET /api/admin/active-sessions
GET /api/admin/roles
GET /api/admin/permissions
GET /api/admin/role-permissions

These can read from the helper views we just created.

11. Add macro view browsing

Because the database already has U.S., Canadian, and comparison macro views, Admin-Web can expose a simple read-only macro browser.

Endpoints:

GET /api/macro/views
GET /api/macro/views/:viewName

Permission:

MACRO_VIEW_READ

This gives the admin panel immediate visual/data value without waiting for SkyWeb.

12. Add security hardening

Before calling script execution “done,” I’d add:

rate limit login endpoint
sanitize script params
block path traversal
do not expose raw scriptFile paths unnecessarily
never return token hashes
session expiry handling
logout/revoke session
audit all script attempts, successful or failed

For local/private use, this does not need to be enterprise-perfect yet. But script execution from a browser needs a seatbelt.

My recommended Phase 6 completion checklist

I’d define Phase 6 as complete when these are done:

✅ Auth/RBAC schema, seeds, views complete
⬜ Auth SQL view files moved out of New folder
⬜ First admin user creation script
⬜ API auth routes: login/logout/me/permissions
⬜ Session creation/revocation working
⬜ Permission middleware working
⬜ SkyServer.json expanded with admin-web metadata
⬜ API can list permitted tools from manifest
⬜ API can run low-risk tools and log execution
⬜ Admin-Web login page working
⬜ Admin-Web protected dashboard working
⬜ Admin-Web tool list page working
⬜ Admin-Web script execution history page working
⬜ Audit event display working
⬜ README + RepoMap updated
