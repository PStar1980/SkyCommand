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
├── SkyServer*RepoMap.md
├── .github/
│ └── workflows/
├── .husky/
│ ├── pre-commit
│ ├── pre-push
│ └── */
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
├── logs/
└── src/
├── index.js
├── server.js
├── config/
│ ├── repo_path.json
│ └── SkyServer.json
├── core/
│ ├── bootstrap.js
│ └── logger.js
├── db/
│ ├── connection.js
│ ├── schemas/
│ │ └── macro.sql
│ ├── tables/
│ │ └── macro.indicators..sql
│ └── views/
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
│ └── macro.vw_rates_curve.sql
├── lib/
│ └── helpers.js
├── scripts/
│ ├── apis/
│ │ └── .gitkeep
│ ├── db/
│ │ ├── run.js
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
│ │ │ └── init/
│ │ │ └── 00001**init_db.sql
│ │ └── seeds/
│ │ ├── 00004**data_indicators.sql
│ │ └── 00010\_\_data_indicators.sql
│ ├── jobs/
│ │ └── .gitkeep
│ ├── listeners/
│ │ └── .gitkeep
│ ├── node/
│ │ ├── db_health.js
│ │ ├── dev_commit.js
│ │ ├── generateStructure.js
│ │ ├── git_repo_status.js
│ │ ├── main_merge.js
│ │ ├── SkyServer_Core.js
│ │ ├── core/
│ │ │ └── runPipeline.js
│ │ └── ingestion/
│ │ ├── loadBoCMacroData.js
│ │ ├── loadFREDMacroData.js
│ │ ├── loadManualData.js
│ │ ├── loadStatCanMacroData.js
│ │ ├── config/
│ │ │ ├── manualIngestion.json
│ │ │ ├── statcanIndicators.js
│ │ │ └── statcanVectors.js
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
│ ├── powershell/
│ │ ├── Build-SkyOne-Bootloader.ps1
│ │ ├── Clean-BackendCache.ps1
│ │ ├── Clean-FrontendCache.ps1
│ │ ├── Git_Repo_Actions.md
│ │ └── Git_Repo_Actions.ps1
│ ├── python/
│ │ ├── dev_commit_auto.py
│ │ ├── main_merge_auto.py
│ │ └── utility_functions.py
│ ├── schedulers/
│ │ └── .gitkeep
│ ├── utils/
│ │ └── logger.js
│ └── workers/
│ └── .gitkeep
├── server/
│ ├── controllers/
│ │ └── healthController.js
│ ├── middleware/
│ │ └── auth.js
│ ├── routes/
│ │ └── index.js
│ └── views/
│ └── .gitkeep
├── telemetry/
│ └── metrics.js
└── web/
├── assets/
│ └── .gitkeep
├── components/
│ └── .gitkeep
├── hooks/
│ └── .gitkeep
└── pages/
└── .gitkeep
