# 🌌 SkyServer

**Private Admin, Automation, PostgreSQL, and Data Ingestion Hub for the Sky Ecosystem**

SkyServer is the private administrative and automation core of the **Sky Ecosystem**. It combines backend services, PostgreSQL database tooling, macroeconomic data ingestion, repository automation, file utilities, and a configurable CLI launcher into one clean operational hub.

SkyServer is designed to be precise, repeatable, idempotent, and easy to extend. It supports local development workflows, database rebuilds, macro data ingestion from multiple public data providers, manual spreadsheet ingestion, Git automation, and script orchestration through the **SkyServer Core CLI Tool**.

---

## 🚀 Core Capabilities

### 🧠 SkyServer Core CLI Tool

SkyServer includes a configurable command-line launcher:

```bash
node packages/core/src/SkyServer_Core.js
```

The CLI reads from:

```text
packages/core/src/config/SkyServer.json
```

It provides a menu-driven interface for running configured tools without requiring users to remember script paths or command syntax.

Current tool groups include:

- **Database Tools**
  - PostgreSQL health checks
  - Full database rebuilds from ordered SQL migrations and seeds

- **Git Tools**
  - Dev branch commit workflow
  - Repository status checks
  - Main branch merge/sync workflow

- **Ingestion Tools**
  - FRED macro data ingestion
  - Bank of Canada data ingestion
  - Statistics Canada data ingestion
  - Manual spreadsheet/CSV ingestion

- **Structure Tools**
  - Repository map generation

The CLI is config-driven, meaning new tools can be added by updating `SkyServer.json` rather than modifying the launcher itself.

---

## 🗄️ PostgreSQL Database Layer

SkyServer uses PostgreSQL as its structured data backend.

The database layer currently focuses on macroeconomic data, using a `macro` schema with:

- `macro.indicators`
  - Central registry of available indicators
  - Tracks indicator code, source, description, frequency, creation timestamp, and active status

- One physical table per indicator
  - Each indicator table matches its `indicator_code`
  - Standard structure:

```sql
edate DATE NOT NULL PRIMARY KEY,
value NUMERIC
```

- Macro analysis views
  - U.S. macro views
  - Canadian macro views
  - U.S./Canada comparison views

The database build system is managed through:

```bash
npm run db:build
```

and the direct script:

```bash
node packages/db_build/src/db_build.js
```

The build tool scans SQL files from:

```text
packages/db_build/migrations
packages/db_build/seeds
```

SQL files are sorted and executed in filename order, preserving deterministic database rebuild behavior across folders.

---

## 📊 Data Ingestion Layer

SkyServer includes a reusable ingestion framework for loading public and manual data into PostgreSQL.

### Supported Data Sources

#### FRED

Loads U.S. macroeconomic indicators from the Federal Reserve Economic Data ecosystem.

Example indicators include:

- Inflation
- Labor market
- Interest rates
- Treasury curve
- Credit conditions
- Housing
- Liquidity
- Growth
- Energy

Run directly:

```bash
node packages/ingestion/src/loadFREDMacroData.js
```

---

#### Bank of Canada

Loads selected Canadian financial indicators from Bank of Canada data sources.

Current active indicators include:

- USD/CAD exchange rate
- Bank of Canada overnight policy rate

Run directly:

```bash
node packages/ingestion/src/loadBoCMacroData.js
```

---

#### Statistics Canada

Loads selected Canadian macroeconomic indicators from Statistics Canada vector-based data.

Current covered areas include:

- CPI / inflation
- GDP
- Housing
- Population
- Labor market
- Imports
- Retail sales
- Building permits
- Trade by industry

Run directly:

```bash
node packages/ingestion/src/loadStatCanMacroData.js
```

Supporting StatCan configuration files live under:

```text
packages/ingestion/src/config
```

including:

```text
statcanIndicators.js
statcanVectors.js
```

Discovery utilities are also available:

```text
packages/ingestion/src/discovery/discoverStatCanMetadata.js
packages/ingestion/src/discovery/resolveStatCanVectors.js
```

---

#### Manual Spreadsheet / CSV Ingestion

SkyServer also supports manual ingestion for user-provided spreadsheet or CSV files.

Manual ingestion uses:

```text
packages/ingestion/src/config/manualIngestion.json
```

The config maps spreadsheet columns to database columns and allows controlled loading into a target table without requiring direct database write access.

Run directly:

```bash
node packages/ingestion/src/loadManualData.js
```

This is useful for team environments where a user can prepare a file and config while the ingestion process handles database loading safely and consistently.

---

## ⚙️ Ingestion Design

The ingestion framework is built around reusable components:

```text
packages/ingestion/src/core/runPipeline.js
packages/ingestion/src/loaders/copyLoader.js
packages/ingestion/src/loaders/manualCopyLoader.js
packages/ingestion/src/transform/csvNormalizer.js
packages/ingestion/src/sources
```

The pipeline pattern is:

```text
Get active indicators
Download source data
Normalize or transform data
Load into staging
Insert new or updated data into target table
Log results
Clean temporary files
```

The loaders are designed to be:

- Idempotent
- Runnable from any command prompt location
- Source-aware
- Efficient for incremental updates
- Safe for repeated execution

Typical ingestion output includes:

```text
staging_rows
staging_max
new_rows
inserted_rows
target_max
```

This keeps the console output compact while still showing whether new data was loaded.

---

## 🧰 Automation Tools

SkyServer includes automation scripts for repository, file, database, ingestion, and operational workflows.

Automation is not a one-time phase of the project. It is a continuous layer of the system: as repeated workflows emerge, they can be promoted into scripts and then exposed through SkyServer Core.

### Git Automation

Located under:

```text
packages/git/src
```

Available scripts:

```text
dev_commit.js
git_repo_status.js
main_merge.js
```

These tools use:

```text
packages/git/src/config/repo_path.json
```

to resolve configured repository roots.

They support:

- Dev branch commit workflow
- Pre-commit and pre-push validation
- Repository status reporting
- Main branch merge/sync workflow
- Optional tagging during merge operations

---

### File / Structure Automation

Repository map generation is handled by:

```text
packages/files/src/generateRepoMap.js
```

This produces a readable file tree for project documentation and structural review.

---

### PowerShell Utilities

Additional PowerShell utilities live under:

```text
scripts/powershell
```

Current utilities include:

```text
Build-SkyOne-Bootloader.ps1
Clean-BackendCache.ps1
Clean-FrontendCache.ps1
```

---

## 🏗️ Repository Structure

```text
SkyServer/
├── apps/
│   ├── admin-web/        # Private admin frontend
│   ├── api/              # Node/Express API layer
│   └── worker/           # Background jobs, listeners, schedulers
│
├── packages/
│   ├── core/             # SkyServer Core CLI Tool
│   ├── db/               # PostgreSQL connection and health tools
│   ├── db_build/         # Database migrations, seeds, and build runner
│   ├── files/            # File and repository structure utilities
│   ├── git/              # Git automation scripts
│   ├── ingestion/        # FRED, BoC, StatCan, and manual ingestion pipelines
│   └── shared/           # Shared constants, contracts, and validators
│
├── scripts/
│   ├── db/               # SQL schemas, table scripts, and views
│   ├── node/             # Shared Node utilities
│   ├── powershell/       # PowerShell automation helpers
│   └── python/           # Reserved for Python utilities
│
├── docs/
│   └── SkyServer_RepoMap.md
│
├── .husky/               # Git hooks
├── eslint.config.mjs     # ESLint flat configuration
├── .prettierrc.json      # Prettier configuration
├── package.json
└── README.md
```

---

## 🧩 NPM Scripts

| Command                | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `npm run start`        | Starts the API server                           |
| `npm run dev`          | Starts the API server with Nodemon              |
| `npm run daemon`       | Starts the API daemon entry point with Nodemon  |
| `npm run lint`         | Runs ESLint checks                              |
| `npm run lint:fix`     | Runs ESLint with auto-fix                       |
| `npm run format`       | Applies Prettier formatting                     |
| `npm run format:check` | Verifies Prettier formatting                    |
| `npm run clean`        | Runs lint fix and formatting                    |
| `npm run prepush`      | Runs lint and formatting checks before push     |
| `npm run db:health`    | Tests PostgreSQL connectivity                   |
| `npm run db:build`     | Rebuilds the PostgreSQL database from SQL files |

---

## 🛡️ Code Quality Automation

SkyServer uses:

- ESLint
- Prettier
- Husky
- lint-staged

### Pre-Commit

The pre-commit hook formats and fixes staged files before commit.

### Pre-Push

The pre-push hook runs validation checks before allowing changes to be pushed.

This keeps the repository clean, formatted, and consistent across refactors.

---

## 🔐 Environment Configuration

SkyServer expects a root `.env` file containing PostgreSQL connection settings.

Example required variables:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=skyserver_dev
PGUSER=postgres
PGPASSWORD=your_password
```

Database and ingestion scripts load `.env` from the SkyServer root so tools can be executed from different command prompt locations.

---

## 📈 Macro Views

SkyServer includes SQL views for reporting and dashboard development.

### U.S. Macro Views

Examples:

```text
macro.vw_inflation
macro.vw_rates_curve
macro.vw_growth
macro.vw_labor
macro.vw_credit_conditions
macro.vw_housing
macro.vw_liquidity
macro.vw_macro_regime
```

### Canadian Macro Views

Examples:

```text
macro.vw_ca_inflation
macro.vw_ca_growth
macro.vw_ca_labor
macro.vw_ca_housing
macro.vw_ca_trade
macro.vw_ca_rates_fx
macro.vw_ca_macro_regime
```

### U.S. / Canada Comparison Views

Examples:

```text
macro.vw_us_ca_policy_fx
macro.vw_us_ca_inflation_compare
macro.vw_us_ca_labor_compare
```

These views are intended to support future dashboarding, public visualizations, analytical reporting, and SkyWeb integration.

---

## ❄️ Future Data Warehouse and BI Direction

After SkyWeb integration, SkyServer can evolve into the source-of-truth pipeline for downstream analytics platforms.

The expected future path is:

```text
Public and private source data
        ↓
SkyServer ingestion pipelines
        ↓
PostgreSQL operational analytics layer
        ↓
SkyServer APIs and SkyWeb dashboards
        ↓
Snowflake ETL/ELT pipelines
        ↓
Curated warehouse models and BI/reporting layers
```

In this model, PostgreSQL remains the operational application database and analytics staging layer, while Snowflake becomes the long-term cloud data warehouse for larger-scale historical analysis, dimensional modeling, and BI consumption.

BI report creation can also be partially automated. SkyServer can automate the preparation of report-ready datasets, scheduled exports, semantic/reporting views, and refresh workflows. Full dashboard/report creation may depend on the chosen BI platform, but the data preparation and delivery layer can be made highly repeatable.

---

## 🌐 Application Direction

SkyServer is the private operational backend for the Sky Ecosystem.

Its long-term role is to support:

- Private admin workflows
- PostgreSQL-backed analytics
- Data ingestion and synchronization
- Script orchestration
- Backend APIs
- Worker jobs
- File and repository automation
- Future SkyWeb public-facing data views
- Future Snowflake ETL/ELT pipelines for cloud data warehousing
- Future BI/report automation using curated warehouse and reporting layers

SkyServer is not just a backend service. It is the private control layer that keeps the system structured, testable, and extensible.

---

## 🧬 Design Philosophy

> “Automation should feel like intelligence — quiet, precise, and always one step ahead.”

SkyServer is built around a few practical rules:

- Keep tools runnable from anywhere.
- Keep scripts config-driven where possible.
- Keep database builds deterministic.
- Keep ingestion idempotent.
- Keep console output useful but compact.
- Keep architecture modular before it becomes painful to change.

---

## 🗺️ Roadmap

| Phase          | Objective                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ✅ Phase 1     | Install Node.js, initialize the application, and establish npm tooling                                                         |
| ✅ Phase 2     | ESLint, Prettier, Husky, and lint-staged automation                                                                            |
| ✅ Phase 3     | PostgreSQL schema, indicator registry, migrations, seeds, views                                                                |
| ✅ Phase 4     | FRED, BoC, StatCan, and manual ingestion pipelines                                                                             |
| ✅ Phase 5     | SkyServer Core CLI Tool with configurable script launcher model                                                                |
| 🔄 Continuous  | Expand automation scripts for Git, files, database, ingestion, workers, and operational workflows                              |
| 🔄 Phase 6     | Private admin web interface under `apps/admin-web`                                                                             |
| 🔜 Phase 7     | API endpoints for macro views, ingestion status, and admin actions                                                             |
| 🔜 Phase 8     | Worker/listener workflows for scheduled and event-driven jobs                                                                  |
| 🔜 Phase 9     | SkyWeb integration for public-facing macro dashboards                                                                          |
| 🔜 Phase 10    | Data mart design and analytics-ready PostgreSQL view/model refinement for public, admin, and BI consumers                      |
| 🔜 Phase 11    | ETL/ELT pipelines from PostgreSQL into Snowflake for durable cloud data warehousing                                            |
| 🔜 Phase 12    | Snowflake warehouse models, dimensional tables, historical snapshots, and curated reporting layers                             |
| 🔜 Phase 13    | BI/report automation layer for scheduled exports, dashboard-ready datasets, and optional Power BI/Tableau/Superset integration |
| 🎯 Final Phase | Operationalize the full data path: source ingestion → PostgreSQL → SkyWeb/API → Snowflake → BI/reporting outputs               |

---

## 🧭 Repository

- **GitHub:** https://github.com/PStar1980/SkyServer
- **Primary development branch:** `dev`
- **Main branch:** `main`
- **License:** ISC
