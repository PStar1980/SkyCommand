SkyServer/
├── .editorconfig
├── .env
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
│ │ │ ├── AuditEvents.jsx
│ │ │ ├── Dashboard.jsx
│ │ │ ├── Home.jsx
│ │ │ ├── Login.jsx
│ │ │ ├── ScriptExecutions.jsx
│ │ │ └── Tools.jsx
│ │ └── services/
│ │ ├── adminService.js
│ │ ├── api.js
│ │ ├── authService.js
│ │ └── toolService.js
│ ├── api/
│ │ └── src/
│ │ ├── index.js
│ │ ├── server.js
│ │ ├── controllers/
│ │ │ ├── adminController.js
│ │ │ ├── authController.js
│ │ │ └── toolsController.js
│ │ ├── middleware/
│ │ │ ├── authMiddleware.js
│ │ │ └── permissionMiddleware.js
│ │ ├── routes/
│ │ │ ├── admin.routes.js
│ │ │ ├── auth.routes.js
│ │ │ └── tools.routes.js
│ │ └── services/
│ │ ├── adminReadService.js
│ │ ├── authService.js
│ │ ├── scriptExecutionService.js
│ │ └── toolManifestService.js
│ └── worker/
│ └── src/
│ ├── jobs/
│ ├── listeners/
│ └── schedulers/
├── docs/
│ └── SkyServer_RepoMap.md
├── logs/
│ └── script-executions/
│ ├── 052bc4ff-153a-44da-a49b-a202dfb5998c.stderr.log
│ ├── 052bc4ff-153a-44da-a49b-a202dfb5998c.stdout.log
│ ├── 05b83ab5-73a9-4792-b68f-7e0d0958c648.stderr.log
│ ├── 05b83ab5-73a9-4792-b68f-7e0d0958c648.stdout.log
│ ├── 0ee692d1-c573-4967-a8ce-cf738e8df8e3.stderr.log
│ ├── 0ee692d1-c573-4967-a8ce-cf738e8df8e3.stdout.log
│ ├── 104e84f1-7564-4600-aee6-ca5401648950.stderr.log
│ ├── 104e84f1-7564-4600-aee6-ca5401648950.stdout.log
│ ├── 10b049e5-757b-4387-be19-ed8905ed0483.stderr.log
│ ├── 10b049e5-757b-4387-be19-ed8905ed0483.stdout.log
│ ├── 129a3b78-209b-4789-bba5-69a35707a770.stderr.log
│ ├── 129a3b78-209b-4789-bba5-69a35707a770.stdout.log
│ ├── 18d453db-a5ef-4464-ae7c-dc5b7717a7b3.stderr.log
│ ├── 18d453db-a5ef-4464-ae7c-dc5b7717a7b3.stdout.log
│ ├── 197c5f54-d4d5-4662-8e69-3fe714a43a5d.stderr.log
│ ├── 197c5f54-d4d5-4662-8e69-3fe714a43a5d.stdout.log
│ ├── 1c2a1f3e-d34d-49ab-9b3b-ad14ed823a9c.stderr.log
│ ├── 1c2a1f3e-d34d-49ab-9b3b-ad14ed823a9c.stdout.log
│ ├── 25969461-b1a2-4ea2-a851-730b3665b3f0.stderr.log
│ ├── 25969461-b1a2-4ea2-a851-730b3665b3f0.stdout.log
│ ├── 25b6fd64-a49c-467c-89f8-093fc2187f44.stderr.log
│ ├── 25b6fd64-a49c-467c-89f8-093fc2187f44.stdout.log
│ ├── 2834c3a1-f547-45be-8d8b-d21b6245c408.stderr.log
│ ├── 2834c3a1-f547-45be-8d8b-d21b6245c408.stdout.log
│ ├── 2b6e17d1-c7bc-4760-afa4-8ff7096158d4.stderr.log
│ ├── 2b6e17d1-c7bc-4760-afa4-8ff7096158d4.stdout.log
│ ├── 2c1b6378-bcca-474f-a2b7-292edcca836a.stderr.log
│ ├── 2c1b6378-bcca-474f-a2b7-292edcca836a.stdout.log
│ ├── 2e8c1601-dbf8-4a17-88f5-1c1a74877aba.stderr.log
│ ├── 2e8c1601-dbf8-4a17-88f5-1c1a74877aba.stdout.log
│ ├── 32a23145-b1c2-4095-93cc-e8179c87d468.stderr.log
│ ├── 32a23145-b1c2-4095-93cc-e8179c87d468.stdout.log
│ ├── 34f3c266-58b0-4da5-9eac-d926c0e54480.stderr.log
│ ├── 34f3c266-58b0-4da5-9eac-d926c0e54480.stdout.log
│ ├── 38bc0e4a-83d5-42fe-ba52-deeed8bac58f.stderr.log
│ ├── 38bc0e4a-83d5-42fe-ba52-deeed8bac58f.stdout.log
│ ├── 3a8f130d-9997-479d-8b2f-abac42787a3a.stderr.log
│ ├── 3a8f130d-9997-479d-8b2f-abac42787a3a.stdout.log
│ ├── 464b0f1c-174c-451f-baa4-8ce36fd57928.stderr.log
│ ├── 464b0f1c-174c-451f-baa4-8ce36fd57928.stdout.log
│ ├── 473a8174-ca28-43ff-abff-888493bac210.stderr.log
│ ├── 473a8174-ca28-43ff-abff-888493bac210.stdout.log
│ ├── 4b5b7847-f1ab-402f-b6f9-15aa2a5fc11e.stderr.log
│ ├── 4b5b7847-f1ab-402f-b6f9-15aa2a5fc11e.stdout.log
│ ├── 50d88a59-d76c-42fb-84a5-479cfe949ffe.stderr.log
│ ├── 50d88a59-d76c-42fb-84a5-479cfe949ffe.stdout.log
│ ├── 520f422d-a367-480c-abea-d2443d980bd9.stderr.log
│ ├── 520f422d-a367-480c-abea-d2443d980bd9.stdout.log
│ ├── 53d14425-01b7-44f6-aa1e-e44f1e253a01.stderr.log
│ ├── 53d14425-01b7-44f6-aa1e-e44f1e253a01.stdout.log
│ ├── 5b851b8e-fe40-4bcd-abdd-8a4a5ee09bb7.stderr.log
│ ├── 5b851b8e-fe40-4bcd-abdd-8a4a5ee09bb7.stdout.log
│ ├── 638d5806-0d8e-4403-973d-8fb0da0f5d33.stderr.log
│ ├── 638d5806-0d8e-4403-973d-8fb0da0f5d33.stdout.log
│ ├── 6a7b3b20-89a0-4f0d-9c83-84ffc04be1a8.stderr.log
│ ├── 6a7b3b20-89a0-4f0d-9c83-84ffc04be1a8.stdout.log
│ ├── 72afe77a-32d4-400c-971e-8fe160ee2c4d.stderr.log
│ ├── 72afe77a-32d4-400c-971e-8fe160ee2c4d.stdout.log
│ ├── 72ed8328-0b02-4fe9-8146-49decff568b2.stderr.log
│ ├── 72ed8328-0b02-4fe9-8146-49decff568b2.stdout.log
│ ├── 739fb244-a5e1-4187-87d1-5ef67b9cdee6.stderr.log
│ ├── 739fb244-a5e1-4187-87d1-5ef67b9cdee6.stdout.log
│ ├── 7a84eb11-4d1f-4291-adea-f1fee31272ef.stderr.log
│ ├── 7a84eb11-4d1f-4291-adea-f1fee31272ef.stdout.log
│ ├── 7e71af4f-5cd0-4c76-8269-4fed50048f93.stderr.log
│ ├── 7e71af4f-5cd0-4c76-8269-4fed50048f93.stdout.log
│ ├── 7f2919aa-cc6b-4b95-a48a-12d97f35a190.stderr.log
│ ├── 7f2919aa-cc6b-4b95-a48a-12d97f35a190.stdout.log
│ ├── 85154acf-f762-42dd-9f3e-f27e4620007f.stderr.log
│ ├── 85154acf-f762-42dd-9f3e-f27e4620007f.stdout.log
│ ├── 85292f07-1c9e-4799-9467-0b7ec6ea2026.stderr.log
│ ├── 85292f07-1c9e-4799-9467-0b7ec6ea2026.stdout.log
│ ├── 95680357-8f27-4f4c-97e7-c301fa3a3546.stderr.log
│ ├── 95680357-8f27-4f4c-97e7-c301fa3a3546.stdout.log
│ ├── 9872126c-0f3f-4a30-80ed-cbff618bab70.stderr.log
│ ├── 9872126c-0f3f-4a30-80ed-cbff618bab70.stdout.log
│ ├── 9a0a164d-ece6-47b6-acca-aff8c274b660.stderr.log
│ ├── 9a0a164d-ece6-47b6-acca-aff8c274b660.stdout.log
│ ├── 9e5a1c27-5976-4081-86fc-e07d80836b2d.stderr.log
│ ├── 9e5a1c27-5976-4081-86fc-e07d80836b2d.stdout.log
│ ├── a4180e3f-6de7-45b5-a9bd-a8bc20d6a2db.stderr.log
│ ├── a4180e3f-6de7-45b5-a9bd-a8bc20d6a2db.stdout.log
│ ├── a59f67b8-07b0-49de-8d7e-22e0677ea815.stderr.log
│ ├── a59f67b8-07b0-49de-8d7e-22e0677ea815.stdout.log
│ ├── a5c4a6a6-fd79-4ba3-809c-7eb58b4c4070.stderr.log
│ ├── a5c4a6a6-fd79-4ba3-809c-7eb58b4c4070.stdout.log
│ ├── b12fad7d-37a0-49aa-b6e2-8f145a3508c0.stderr.log
│ ├── b12fad7d-37a0-49aa-b6e2-8f145a3508c0.stdout.log
│ ├── bd03399b-e88e-4bdb-bdd4-61dd6f9888d4.stderr.log
│ ├── bd03399b-e88e-4bdb-bdd4-61dd6f9888d4.stdout.log
│ ├── bf6a240f-bba5-4104-afcd-125960c74dae.stderr.log
│ ├── bf6a240f-bba5-4104-afcd-125960c74dae.stdout.log
│ ├── c4fe7867-3d7f-48cf-bc7d-89549dd64a43.stderr.log
│ ├── c4fe7867-3d7f-48cf-bc7d-89549dd64a43.stdout.log
│ ├── c5e91615-c1d1-4900-a931-9570e7ca5fd9.stderr.log
│ ├── c5e91615-c1d1-4900-a931-9570e7ca5fd9.stdout.log
│ ├── c632fb95-35db-4757-94aa-1f105cd7fd2b.stderr.log
│ ├── c632fb95-35db-4757-94aa-1f105cd7fd2b.stdout.log
│ ├── c70a29ca-4db2-430d-8964-81bb452c8867.stderr.log
│ ├── c70a29ca-4db2-430d-8964-81bb452c8867.stdout.log
│ ├── c9195b01-a1f4-40be-900d-8690f90c4e11.stderr.log
│ ├── c9195b01-a1f4-40be-900d-8690f90c4e11.stdout.log
│ ├── cd3fd468-9d68-46d3-a308-fc4ca9012d46.stderr.log
│ ├── cd3fd468-9d68-46d3-a308-fc4ca9012d46.stdout.log
│ ├── cffdb6f2-2226-4a2f-8cbb-aea75f310cc4.stderr.log
│ ├── cffdb6f2-2226-4a2f-8cbb-aea75f310cc4.stdout.log
│ ├── d06511a5-89b7-4347-8fae-dc6e68114307.stderr.log
│ ├── d06511a5-89b7-4347-8fae-dc6e68114307.stdout.log
│ ├── d26aaeaa-66f6-438d-94df-e9f7ef368388.stderr.log
│ ├── d26aaeaa-66f6-438d-94df-e9f7ef368388.stdout.log
│ ├── d76aea8d-4937-485e-8009-36d92bb566fd.stderr.log
│ ├── d76aea8d-4937-485e-8009-36d92bb566fd.stdout.log
│ ├── e1a9ffda-ce7d-4e8b-a5b3-f2397a5d5d8a.stderr.log
│ ├── e1a9ffda-ce7d-4e8b-a5b3-f2397a5d5d8a.stdout.log
│ ├── e34e263a-2628-44da-9b38-7cf0f970a4a8.stderr.log
│ ├── e34e263a-2628-44da-9b38-7cf0f970a4a8.stdout.log
│ ├── e3df07e4-49f4-48ce-94e6-12168474f82d.stderr.log
│ ├── e3df07e4-49f4-48ce-94e6-12168474f82d.stdout.log
│ ├── e5c2876c-faf4-4f4e-915d-1fe0a706c3ec.stderr.log
│ ├── e5c2876c-faf4-4f4e-915d-1fe0a706c3ec.stdout.log
│ ├── e8a461e6-046f-4c54-a381-f3143c0d000a.stderr.log
│ ├── e8a461e6-046f-4c54-a381-f3143c0d000a.stdout.log
│ ├── f01eb679-9acd-49b4-a896-a7428b0da983.stderr.log
│ ├── f01eb679-9acd-49b4-a896-a7428b0da983.stdout.log
│ ├── f4a7f5ef-74a2-475e-9f7c-69bd8a4075a9.stderr.log
│ ├── f4a7f5ef-74a2-475e-9f7c-69bd8a4075a9.stdout.log
│ ├── f520e190-1718-41ca-9efe-8234efe39e76.stderr.log
│ ├── f520e190-1718-41ca-9efe-8234efe39e76.stdout.log
│ ├── f85201b2-1354-4219-a97f-02cc14c22731.stderr.log
│ ├── f85201b2-1354-4219-a97f-02cc14c22731.stdout.log
│ ├── fb7f47a8-7757-4324-8265-a24fa2be8045.stderr.log
│ └── fb7f47a8-7757-4324-8265-a24fa2be8045.stdout.log
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
│ │ │ └── init/
│ │ │ └── 00001**init_db.sql
│ │ ├── seeds/
│ │ │ ├── 00004**data_indicators.sql
│ │ │ ├── 00010**data_indicators.sql
│ │ │ ├── 00016**auth_seed_roles_permissions.sql
│ │ │ └── 00019\_\_core_config_seed.sql
│ │ └── src/
│ │ └── db_build.js
│ ├── files/
│ │ └── src/
│ │ └── generateRepoMap.js
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
│ └── shared/
│ └── src/
│ ├── constants/
│ ├── contracts/
│ └── validators/
└── scripts/
├── db/
│ ├── functions/
│ │ ├── auth.set_updated_at.sql
│ │ └── core.set_updated_at.sql
│ ├── schemas/
│ │ ├── auth.sql
│ │ ├── core.sql
│ │ └── macro.sql
│ ├── tables/
│ │ ├── auth.audit_events.sql
│ │ ├── auth.login_events.sql
│ │ ├── auth.permissions.sql
│ │ ├── auth.role_permissions.sql
│ │ ├── auth.roles.sql
│ │ ├── auth.script_execution_log.sql
│ │ ├── auth.sessions.sql
│ │ ├── auth.user_roles.sql
│ │ ├── auth.users.sql
│ │ ├── core.applications.sql
│ │ ├── core.config_profiles.sql
│ │ ├── core.option_sources.sql
│ │ ├── core.param_types.sql
│ │ ├── core.repositories.sql
│ │ ├── core.repository_paths.sql
│ │ ├── core.risk_levels.sql
│ │ ├── core.runtimes.sql
│ │ ├── core.tool_categories.sql
│ │ ├── core.tool_category_visibility.sql
│ │ ├── core.tool_parameter_options.sql
│ │ ├── core.tool_parameters.sql
│ │ ├── core.tool_visibility.sql
│ │ ├── core.tools.sql
│ │ ├── core.visibility_channels.sql
│ │ └── macro.indicators..sql
│ ├── triggers/
│ │ ├── auth.permissions_set_updated_at.sql
│ │ ├── auth.roles_set_updated_at.sql
│ │ ├── auth.users_set_updated_at.sql
│ │ ├── core.applications_set_updated_at.sql
│ │ ├── core.repositories_set_updated_at.sql
│ │ ├── core.repository_paths_set_updated_at.sql
│ │ ├── core.tool_categories_set_updated_at.sql
│ │ ├── core.tool_parameters_set_updated_at.sql
│ │ └── core.tools_set_updated_at.sql
│ └── views/
│ ├── auth.vw_active_sessions.sql
│ ├── auth.vw_audit_events_recent.sql
│ ├── auth.vw_login_events_recent.sql
│ ├── auth.vw_role_permissions.sql
│ ├── auth.vw_script_execution_recent.sql
│ ├── auth.vw_user_permissions.sql
│ ├── auth.vw_user_roles.sql
│ ├── core.vw_admin_web_tools.sql
│ ├── core.vw_cli_categories.sql
│ ├── core.vw_cli_tools.sql
│ ├── core.vw_repository_paths.sql
│ ├── core.vw_tool_manifest.sql
│ ├── core.vw_tool_parameter_options.sql
│ ├── core.vw_tool_parameters.sql
│ ├── macro.vw_ca_growth.sql
│ ├── macro.vw_ca_housing.sql
│ ├── macro.vw_ca_inflation.sql
│ ├── macro.vw_ca_labor.sql
│ ├── macro.vw_ca_macro_regime.sql
│ ├── macro.vw_ca_rates_fx.sql
│ ├── macro.vw_ca_trade.sql
│ ├── macro.vw_credit_conditions.sql
│ ├── macro.vw_growth.sql
│ ├── macro.vw_housing.sql
│ ├── macro.vw_inflation.sql
│ ├── macro.vw_labor.sql
│ ├── macro.vw_liquidity.sql
│ ├── macro.vw_macro_regime.sql
│ ├── macro.vw_rates_curve.sql
│ ├── macro.vw_us_ca_inflation_compare.sql
│ ├── macro.vw_us_ca_labor_compare.sql
│ └── macro.vw_us_ca_policy_fx.sql
├── node/
│ └── util/
│ ├── bootstrap.js
│ └── logger.js
├── powershell/
│ ├── Build-SkyOne-Bootloader.ps1
│ ├── Clean-BackendCache.ps1
│ └── Clean-FrontendCache.ps1
└── python/
