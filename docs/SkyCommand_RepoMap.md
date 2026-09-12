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
│   │       │   ├── BrowserAutomations.jsx
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
│   │       │   ├── browserAutomationService.js
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
│   │       │   ├── browserAutomationController.js
│   │       │   ├── browserTestController.js
│   │       │   ├── browserTestSuiteController.js
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
│   │       │   ├── browserAutomation.routes.js
│   │       │   ├── browserTest.routes.js
│   │       │   ├── browserTestSuite.routes.js
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
│   │       │   ├── browserAutomationExecutionService.js
│   │       │   ├── browserAutomationRegistryService.js
│   │       │   ├── browserTestFailureUtils.js
│   │       │   ├── browserTestRegistryService.js
│   │       │   ├── browserTestSuiteService.js
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
│   │       │   ├── workflowPlaywrightNodeService.js
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
│           │   ├── scheduledPlaywrightRunner.js
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
│       ├── automations/
│       │   ├── .gitkeep
│       │   ├── 74cf78ef-b0dc-44a9-b653-2ecf925160ef/
│       │   │   ├── skycommand-automation-summary.json
│       │   │   ├── downloads/
│       │   │   └── screenshots/
│       │   │       └── Command Center Status Snapshot.png
│       │   ├── 82bf1bfa-2c17-455b-80f7-1c3901d94fea/
│       │   │   ├── skycommand-automation-summary.json
│       │   │   ├── downloads/
│       │   │   └── screenshots/
│       │   │       └── Command Center Status Snapshot.png
│       │   ├── 93fe49ba-a722-4cc8-970d-5365c0538b77/
│       │   │   ├── skycommand-automation-summary.json
│       │   │   ├── downloads/
│       │   │   └── screenshots/
│       │   │       └── Command Center Status Snapshot.png
│       │   └── bd570f67-6409-41db-ba22-20dc6a92b4ef/
│       │       ├── skycommand-automation-summary.json
│       │       ├── downloads/
│       │       └── screenshots/
│       │           └── Command Center Status Snapshot.png
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
│           ├── 0c6fdc18-b195-4d1b-a056-9995ca9e38d4/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 549189c241a1c949cb6d60bc5095c618c79f4d40.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       ├── .playwright-artifacts-0/
│           │       │   └── traces/
│           │       │       └── resources/
│           │       │           ├── 012354827249a40407adc79057a96d54d49ad4cd.json
│           │       │           ├── 0a0120f37c763f767599aaa4ba9f704af26419e9.json
│           │       │           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │       │           ├── 227b6140c0c4ae0f0169d77cf35d2b4d724bfa69.json
│           │       │           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │       │           ├── 3f26c6788a326acc715e1639e5eb65beae3a9493.html
│           │       │           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │       │           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │       │           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │       │           ├── 7d63a1479fae3037dc2cb81b393de084a2ee4555.json
│           │       │           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │       │           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │       │           ├── bef17107005235fa9e7b2daf1b447d8d5c260905.css
│           │       │           ├── c5d1a2aa31758ad0450758d6916ce36f0a04ead6.json
│           │       │           ├── da07808075d611e8dda3316730c623299fc26555.json
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702178.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702196.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702469.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702495.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702519.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702546.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702572.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702596.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702621.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702646.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702671.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702695.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702718.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702743.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702773.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702891.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702939.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098702995.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703189.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703212.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703229.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703246.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703266.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703284.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703303.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703313.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703348.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703350.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703356.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703407.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703467.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703480.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703493.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703512.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703534.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703564.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703583.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703601.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703633.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703664.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703680.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703694.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703710.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703743.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703759.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703783.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703804.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703908.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098703923.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098704053.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098704064.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098704326.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098704346.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098704368.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098704397.jpeg
│           │       │           ├── page@19d730e38a5e0287825c00d86e8e8527-1789098704749.jpeg
│           │       │           └── page@19d730e38a5e0287825c00d86e8e8527-1789098704761.jpeg
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-089353839c5f67392434e6a06ac52b3745bdf7ed.png
│           ├── 100d058c-41d2-465a-84eb-f16094a6dfd1/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 4786648aea7219698017232984fd308bdab241e9.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-751fe6cdee337436fbb3ced7e1b41db95b75607e.png
│           ├── 135a76f1-7c7b-4e3a-bd7b-025278897391/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── b8f9ec26f23e8dd1b7c6405f89d36827738e2983.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-3c735df3211262ac2076879d72bfb4fb62f86793.png
│           ├── 18d32013-6755-499c-a729-f20f31650200/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 549189c241a1c949cb6d60bc5095c618c79f4d40.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       ├── .playwright-artifacts-0/
│           │       │   └── traces/
│           │       │       └── resources/
│           │       │           ├── 0a0120f37c763f767599aaa4ba9f704af26419e9.json
│           │       │           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │       │           ├── 13b84d5b1933e3e4c2ba71b1fb3957379eb5df1a.json
│           │       │           ├── 1bc1706c5b68d398052b9b35960b086bd57ecbe5.json
│           │       │           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │       │           ├── 3f26c6788a326acc715e1639e5eb65beae3a9493.html
│           │       │           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │       │           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │       │           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │       │           ├── 815f6d0f6016f6508cabfdbc9851306f98582ec6.json
│           │       │           ├── 926d0e80eb34c5f6709f8f434a9b4d224445c274.json
│           │       │           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │       │           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │       │           ├── bef17107005235fa9e7b2daf1b447d8d5c260905.css
│           │       │           ├── c5d1a2aa31758ad0450758d6916ce36f0a04ead6.json
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876259.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876287.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876572.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876601.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876629.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876656.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876683.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876713.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876741.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876766.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876792.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876818.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876843.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876869.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876897.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100876928.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877050.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877100.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877358.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877382.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877396.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877413.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877427.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877450.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877469.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877490.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877515.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877594.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877642.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877657.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877677.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877698.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877715.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877736.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877764.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877782.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877801.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877816.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877843.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877865.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877880.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877898.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877916.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877931.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877946.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877970.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100877989.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878085.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878104.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878242.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878266.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878291.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878523.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878544.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878563.jpeg
│           │       │           ├── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878579.jpeg
│           │       │           └── page@c4f4aef798470e1fdf6e42c52fe8d074-1789100878934.jpeg
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-048857c0746c44c57b49ac565e2ffbf9c0c2906d.png
│           ├── 1aaaaa8b-9896-476c-8834-fdf926f1a506/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 549189c241a1c949cb6d60bc5095c618c79f4d40.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       ├── .playwright-artifacts-0/
│           │       │   └── traces/
│           │       │       └── resources/
│           │       │           ├── 0b1a54da5387a073455a40ef1058dbb9f8c77392.json
│           │       │           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │       │           ├── 1e2a41df9cf3afd2d29516c59f5108961204a13d.json
│           │       │           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │       │           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │       │           ├── 663d24d668638831692437874c7496503c1e91d6.json
│           │       │           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │       │           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │       │           ├── 8f6e6118d837cb8a5b81f9847e4d5c2bbbb4446f.json
│           │       │           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │       │           ├── 98a453cd0379ba83c17769c5ab8c201f3e32f1a7.json
│           │       │           ├── 994592fdac07beb7feb0ebd6b9efdb94104eae2a.json
│           │       │           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │       │           ├── bef17107005235fa9e7b2daf1b447d8d5c260905.css
│           │       │           ├── d6ca1c4326d8a2d9a5d506f81642f3addd058990.json
│           │       │           ├── f8d059cf7d7ce2bf333b76d9ae32f6be165472d6.html
│           │       │           ├── fcd904963b07f614cfa365fbfe99dfd4f7a57275.json
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170305769.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170305787.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306078.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306106.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306129.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306155.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306183.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306209.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306235.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306262.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306289.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306320.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306347.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306373.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306399.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306435.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306464.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306582.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306660.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306882.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306924.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306953.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306965.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306977.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306987.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170306996.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307012.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307031.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307061.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307126.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307135.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307168.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307216.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307227.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307246.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307271.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307286.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307304.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307352.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307354.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307373.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307398.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307426.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307461.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307593.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307640.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307674.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307834.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307852.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307981.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170307992.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170308003.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170308262.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170308284.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170308304.jpeg
│           │       │           ├── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170308336.jpeg
│           │       │           └── page@364a0d1fcfdb0a8a0ce6866ae75e9da9-1789170308695.jpeg
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-c10963fc74a9c821db6aeef6224ab6db4202ee2c.png
│           ├── 34cec146-1137-406b-91ff-3ccfbc11f32f/
│           ├── 3528dac6-2bbb-4559-a4dd-427caf5f52a0/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── b8f9ec26f23e8dd1b7c6405f89d36827738e2983.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-78aa7d897dd0a29dde5e244fdfde29f762a31f3d.png
│           ├── 4e18137b-4f44-40f9-a03e-b8cbf6522629/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── b8f9ec26f23e8dd1b7c6405f89d36827738e2983.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-3e39adc64589265f3d175e72020e6dd7f2244554.png
│           ├── 5055ea48-b75f-4132-ba34-7edeb5caa495/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── a69a81942baec2c21536263666dfaafe1ae55196.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       ├── .playwright-artifacts-0/
│           │       │   ├── 01240cd545ea9432c881da68584e88be.png
│           │       │   ├── page@f7bf2a7c197929d9545b4a4f3f30c799.webm
│           │       │   └── traces/
│           │       │       ├── f441b5d0cf7dc9aa1ed2-c78279029eaa25b3bc6d.network
│           │       │       ├── f441b5d0cf7dc9aa1ed2-c78279029eaa25b3bc6d.trace
│           │       │       └── resources/
│           │       │           ├── 0a0120f37c763f767599aaa4ba9f704af26419e9.json
│           │       │           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │       │           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │       │           ├── 43f60fd5bb565ef13ebe57331892d1b7f505bcbb.json
│           │       │           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │       │           ├── 5bddb87f2573bca1db0bf96a497ef60a94362ac7.css
│           │       │           ├── 5f800a2fc698a758ec916f5b7debc669527f0815.json
│           │       │           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │       │           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │       │           ├── 7e6810a04e9fa50fc27d19f11b52bccd3f6ec478.json
│           │       │           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │       │           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │       │           ├── af209361b1352da1e755cf87431854967f2aadfd.json
│           │       │           ├── c5d1a2aa31758ad0450758d6916ce36f0a04ead6.json
│           │       │           ├── fca357518c8a1a16ce8a6a007abc6e9d49d825ea.html
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929487.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929748.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929770.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929793.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929814.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929837.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929858.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929878.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929899.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929920.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929941.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929962.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933929982.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930003.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930024.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930153.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930177.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930206.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930363.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930418.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930490.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930500.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930597.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930635.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930657.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930675.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930707.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930792.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930811.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933930905.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931014.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931022.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931037.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931062.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931143.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931155.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931169.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931216.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931337.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931354.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931372.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931388.jpeg
│           │       │           ├── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931402.jpeg
│           │       │           └── page@f7bf2a7c197929d9545b4a4f3f30c799-1788933931713.jpeg
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-082a1acee49f5849345e70762c76921415c76544.png
│           ├── 5469621a-0dda-4e95-a095-459b098859d7/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── f9596517c28b9fd8a4b84e25198a16c758bc166e.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-725fbb6db1f646967daaa04e0faf1c83c4b2e668.png
│           ├── 568813fb-2b3b-40b1-a35d-9e458f877648/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 80fa5996ee92f0bbff099d1a31788a49a91aab39.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-bbab7e510b24ac812bdff58dc97900e9f0c03655.png
│           ├── 5a9c8dc2-b6b4-41ea-a6f3-ed35391b4f46/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 53580953c64053235a9cc1ea46a58839e0bb3674.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-984384e6bed878248b60b446b985ac9bb1697c36.png
│           ├── 5f03dc0d-b745-4fbd-b56f-d67abd5ec696/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 8191255bb2931353ece9b415eecc88d87d7477d7.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-62ed12d3e049bb69fcc8b6ea94c3394cb4d5b841.png
│           ├── 6b284b19-5e60-42a9-b7a7-48ad2e7aec23/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 322240b74d6ce372f2b969f91c77808257b6ae84.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-cddb507d49d4506464bc7b452df79502ad625003.png
│           ├── 7238eaf2-5f82-42f6-9fae-d984ec3b232d/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── f185e9c3c3c3658d592b4fc0537ccd0a5f60f804.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       ├── .playwright-artifacts-0/
│           │       │   └── traces/
│           │       │       └── resources/
│           │       │           ├── 0a0120f37c763f767599aaa4ba9f704af26419e9.json
│           │       │           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │       │           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │       │           ├── 548ff6c810d0829141f480c6e33744bbe3f3f2de.json
│           │       │           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │       │           ├── 5bddb87f2573bca1db0bf96a497ef60a94362ac7.css
│           │       │           ├── 64783425779a6bcac4645ffe4e389923054b76cd.json
│           │       │           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │       │           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │       │           ├── 885fcc02f443a2f04a3cabbdc3019dc534479196.json
│           │       │           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │       │           ├── 987ddf442a7a186c7e7db35ccc41778e739682cd.json
│           │       │           ├── 994592fdac07beb7feb0ebd6b9efdb94104eae2a.json
│           │       │           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │       │           ├── c5d1a2aa31758ad0450758d6916ce36f0a04ead6.json
│           │       │           ├── c8c980c90b562095f1583425bdddaefd2f5400b4.json
│           │       │           ├── ea7a3e45ad91ae18925c4e0559fde53253e437f8.html
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121178.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121188.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121465.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121496.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121521.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121550.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121577.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121602.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121632.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121658.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121683.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121708.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121733.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121758.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121785.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121816.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938121964.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122032.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122247.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122267.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122285.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122299.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122310.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122327.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122337.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122465.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122474.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122513.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122572.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122586.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122598.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122611.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122634.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122651.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122679.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122700.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122731.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122732.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122748.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122765.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122793.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122809.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122838.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122853.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122875.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122894.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938122994.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938123014.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938123138.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938123149.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938123191.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938123415.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938123440.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938123458.jpeg
│           │       │           ├── page@85cc97e17884009e497474d1bf81a0b3-1788938123480.jpeg
│           │       │           └── page@85cc97e17884009e497474d1bf81a0b3-1788938123844.jpeg
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-6fca5181e32ba76f1c9b79bdc964126b349a4bdd.png
│           ├── 7403013f-fe9f-45ca-aab1-3ae9f29bea9c/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── bec854065659e067f36981b62cbdf959a27911e8.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-d6000b56b3bc97f6bd46990671e037bee8ae43dd.png
│           ├── 76ae86c7-9a00-4544-b001-4f9dd0f1e152/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 030659bfa5c953578cddb187ab80a2d5a1a82e1a.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-609cececa064efdbdb225003e2cad01209836611.png
│           ├── 8c6ffa7e-5d68-42eb-b843-315e1cc46670/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── b7fcf045fd6fa6eb58023d9138acf400ffc795d1.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-ffdaa1fdf5ee14e3d06f05937af56d3e26cd3bc6.png
│           ├── 999971c9-33d8-4478-93bc-8788f4de2646/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── d3281570eb068dd291b33cb19d3c014a195cb5cc.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-c14db8559e5a592ada042738ab5b1496224bd218.png
│           ├── a62930cf-db7a-49d7-9a0f-db2389c1780d/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── a69a81942baec2c21536263666dfaafe1ae55196.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       ├── .playwright-artifacts-0/
│           │       │   ├── 3743e0411821335921fabd8cfb9478c1.png
│           │       │   ├── page@05a75fba15bcf6847d382799fe779b4d.webm
│           │       │   └── traces/
│           │       │       ├── f441b5d0cf7dc9aa1ed2-c78279029eaa25b3bc6d.network
│           │       │       ├── f441b5d0cf7dc9aa1ed2-c78279029eaa25b3bc6d.trace
│           │       │       └── resources/
│           │       │           ├── 0a0120f37c763f767599aaa4ba9f704af26419e9.json
│           │       │           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │       │           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │       │           ├── 4876ded51b8ef3f0bbf70cc58eed5316ff614e5e.json
│           │       │           ├── 52894242605ce2cb5187e402d45ddf8adc3b43ae.json
│           │       │           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │       │           ├── 5bddb87f2573bca1db0bf96a497ef60a94362ac7.css
│           │       │           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │       │           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │       │           ├── 7e6810a04e9fa50fc27d19f11b52bccd3f6ec478.json
│           │       │           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │       │           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │       │           ├── c5d1a2aa31758ad0450758d6916ce36f0a04ead6.json
│           │       │           ├── fca357518c8a1a16ce8a6a007abc6e9d49d825ea.html
│           │       │           ├── fda02e49dfe2c456f2f9cfa4d0121f7c9c777379.json
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314376.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314639.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314663.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314684.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314704.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314726.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314752.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314773.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314796.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314819.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314841.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314864.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314890.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314911.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314934.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314960.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934314986.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315066.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315092.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315116.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315274.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315333.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315402.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315419.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315512.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315551.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315578.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315611.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315627.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315709.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315807.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315907.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315920.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934315950.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934316035.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934316045.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934316055.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934316067.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934316221.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934316238.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934316255.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934316271.jpeg
│           │       │           ├── page@05a75fba15bcf6847d382799fe779b4d-1788934316285.jpeg
│           │       │           └── page@05a75fba15bcf6847d382799fe779b4d-1788934316600.jpeg
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-6f69abef1cbc6859591dc77d559c34cddd5754f3.png
│           ├── af70c720-bc8d-47e5-ae94-c82199e7059b/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── e7340f786e2aed6ba8322fc03836a1697f5dc68e.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-43e1eb2f732dc86387f0aa9c16cf16aa77475b91.png
│           ├── b788590d-6b84-4328-aec7-306d17bc9856/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── f9596517c28b9fd8a4b84e25198a16c758bc166e.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-58ff2d9061b6788d0c7c08f9469041e4b8cceda2.png
│           ├── bcb8abff-8f88-4453-87c0-10e250a69d8c/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── a69a81942baec2c21536263666dfaafe1ae55196.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       ├── .playwright-artifacts-0/
│           │       │   └── traces/
│           │       │       └── resources/
│           │       │           ├── 0a0120f37c763f767599aaa4ba9f704af26419e9.json
│           │       │           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │       │           ├── 1960c6e6c29b2fee9565b135ec65ee58edc34051.json
│           │       │           ├── 20aa8d9eacfe00378fe4c2575e11fb4334c0db71.json
│           │       │           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │       │           ├── 3b13b9bb24a9e161a22bd05e98494b15dcf84efd.json
│           │       │           ├── 4a474444f0c0f681ede098f9b3bc695ed952568e.json
│           │       │           ├── 4d0158c128d14df72ab54769e0bca674e67f00f6.json
│           │       │           ├── 51ff4819cae5874fed50dcda6e67e18146d0b718.json
│           │       │           ├── 52597227086663c894a91f2b5dfbdddd5c068080.json
│           │       │           ├── 570a2c20a8e96a773474092e3d907a9f1948d1e5.json
│           │       │           ├── 57b8f3e4229f988a5a498fcb489e57362e8ea97d.html
│           │       │           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │       │           ├── 5bddb87f2573bca1db0bf96a497ef60a94362ac7.css
│           │       │           ├── 6832dccd2ae5e84a7d052162e44fff8caaef5917.json
│           │       │           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │       │           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │       │           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │       │           ├── 994592fdac07beb7feb0ebd6b9efdb94104eae2a.json
│           │       │           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │       │           ├── ad309296c615370577c4eb2e065158673d51de74.json
│           │       │           ├── b755d32b65e05710845c5f7ebe090fbe6b8bb2a8.json
│           │       │           ├── c5d1a2aa31758ad0450758d6916ce36f0a04ead6.json
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930054816.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055082.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055104.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055126.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055150.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055172.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055199.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055222.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055243.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055267.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055290.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055311.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055333.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055357.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055378.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055404.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055672.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055719.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055811.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055877.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055889.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055929.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930055988.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056058.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056162.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056292.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056306.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056321.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056418.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056427.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056439.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056481.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056498.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056576.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056588.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056606.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056634.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056654.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056778.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056794.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056813.jpeg
│           │       │           ├── page@9af0a35073a4a4ebf85e748209ac2161-1788930056843.jpeg
│           │       │           └── page@9af0a35073a4a4ebf85e748209ac2161-1788930057157.jpeg
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-5e2ef74a8adbde81dbc7105a4e1c9ad0aec8da3a.png
│           ├── c88b6383-b979-4d9d-9dff-e2477d53d285/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── ef12c9e0a1ea034c0027ef54aef2cd0b14434e0a.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-145837ae43ede0a178e631451ee5f03327ee43b4.png
│           ├── cf6c0363-4a17-4318-a70f-7a85b4652495/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── cd15e1e5dac8866baa123c0159b4683b527c00cd.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-c059687b1a266cce18d80998661acb455883bd86.png
│           ├── d8a367a5-b2b3-42d0-9495-4e2c88a8c2f9/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 549189c241a1c949cb6d60bc5095c618c79f4d40.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       ├── .playwright-artifacts-0/
│           │       │   └── traces/
│           │       │       └── resources/
│           │       │           ├── 02436f4f081ec70efb40834540a371a4777ceba3.json
│           │       │           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │       │           ├── 13b84d5b1933e3e4c2ba71b1fb3957379eb5df1a.json
│           │       │           ├── 1e2a41df9cf3afd2d29516c59f5108961204a13d.json
│           │       │           ├── 2ba0725c5c5bcbd19b6f88f6739e09a3d69cb8ce.json
│           │       │           ├── 3517529eb2a4daa8b9300d8804b1281b65854d03.json
│           │       │           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │       │           ├── 40b05b564628175a716fb21949131c49a2cd5848.json
│           │       │           ├── 4514f1eadda395b8a8207168b2e33836dedda8e9.json
│           │       │           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │       │           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │       │           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │       │           ├── 7ae633ade3a7eecb3e78b30c08f2bb21d4697e4a.json
│           │       │           ├── 90cfbb2855f8834166c4a5fb9130205cfc599f41.json
│           │       │           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │       │           ├── 994592fdac07beb7feb0ebd6b9efdb94104eae2a.json
│           │       │           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │       │           ├── b887235ba0f5787e481de88d01fbb71348a065f3.json
│           │       │           ├── bef17107005235fa9e7b2daf1b447d8d5c260905.css
│           │       │           ├── d5702a096c7de2367318decef0bd72ad3d91d6f3.json
│           │       │           ├── dd022efe2d3307d2168e462542666a0cbc6d23e7.json
│           │       │           ├── e344db1520d219aeb74e9c40b73d95b38f6249ad.json
│           │       │           ├── eefbc1e1d520e148c4f55b3ba087dd8d0da20934.html
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162526633.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162526643.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162526942.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162526972.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527002.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527031.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527060.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527090.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527118.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527147.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527173.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527202.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527232.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527257.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527285.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527320.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527743.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527794.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527865.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162527947.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528030.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528098.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528112.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528128.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528146.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528169.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528193.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528211.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528236.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528259.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528280.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528301.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528315.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528332.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528349.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528377.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528513.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528545.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528557.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528580.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528602.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528708.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528728.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528869.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162528880.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162529282.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162529305.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162529330.jpeg
│           │       │           ├── page@5800bce61594a1ce7c1af2378a775ce4-1789162529355.jpeg
│           │       │           └── page@5800bce61594a1ce7c1af2378a775ce4-1789162529759.jpeg
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-e3a040c5d9a9aaf498ae571230ecb32879b836c2.png
│           ├── dbee9a43-d67d-4305-b10f-4729e38f9798/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── b8f9ec26f23e8dd1b7c6405f89d36827738e2983.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-0275807db743915c1c82aec4c1cd7d0a54e4b36b.png
│           ├── dce96d16-e8a5-40be-a31d-781d4309bdbb/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── 316198f132d93d6060d23741d3f72b578b52a2ea.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-e655698a99ff12ebf498b596b7d4e214659d88c9.png
│           ├── ed08b8f6-27e7-464d-adc1-7fdaf3d441af/
│           │   ├── skycommand-summary.json
│           │   ├── report/
│           │   │   ├── index.html
│           │   │   └── data/
│           │   │       └── a69a81942baec2c21536263666dfaafe1ae55196.png
│           │   └── results/
│           │       ├── .last-run.json
│           │       ├── .playwright-artifacts-0/
│           │       │   └── traces/
│           │       │       └── resources/
│           │       │           ├── 0a0120f37c763f767599aaa4ba9f704af26419e9.json
│           │       │           ├── 1353b6958faa7d833d1492c98566e714f8540ecd.json
│           │       │           ├── 3626ab79deee7998a744e27e9b8a31f2c7272cb0.png
│           │       │           ├── 454ec08db802d3cd189d6b560fb607101a6b937b.json
│           │       │           ├── 54524d458de501687811b5309e3a977941e58c36.json
│           │       │           ├── 57b8f3e4229f988a5a498fcb489e57362e8ea97d.html
│           │       │           ├── 59b16f282ec8be4b6f6d4feff660f72c221fe36e.json
│           │       │           ├── 5bddb87f2573bca1db0bf96a497ef60a94362ac7.css
│           │       │           ├── 6832dccd2ae5e84a7d052162e44fff8caaef5917.json
│           │       │           ├── 6fd0f0ca46886e33902862da955fbc8817e7cfe9.json
│           │       │           ├── 76d943cb96b26604d075baed61fcd90fc1f173a0.json
│           │       │           ├── 8291416ed41854bc0df735e504c4431f2d845da1.json
│           │       │           ├── 96a0117ee9005ab15434f0f936f8c3ea349d967e.png
│           │       │           ├── ac3bf7253e1eacf53860ecb78d4aa5412c611df6.png
│           │       │           ├── c5d1a2aa31758ad0450758d6916ce36f0a04ead6.json
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859317.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859326.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859590.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859617.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859642.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859665.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859689.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859713.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859736.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859760.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859787.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859809.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859830.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859850.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859874.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923859894.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860030.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860068.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860099.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860232.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860309.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860316.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860427.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860445.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860542.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860562.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860626.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860718.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860829.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860935.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923860957.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861040.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861118.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861254.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861265.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861278.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861327.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861451.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861467.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861484.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861500.jpeg
│           │       │           ├── page@ee29e4df8ada529e629c1d442938914e-1788923861514.jpeg
│           │       │           └── page@ee29e4df8ada529e629c1d442938914e-1788923861832.jpeg
│           │       └── workflows-workflowInitiali-f13c3-thout-starting-the-workflow-chromium/
│           │           ├── workflow-initialization-open.png
│           │           └── attachments/
│           │               └── Workflow-Initialization-Open-16ecac1af039d680fbf89a008fe762627008aeba.png
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
├── browser-automation/
│   ├── README.md
│   └── scripts/
│       └── skycommand/
│           └── commandCenterStatus.js
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
│   ├── PLAYWRIGHT_PHASE10_SCHEDULING.md
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
│   │   ├── contracts/
│   │   │   ├── browser_automation_summary.v1.schema.json
│   │   │   └── browser_test_suite_summary.v1.schema.json
│   │   └── src/
│   │       ├── browserAutomationRunner.js
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
│   │       │   ├── 00115__browser_test_observability.sql
│   │       │   ├── 00116__browser_test_execution_mode.sql
│   │       │   ├── 00117__browser_automation_registry_foundation.sql
│   │       │   ├── 00119__browser_automation_execution.sql
│   │       │   ├── 00121__browser_test_suites.sql
│   │       │   ├── 00123__playwright_workflow_node_types.sql
│   │       │   └── 00125__scheduler_failure_notifications.sql
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
│   │           ├── 00114__browser_test_registry_seed.sql
│   │           ├── 00118__browser_automation_registry_seed.sql
│   │           ├── 00120__browser_automation_execution_seed.sql
│   │           ├── 00122__browser_test_suites_seed.sql
│   │           └── 00124__playwright_scheduler_bridges_seed.sql
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
│   │   ├── Show-SkyCommandPlaywrightWindow.ps1
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
        │   │       │   ├── browserAutomationRegistryUiSelfTest.js
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
        │               ├── browserAutomationExecutionSelfTest.js
        │               ├── browserAutomationRegistrySelfTest.js
        │               ├── browserTestObservabilitySelfTest.js
        │               ├── browserTestRegistrySelfTest.js
        │               ├── browserTestSuiteSelfTest.js
        │               ├── dockerEventStreamServiceSelfTest.js
        │               ├── dockerTelemetryStreamServiceSelfTest.js
        │               ├── infrastructureServiceSelfTest.js
        │               ├── legacyMacroFreshnessAdapterSelfTest.js
        │               ├── notificationFoundationSelfTest.js
        │               ├── phase15ClosureReadinessSelfTest.js
        │               ├── playwrightSchedulerSelfTest.js
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
        │               ├── workflowPlaywrightNodeSelfTest.js
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
