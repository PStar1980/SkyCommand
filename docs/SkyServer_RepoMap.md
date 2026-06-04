SkyServer/
├── .editorconfig
├── .env.example
├── .gitattributes
├── .gitignore
├── .prettierignore
├── .prettierrc.json
├── eslint.config.mjs
├── package-lock.json
├── package.json
├── README.md
├── .github/
│ └── workflows/
├── .husky/
│ ├── pre-commit
│ ├── pre-push
│ └── \_/
│ ├── .gitignore
│ ├── applypatch-msg
│ ├── commit-msg
│ ├── h
│ ├── husky.sh
│ ├── post-applypatch
│ ├── post-checkout
│ ├── post-commit
│ ├── post-merge
│ ├── post-rewrite
│ ├── pre-applypatch
│ ├── pre-auto-gc
│ ├── pre-commit
│ ├── pre-merge-commit
│ ├── pre-push
│ ├── pre-rebase
│ └── prepare-commit-msg
├── apps/
│ ├── admin-web/
│ │ ├── index.html
│ │ ├── vite.config.js
│ │ └── src/
│ │ ├── App.css
│ │ ├── App.jsx
│ │ ├── index.css
│ │ ├── main.jsx
│ │ ├── components/
│ │ │ ├── Navbar.jsx
│ │ │ └── ProtectedRoute.jsx
│ │ ├── context/
│ │ │ └── AuthContext.jsx
│ │ ├── pages/
│ │ │ ├── AdminPrivileges.jsx
│ │ │ ├── AdminRepositories.jsx
│ │ │ ├── AdminRoles.jsx
│ │ │ ├── AdminSessions.jsx
│ │ │ ├── AdminUsers.jsx
│ │ │ ├── AuditEvents.jsx
│ │ │ ├── AutomationListeners.jsx
│ │ │ ├── Dashboard.jsx
│ │ │ ├── Home.jsx
│ │ │ ├── IngestionStatus.jsx
│ │ │ ├── Login.jsx
│ │ │ ├── SchedulerControl.jsx
│ │ │ ├── ScriptExecutions.jsx
│ │ │ ├── Tools.jsx
│ │ │ └── WorkerControl.jsx
│ │ └── services/
│ │ ├── adminService.js
│ │ ├── api.js
│ │ ├── authService.js
│ │ ├── ingestionService.js
│ │ ├── toolService.js
│ │ └── workerService.js
│ ├── api/
│ │ └── src/
│ │ ├── index.js
│ │ ├── server.js
│ │ ├── controllers/
│ │ │ ├── adminController.js
│ │ │ ├── authController.js
│ │ │ ├── ingestionController.js
│ │ │ ├── macroController.js
│ │ │ ├── publicMacroController.js
│ │ │ ├── skywebController.js
│ │ │ ├── toolsController.js
│ │ │ └── workerController.js
│ │ ├── middleware/
│ │ │ ├── authMiddleware.js
│ │ │ └── permissionMiddleware.js
│ │ ├── routes/
│ │ │ ├── admin.routes.js
│ │ │ ├── auth.routes.js
│ │ │ ├── ingestion.routes.js
│ │ │ ├── macro.routes.js
│ │ │ ├── public.routes.js
│ │ │ ├── publicMacro.routes.js
│ │ │ ├── skyweb.routes.js
│ │ │ ├── tools.routes.js
│ │ │ └── worker.routes.js
│ │ └── services/
│ │ ├── adminActionService.js
│ │ ├── adminReadService.js
│ │ ├── authService.js
│ │ ├── ingestionStatusService.js
│ │ ├── macroReadService.js
│ │ ├── publicMacroService.js
│ │ ├── scriptExecutionService.js
│ │ ├── skywebAlertsService.js
│ │ ├── skywebDashboardsService.js
│ │ ├── skywebPreferencesService.js
│ │ ├── skywebProfileService.js
│ │ ├── skywebSavedViewsService.js
│ │ ├── toolManifestService.js
│ │ └── workerService.js
│ └── worker/
│ └── src/
│ ├── index.js
│ ├── jobs/
│ │ ├── scheduledToolRunner.js
│ │ ├── workerNodeService.js
│ │ └── workerToolExecutionService.js
│ ├── listeners/
│ │ └── listenerPoller.js
│ └── schedulers/
│ ├── scheduleCalculator.js
│ └── schedulePoller.js
├── docs/
│ ├── SkyServer_RepoMap.md
│ └── SkyServer_Temporal_Workflow_Architecture_Plan.md
├── packages/
│ ├── auth/
│ │ └── src/
│ │ ├── createAdminUser.js
│ │ └── password.js
│ ├── core/
│ │ └── src/
│ │ └── SkyServer_Core.js
│ ├── db/
│ │ └── src/
│ │ ├── connection.js
│ │ └── db_health.js
│ ├── db_build/
│ │ └── src/
│ │ ├── db_build.js
│ │ ├── migrations/
│ │ │ ├── 00002**schema_macro.sql
│ │ │ ├── 00003**table_indicators.sql
│ │ │ ├── 00005**gen_indicator_tables.sql
│ │ │ ├── 00006**indicators_update.sql
│ │ │ ├── 00007_indicator_views.sql
│ │ │ ├── 00008_indicator_views.sql
│ │ │ ├── 00009_gen_indicator_tables.sql
│ │ │ ├── 00011_gen_indicator_tables.sql
│ │ │ ├── 00012_indicator_views.sql
│ │ │ ├── 00013_indicator_views.sql
│ │ │ ├── 00014**schema_auth.sql
│ │ │ ├── 00015**auth_tables.sql
│ │ │ ├── 00017**auth_views.sql
│ │ │ ├── 00018**core_config_tables.sql
│ │ │ ├── 00020**worker_tables.sql
│ │ │ ├── 00021**worker_automation_polish.sql
│ │ │ ├── 00022**auth_application_scope.sql
│ │ │ ├── 00023**skyweb_auth_profiles.sql
│ │ │ ├── 00025**skyweb_saved_macro_views.sql
│ │ │ ├── 00026**skyweb_user_dashboards.sql
│ │ │ ├── 00027**skyweb_dashboard_item_visualization_modes.sql
│ │ │ ├── 00028**skyweb_dashboard_indicator_items.sql
│ │ │ └── 00029**skyweb_alert_rules.sql
│ │ └── seeds/
│ │ ├── 00004**data_indicators.sql
│ │ ├── 00010**data_indicators.sql
│ │ ├── 00016**auth_seed_roles_permissions.sql
│ │ ├── 00019**core_config_seed.sql
│ │ ├── 00024**skyweb_auth_seed.sql
│ │ └── 00030\_\_skyweb_alert_worker_seed.sql
│ ├── files/
│ │ └── src/
│ │ ├── generateRepoMap.js
│ │ └── generateRepoZip.js
│ ├── git/
│ │ └── src/
│ │ ├── dev_commit.js
│ │ ├── git_repo_status.js
│ │ └── main_merge.js
│ ├── ingestion/
│ │ └── src/
│ │ ├── loadBoCMacroData.js
│ │ ├── loadFREDMacroData.js
│ │ ├── loadManualData.js
│ │ ├── loadStatCanMacroData.js
│ │ ├── config/
│ │ │ ├── manualIngestion.json
│ │ │ ├── statcanIndicators.js
│ │ │ └── statcanVectors.js
│ │ ├── core/
│ │ │ └── runPipeline.js
│ │ ├── discovery/
│ │ │ ├── discoverStatCanMetadata.js
│ │ │ └── resolveStatCanVectors.js
│ │ ├── loaders/
│ │ │ ├── copyLoader.js
│ │ │ └── manualCopyLoader.js
│ │ ├── manual/
│ │ │ └── manual_data.csv
│ │ ├── sources/
│ │ │ ├── boc.js
│ │ │ ├── fred.js
│ │ │ ├── indicators.js
│ │ │ ├── manual.js
│ │ │ └── statcan.js
│ │ └── transform/
│ │ └── csvNormalizer.js
│ ├── shared/
│ │ └── src/
│ │ ├── constants/
│ │ ├── contracts/
│ │ └── validators/
│ └── skyweb/
│ └── src/
│ └── evaluateSkyWebAlerts.js
├── scripts/
│ ├── db/
│ │ ├── functions/
│ │ │ ├── auth.set_updated_at.sql
│ │ │ ├── core.set_updated_at.sql
│ │ │ ├── skyweb.set_updated_at.sql
│ │ │ └── worker.set_updated_at.sql
│ │ ├── schemas/
│ │ │ ├── auth.sql
│ │ │ ├── core.sql
│ │ │ ├── macro.sql
│ │ │ ├── skyweb.sql
│ │ │ └── worker.sql
│ │ ├── tables/
│ │ │ ├── auth.audit_events.sql
│ │ │ ├── auth.login_events.sql
│ │ │ ├── auth.permissions.sql
│ │ │ ├── auth.role_permissions.sql
│ │ │ ├── auth.roles.sql
│ │ │ ├── auth.script_execution_log.sql
│ │ │ ├── auth.sessions.sql
│ │ │ ├── auth.user_applications.sql
│ │ │ ├── auth.user_roles.sql
│ │ │ ├── auth.users.sql
│ │ │ ├── core.applications.sql
│ │ │ ├── core.config_profiles.sql
│ │ │ ├── core.option_sources.sql
│ │ │ ├── core.param_types.sql
│ │ │ ├── core.repositories.sql
│ │ │ ├── core.repository_paths.sql
│ │ │ ├── core.risk_levels.sql
│ │ │ ├── core.runtimes.sql
│ │ │ ├── core.tool_categories.sql
│ │ │ ├── core.tool_category_visibility.sql
│ │ │ ├── core.tool_parameter_options.sql
│ │ │ ├── core.tool_parameters.sql
│ │ │ ├── core.tool_visibility.sql
│ │ │ ├── core.tools.sql
│ │ │ ├── core.visibility_channels.sql
│ │ │ ├── macro.indicators..sql
│ │ │ ├── skyweb.saved_macro_views.sql
│ │ │ ├── skyweb.user_preferences.sql
│ │ │ ├── skyweb.user_profiles.sql
│ │ │ ├── worker.listener_events.sql
│ │ │ ├── worker.listeners_phase8_5.sql
│ │ │ ├── worker.listeners.sql
│ │ │ ├── worker.schedule_runs.sql
│ │ │ ├── worker.schedules_phase8_5.sql
│ │ │ ├── worker.schedules.sql
│ │ │ └── worker.worker_nodes.sql
│ │ ├── triggers/
│ │ │ ├── auth.permissions_set_updated_at.sql
│ │ │ ├── auth.roles_set_updated_at.sql
│ │ │ ├── auth.user_applications_set_updated_at.sql
│ │ │ ├── auth.users_set_updated_at.sql
│ │ │ ├── core.applications_set_updated_at.sql
│ │ │ ├── core.repositories_set_updated_at.sql
│ │ │ ├── core.repository_paths_set_updated_at.sql
│ │ │ ├── core.tool_categories_set_updated_at.sql
│ │ │ ├── core.tool_parameters_set_updated_at.sql
│ │ │ ├── core.tools_set_updated_at.sql
│ │ │ ├── skyweb.saved_macro_views_set_updated_at.sql
│ │ │ ├── skyweb.user_preferences_set_updated_at.sql
│ │ │ ├── skyweb.user_profiles_set_updated_at.sql
│ │ │ ├── worker.listener_events_set_updated_at.sql
│ │ │ ├── worker.listeners_set_updated_at.sql
│ │ │ ├── worker.schedule_runs_set_updated_at.sql
│ │ │ ├── worker.schedules_set_updated_at.sql
│ │ │ ├── worker.vw_listener_events_recent.sql
│ │ │ ├── worker.vw_listeners.sql
│ │ │ ├── worker.vw_schedule_runs_recent.sql
│ │ │ ├── worker.vw_schedules.sql
│ │ │ ├── worker.vw_worker_nodes.sql
│ │ │ └── worker.worker_nodes_set_updated_at.sql
│ │ └── views/
│ │ ├── auth.vw_active_sessions.sql
│ │ ├── auth.vw_audit_events_recent.sql
│ │ ├── auth.vw_login_events_recent.sql
│ │ ├── auth.vw_role_permissions.sql
│ │ ├── auth.vw_script_execution_recent.sql
│ │ ├── auth.vw_user_applications.sql
│ │ ├── auth.vw_user_permissions.sql
│ │ ├── auth.vw_user_roles.sql
│ │ ├── core.vw_admin_web_tools.sql
│ │ ├── core.vw_cli_categories.sql
│ │ ├── core.vw_cli_tools.sql
│ │ ├── core.vw_repository_paths.sql
│ │ ├── core.vw_tool_manifest.sql
│ │ ├── core.vw_tool_parameter_options.sql
│ │ ├── core.vw_tool_parameters.sql
│ │ ├── macro.vw_ca_growth.sql
│ │ ├── macro.vw_ca_housing.sql
│ │ ├── macro.vw_ca_inflation.sql
│ │ ├── macro.vw_ca_labor.sql
│ │ ├── macro.vw_ca_macro_regime.sql
│ │ ├── macro.vw_ca_rates_fx.sql
│ │ ├── macro.vw_ca_trade.sql
│ │ ├── macro.vw_credit_conditions.sql
│ │ ├── macro.vw_growth.sql
│ │ ├── macro.vw_housing.sql
│ │ ├── macro.vw_inflation.sql
│ │ ├── macro.vw_labor.sql
│ │ ├── macro.vw_liquidity.sql
│ │ ├── macro.vw_macro_regime.sql
│ │ ├── macro.vw_rates_curve.sql
│ │ ├── macro.vw_us_ca_inflation_compare.sql
│ │ ├── macro.vw_us_ca_labor_compare.sql
│ │ ├── macro.vw_us_ca_policy_fx.sql
│ │ ├── skyweb.vw_saved_macro_views.sql
│ │ ├── skyweb.vw_user_preferences.sql
│ │ ├── skyweb.vw_user_profiles.sql
│ │ ├── worker.vw_listener_events_recent.sql
│ │ ├── worker.vw_listeners.sql
│ │ ├── worker.vw_schedule_runs_recent.sql
│ │ ├── worker.vw_schedules.sql
│ │ └── worker.vw_worker_nodes.sql
│ ├── node/
│ │ └── util/
│ │ ├── bootstrap.js
│ │ └── logger.js
│ ├── powershell/
│ │ ├── Build-SkyOne-Bootloader.ps1
│ │ ├── Clean-BackendCache.ps1
│ │ └── Clean-FrontendCache.ps1
│ └── python/
└── tests/
└── e2e/
