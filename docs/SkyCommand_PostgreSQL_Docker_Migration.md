# SkyCommand PostgreSQL Docker Migration

## Purpose

PostgreSQL is the final stateful SkyCommand service moving from the Windows host into Docker. Unlike Web/API/worker relocation, the database move is handled as a blue/green migration with a shadow database, durable backup, catalogue parity, CLI acceptance, and a later explicit cutover.

This document describes the **pre-cutover stage only**. Running these commands does not switch SkyCommand application services away from the existing Windows PostgreSQL server.

## Pre-cutover topology

```text
Current production-like local runtime

Docker Web/API/Workers/Temporal
             |
             +----> Windows PostgreSQL :5432   (still authoritative)

Shadow acceptance lane

Host SkyCommand_Core / parity tools
             |
             +----> Docker PostgreSQL :55432   (candidate clone)
```

The Docker candidate uses the official PostgreSQL 18.6 Debian image and a named `skycommand_postgres_data` volume. PostgreSQL 18 uses `/var/lib/postgresql` as the image volume boundary, so the Compose mount intentionally targets that path.

## Environment

Keep the existing source connection unchanged:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=skyserver_dev
PGUSER=postgres
PGPASSWORD=<existing password>
```

Add or retain the migration-lane settings:

```env
SKYCOMMAND_POSTGRES_IMAGE=postgres:18.6-bookworm
SKYCOMMAND_POSTGRES_HOST_PORT=55432
SKYCOMMAND_POSTGRES_SOURCE_PORT=5432
# Optional. When blank, backups are written under ~/.skycommand/backups/postgres.
SKYCOMMAND_POSTGRES_BACKUP_DIR=
```

The candidate port intentionally differs from `5432`. This lets the Windows database and Docker database run simultaneously for acceptance and provides a clean rollback boundary.

## Stage the shadow database

Run:

```powershell
npm run db:docker:stage
```

The command performs the following sequence:

1. Starts/health-checks the Docker PostgreSQL candidate.
2. Uses PostgreSQL 18 `pg_dump` to take a consistent custom-format snapshot of the current Windows `PGDATABASE`.
3. Writes the snapshot outside the repository under `~/.skycommand/backups/postgres` unless `SKYCOMMAND_POSTGRES_BACKUP_DIR` overrides it.
4. Recreates the candidate database using the Docker cluster locale and UTF-8 encoding.
5. Restores the exact snapshot with `pg_restore --no-owner --no-acl --exit-on-error`.
6. Runs `ANALYZE`.
7. Executes the critical tool/workflow parity verifier.

The source database is never dropped or modified by this operation.

## Tool and workflow parity

Run independently at any time while both databases are online:

```powershell
npm run db:docker:parity
```

The verifier compares row counts and content hashes for the PostgreSQL-authoritative configuration needed by tools and workflows, including:

- applications, configuration profiles, repositories, and repository paths;
- runtimes, parameter types, option sources, risk levels, and visibility channels;
- tool categories, visibility, tools, tool parameters, and static options;
- workflow node types, definitions, versions, nodes, and edges.

It also compares the ordered tool and workflow catalogue projections. Any mismatch exits non-zero and means **do not cut over**.

The initial stage is a point-in-time snapshot. If tools/workflows are edited afterward, rerun `npm run db:docker:stage` before the eventual cutover so the candidate contains the latest authoritative configuration.

## SkyCommand_Core pre-cutover acceptance

The CLI remains intentionally host-run. This is analogous to an operator client: it can connect to containerized services through their localhost-published ports while retaining access to Windows-only tools and `DEV_LOCAL` repository paths.

First run the non-interactive check:

```powershell
npm run core:docker-db:check
```

This verifies that the shadow database exposes CLI-visible tools, active published workflows, both `DEV_LOCAL` and `DOCKER_LOCAL` repository profiles, and that Temporal's published `localhost:7233` port is reachable.

Then launch the actual CLI against the candidate:

```powershell
npm run core:docker-db
```

Pre-cutover candidate mode deliberately uses:

```text
Database     127.0.0.1:55432
Repo profile DEV_LOCAL
Workflow     inline executor only
Temporal     localhost:7233 is checked, but not used for candidate workflow execution yet
```

Inline-only workflow execution is a safety boundary. The live Docker Temporal worker still points to the Windows database during this stage; allowing the candidate CLI to submit a Temporal run would split one execution across two PostgreSQL databases.

Good acceptance choices are read-only or reversible Node-backed tools and a non-Git workflow such as Database Synchronization Test. Avoid Development Promotion while validating the candidate database unless you intentionally want Git changes.

After the final database cutover, normal `npm run core` can return to the Temporal executor because the CLI and Docker workers will then share the same Docker PostgreSQL database.

## Database build portability

`db_build.js` no longer hard-codes the Windows-only `English_Canada.1252` locale. New database builds use `template0` and the PostgreSQL cluster's locale by default. Operators can still opt into explicit locale settings with `DB_BUILD_LC_COLLATE`, `DB_BUILD_LC_CTYPE`, and `DB_BUILD_LOCALE_PROVIDER` when required.

This makes the database build tool usable against both Windows PostgreSQL and Linux/Docker PostgreSQL.

## Useful commands

```powershell
npm run db:docker:up
npm run db:docker:status
npm run db:docker:logs
npm run db:docker:backup
npm run db:docker:stage
npm run db:docker:parity
npm run core:docker-db:check
npm run core:docker-db
```

To stop only the candidate database:

```powershell
npm run db:docker:stop
```

Stopping the candidate does not affect the current SkyCommand runtime because the application containers still point to host PostgreSQL during this stage.

## Cutover boundary

Do not stop Windows PostgreSQL or change application `PGHOST` settings during this pre-cutover slice.

The next slice will perform the actual switch only after:

- a fresh final snapshot has been staged;
- tool/workflow parity is green;
- SkyCommand_Core acceptance is green;
- the candidate survives restart/persistence checks.

The cutover will then point Docker API/workers directly to `postgres:5432` on the Compose network, update host CLI connectivity to the published candidate port, cold-start the stack, and prove rollback/recovery before the Windows PostgreSQL service is retired.
