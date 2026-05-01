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
│ │ ├── eslint.config.js
│ │ ├── index.html
│ │ ├── package-lock.json
│ │ ├── package.json
│ │ ├── vite.config.js
│ │ ├── public/
│ │ │ └── vite.svg
│ │ └── src/
│ │ ├── App.css
│ │ ├── App.jsx
│ │ ├── index.css
│ │ ├── main.jsx
│ │ ├── assets/
│ │ │ └── react.svg
│ │ ├── components/
│ │ │ ├── AccountCard.jsx
│ │ │ ├── Navbar.jsx
│ │ │ └── TransactionList.jsx
│ │ ├── context/
│ │ ├── pages/
│ │ │ ├── Dashboard.jsx
│ │ │ ├── Home.jsx
│ │ │ └── Login.jsx
│ │ └── services/
│ │ ├── api.js
│ │ └── userService.js
│ ├── api/
│ │ └── src/
│ │ ├── index.js
│ │ ├── server.js
│ │ ├── controllers/
│ │ ├── middleware/
│ │ ├── routes/
│ │ └── services/
│ └── worker/
│ └── src/
│ ├── jobs/
│ ├── listeners/
│ └── schedulers/
├── docs/
│ └── SkyServer_RepoMap.md
├── logs/
├── packages/
│ ├── core/
│ │ └── src/
│ │ ├── SkyServer_Core.js
│ │ └── config/
│ │ └── SkyServer.json
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
│ │ │ └── init/
│ │ │ └── 00001**init_db.sql
│ │ ├── seeds/
│ │ │ ├── 00004**data_indicators.sql
│ │ │ └── 00010\_\_data_indicators.sql
│ │ └── src/
│ │ └── db_build.js
│ ├── files/
│ │ └── src/
│ │ └── generateRepoMap.js
│ ├── git/
│ │ └── src/
│ │ ├── dev_commit.js
│ │ ├── git_repo_status.js
│ │ ├── main_merge.js
│ │ └── config/
│ │ └── repo_path.json
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
