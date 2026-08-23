SkyCommand/
├── .dockerignore
├── .editorconfig
├── .env.example
├── .gitattributes
├── .gitignore
├── .prettierignore
├── .prettierrc.json
├── change.log
├── compose.yaml
├── eslint.config.mjs
├── nodemon.json
├── package-lock.json
├── package.json
├── README.md
├── .husky/
│   ├── pre-commit
│   ├── pre-push
│   └── _/
│       ├── .gitignore
│       ├── applypatch-msg
│       ├── commit-msg
│       ├── h
│       ├── husky.sh
│       ├── post-applypatch
│       ├── post-checkout
│       ├── post-commit
│       ├── post-merge
│       ├── post-rewrite
│       ├── pre-applypatch
│       ├── pre-auto-gc
│       ├── pre-commit
│       ├── pre-merge-commit
│       ├── pre-push
│       ├── pre-rebase
│       └── prepare-commit-msg
├── apps/
│   ├── admin-web/
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   ├── public/
│   │   │   └── brand/
│   │   │       ├── skycommand-logo-lockup.png
│   │   │       ├── skycommand-mark-gold.png
│   │   │       └── assets/
│   │   └── src/
│   │       ├── App.css
│   │       ├── App.jsx
│   │       ├── index.css
│   │       ├── main.jsx
│   │       ├── assets/
│   │       │   ├── sky-net-background.png
│   │       │   └── sky-net-background.svg
│   │       ├── components/
│   │       │   ├── ConditionParameterEditor.jsx
│   │       │   ├── DockerContainerDetailsModal.jsx
│   │       │   ├── DockerProjectDetailsModal.jsx
│   │       │   ├── DockerResourceDetailsModal.jsx
│   │       │   ├── HumanApprovalParameterEditor.jsx
│   │       │   ├── IngestionProfileEditor.jsx
│   │       │   ├── Navbar.jsx
│   │       │   ├── ProtectedRoute.jsx
│   │       │   ├── RepositoryForm.jsx
│   │       │   ├── RuntimeParameterSchemaEditor.jsx
│   │       │   ├── SummaryParameterEditor.jsx
│   │       │   ├── ToolParameterEditor.jsx
│   │       │   ├── WaitParameterEditor.jsx
│   │       │   ├── WorkflowApprovalOverlay.jsx
│   │       │   ├── WorkflowRetryPolicyEditor.jsx
│   │       │   ├── WorkflowVisualGraph.jsx
│   │       │   ├── charts/
│   │       │   │   ├── ApiObservabilityPanel.jsx
│   │       │   │   ├── ApplicationUserSummaryRow.jsx
│   │       │   │   ├── chartData.js
│   │       │   │   ├── ChartFullscreenOverlay.jsx
│   │       │   │   ├── chartOptions.js
│   │       │   │   ├── chartTheme.js
│   │       │   │   ├── chartTypographySelfTest.js
│   │       │   │   ├── DashboardVisuals.jsx
│   │       │   │   ├── DockerTelemetryVisuals.jsx
│   │       │   │   ├── DurationTrendChart.jsx
│   │       │   │   ├── EChartCanvas.jsx
│   │       │   │   ├── EChartCard.jsx
│   │       │   │   ├── EmptyChartState.jsx
│   │       │   │   ├── IdentityHorizontalBarChart.jsx
│   │       │   │   ├── IngestionStatusVisuals.jsx
│   │       │   │   ├── liveChartUpdateSelfTest.js
│   │       │   │   ├── OutcomeBarChart.jsx
│   │       │   │   ├── ProductionReadinessVisuals.jsx
│   │       │   │   ├── StatusDonut.jsx
│   │       │   │   ├── ToolsHistoryVisuals.jsx
│   │       │   │   ├── TrendAreaChart.jsx
│   │       │   │   ├── WorkerHealthVisuals.jsx
│   │       │   │   └── WorkflowHistoryVisuals.jsx
│   │       │   ├── tools/
│   │       │   │   ├── StructuredToolResultDisplay.jsx
│   │       │   │   └── ToolExecutionOutputPanels.jsx
│   │       │   └── ui/
│   │       │       ├── brandThemeSelfTest.js
│   │       │       ├── commandSearchSelfTest.js
│   │       │       ├── DashboardFilterCard.jsx
│   │       │       ├── DashboardRefreshActions.jsx
│   │       │       ├── dashboardUiConsistencySelfTest.js
│   │       │       ├── DismissibleAlert.jsx
│   │       │       ├── PageHeader.jsx
│   │       │       ├── Panel.jsx
│   │       │       ├── ServerStatusPanel.jsx
│   │       │       ├── sidebarAccordionSelfTest.js
│   │       │       ├── SidebarNav.jsx
│   │       │       ├── SkyCommandMark.jsx
│   │       │       ├── SmartPollingStatus.jsx
│   │       │       ├── StatCard.jsx
│   │       │       ├── StatusPill.jsx
│   │       │       └── transientAlertSelfTest.js
│   │       ├── context/
│   │       │   └── AuthContext.jsx
│   │       ├── hooks/
│   │       │   ├── useDockerEventStream.js
│   │       │   ├── useDockerOverview.js
│   │       │   ├── useDockerTelemetryStream.js
│   │       │   └── useSmartPolling.js
│   │       ├── pages/
│   │       │   ├── AddRepository.jsx
│   │       │   ├── AddTool.jsx
│   │       │   ├── AdminPrivileges.jsx
│   │       │   ├── AdminRepositories.jsx
│   │       │   ├── AdminRoles.jsx
│   │       │   ├── AdminSessions.jsx
│   │       │   ├── AdminUsers.jsx
│   │       │   ├── ApiDashboard.jsx
│   │       │   ├── apiDashboardSelfTest.js
│   │       │   ├── approvalHistorySelfTest.js
│   │       │   ├── AuditEvents.jsx
│   │       │   ├── AutomationDashboard.jsx
│   │       │   ├── AutomationListeners.jsx
│   │       │   ├── Dashboard.jsx
│   │       │   ├── DataStatus.jsx
│   │       │   ├── dockerInfrastructureSurfaceSelfTest.js
│   │       │   ├── DockerInventory.jsx
│   │       │   ├── DockerOperations.jsx
│   │       │   ├── DockerOverview.jsx
│   │       │   ├── Home.jsx
│   │       │   ├── IngestionOperations.jsx
│   │       │   ├── ingestionOperationsSurfaceSelfTest.js
│   │       │   ├── IngestionStatus.jsx
│   │       │   ├── Login.jsx
│   │       │   ├── ManageRepositories.jsx
│   │       │   ├── ManageTools.jsx
│   │       │   ├── manageToolsVerificationNavigationSelfTest.js
│   │       │   ├── ProductionReadiness.jsx
│   │       │   ├── ReadinessDashboard.jsx
│   │       │   ├── repositoryAdminUtils.js
│   │       │   ├── repositoryPageSplitSelfTest.js
│   │       │   ├── runToolsCatalogueSelfTest.js
│   │       │   ├── SchedulerControl.jsx
│   │       │   ├── schedulerPageSplitSelfTest.js
│   │       │   ├── ScriptExecutions.jsx
│   │       │   ├── SkyWorkflows.jsx
│   │       │   ├── TemporalWorkflows.jsx
│   │       │   ├── toolHistoryCatalogueSelfTest.js
│   │       │   ├── Tools.jsx
│   │       │   ├── ToolsDashboard.jsx
│   │       │   ├── WorkerControl.jsx
│   │       │   ├── WorkflowApprovals.jsx
│   │       │   ├── WorkflowBuilder.jsx
│   │       │   ├── workflowDatabaseOutputSelfTest.js
│   │       │   ├── workflowEditorGraphParitySelfTest.js
│   │       │   ├── WorkflowManager.jsx
│   │       │   ├── WorkflowsDashboard.jsx
│   │       │   ├── workflowStartCatalogueSelfTest.js
│   │       │   └── WorkflowWorkerHealth.jsx
│   │       ├── services/
│   │       │   ├── adminService.js
│   │       │   ├── api.js
│   │       │   ├── authExpiryRefreshSelfTest.js
│   │       │   ├── authService.js
│   │       │   ├── infrastructureService.js
│   │       │   ├── ingestionService.js
│   │       │   ├── notificationService.js
│   │       │   ├── temporalService.js
│   │       │   ├── toolService.js
│   │       │   ├── workerService.js
│   │       │   └── workflowService.js
│   │       └── utils/
│   │           └── dockerLiveStatus.js
│   ├── api/
│   │   └── src/
│   │       ├── index.js
│   │       ├── server.js
│   │       ├── controllers/
│   │       │   ├── adminController.js
│   │       │   ├── authController.js
│   │       │   ├── infrastructureController.js
│   │       │   ├── ingestionController.js
│   │       │   ├── macroController.js
│   │       │   ├── notificationController.js
│   │       │   ├── publicMacroController.js
│   │       │   ├── skywebController.js
│   │       │   ├── temporalController.js
│   │       │   ├── toolsController.js
│   │       │   ├── workerController.js
│   │       │   └── workflowController.js
│   │       ├── middleware/
│   │       │   ├── apiTelemetryMiddleware.js
│   │       │   ├── authMiddleware.js
│   │       │   └── permissionMiddleware.js
│   │       ├── routes/
│   │       │   ├── admin.routes.js
│   │       │   ├── auth.routes.js
│   │       │   ├── infrastructure.routes.js
│   │       │   ├── ingestion.routes.js
│   │       │   ├── macro.routes.js
│   │       │   ├── public.routes.js
│   │       │   ├── publicMacro.routes.js
│   │       │   ├── skyweb.routes.js
│   │       │   ├── temporal.routes.js
│   │       │   ├── tools.routes.js
│   │       │   ├── worker.routes.js
│   │       │   └── workflow.routes.js
│   │       ├── services/
│   │       │   ├── adminActionService.js
│   │       │   ├── adminReadService.js
│   │       │   ├── apiDockerPreflight.js
│   │       │   ├── apiTelemetryPolicy.js
│   │       │   ├── apiTelemetryPolicySelfTest.js
│   │       │   ├── apiTelemetryService.js
│   │       │   ├── authService.js
│   │       │   ├── dockerEventStreamService.js
│   │       │   ├── dockerEventStreamServiceSelfTest.js
│   │       │   ├── dockerTelemetryStreamService.js
│   │       │   ├── dockerTelemetryStreamServiceSelfTest.js
│   │       │   ├── infrastructureService.js
│   │       │   ├── infrastructureServiceSelfTest.js
│   │       │   ├── ingestionStatusService.js
│   │       │   ├── legacyMacroFreshnessAdapter.js
│   │       │   ├── legacyMacroFreshnessAdapterSelfTest.js
│   │       │   ├── macroReadService.js
│   │       │   ├── notificationFoundationSelfTest.js
│   │       │   ├── notificationService.js
│   │       │   ├── phase15ClosureReadinessSelfTest.js
│   │       │   ├── productionReadinessService.js
│   │       │   ├── publicMacroService.js
│   │       │   ├── scriptExecutionService.js
│   │       │   ├── skycommandRepositorySelfTest.js
│   │       │   ├── skycommandRepositoryService.js
│   │       │   ├── skywebAlertPreferencesService.js
│   │       │   ├── skywebAlertsService.js
│   │       │   ├── skywebDashboardsService.js
│   │       │   ├── skywebPreferencesService.js
│   │       │   ├── skywebProfileService.js
│   │       │   ├── skywebSavedViewsService.js
│   │       │   ├── structuredToolContractAssociationSelfTest.js
│   │       │   ├── temporalService.js
│   │       │   ├── toolAdminService.js
│   │       │   ├── toolExecutionHttpResponse.js
│   │       │   ├── toolExecutionHttpResponseSelfTest.js
│   │       │   ├── toolExecutionOutputWorkspaceSelfTest.js
│   │       │   ├── toolManifestService.js
│   │       │   ├── toolOnboardingSelfTest.js
│   │       │   ├── toolOnboardingService.js
│   │       │   ├── toolVerificationSelfTest.js
│   │       │   ├── toolVerificationService.js
│   │       │   ├── workerService.js
│   │       │   ├── workflowApprovalBranchSelfTest.js
│   │       │   ├── workflowCloneParitySelfTest.js
│   │       │   ├── workflowConditionSelfTest.js
│   │       │   ├── workflowConditionService.js
│   │       │   ├── workflowExecutionPreflightSelfTest.js
│   │       │   ├── workflowExecutionPreflightService.js
│   │       │   ├── workflowExecutorService.js
│   │       │   ├── workflowHealthService.js
│   │       │   ├── workflowParameterUtils.js
│   │       │   ├── workflowParameterUtilsSelfTest.js
│   │       │   ├── workflowServiceError.js
│   │       │   ├── workflowToolConfirmationPolicySelfTest.js
│   │       │   └── workflowToolVisibilitySelfTest.js
│   │       └── utils/
│   │           └── liveTelemetryEnvelope.js
│   └── worker/
│       └── src/
│           ├── index.js
│           ├── jobs/
│           │   ├── scheduledSkyCommandWorkflowRunner.js
│           │   ├── scheduledTemporalWorkflowRunner.js
│           │   ├── scheduledToolRunner.js
│           │   ├── workerNodeService.js
│           │   └── workerToolExecutionService.js
│           ├── listeners/
│           │   └── listenerPoller.js
│           └── schedulers/
│               ├── scheduleCalculator.js
│               └── schedulePoller.js
├── docker/
│   ├── api.Dockerfile
│   ├── api.package.json
│   ├── empty-github-token
│   ├── git-credential-skycommand.js
│   ├── git-credential-skycommand.sh
│   ├── node-worker.Dockerfile
│   ├── node-worker.package.json
│   ├── temporal-worker.Dockerfile
│   ├── temporal-worker.package.json
│   ├── web.Dockerfile
│   ├── web.nginx.conf
│   └── web.package.json
├── docs/
│   ├── SkyCommand_Admin_Web_Docker_Local_Setup.md
│   ├── SkyCommand_AI_Tool_Build_Prompt.md
│   ├── SkyCommand_API_Docker_Local_Setup.md
│   ├── SkyCommand_API_Observability.md
│   ├── SkyCommand_Data_Domain_Onboarding_and_Operations_Guide.md
│   ├── SkyCommand_Docker_Infrastructure_Control_Plane.md
│   ├── SkyCommand_Host_Agent_Local_Setup.md
│   ├── SkyCommand_Phase_14_Structured_Tool_Results.md
│   ├── SkyCommand_Phase_15_Tool_Catalogue_Administration.md
│   ├── SkyCommand_Phase_16_Closure_Report.md
│   ├── SkyCommand_PostgreSQL_Docker_Migration.md
│   ├── SkyCommand_RepoMap.md
│   ├── SkyCommand_Temporal_Local_Setup.md
│   ├── SkyCommand_Temporal_Workflow_Architecture_Plan.md
│   ├── SkyCommand_Tool_Authoring_Guide.md
│   ├── assets/
│   │   ├── auth_schema_ERD.png
│   │   ├── core_schema_ERD.png
│   │   ├── skyweb_schema_ERD.png
│   │   └── worker_schema_ERD.png
│   └── audits/
├── packages/
│   ├── auth/
│   │   └── src/
│   │       ├── createAdminUser.js
│   │       └── password.js
│   ├── core/
│   │   └── src/
│   │       ├── runtimePathResolver.js
│   │       ├── runtimePathResolverSelfTest.js
│   │       ├── SkyCommand_Core.js
│   │       ├── skyCommandIdentitySelfTest.js
│   │       ├── skyCommandIdentityVerification.js
│   │       ├── workflowCliRuntimeParameters.js
│   │       └── workflowCliRuntimeParametersSelfTest.js
│   ├── db/
│   │   └── src/
│   │       ├── connection.js
│   │       ├── db_health.js
│   │       └── dbHealthResultSelfTest.js
│   ├── db_build/
│   │   └── src/
│   │       ├── databaseBuildResult.js
│   │       ├── db_build.js
│   │       ├── dbBuildResultSelfTest.js
│   │       ├── migrations/
│   │       │   ├── 00002__schema_macro.sql
│   │       │   ├── 00003__table_indicators.sql
│   │       │   ├── 00005__gen_indicator_tables.sql
│   │       │   ├── 00006__indicators_update.sql
│   │       │   ├── 00007_indicator_views.sql
│   │       │   ├── 00008_indicator_views.sql
│   │       │   ├── 00009_gen_indicator_tables.sql
│   │       │   ├── 00011_gen_indicator_tables.sql
│   │       │   ├── 00012_indicator_views.sql
│   │       │   ├── 00013_indicator_views.sql
│   │       │   ├── 00014__schema_auth.sql
│   │       │   ├── 00015__auth_tables.sql
│   │       │   ├── 00017__auth_views.sql
│   │       │   ├── 00018__core_config_tables.sql
│   │       │   ├── 00020__worker_tables.sql
│   │       │   ├── 00021__worker_automation_polish.sql
│   │       │   ├── 00022__auth_application_scope.sql
│   │       │   ├── 00023__skyweb_auth_profiles.sql
│   │       │   ├── 00025__skyweb_saved_macro_views.sql
│   │       │   ├── 00026__skyweb_user_dashboards.sql
│   │       │   ├── 00027__skyweb_dashboard_item_visualization_modes.sql
│   │       │   ├── 00028__skyweb_dashboard_indicator_items.sql
│   │       │   ├── 00029__skyweb_alert_rules.sql
│   │       │   ├── 00031__skyweb_alert_notifications.sql
│   │       │   ├── 00033__temporal_workflow_templates.sql
│   │       │   ├── 00035__temporal_workflow_run_records.sql
│   │       │   ├── 00038__workflow_builder_foundation.sql
│   │       │   ├── 00045__workflow_lifecycle_simplification.sql
│   │       │   ├── 00051__workflow_human_approval_requests.sql
│   │       │   ├── 00054__temporal_worker_heartbeats.sql
│   │       │   ├── 00055__workflow_node_output_persistence.sql
│   │       │   ├── 00062__workflow_output_type_contracts.sql
│   │       │   ├── 00064__remove_tool_manifest_snapshot_enforcement.sql
│   │       │   ├── 00065__repository_intelligence_tool.sql
│   │       │   ├── 00066__tool_catalogue_administration.sql
│   │       │   ├── 00068__skycommand_repository_designation.sql
│   │       │   ├── 00071__api_request_telemetry.sql
│   │       │   ├── 00074__portable_ingestion_identity.sql
│   │       │   ├── 00076__ingestion_profile_guardrails.sql
│   │       │   ├── 00077__portable_asset_metric_catalogue.sql
│   │       │   ├── 00079__portable_catalogue_administration.sql
│   │       │   ├── 00080__explainable_freshness_foundation.sql
│   │       │   ├── 00082__generic_ingestion_ledger.sql
│   │       │   ├── 00084__source_request_retry_policies.sql
│   │       │   ├── 00086__revision_quality_foundation.sql
│   │       │   ├── 00088__portable_quality_policies.sql
│   │       │   ├── 00090__ingestion_recovery_foundation.sql
│   │       │   ├── 00094__skycommand_repository_identity_changeover.sql
│   │       │   ├── 00095__repository_artifact_configuration.sql
│   │       │   ├── 00096__repository_artifact_tool_parameters.sql
│   │       │   ├── 00097__repository_registry_legacy_cleanup.sql
│   │       │   ├── 00098__docker_local_repository_profile.sql
│   │       │   ├── 00099__local_repository_sync_tool.sql
│   │       │   ├── 00100__host_agent_local_repository_sync.sql
│   │       │   ├── 00101__development_promotion_host_sync_node.sql
│   │       │   ├── 00102__docker_infrastructure_read_foundation.sql
│   │       │   ├── 00103__docker_compose_lifecycle_controls.sql
│   │       │   ├── 00104__docker_container_operations.sql
│   │       │   ├── 00105__docker_resource_cleanup.sql
│   │       │   └── 00106__user_notification_foundation.sql
│   │       └── seeds/
│   │           ├── 00004__data_indicators.sql
│   │           ├── 00010__data_indicators.sql
│   │           ├── 00016__auth_seed_roles_permissions.sql
│   │           ├── 00019__core_config_seed.sql
│   │           ├── 00024__skyweb_auth_seed.sql
│   │           ├── 00030__skyweb_alert_worker_seed.sql
│   │           ├── 00032__temporal_auth_seed.sql
│   │           ├── 00034__temporal_workflow_template_seed.sql
│   │           ├── 00036__temporal_schedule_bridge_seed.sql
│   │           ├── 00037__fred_ingestion_tool_upgrade_seed.sql
│   │           ├── 00039__workflow_builder_foundation_seed.sql
│   │           ├── 00040__workflow_executor_v1_seed.sql
│   │           ├── 00041__workflow_executor_permission_hotfix.sql
│   │           ├── 00042__skyserver_workflow_schedule_bridge_seed.sql
│   │           ├── 00043__workflow_builder_permissions_seed.sql
│   │           ├── 00044__boc_statcan_ingestion_tool_upgrade_seed.sql
│   │           ├── 00046__workflow_api_node_support_seed.sql
│   │           ├── 00047__workflow_child_node_support_seed.sql
│   │           ├── 00048__workflow_temporal_template_node_support_seed.sql
│   │           ├── 00049__workflow_condition_node_support_seed.sql
│   │           ├── 00050__workflow_wait_node_support_seed.sql
│   │           ├── 00052__workflow_human_approval_node_support_seed.sql
│   │           ├── 00053__workflow_retry_policy_hotfix.sql
│   │           ├── 00056__workflow_runtime_parameters_seed.sql
│   │           ├── 00057__workflow_runtime_parameter_scope_cleanup.sql
│   │           ├── 00058__workflow_summary_node_support_seed.sql
│   │           ├── 00059__workflow_scheduler_audit_privileges_seed.sql
│   │           ├── 00060__temporal_listener_audit_privileges_seed.sql
│   │           ├── 00061__skycommand_application_brand_seed.sql
│   │           ├── 00067__tool_catalogue_admin_permissions_seed.sql
│   │           ├── 00069__db_health_structured_output_seed.sql
│   │           ├── 00070__db_build_structured_output_seed.sql
│   │           ├── 00072__api_telemetry_permissions_seed.sql
│   │           ├── 00073__structured_tool_contract_associations_seed.sql
│   │           ├── 00075__portable_ingestion_identity_seed.sql
│   │           ├── 00078__portable_asset_metric_catalogue_seed.sql
│   │           ├── 00081__explainable_freshness_foundation_seed.sql
│   │           ├── 00083__generic_ingestion_ledger_seed.sql
│   │           ├── 00085__source_request_retry_policies_seed.sql
│   │           ├── 00087__revision_quality_foundation_seed.sql
│   │           ├── 00089__portable_quality_policies_seed.sql
│   │           ├── 00091__ingestion_recovery_foundation_seed.sql
│   │           ├── 00092__production_ingestion_recovery_integration.sql
│   │           └── 00093__workflow_ingestion_recovery_parameters.sql
│   ├── db_compare/
│   │   └── src/
│   │       └── db_object_compare.js
│   ├── files/
│   │   └── src/
│   │       ├── generateRepoMap.js
│   │       ├── generateRepoZip.js
│   │       ├── repositoryArtifactConfiguration.js
│   │       ├── repositoryArtifactConfigurationSelfTest.js
│   │       ├── repositoryMapResult.js
│   │       ├── repositoryMapResultSelfTest.js
│   │       ├── repositoryPackageResult.js
│   │       └── repositoryPackageResultSelfTest.js
│   ├── git/
│   │   └── src/
│   │       ├── dev_commit.js
│   │       ├── git_repo_status.js
│   │       ├── gitBranchSyncResult.js
│   │       ├── gitBranchSyncResultSelfTest.js
│   │       ├── gitCommitResult.js
│   │       ├── gitCommitResultSelfTest.js
│   │       ├── gitLocalSyncResult.js
│   │       ├── gitLocalSyncResultSelfTest.js
│   │       ├── gitRepositoryStatusInspector.js
│   │       ├── gitRepositoryStatusResult.js
│   │       ├── gitRepositoryStatusSelfTest.js
│   │       ├── local_repo_sync.js
│   │       └── main_merge.js
│   ├── host-agent/
│   │   └── src/
│   │       ├── activities.js
│   │       ├── config.js
│   │       ├── dockerContainer.js
│   │       ├── dockerContainerSelfTest.js
│   │       ├── dockerControl.js
│   │       ├── dockerControlSelfTest.js
│   │       ├── dockerEventBridge.js
│   │       ├── dockerEventBridgeSelfTest.js
│   │       ├── dockerResource.js
│   │       ├── dockerResourceSelfTest.js
│   │       ├── dockerSnapshot.js
│   │       ├── dockerSnapshotSelfTest.js
│   │       ├── dockerTelemetryBridge.js
│   │       ├── dockerTelemetryBridgeSelfTest.js
│   │       ├── health.js
│   │       ├── hostAgentSelfTest.js
│   │       └── worker.js
│   ├── ingestion/
│   │   └── src/
│   │       ├── loadBoCMacroData.js
│   │       ├── loadFREDMacroData.js
│   │       ├── loadManualData.js
│   │       ├── loadStatCanMacroData.js
│   │       ├── adapters/
│   │       │   ├── bocAdapter.js
│   │       │   ├── fredAdapter.js
│   │       │   ├── manualAdapter.js
│   │       │   └── statcanAdapter.js
│   │       ├── audit/
│   │       │   └── phase16BaselineAudit.js
│   │       ├── catalogue/
│   │       │   ├── dataCatalogueAdminService.js
│   │       │   ├── dataCatalogueAdminServiceSelfTest.js
│   │       │   ├── dataCatalogueService.js
│   │       │   ├── dataCatalogueServiceSelfTest.js
│   │       │   ├── ingestionCatalogueService.js
│   │       │   ├── phase16AssetMetricCatalogue.js
│   │       │   ├── phase16CatalogueAdministration.js
│   │       │   ├── phase16IngestionIdentity.js
│   │       │   ├── phase16IngestionIdentitySelfTest.js
│   │       │   ├── phase16IngestionProfileGuardrails.js
│   │       │   ├── phase16IngestionProfileGuardrailsSelfTest.js
│   │       │   ├── phase16PortabilityProof.js
│   │       │   ├── phase16PortabilityProofSelfTest.js
│   │       │   └── phase16SecondDomainProof.js
│   │       ├── closure/
│   │       │   ├── phase16ClosureStabilization.js
│   │       │   ├── phase16ClosureStabilizationSelfTest.js
│   │       │   ├── phase16PortabilityClosure.js
│   │       │   └── phase16PortabilityClosureSelfTest.js
│   │       ├── config/
│   │       │   ├── manualIngestion.json
│   │       │   ├── statcanIndicators.js
│   │       │   └── statcanVectors.js
│   │       ├── consumer/
│   │       │   ├── dataConsumerService.js
│   │       │   ├── dataConsumerServiceSelfTest.js
│   │       │   └── phase16ConsumerContracts.js
│   │       ├── core/
│   │       │   ├── cliOptions.js
│   │       │   ├── httpSourceClient.js
│   │       │   ├── macroIngestionCli.js
│   │       │   ├── macroIngestionCliSelfTest.js
│   │       │   ├── macroIngestionResult.js
│   │       │   ├── macroIngestionResultSelfTest.js
│   │       │   ├── phase16AdapterOnboardingClosure.js
│   │       │   ├── phase16AdapterRetryFramework.js
│   │       │   ├── phase16ControlledRetryProof.js
│   │       │   ├── retryExecutor.js
│   │       │   ├── runPipeline.js
│   │       │   ├── sourceAdapter.js
│   │       │   ├── sourceAdapterRegistry.js
│   │       │   ├── sourceAdapterRegistrySelfTest.js
│   │       │   ├── sourceAdapterRetrySelfTest.js
│   │       │   └── sourceRequestPolicy.js
│   │       ├── discovery/
│   │       │   ├── discoverStatCanMetadata.js
│   │       │   └── resolveStatCanVectors.js
│   │       ├── fred/
│   │       │   └── fredBatchRunner.js
│   │       ├── freshness/
│   │       │   ├── freshnessAdminService.js
│   │       │   ├── freshnessService.js
│   │       │   ├── freshnessServiceSelfTest.js
│   │       │   ├── phase16ExplainableFreshness.js
│   │       │   ├── phase16FreshnessIntegration.js
│   │       │   └── phase16FreshnessPortabilityProof.js
│   │       ├── ledger/
│   │       │   ├── ingestionLedgerIntegration.js
│   │       │   ├── ingestionLedgerService.js
│   │       │   ├── ingestionRunResult.js
│   │       │   ├── ingestionRunResultSelfTest.js
│   │       │   ├── phase16IngestionLedger.js
│   │       │   ├── phase16IngestionLedgerProof.js
│   │       │   ├── phase16ProductionLedgerIntegration.js
│   │       │   └── phase16WorkflowLedgerLinkage.js
│   │       ├── loaders/
│   │       │   ├── copyLoader.js
│   │       │   ├── manualCopyLoader.js
│   │       │   └── qualityAwareTimeSeriesLoader.js
│   │       ├── manual/
│   │       │   └── manual_data.csv
│   │       ├── quality/
│   │       │   ├── phase16ProductionQualityClosure.js
│   │       │   ├── phase16QualityPolicyFoundation.js
│   │       │   ├── phase16QualityPolicyProof.js
│   │       │   ├── phase16RevisionQualityFoundation.js
│   │       │   ├── phase16RevisionQualityProof.js
│   │       │   ├── qualityEvidenceService.js
│   │       │   ├── qualityPolicy.js
│   │       │   ├── qualityPolicyAdminSelfTest.js
│   │       │   ├── qualityPolicyAdminService.js
│   │       │   ├── qualityPolicySelfTest.js
│   │       │   └── revisionQualitySelfTest.js
│   │       ├── recovery/
│   │       │   ├── ingestionRecoverySelfTest.js
│   │       │   ├── ingestionRecoveryService.js
│   │       │   ├── phase16LiveRecoveryClosure.js
│   │       │   ├── phase16LiveRecoverySelfTest.js
│   │       │   ├── phase16ProductionRecoveryIntegration.js
│   │       │   ├── phase16ProductionRecoveryProof.js
│   │       │   ├── phase16RecoveryFoundation.js
│   │       │   ├── phase16RecoveryProof.js
│   │       │   ├── phase16WorkflowRecoveryClosure.js
│   │       │   ├── productionRecovery.js
│   │       │   └── productionRecoverySelfTest.js
│   │       ├── sources/
│   │       │   ├── boc.js
│   │       │   ├── fred.js
│   │       │   ├── indicators.js
│   │       │   ├── manual.js
│   │       │   └── statcan.js
│   │       └── transform/
│   │           └── csvNormalizer.js
│   ├── skyweb/
│   │   └── src/
│   │       └── evaluateSkyWebAlerts.js
│   ├── temporal/
│   │   └── src/
│   │       ├── config.js
│   │       ├── startFredIngestionWorkflow.js
│   │       ├── temporalHealth.js
│   │       ├── worker.js
│   │       ├── activities/
│   │       │   ├── fredActivities.js
│   │       │   ├── index.js
│   │       │   └── skyCommandWorkflowActivities.js
│   │       └── workflows/
│   │           ├── fredIngestionWorkflow.js
│   │           ├── hostAgentWorkflow.js
│   │           ├── index.js
│   │           └── skyCommandWorkflowExecutorWorkflow.js
│   └── tools/
│       ├── contracts/
│       │   ├── database_build_summary.v1.schema.json
│       │   ├── database_health_summary.v1.schema.json
│       │   ├── git_branch_sync_summary.v1.schema.json
│       │   ├── git_commit_summary.v1.schema.json
│       │   ├── git_local_sync_summary.v1.schema.json
│       │   ├── git_repository_status.v1.schema.json
│       │   ├── ingestion_run_summary.v1.schema.json
│       │   ├── macro_ingestion_summary.v1.schema.json
│       │   ├── postgresql_database_comparison_summary.v1.schema.json
│       │   ├── repository_map_summary.v1.schema.json
│       │   └── repository_package_summary.v1.schema.json
│       ├── custom/
│       │   └── _template/
│       │       ├── example_greeting_summary.v1.schema.json
│       │       ├── README.md
│       │       ├── skycommand.tool.json
│       │       └── src/
│       │           └── tool.js
│       └── src/
│           ├── index.js
│           ├── jsonSchemaValidator.js
│           ├── toolCliAdapter.js
│           ├── toolProcessExecutor.js
│           ├── toolResultContract.js
│           ├── toolResultSelfTest.js
│           ├── toolResultTransport.js
│           ├── workflowResultContext.js
│           └── workflowResultContextSelfTest.js
├── scripts/
│   ├── validate.js
│   ├── db/
│   │   ├── functions/
│   │   │   ├── auth.set_updated_at.sql
│   │   │   ├── core.set_updated_at.sql
│   │   │   ├── skyweb.set_updated_at.sql
│   │   │   └── worker.set_updated_at.sql
│   │   ├── schemas/
│   │   │   ├── auth.sql
│   │   │   ├── core.sql
│   │   │   ├── macro.sql
│   │   │   ├── skyweb.sql
│   │   │   └── worker.sql
│   │   ├── tables/
│   │   │   ├── auth.audit_events.sql
│   │   │   ├── auth.login_events.sql
│   │   │   ├── auth.permissions.sql
│   │   │   ├── auth.role_permissions.sql
│   │   │   ├── auth.roles.sql
│   │   │   ├── auth.script_execution_log.sql
│   │   │   ├── auth.sessions.sql
│   │   │   ├── auth.user_applications.sql
│   │   │   ├── auth.user_notifications.sql
│   │   │   ├── auth.user_roles.sql
│   │   │   ├── auth.users.sql
│   │   │   ├── core.applications.sql
│   │   │   ├── core.config_profiles.sql
│   │   │   ├── core.option_sources.sql
│   │   │   ├── core.param_types.sql
│   │   │   ├── core.repositories.sql
│   │   │   ├── core.repository_paths.sql
│   │   │   ├── core.risk_levels.sql
│   │   │   ├── core.runtimes.sql
│   │   │   ├── core.tool_categories.sql
│   │   │   ├── core.tool_category_visibility.sql
│   │   │   ├── core.tool_parameter_options.sql
│   │   │   ├── core.tool_parameters.sql
│   │   │   ├── core.tool_visibility.sql
│   │   │   ├── core.tools.sql
│   │   │   ├── core.visibility_channels.sql
│   │   │   ├── macro.indicators.sql
│   │   │   ├── skyweb.alert_notifications.sql
│   │   │   ├── skyweb.alert_rule_events.sql
│   │   │   ├── skyweb.alert_rules.sql
│   │   │   ├── skyweb.saved_macro_views.sql
│   │   │   ├── skyweb.user_dashboard_items.sql
│   │   │   ├── skyweb.user_dashboards.sql
│   │   │   ├── skyweb.user_preferences.sql
│   │   │   ├── skyweb.user_profiles.sql
│   │   │   ├── worker.listener_events.sql
│   │   │   ├── worker.listeners_phase8_5.sql
│   │   │   ├── worker.listeners.sql
│   │   │   ├── worker.schedule_runs.sql
│   │   │   ├── worker.schedules_phase8_5.sql
│   │   │   ├── worker.schedules.sql
│   │   │   ├── worker.temporal_worker_heartbeats.sql
│   │   │   ├── worker.temporal_workflow_definitions.sql
│   │   │   ├── worker.temporal_workflow_parameters.sql
│   │   │   ├── worker.temporal_workflow_run_records.sql
│   │   │   ├── worker.worker_nodes.sql
│   │   │   ├── worker.workflow_approval_requests.sql
│   │   │   ├── worker.workflow_definitions.sql
│   │   │   ├── worker.workflow_edges.sql
│   │   │   ├── worker.workflow_node_run_records.sql
│   │   │   ├── worker.workflow_node_types.sql
│   │   │   ├── worker.workflow_nodes.sql
│   │   │   ├── worker.workflow_run_context_values.sql
│   │   │   ├── worker.workflow_run_node_outputs.sql
│   │   │   ├── worker.workflow_run_records.sql
│   │   │   └── worker.workflow_versions.sql
│   │   ├── triggers/
│   │   │   ├── auth.permissions_set_updated_at.sql
│   │   │   ├── auth.roles_set_updated_at.sql
│   │   │   ├── auth.user_applications_set_updated_at.sql
│   │   │   ├── auth.users_set_updated_at.sql
│   │   │   ├── core.applications_set_updated_at.sql
│   │   │   ├── core.repositories_set_updated_at.sql
│   │   │   ├── core.repository_paths_set_updated_at.sql
│   │   │   ├── core.tool_categories_set_updated_at.sql
│   │   │   ├── core.tool_parameters_set_updated_at.sql
│   │   │   ├── core.tools_set_updated_at.sql
│   │   │   ├── skyweb.alert_notifications_set_updated_at.sql
│   │   │   ├── skyweb.alert_rules_set_updated_at.sql
│   │   │   ├── skyweb.saved_macro_views_set_updated_at.sql
│   │   │   ├── skyweb.user_dashboard_items_set_updated_at.sql
│   │   │   ├── skyweb.user_dashboards_set_updated_at.sql
│   │   │   ├── skyweb.user_preferences_set_updated_at.sql
│   │   │   ├── skyweb.user_profiles_set_updated_at.sql
│   │   │   ├── worker.listener_events_set_updated_at.sql
│   │   │   ├── worker.listeners_set_updated_at.sql
│   │   │   ├── worker.schedule_runs_set_updated_at.sql
│   │   │   ├── worker.schedules_set_updated_at.sql
│   │   │   ├── worker.temporal_worker_heartbeats_set_updated_at.sql
│   │   │   ├── worker.temporal_workflow_definitions_set_updated_at.sql
│   │   │   ├── worker.temporal_workflow_parameters_set_updated_at.sql
│   │   │   ├── worker.temporal_workflow_run_records_set_updated_at.sql
│   │   │   ├── worker.worker_nodes_set_updated_at.sql
│   │   │   ├── worker.workflow_approval_requests_set_updated_at.sql
│   │   │   ├── worker.workflow_definitions_set_updated_at.sql
│   │   │   ├── worker.workflow_edges_set_updated_at.sql
│   │   │   ├── worker.workflow_node_run_records_set_updated_at.sql
│   │   │   ├── worker.workflow_node_types_set_updated_at.sql
│   │   │   ├── worker.workflow_nodes_set_updated_at.sql
│   │   │   ├── worker.workflow_run_context_values_set_updated_at.sql
│   │   │   ├── worker.workflow_run_node_outputs_set_updated_at.sql
│   │   │   ├── worker.workflow_run_records_set_updated_at.sql
│   │   │   └── worker.workflow_versions_set_updated_at.sql
│   │   └── views/
│   │       ├── auth.vw_active_sessions.sql
│   │       ├── auth.vw_audit_events_recent.sql
│   │       ├── auth.vw_login_events_recent.sql
│   │       ├── auth.vw_role_permissions.sql
│   │       ├── auth.vw_script_execution_recent.sql
│   │       ├── auth.vw_user_applications.sql
│   │       ├── auth.vw_user_permissions.sql
│   │       ├── auth.vw_user_roles.sql
│   │       ├── core.vw_admin_web_tools.sql
│   │       ├── core.vw_cli_categories.sql
│   │       ├── core.vw_cli_tools.sql
│   │       ├── core.vw_repository_paths.sql
│   │       ├── core.vw_tool_manifest.sql
│   │       ├── core.vw_tool_parameter_options.sql
│   │       ├── core.vw_tool_parameters.sql
│   │       ├── macro.vw_ca_growth.sql
│   │       ├── macro.vw_ca_housing.sql
│   │       ├── macro.vw_ca_inflation.sql
│   │       ├── macro.vw_ca_labor.sql
│   │       ├── macro.vw_ca_macro_regime.sql
│   │       ├── macro.vw_ca_rates_fx.sql
│   │       ├── macro.vw_ca_trade.sql
│   │       ├── macro.vw_credit_conditions.sql
│   │       ├── macro.vw_growth.sql
│   │       ├── macro.vw_housing.sql
│   │       ├── macro.vw_inflation.sql
│   │       ├── macro.vw_labor.sql
│   │       ├── macro.vw_liquidity.sql
│   │       ├── macro.vw_macro_regime.sql
│   │       ├── macro.vw_rates_curve.sql
│   │       ├── macro.vw_us_ca_inflation_compare.sql
│   │       ├── macro.vw_us_ca_labor_compare.sql
│   │       ├── macro.vw_us_ca_policy_fx.sql
│   │       ├── skyweb.vw_alert_notifications.sql
│   │       ├── skyweb.vw_alert_rule_events.sql
│   │       ├── skyweb.vw_alert_rules.sql
│   │       ├── skyweb.vw_saved_macro_views.sql
│   │       ├── skyweb.vw_user_dashboard_items.sql
│   │       ├── skyweb.vw_user_dashboards.sql
│   │       ├── skyweb.vw_user_preferences.sql
│   │       ├── skyweb.vw_user_profiles.sql
│   │       ├── worker.vw_listener_events_recent.sql
│   │       ├── worker.vw_listeners.sql
│   │       ├── worker.vw_schedule_runs_recent.sql
│   │       ├── worker.vw_schedules.sql
│   │       ├── worker.vw_temporal_worker_heartbeats.sql
│   │       ├── worker.vw_temporal_workflow_definitions.sql
│   │       ├── worker.vw_temporal_workflow_run_records.sql
│   │       ├── worker.vw_worker_nodes.sql
│   │       ├── worker.vw_workflow_approval_requests.sql
│   │       ├── worker.vw_workflow_definitions.sql
│   │       ├── worker.vw_workflow_nodes.sql
│   │       ├── worker.vw_workflow_run_context_values.sql
│   │       ├── worker.vw_workflow_run_node_outputs.sql
│   │       └── worker.vw_workflow_run_records.sql
│   ├── docker/
│   │   ├── apiDocker.js
│   │   ├── apiDockerSelfTest.js
│   │   ├── coreDockerCompatibilitySelfTest.js
│   │   ├── coreDockerDb.js
│   │   ├── coreDockerDbCheck.js
│   │   ├── developmentPromotionHostSyncCheck.js
│   │   ├── dockerIntegrationClosureSelfTest.js
│   │   ├── dockerIntegrationSelfTest.js
│   │   ├── nodeWorkerDocker.js
│   │   ├── nodeWorkerDockerSelfTest.js
│   │   ├── postgresCutoverCheck.js
│   │   ├── postgresDocker.js
│   │   ├── postgresDockerSelfTest.js
│   │   ├── postgresParity.js
│   │   ├── temporalDockerSelfTest.js
│   │   ├── temporalWorkerDocker.js
│   │   ├── temporalWorkerDockerSelfTest.js
│   │   ├── temporalWorkerGitCheck.js
│   │   ├── webDocker.js
│   │   └── webDockerSelfTest.js
│   ├── node/
│   │   └── util/
│   │       ├── bootstrap.js
│   │       └── logger.js
│   ├── powershell/
│   │   ├── Build-SkyOne-Bootloader.ps1
│   │   ├── Clean-BackendCache.ps1
│   │   ├── Clean-FrontendCache.ps1
│   │   ├── hostAgentTaskSelfTest.js
│   │   ├── SkyCommand-HostAgentTask.ps1
│   │   └── Start-SkyCommandHostAgent.ps1
│   └── python/
└── tests/
