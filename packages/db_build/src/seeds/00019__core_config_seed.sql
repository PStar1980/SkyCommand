-- Seed: 00019__core_config_seed.sql
-- Purpose: Seeds SkyServer Core relational configuration from current SkyServer.json and repo_path.json.

BEGIN;

INSERT INTO core.applications (app_code, title, manifest_version, description, active)
VALUES ('SKYSERVER_CORE','SkyServer Core','2.0.0','Shared operational manifest for SkyServer Core CLI and Admin-Web/API tool execution.',TRUE)
ON CONFLICT (app_code) DO UPDATE
SET title = EXCLUDED.title,
    manifest_version = EXCLUDED.manifest_version,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.visibility_channels (channel_code, channel_name, description, active)
VALUES
  ('cli','CLI','SkyServer Core command-line interface.',TRUE),
  ('admin-web','Admin Web','Private SkyServer Admin-Web interface.',TRUE),
  ('api','API','Server-side API execution and service channel.',TRUE),
  ('worker','Worker','Background worker/listener/scheduler channel.',TRUE)
ON CONFLICT (channel_code) DO UPDATE
SET channel_name = EXCLUDED.channel_name,
    description = EXCLUDED.description,
    active = EXCLUDED.active;

INSERT INTO core.runtimes (runtime_code, runtime_name, executable, description, active)
VALUES
  ('node','Node.js','node','Node.js/CommonJS script runtime.',TRUE),
  ('powershell','Windows PowerShell','powershell.exe','Windows PowerShell runtime.',TRUE),
  ('pwsh','PowerShell 7','pwsh','Cross-platform PowerShell runtime.',TRUE)
ON CONFLICT (runtime_code) DO UPDATE
SET runtime_name = EXCLUDED.runtime_name,
    executable = EXCLUDED.executable,
    description = EXCLUDED.description,
    active = EXCLUDED.active;

INSERT INTO core.risk_levels (risk_code, risk_name, risk_rank, description, active)
VALUES
  ('low','Low',10,'Read/check/report style operation with low operational risk.',TRUE),
  ('medium','Medium',20,'Operation may write data, commit code, or change controlled state.',TRUE),
  ('high','High',30,'Operation may rebuild data, modify branch state, or provision privileged access.',TRUE)
ON CONFLICT (risk_code) DO UPDATE
SET risk_name = EXCLUDED.risk_name,
    risk_rank = EXCLUDED.risk_rank,
    description = EXCLUDED.description,
    active = EXCLUDED.active;

INSERT INTO core.param_types (param_type_code, param_type_name, description, active)
VALUES
  ('string','String','Free-text string parameter.',TRUE),
  ('number','Number','Numeric parameter.',TRUE),
  ('boolean','Boolean','Boolean true/false parameter.',TRUE),
  ('repo','Repository','Repository selection parameter.',TRUE),
  ('select','Select','Static or dynamic select/dropdown parameter.',TRUE),
  ('path','Path','Filesystem path parameter.',TRUE),
  ('date','Date','Date parameter.',TRUE)
ON CONFLICT (param_type_code) DO UPDATE
SET param_type_name = EXCLUDED.param_type_name,
    description = EXCLUDED.description,
    active = EXCLUDED.active;

INSERT INTO core.option_sources (option_source_code, option_source_name, description, active)
VALUES ('repositories','Repositories','Active repository list from core.repositories and core.repository_paths.',TRUE)
ON CONFLICT (option_source_code) DO UPDATE
SET option_source_name = EXCLUDED.option_source_name,
    description = EXCLUDED.description,
    active = EXCLUDED.active;

INSERT INTO core.config_profiles (profile_code, profile_name, description, active)
VALUES ('DEV_LOCAL','Local Development','Local Windows development profile for Paul/SkyServer.',TRUE)
ON CONFLICT (profile_code) DO UPDATE
SET profile_name = EXCLUDED.profile_name,
    description = EXCLUDED.description,
    active = EXCLUDED.active;

INSERT INTO core.repositories (repo_code, repo_name, description, remote_url, main_branch, dev_branch, display_order, active)
VALUES
  ('NeoFinTech','NeoFinTech','NeoFinTech application repository.',NULL,'main','dev',10,TRUE),
  ('SkyOne','SkyOne','SkyOne cognitive core repository.',NULL,'main','dev',20,TRUE),
  ('SkyProject','SkyProject','SkyProject metadata and orchestration repository.',NULL,'main','dev',30,TRUE),
  ('SkyServer','SkyServer','SkyServer private admin, automation, PostgreSQL, and ingestion hub.',NULL,'main','dev',40,TRUE),
  ('SkyWeb','SkyWeb','SkyWeb public web/data visualization layer repository.',NULL,'main','dev',50,TRUE)
ON CONFLICT (repo_code) DO UPDATE
SET repo_name = EXCLUDED.repo_name,
    description = EXCLUDED.description,
    remote_url = EXCLUDED.remote_url,
    main_branch = EXCLUDED.main_branch,
    dev_branch = EXCLUDED.dev_branch,
    display_order = EXCLUDED.display_order,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.repository_paths (repo_id, profile_id, root_path, active)
SELECT r.repo_id, cp.profile_id, v.root_path, TRUE
FROM (
  VALUES
    ('SkyOne', $$C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOne System\SkyOne$$),
    ('SkyProject', $$C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyProject System\SkyProject$$),
    ('SkyServer', $$C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyServer System\SkyServer$$),
    ('SkyWeb', $$C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyWeb System\SkyWeb$$),
    ('NeoFinTech', $$C:\Users\pauls\Dropbox\Programming\NeoFinTech System\NeoFinTech$$)
) AS v(repo_code, root_path)
JOIN core.repositories r ON r.repo_code = v.repo_code
JOIN core.config_profiles cp ON cp.profile_code = 'DEV_LOCAL'
ON CONFLICT (repo_id, profile_id) DO UPDATE
SET root_path = EXCLUDED.root_path,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.tool_categories (app_id, category_code, name, label, description, display_order, enabled)
SELECT a.app_id, v.category_code, v.name, v.label, v.description, v.display_order, TRUE
FROM core.applications a
CROSS JOIN (
  VALUES
    ('database_tools','Database Tools','Database Tools','PostgreSQL health and build operations.',10),
    ('auth_tools','Auth Tools','Auth Tools','User, role, permission, and authentication setup utilities.',15),
    ('git_tools','Git Tools','Git Tools','Repository status, commit, and merge workflows.',20),
    ('data_ingestion_tools','Data Ingestion Tools','Data Ingestion Tools','Source-specific macroeconomic and manual ingestion workflows.',30),
    ('file_tools','File Tools','File Tools','File, documentation, and repository structure utilities.',40)
) AS v(category_code, name, label, description, display_order)
WHERE a.app_code = 'SKYSERVER_CORE'
ON CONFLICT (app_id, category_code) DO UPDATE
SET name = EXCLUDED.name,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.tool_category_visibility (category_id, channel_code)
SELECT c.category_id, v.channel_code
FROM core.tool_categories c
JOIN core.applications a ON a.app_id = c.app_id
JOIN (
  VALUES
    ('database_tools','cli'), ('database_tools','admin-web'), ('database_tools','api'), ('database_tools','worker'),
    ('auth_tools','cli'),
    ('git_tools','cli'), ('git_tools','admin-web'), ('git_tools','api'),
    ('data_ingestion_tools','cli'), ('data_ingestion_tools','admin-web'), ('data_ingestion_tools','api'), ('data_ingestion_tools','worker'),
    ('file_tools','cli'), ('file_tools','admin-web'), ('file_tools','api')
) AS v(category_code, channel_code) ON v.category_code = c.category_code
WHERE a.app_code = 'SKYSERVER_CORE'
ON CONFLICT (category_id, channel_code) DO NOTHING;

INSERT INTO core.tools (
  category_id, tool_code, name, label, description, script_repo_id, script_path,
  runtime_code, permission_code, risk_code, requires_confirmation, confirmation_text,
  captures_output, allow_params, display_order, enabled
)
SELECT c.category_id, v.tool_code, v.name, v.label, v.description, r.repo_id, v.script_path,
       v.runtime_code, v.permission_code, v.risk_code, v.requires_confirmation, v.confirmation_text,
       v.captures_output, v.allow_params, v.display_order, TRUE
FROM (
  VALUES
    ('database_tools','db_health','db_health','Database Health Check','Tests PostgreSQL connectivity using the configured environment.','packages/db/src/db_health.js','node','DB_HEALTH_RUN','low',FALSE,NULL,TRUE,FALSE,10),
    ('database_tools','db_build','db_build','Database Build','Drops, recreates, and rebuilds the selected PostgreSQL database from ordered migrations and seed files.','packages/db_build/src/db_build.js','node','DB_BUILD_RUN','high',TRUE,'This will drop and recreate the selected database, then run all configured migrations and seeds. Confirm only when you intentionally want to rebuild that database.',TRUE,TRUE,20),
    ('auth_tools','auth_create_admin_user','createAdminUser','Create Admin User','Creates an ACTIVE SkyServer user and assigns an RBAC role.','packages/auth/src/createAdminUser.js','node','ADMIN_USER_WRITE','high',TRUE,'This creates an active user account and assigns a role. Confirm only when intentionally provisioning an admin user.',TRUE,FALSE,10),
    ('git_tools','git_repo_status','git_repo_status','Repository Status','Checks configured repository status across dev and main branches.','packages/git/src/git_repo_status.js','node','GIT_STATUS_RUN','low',FALSE,NULL,TRUE,TRUE,10),
    ('git_tools','dev_commit','dev_commit','Dev Commit','Runs the configured dev branch commit workflow.','packages/git/src/dev_commit.js','node','GIT_COMMIT_RUN','medium',TRUE,'This will stage, commit, and push changes for the selected repository.',TRUE,TRUE,20),
    ('git_tools','main_merge','main_merge','Main Merge','Runs the configured main branch merge and synchronization workflow.','packages/git/src/main_merge.js','node','GIT_MAIN_MERGE_RUN','high',TRUE,'This will synchronize main/dev branches and may push branch updates and tags.',TRUE,TRUE,30),
    ('data_ingestion_tools','ingestion_fred','loadFREDMacroData','Run FRED Ingestion','Loads active FRED macroeconomic indicators into PostgreSQL.','packages/ingestion/src/loadFREDMacroData.js','node','INGESTION_RUN_FRED','medium',TRUE,'This will call the FRED ingestion pipeline and write any new data into PostgreSQL.',TRUE,FALSE,10),
    ('data_ingestion_tools','ingestion_boc','loadBoCMacroData','Run Bank of Canada Ingestion','Loads active Bank of Canada macroeconomic indicators into PostgreSQL.','packages/ingestion/src/loadBoCMacroData.js','node','INGESTION_RUN_BOC','medium',TRUE,'This will call the Bank of Canada ingestion pipeline and write any new data into PostgreSQL.',TRUE,FALSE,20),
    ('data_ingestion_tools','ingestion_statcan','loadStatCanMacroData','Run Statistics Canada Ingestion','Loads active Statistics Canada vector-based macroeconomic indicators into PostgreSQL.','packages/ingestion/src/loadStatCanMacroData.js','node','INGESTION_RUN_STATCAN','medium',TRUE,'This will call the Statistics Canada ingestion pipeline and write any new data into PostgreSQL.',TRUE,FALSE,30),
    ('data_ingestion_tools','ingestion_manual','loadManualData','Run Manual Ingestion','Loads configured manual spreadsheet or CSV data into PostgreSQL.','packages/ingestion/src/loadManualData.js','node','INGESTION_RUN_MANUAL','medium',TRUE,'This will process the configured manual ingestion file and write mapped data into PostgreSQL.',TRUE,FALSE,40),
    ('file_tools','repo_map_generate','generateRepoMap','Generate Repository Map','Generates a readable repository map for documentation and structural review.','packages/files/src/generateRepoMap.js','node','REPO_MAP_GENERATE','low',FALSE,NULL,TRUE,TRUE,10),
    ('file_tools','repo_zip_generate','generateRepoZip','Generate Repository Zip','Generates a zip archive of a repository using the configured ignore rules for project handoff and review.','packages/files/src/generateRepoZip.js','node','REPO_ZIP_GENERATE','low',FALSE,NULL,TRUE,TRUE,20)
) AS v(category_code, tool_code, name, label, description, script_path, runtime_code, permission_code, risk_code, requires_confirmation, confirmation_text, captures_output, allow_params, display_order)
JOIN core.applications a ON a.app_code = 'SKYSERVER_CORE'
JOIN core.tool_categories c ON c.app_id = a.app_id AND c.category_code = v.category_code
JOIN core.repositories r ON r.repo_code = 'SkyServer'
ON CONFLICT (tool_code) DO UPDATE
SET category_id = EXCLUDED.category_id,
    name = EXCLUDED.name,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    script_repo_id = EXCLUDED.script_repo_id,
    script_path = EXCLUDED.script_path,
    runtime_code = EXCLUDED.runtime_code,
    permission_code = EXCLUDED.permission_code,
    risk_code = EXCLUDED.risk_code,
    requires_confirmation = EXCLUDED.requires_confirmation,
    confirmation_text = EXCLUDED.confirmation_text,
    captures_output = EXCLUDED.captures_output,
    allow_params = EXCLUDED.allow_params,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.tool_visibility (tool_id, channel_code)
SELECT t.tool_id, v.channel_code
FROM core.tools t
JOIN (
  VALUES
    ('db_health','cli'), ('db_health','admin-web'), ('db_health','api'), ('db_health','worker'),
    ('db_build','cli'), ('db_build','admin-web'), ('db_build','api'),
    ('auth_create_admin_user','cli'),
    ('git_repo_status','cli'), ('git_repo_status','admin-web'), ('git_repo_status','api'),
    ('dev_commit','cli'), ('dev_commit','admin-web'), ('dev_commit','api'),
    ('main_merge','cli'), ('main_merge','admin-web'), ('main_merge','api'),
    ('ingestion_fred','cli'), ('ingestion_fred','admin-web'), ('ingestion_fred','api'), ('ingestion_fred','worker'),
    ('ingestion_boc','cli'), ('ingestion_boc','admin-web'), ('ingestion_boc','api'), ('ingestion_boc','worker'),
    ('ingestion_statcan','cli'), ('ingestion_statcan','admin-web'), ('ingestion_statcan','api'), ('ingestion_statcan','worker'),
    ('ingestion_manual','cli'), ('ingestion_manual','admin-web'), ('ingestion_manual','api'),
    ('repo_map_generate','cli'), ('repo_map_generate','admin-web'), ('repo_map_generate','api'),
    ('repo_zip_generate','cli'), ('repo_zip_generate','admin-web'), ('repo_zip_generate','api')
) AS v(tool_code, channel_code) ON v.tool_code = t.tool_code
ON CONFLICT (tool_id, channel_code) DO NOTHING;

INSERT INTO core.tool_parameters (tool_id, parameter_name, label, param_type_code, prompt, required, default_value, option_source_code, display_order, enabled)
SELECT t.tool_id, v.parameter_name, v.label, v.param_type_code, v.prompt, v.required, v.default_value, v.option_source_code, v.display_order, TRUE
FROM core.tools t
JOIN (
  VALUES
    ('db_build','databaseName','Database Name','string','Enter target database name, for example skyserver_dev or skyserver_test',TRUE,NULL,NULL,10),
    ('git_repo_status','repoName','Repository','repo','Select repository',TRUE,NULL,'repositories',10),
    ('dev_commit','repoName','Repository','repo','Select repository',TRUE,NULL,'repositories',10),
    ('dev_commit','commitMessage','Commit Message','string','Enter commit message',TRUE,NULL,NULL,20),
    ('main_merge','repoName','Repository','repo','Select repository',TRUE,NULL,'repositories',10),
    ('main_merge','tagName','Optional Tag Name','string','Optional tag name (leave blank for none)',FALSE,NULL,NULL,20),
    ('repo_map_generate','location','Root Folder Location','string','Enter root folder location',TRUE,NULL,NULL,10),
    ('repo_map_generate','fileName','Output File Name','string','Enter output file name',TRUE,NULL,NULL,20),
    ('repo_map_generate','outputPath','Optional Output Path','string','Optional output path (leave blank to use same location)',FALSE,NULL,NULL,30),
    ('repo_zip_generate','location','Root Folder Location','string','Enter root folder location',TRUE,NULL,NULL,10),
    ('repo_zip_generate','fileName','Output Zip File Name','string','Enter output zip file name',TRUE,NULL,NULL,20),
    ('repo_zip_generate','outputPath','Optional Output Path','string','Optional output path (leave blank to use same location)',FALSE,NULL,NULL,30)
) AS v(tool_code, parameter_name, label, param_type_code, prompt, required, default_value, option_source_code, display_order)
ON v.tool_code = t.tool_code
ON CONFLICT (tool_id, parameter_name) DO UPDATE
SET label = EXCLUDED.label,
    param_type_code = EXCLUDED.param_type_code,
    prompt = EXCLUDED.prompt,
    required = EXCLUDED.required,
    default_value = EXCLUDED.default_value,
    option_source_code = EXCLUDED.option_source_code,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
