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
│   │       │   ├── SkyCommandRuntimeControls.jsx
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
│   │       │   │   ├── DashboardVisuals.jsx
│   │       │   │   ├── DockerTelemetryVisuals.jsx
│   │       │   │   ├── DurationTrendChart.jsx
│   │       │   │   ├── EChartCanvas.jsx
│   │       │   │   ├── EChartCard.jsx
│   │       │   │   ├── EmptyChartState.jsx
│   │       │   │   ├── IdentityHorizontalBarChart.jsx
│   │       │   │   ├── IngestionStatusVisuals.jsx
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
│   │       │       ├── DashboardFilterCard.jsx
│   │       │       ├── DashboardRefreshActions.jsx
│   │       │       ├── DismissibleAlert.jsx
│   │       │       ├── PageHeader.jsx
│   │       │       ├── Panel.jsx
│   │       │       ├── ServerStatusPanel.jsx
│   │       │       ├── SidebarNav.jsx
│   │       │       ├── SkyCommandMark.jsx
│   │       │       ├── SmartPollingStatus.jsx
│   │       │       ├── StatCard.jsx
│   │       │       └── StatusPill.jsx
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
│   │       │   ├── AuditEvents.jsx
│   │       │   ├── AutomationDashboard.jsx
│   │       │   ├── AutomationListeners.jsx
│   │       │   ├── BrowserTests.jsx
│   │       │   ├── Dashboard.jsx
│   │       │   ├── DataStatus.jsx
│   │       │   ├── DockerInventory.jsx
│   │       │   ├── DockerOperations.jsx
│   │       │   ├── DockerOverview.jsx
│   │       │   ├── Home.jsx
│   │       │   ├── IngestionOperations.jsx
│   │       │   ├── IngestionStatus.jsx
│   │       │   ├── Login.jsx
│   │       │   ├── ManageRepositories.jsx
│   │       │   ├── ManageTools.jsx
│   │       │   ├── ProductionReadiness.jsx
│   │       │   ├── ReadinessDashboard.jsx
│   │       │   ├── repositoryAdminUtils.js
│   │       │   ├── SchedulerControl.jsx
│   │       │   ├── ScriptExecutions.jsx
│   │       │   ├── SkyWorkflows.jsx
│   │       │   ├── TemporalWorkflows.jsx
│   │       │   ├── Tools.jsx
│   │       │   ├── ToolsDashboard.jsx
│   │       │   ├── WorkerControl.jsx
│   │       │   ├── WorkflowApprovals.jsx
│   │       │   ├── WorkflowBuilder.jsx
│   │       │   ├── WorkflowManager.jsx
│   │       │   ├── WorkflowsDashboard.jsx
│   │       │   └── WorkflowWorkerHealth.jsx
│   │       ├── services/
│   │       │   ├── adminService.js
│   │       │   ├── api.js
│   │       │   ├── authService.js
│   │       │   ├── browserTestService.js
│   │       │   ├── infrastructureService.js
│   │       │   ├── ingestionService.js
│   │       │   ├── notificationService.js
│   │       │   ├── supervisorService.js
│   │       │   ├── temporalService.js
│   │       │   ├── toolService.js
│   │       │   ├── workerService.js
│   │       │   └── workflowService.js
│   │       └── utils/
│   │           ├── dockerLiveStatus.js
│   │           ├── tablePageSize.js
│   │           ├── tableSorting.js
│   │           └── workflowCategories.js
│   ├── api/
│   │   └── src/
│   │       ├── index.js
│   │       ├── server.js
│   │       ├── controllers/
│   │       │   ├── adminController.js
│   │       │   ├── authController.js
│   │       │   ├── browserTestController.js
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
│   │       │   ├── browserTest.routes.js
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
│   │       │   ├── apiTelemetryService.js
│   │       │   ├── authService.js
│   │       │   ├── browserTestRegistryService.js
│   │       │   ├── dockerEventStreamService.js
│   │       │   ├── dockerTelemetryStreamService.js
│   │       │   ├── infrastructureService.js
│   │       │   ├── ingestionStatusService.js
│   │       │   ├── legacyMacroFreshnessAdapter.js
│   │       │   ├── macroReadService.js
│   │       │   ├── notificationService.js
│   │       │   ├── productionReadinessService.js
│   │       │   ├── publicMacroService.js
│   │       │   ├── scriptExecutionService.js
│   │       │   ├── skycommandRepositoryService.js
│   │       │   ├── skywebAlertPreferencesService.js
│   │       │   ├── skywebAlertsService.js
│   │       │   ├── skywebDashboardsService.js
│   │       │   ├── skywebPreferencesService.js
│   │       │   ├── skywebProfileService.js
│   │       │   ├── skywebSavedViewsService.js
│   │       │   ├── supervisorLifecycleGrantService.js
│   │       │   ├── tableSortUtils.js
│   │       │   ├── temporalService.js
│   │       │   ├── toolAdminService.js
│   │       │   ├── toolExecutionHttpResponse.js
│   │       │   ├── toolManifestService.js
│   │       │   ├── toolOnboardingService.js
│   │       │   ├── toolVerificationService.js
│   │       │   ├── workerService.js
│   │       │   ├── workflowConditionService.js
│   │       │   ├── workflowExecutionPreflightService.js
│   │       │   ├── workflowExecutorService.js
│   │       │   ├── workflowHealthService.js
│   │       │   ├── workflowParameterUtils.js
│   │       │   └── workflowServiceError.js
│   │       └── utils/
│   │           └── liveTelemetryEnvelope.js
│   ├── browser-worker/
│   │   └── src/
│   │       ├── health.js
│   │       └── index.js
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
├── artifacts/
│   └── browser/
│       └── tests/
│           ├── 0209d86f-1443-41e3-ad84-62f1220fdf68/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   └── index.html
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── .playwright-artifacts-0/
│           │           └── traces/
│           │               └── resources/
│           │                   ├── 0450a145366a3d68187a15630a4347764baf054b.json
│           │                   ├── 0a0120f37c763f767599aaa4ba9f704af26419e9.json
│           │                   ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │                   ├── 219c137d994a4f9e93acf5e25a038ba4352d7a48.json
│           │                   ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │                   ├── 3faab62a7125623f01758521440ea664e20e227c.json
│           │                   ├── 42e86388f373be553c1a59742b5a326c9aa33705.json
│           │                   ├── 48211149ffab99312ec0dda057d2e96f15d8c8e7.json
│           │                   ├── 53565281339a9822492ab2fef5db8289e0cc782e.json
│           │                   ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │                   ├── 5bddb87f2573bca1db0bf96a497ef60a94362ac7.css
│           │                   ├── 6660a86b48de4a9ad9ca1d246d4732a69173a3b6.json
│           │                   ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │                   ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │                   ├── 87e97e66ca2d8c9c5f10a93c919d69f638cae4c1.json
│           │                   ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │                   ├── 994592fdac07beb7feb0ebd6b9efdb94104eae2a.json
│           │                   ├── 998ce898aa818763286a66fd5fd7b31b61cd557e.json
│           │                   ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │                   ├── b97d90e98041bd30da46c83659e4d80f36a42918.json
│           │                   ├── be19f552b4df89f64807c8cda746cdf069dab637.json
│           │                   ├── c5d1a2aa31758ad0450758d6916ce36f0a04ead6.json
│           │                   ├── ebb624ceceb45d4c47de178db9c8754c0c15bd9e.html
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931059.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931326.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931349.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931369.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931391.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931414.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931438.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931461.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931484.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931506.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931528.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931551.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931572.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931594.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931615.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931637.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931773.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931906.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919931975.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932089.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932148.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932161.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932223.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932234.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932267.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932325.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932431.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932449.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932545.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932553.jpeg
│           │                   ├── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932573.jpeg
│           │                   └── page@0f6e268021d8a2c7abef3dba7f585b48-1788919932668.jpeg
│           ├── report/
│           │   └── index.html
│           └── results/
│               ├── .last-run.json
│               └── .playwright-artifacts-0/
│                   └── traces/
│                       └── resources/
│                           ├── 0a0120f37c763f767599aaa4ba9f704af26419e9.json
│                           ├── 0c736da785c92444db63b25963fd8beb89798ce1.html
│                           ├── 0e6b9073b7cf569b00bd5b4a8bbeecc7d7adca34.json
│                           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│                           ├── 1ea0500bdd02c73bcd6b48d2d83ac42be5a674fc.json
│                           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│                           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│                           ├── 5bddb87f2573bca1db0bf96a497ef60a94362ac7.css
│                           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│                           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│                           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│                           ├── aa6ac398ab464b28f60b355b3090f991863148b0.json
│                           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│                           ├── c5d1a2aa31758ad0450758d6916ce36f0a04ead6.json
│                           ├── d940365aa516ea450b1d82ec02414326904f6817.json
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913438923.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439179.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439207.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439230.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439254.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439276.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439300.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439323.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439345.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439368.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439392.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439413.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439433.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439455.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439477.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439614.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439637.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439666.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439820.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439873.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439949.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439956.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913439993.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440054.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440087.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440112.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440145.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440163.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440239.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440332.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440431.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440440.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440460.jpeg
│                           ├── page@f3bcc555655fd05107b53fd0329928ef-1788913440556.jpeg
│                           └── page@f3bcc555655fd05107b53fd0329928ef-1788913440571.jpeg
├── docker/
│   ├── api.Dockerfile
│   ├── api.package.json
│   ├── browser-worker.Dockerfile
│   ├── browser-worker.Dockerfile.dockerignore
│   ├── browser-worker.package.json
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
│   ├── SkyCommand_Browser_Worker.md
│   ├── SkyCommand_Data_Domain_Onboarding_and_Operations_Guide.md
│   ├── SkyCommand_Docker_Infrastructure_Control_Plane.md
│   ├── SkyCommand_Host_Agent_Local_Setup.md
│   ├── SkyCommand_Phase_14_Structured_Tool_Results.md
│   ├── SkyCommand_Phase_15_Tool_Catalogue_Administration.md
│   ├── SkyCommand_Phase_16_Closure_Report.md
│   ├── SkyCommand_PostgreSQL_Docker_Migration.md
│   ├── SkyCommand_RepoMap.md
│   ├── SkyCommand_Supervisor.md
│   ├── SkyCommand_Temporal_Local_Setup.md
│   ├── SkyCommand_Temporal_Workflow_Architecture_Plan.md
│   ├── SkyCommand_Tool_Authoring_Guide.md
│   ├── assets/
│   │   ├── auth_schema_ERD.png
│   │   ├── core_schema_ERD.png
│   │   ├── skyweb_schema_ERD.png
│   │   └── worker_schema_ERD.png
│   ├── audits/
│   └── images/
│       └── readme/
│           ├── Approval_Prompt.png
│           ├── Dashboard.png
│           ├── Docker_Containers.png
│           ├── Login_Page.png
│           ├── Run_Tools.png
│           ├── Start_Workflow.png
│           └── Workflow_Running.png
├── packages/
│   ├── auth/
│   │   └── src/
│   │       ├── createAdminUser.js
│   │       └── password.js
│   ├── browser/
│   │   └── src/
│   │       ├── browserTestRunner.js
│   │       ├── config.js
│   │       └── temporal/
│   │           ├── activities.js
│   │           └── workflows.js
│   ├── core/
│   │   └── src/
│   │       ├── runtimePathResolver.js
│   │       ├── SkyCommand_Core.js
│   │       ├── skyCommandIdentityVerification.js
│   │       └── workflowCliRuntimeParameters.js
│   ├── db/
│   │   └── src/
│   │       ├── connection.js
│   │       └── db_health.js
│   ├── db_build/
│   │   └── src/
│   │       ├── databaseBuildResult.js
│   │       ├── db_build.js
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
│   │       │   ├── 00106__user_notification_foundation.sql
│   │       │   ├── 00107__workflow_category_foundation.sql
│   │       │   ├── 00109__workflow_run_category_projection.sql
│   │       │   ├── 00110__workflow_approval_category_projection.sql
│   │       │   ├── 00111__local_dev_pull_tool.sql
│   │       │   ├── 00112__tool_parameter_cli_binding.sql
│   │       │   ├── 00113__browser_test_registry_foundation.sql
│   │       │   └── 00115__browser_test_observability.sql
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
│   │           ├── 00093__workflow_ingestion_recovery_parameters.sql
│   │           ├── 00108__workflow_category_seed.sql
│   │           └── 00114__browser_test_registry_seed.sql
│   ├── db_compare/
│   │   └── src/
│   │       └── db_object_compare.js
│   ├── files/
│   │   └── src/
│   │       ├── generateRepoMap.js
│   │       ├── generateRepoZip.js
│   │       ├── repositoryArtifactConfiguration.js
│   │       ├── repositoryMapResult.js
│   │       └── repositoryPackageResult.js
│   ├── git/
│   │   └── src/
│   │       ├── dev_commit.js
│   │       ├── git_repo_status.js
│   │       ├── gitBranchSyncResult.js
│   │       ├── gitCommitResult.js
│   │       ├── gitDevPullResult.js
│   │       ├── gitLocalSyncResult.js
│   │       ├── gitPerformanceTelemetry.js
│   │       ├── gitRepositoryStatusInspector.js
│   │       ├── gitRepositoryStatusResult.js
│   │       ├── local_dev_pull.js
│   │       ├── local_repo_sync.js
│   │       ├── localRepoSyncLineage.js
│   │       └── main_merge.js
│   ├── host-agent/
│   │   └── src/
│   │       ├── activities.js
│   │       ├── config.js
│   │       ├── dockerContainer.js
│   │       ├── dockerControl.js
│   │       ├── dockerEventBridge.js
│   │       ├── dockerResource.js
│   │       ├── dockerSnapshot.js
│   │       ├── dockerTelemetryBridge.js
│   │       ├── health.js
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
│   │       │   ├── dataCatalogueService.js
│   │       │   ├── ingestionCatalogueService.js
│   │       │   ├── phase16AssetMetricCatalogue.js
│   │       │   ├── phase16CatalogueAdministration.js
│   │       │   ├── phase16IngestionIdentity.js
│   │       │   ├── phase16IngestionProfileGuardrails.js
│   │       │   ├── phase16PortabilityProof.js
│   │       │   └── phase16SecondDomainProof.js
│   │       ├── closure/
│   │       │   ├── phase16ClosureStabilization.js
│   │       │   └── phase16PortabilityClosure.js
│   │       ├── config/
│   │       │   ├── manualIngestion.json
│   │       │   ├── statcanIndicators.js
│   │       │   └── statcanVectors.js
│   │       ├── consumer/
│   │       │   ├── dataConsumerService.js
│   │       │   └── phase16ConsumerContracts.js
│   │       ├── core/
│   │       │   ├── cliOptions.js
│   │       │   ├── httpSourceClient.js
│   │       │   ├── macroIngestionCli.js
│   │       │   ├── macroIngestionPerformance.js
│   │       │   ├── macroIngestionResult.js
│   │       │   ├── phase16AdapterOnboardingClosure.js
│   │       │   ├── phase16AdapterRetryFramework.js
│   │       │   ├── phase16ControlledRetryProof.js
│   │       │   ├── retryExecutor.js
│   │       │   ├── runPipeline.js
│   │       │   ├── sourceAdapter.js
│   │       │   ├── sourceAdapterRegistry.js
│   │       │   └── sourceRequestPolicy.js
│   │       ├── discovery/
│   │       │   ├── discoverStatCanMetadata.js
│   │       │   └── resolveStatCanVectors.js
│   │       ├── fred/
│   │       │   └── fredBatchRunner.js
│   │       ├── freshness/
│   │       │   ├── freshnessAdminService.js
│   │       │   ├── freshnessService.js
│   │       │   ├── phase16ExplainableFreshness.js
│   │       │   ├── phase16FreshnessIntegration.js
│   │       │   └── phase16FreshnessPortabilityProof.js
│   │       ├── ledger/
│   │       │   ├── ingestionLedgerIntegration.js
│   │       │   ├── ingestionLedgerService.js
│   │       │   ├── ingestionRunResult.js
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
│   │       │   └── qualityPolicyAdminService.js
│   │       ├── recovery/
│   │       │   ├── ingestionRecoveryService.js
│   │       │   ├── phase16LiveRecoveryClosure.js
│   │       │   ├── phase16ProductionRecoveryIntegration.js
│   │       │   ├── phase16ProductionRecoveryProof.js
│   │       │   ├── phase16RecoveryFoundation.js
│   │       │   ├── phase16RecoveryProof.js
│   │       │   ├── phase16WorkflowRecoveryClosure.js
│   │       │   └── productionRecovery.js
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
│   ├── supervisor/
│   │   └── src/
│   │       ├── config.js
│   │       ├── health.js
│   │       ├── lifecycleGrant.js
│   │       ├── runtimeLifecycle.js
│   │       └── server.js
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
│       │   ├── git_dev_pull_summary.v1.schema.json
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
│           ├── gitDevPullPromotionRollup.js
│           ├── index.js
│           ├── jsonSchemaValidator.js
│           ├── toolArgumentBinding.js
│           ├── toolCliAdapter.js
│           ├── toolProcessExecutor.js
│           ├── toolResultContract.js
│           ├── toolResultTransport.js
│           └── workflowResultContext.js
├── scripts/
│   ├── validate.js
│   ├── browser/
│   │   ├── browserRegistrySmoke.js
│   │   └── browserWorkerSmoke.js
│   ├── db/
│   │   ├── workflowCategoryFoundation.js
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
│   │   │   ├── worker.workflow_categories.sql
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
│   │   │   ├── worker.workflow_categories_set_updated_at.sql
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
│   │   ├── browserWorkerDocker.js
│   │   ├── coreDockerDb.js
│   │   ├── coreDockerDbCheck.js
│   │   ├── developmentPromotionHostSyncCheck.js
│   │   ├── nodeWorkerDocker.js
│   │   ├── postgresCutoverCheck.js
│   │   ├── postgresDocker.js
│   │   ├── postgresParity.js
│   │   ├── temporalWorkerDocker.js
│   │   ├── temporalWorkerGitCheck.js
│   │   └── webDocker.js
│   ├── node/
│   │   └── util/
│   │       ├── bootstrap.js
│   │       └── logger.js
│   ├── powershell/
│   │   ├── Build-SkyOne-Bootloader.ps1
│   │   ├── Clean-BackendCache.ps1
│   │   ├── Clean-FrontendCache.ps1
│   │   ├── SkyCommand-HostAgentTask.ps1
│   │   ├── SkyCommand-SupervisorTask.ps1
│   │   ├── Start-SkyCommandHostAgent.ps1
│   │   ├── Start-SkyCommandHostAgentHidden.vbs
│   │   ├── Start-SkyCommandSupervisor.ps1
│   │   └── Start-SkyCommandSupervisorHidden.vbs
│   └── python/
└── tests/
    ├── README.md
    ├── _support/
    │   └── sourceTestBootstrap.js
    ├── browser/
    │   ├── playwright.config.js
    │   ├── README.md
    │   ├── data/
    │   │   └── .gitkeep
    │   ├── fixtures/
    │   │   └── .gitkeep
    │   ├── helpers/
    │   │   ├── browserTestParameters.js
    │   │   ├── skyCommandAuth.js
    │   │   └── skyCommandLinks.js
    │   ├── pages/
    │   │   └── .gitkeep
    │   ├── reporters/
    │   │   └── skyCommandReporter.js
    │   └── specs/
    │       ├── access/
    │       │   └── .gitkeep
    │       ├── automation/
    │       │   └── .gitkeep
    │       ├── docker/
    │       │   └── .gitkeep
    │       ├── smoke/
    │       │   └── .gitkeep
    │       ├── tools/
    │       │   └── .gitkeep
    │       └── workflows/
    │           └── workflowInitialization.spec.js
    └── self/
        ├── apps/
        │   ├── admin-web/
        │   │   └── src/
        │   │       ├── components/
        │   │       │   ├── charts/
        │   │       │   │   ├── chartTypographySelfTest.js
        │   │       │   │   └── liveChartUpdateSelfTest.js
        │   │       │   └── ui/
        │   │       │       ├── brandThemeSelfTest.js
        │   │       │       ├── commandSearchSelfTest.js
        │   │       │       ├── dashboardUiConsistencySelfTest.js
        │   │       │       ├── sidebarAccordionSelfTest.js
        │   │       │       ├── surfaceRhythmSelfTest.js
        │   │       │       └── transientAlertSelfTest.js
        │   │       ├── pages/
        │   │       │   ├── adminPrivilegesSurfaceSelfTest.js
        │   │       │   ├── adminRolesSurfaceSelfTest.js
        │   │       │   ├── adminSessionsSurfaceSelfTest.js
        │   │       │   ├── adminUserHistorySurfaceSelfTest.js
        │   │       │   ├── adminUsersSurfaceSelfTest.js
        │   │       │   ├── apiDashboardSelfTest.js
        │   │       │   ├── approvalHistorySelfTest.js
        │   │       │   ├── browserTestUiSelfTest.js
        │   │       │   ├── dockerInfrastructureSurfaceSelfTest.js
        │   │       │   ├── ingestionOperationsSurfaceSelfTest.js
        │   │       │   ├── loginRuntimeBootstrapSelfTest.js
        │   │       │   ├── manageToolsVerificationNavigationSelfTest.js
        │   │       │   ├── operationsTableBatchRefinementSelfTest.js
        │   │       │   ├── repositoryPageSplitSelfTest.js
        │   │       │   ├── runToolsCatalogueSelfTest.js
        │   │       │   ├── schedulerPageSplitSelfTest.js
        │   │       │   ├── supervisorRuntimeControlSelfTest.js
        │   │       │   ├── toolHistoryCatalogueSelfTest.js
        │   │       │   ├── toolOperationsSortingSelfTest.js
        │   │       │   ├── toolOperationsTableRefinementSelfTest.js
        │   │       │   ├── workflowCategoryUiSelfTest.js
        │   │       │   ├── workflowDatabaseOutputSelfTest.js
        │   │       │   ├── workflowEditorGraphParitySelfTest.js
        │   │       │   ├── workflowOperationsTableRefinementSelfTest.js
        │   │       │   └── workflowStartCatalogueSelfTest.js
        │   │       └── services/
        │   │           └── authExpiryRefreshSelfTest.js
        │   └── api/
        │       └── src/
        │           └── services/
        │               ├── apiTelemetryPolicySelfTest.js
        │               ├── browserTestObservabilitySelfTest.js
        │               ├── browserTestRegistrySelfTest.js
        │               ├── dockerEventStreamServiceSelfTest.js
        │               ├── dockerTelemetryStreamServiceSelfTest.js
        │               ├── infrastructureServiceSelfTest.js
        │               ├── legacyMacroFreshnessAdapterSelfTest.js
        │               ├── notificationFoundationSelfTest.js
        │               ├── phase15ClosureReadinessSelfTest.js
        │               ├── schedulerWorkflowParametersSelfTest.js
        │               ├── skycommandRepositorySelfTest.js
        │               ├── structuredToolContractAssociationSelfTest.js
        │               ├── supervisorLifecycleGrantServiceSelfTest.js
        │               ├── tableSortUtilsSelfTest.js
        │               ├── toolExecutionHttpResponseSelfTest.js
        │               ├── toolExecutionOutputWorkspaceSelfTest.js
        │               ├── toolOnboardingSelfTest.js
        │               ├── toolVerificationSelfTest.js
        │               ├── workflowApprovalBranchSelfTest.js
        │               ├── workflowCategoryFoundationSelfTest.js
        │               ├── workflowCloneParitySelfTest.js
        │               ├── workflowConditionSelfTest.js
        │               ├── workflowExecutionPreflightSelfTest.js
        │               ├── workflowNodeRecoverySelfTest.js
        │               ├── workflowParameterUtilsSelfTest.js
        │               ├── workflowToolConfirmationPolicySelfTest.js
        │               └── workflowToolVisibilitySelfTest.js
        ├── packages/
        │   ├── browser/
        │   │   └── src/
        │   │       └── browserTestRunnerSelfTest.js
        │   ├── core/
        │   │   └── src/
        │   │       ├── runtimePathResolverSelfTest.js
        │   │       ├── skyCommandIdentitySelfTest.js
        │   │       └── workflowCliRuntimeParametersSelfTest.js
        │   ├── db/
        │   │   └── src/
        │   │       └── dbHealthResultSelfTest.js
        │   ├── db_build/
        │   │   └── src/
        │   │       └── dbBuildResultSelfTest.js
        │   ├── files/
        │   │   └── src/
        │   │       ├── repositoryArtifactConfigurationSelfTest.js
        │   │       ├── repositoryMapResultSelfTest.js
        │   │       └── repositoryPackageResultSelfTest.js
        │   ├── git/
        │   │   └── src/
        │   │       ├── gitBranchSyncResultSelfTest.js
        │   │       ├── gitCommitResultSelfTest.js
        │   │       ├── gitDevPullResultSelfTest.js
        │   │       ├── gitLocalSyncResultSelfTest.js
        │   │       ├── gitRepositoryStatusSelfTest.js
        │   │       └── localRepoSyncLineageSelfTest.js
        │   ├── host-agent/
        │   │   └── src/
        │   │       ├── dockerContainerSelfTest.js
        │   │       ├── dockerControlSelfTest.js
        │   │       ├── dockerEventBridgeSelfTest.js
        │   │       ├── dockerResourceSelfTest.js
        │   │       ├── dockerSnapshotSelfTest.js
        │   │       ├── dockerTelemetryBridgeSelfTest.js
        │   │       └── hostAgentSelfTest.js
        │   ├── ingestion/
        │   │   └── src/
        │   │       ├── catalogue/
        │   │       │   ├── dataCatalogueAdminServiceSelfTest.js
        │   │       │   ├── dataCatalogueServiceSelfTest.js
        │   │       │   ├── phase16IngestionIdentitySelfTest.js
        │   │       │   ├── phase16IngestionProfileGuardrailsSelfTest.js
        │   │       │   └── phase16PortabilityProofSelfTest.js
        │   │       ├── closure/
        │   │       │   ├── phase16ClosureStabilizationSelfTest.js
        │   │       │   └── phase16PortabilityClosureSelfTest.js
        │   │       ├── consumer/
        │   │       │   └── dataConsumerServiceSelfTest.js
        │   │       ├── core/
        │   │       │   ├── macroIngestionCliSelfTest.js
        │   │       │   ├── macroIngestionResultSelfTest.js
        │   │       │   ├── sourceAdapterRegistrySelfTest.js
        │   │       │   └── sourceAdapterRetrySelfTest.js
        │   │       ├── freshness/
        │   │       │   └── freshnessServiceSelfTest.js
        │   │       ├── ledger/
        │   │       │   └── ingestionRunResultSelfTest.js
        │   │       ├── quality/
        │   │       │   ├── qualityPolicyAdminSelfTest.js
        │   │       │   ├── qualityPolicySelfTest.js
        │   │       │   └── revisionQualitySelfTest.js
        │   │       └── recovery/
        │   │           ├── ingestionRecoverySelfTest.js
        │   │           ├── phase16LiveRecoverySelfTest.js
        │   │           └── productionRecoverySelfTest.js
        │   ├── supervisor/
        │   │   └── src/
        │   │       ├── lifecycleGrantSelfTest.js
        │   │       └── supervisorSelfTest.js
        │   └── tools/
        │       └── src/
        │           ├── gitDevPullPromotionRollupSelfTest.js
        │           ├── toolArgumentBindingSelfTest.js
        │           ├── toolResultSelfTest.js
        │           └── workflowResultContextSelfTest.js
        └── scripts/
            ├── docker/
            │   ├── apiDockerSelfTest.js
            │   ├── browserWorkerDockerSelfTest.js
            │   ├── coreDockerCompatibilitySelfTest.js
            │   ├── dockerIntegrationClosureSelfTest.js
            │   ├── dockerIntegrationSelfTest.js
            │   ├── nodeWorkerDockerSelfTest.js
            │   ├── postgresDockerSelfTest.js
            │   ├── temporalDockerSelfTest.js
            │   ├── temporalWorkerDockerSelfTest.js
            │   └── webDockerSelfTest.js
            └── powershell/
                ├── hostAgentTaskSelfTest.js
                └── supervisorTaskSelfTest.js
