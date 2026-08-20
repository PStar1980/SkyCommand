# SkyCommand PostgreSQL Docker Migration

## Purpose

PostgreSQL is the final stateful SkyCommand service moving from the Windows host into Docker. The migration is intentionally handled as a blue/green database cutover rather than a simple container start.

The process keeps the existing Windows PostgreSQL instance available as a short-lived rollback source while the Docker candidate is staged, accepted, cut over, cold-restarted, backed up, and finalized.

## Topology

### Pre-cutover

```text
Docker Web/API/Workers/Temporal
             |
             +----> Windows PostgreSQL :5432   (authoritative)

Host SkyCommand_Core / parity tools
             |
             +----> Docker PostgreSQL :55432   (shadow candidate)
```

### Post-cutover

```text
Browser
  |
Docker Web :15171
  |
Docker API :7171
  |
  +----> Docker PostgreSQL postgres:5432
  +----> Docker Temporal :7233
             |
             +----> Docker Temporal Worker

Docker Node Worker ------> Docker PostgreSQL postgres:5432

Host SkyCommand_Core / CLI / host tools
             |
             +----> 127.0.0.1:55432 -> Docker PostgreSQL :5432

Windows PostgreSQL :5432 remains untouched during immediate acceptance/rollback,
then can be stopped after persistence and final backup are proven.
```

The Docker candidate uses the official PostgreSQL 18.6 Debian image and the stable named volume `skycommand_postgres_data` mounted at `/var/lib/postgresql`.

## Environment contract

Before cutover, keep the source connection unchanged:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=skyserver_dev
PGUSER=postgres
PGPASSWORD=<existing password>

SKYCOMMAND_POSTGRES_IMAGE=postgres:18.6-bookworm
SKYCOMMAND_POSTGRES_HOST_PORT=55432
SKYCOMMAND_POSTGRES_SOURCE_PORT=5432
SKYCOMMAND_DATABASE_HOST=host.docker.internal
SKYCOMMAND_DATABASE_PORT=5432
```

`SKYCOMMAND_DATABASE_HOST` / `SKYCOMMAND_DATABASE_PORT` are the Compose-side database connection switch. Before cutover they resolve API/workers to the Windows host database. The cutover command changes them to:

```env
SKYCOMMAND_DATABASE_HOST=postgres
SKYCOMMAND_DATABASE_PORT=5432
```

At the same time, host-side clients are moved to the candidate's published port:

```env
PGHOST=127.0.0.1
PGPORT=55432
```

This means normal host commands such as `npm run core`, `npm run db:health`, and other repository tools continue to work after cutover without requiring Windows PostgreSQL on port 5432.

## Shadow staging and parity

The pre-cutover staging lane remains available:

```powershell
npm run db:docker:stage
npm run db:docker:parity
npm run core:docker-db:check
npm run core:docker-db
```

`db:docker:stage`:

1. starts/health-checks the Docker PostgreSQL candidate;
2. takes a custom-format `pg_dump` snapshot of the Windows source;
3. stores the dump outside the repository under `~/.skycommand/backups/postgres` unless overridden;
4. recreates the candidate database with the Docker cluster locale and UTF-8;
5. restores with `pg_restore --no-owner --no-acl --exit-on-error`;
6. runs `ANALYZE`;
7. requires critical tool/workflow parity.

The parity verifier compares row counts and semantic content hashes for the authoritative repository/tool/workflow configuration. Both source and candidate sessions are canonicalized to UTC before hashing so Windows/Linux `TIMESTAMPTZ` rendering cannot create false mismatches.

## Controlled cutover

Run the actual cutover only when:

- `db:docker:parity` is green;
- `core:docker-db:check` is green;
- SkyCommand_Core has been exercised against the candidate;
- there are no intended active workflows.

Then run:

```powershell
npm run db:docker:cutover
```

The cutover command performs this sequence:

1. starts/health-checks the Docker candidate;
2. prebuilds Web/API/worker images **before** the write freeze to reduce functional downtime;
3. verifies that the source workflow ledger has no `QUEUED` or `RUNNING` workflow runs;
4. stops Web, API, Node Worker, and Temporal Worker so no new application writes can reach the Windows source;
5. verifies the source workflow ledger is still quiescent;
6. takes a fresh final Windows PostgreSQL backup;
7. recreates/restores the Docker candidate from that final snapshot;
8. requires tool/workflow parity again;
9. runs the SkyCommand_Core candidate compatibility check again;
10. saves the current `.env` outside the repository;
11. switches host clients to `127.0.0.1:55432` and Docker services to `postgres:5432`;
12. starts the full six-service Docker runtime;
13. verifies the host-published database, API health, API database health, candidate PostgreSQL version, and Temporal connectivity.

If the cutover fails **after** the environment switch, the helper automatically restores the pre-cutover `.env` and restarts the application services against the Windows source.

On success, Windows PostgreSQL remains running on `5432` only as a short-lived rollback fallback. Do not continue using it for application writes after the Docker cutover succeeds.

## Runtime cutover check

At any time after cutover:

```powershell
npm run db:docker:cutover:check
```

The check requires:

- Docker services configured for `postgres:5432`;
- host tools configured for the published candidate port;
- direct PostgreSQL connectivity;
- healthy `/_health` and `/_db/health` API contracts;
- matching database/version between host-published PostgreSQL and the Docker API;
- published Temporal port reachability.

## Immediate rollback

If a problem is discovered immediately after cutover and before Docker PostgreSQL has accumulated changes that must be preserved:

```powershell
npm run db:docker:rollback
```

Rollback:

1. stops application writers;
2. restores the pre-cutover `.env` backup;
3. restarts the Docker application services against Windows PostgreSQL.

**Important:** rollback does not reverse-copy post-cutover Docker writes into Windows PostgreSQL. Once the Docker database has accepted meaningful new state, use backups/recovery rather than a blind rollback.

## Persistence proof

After UI/CLI acceptance is green, prove that the named PostgreSQL volume survives a cold application/database restart:

```powershell
npm run db:docker:persistence
```

This command:

1. verifies the active Docker database runtime;
2. creates a Docker-active custom-format backup;
3. stops Web, API, Node Worker, Temporal Worker, Temporal, and PostgreSQL;
4. restarts the complete six-service stack from the persistent volumes;
5. reruns the cutover verification.

A passing persistence proof demonstrates that the database state is not tied to a disposable container instance.

## Finalize

After the persistence proof and final UI/CLI acceptance:

```powershell
npm run db:docker:finalize
```

Finalize performs one more runtime check and creates a fresh Docker-active backup. After it passes, the old Windows PostgreSQL service can be stopped/disabled.

The final backup path and cutover state are recorded under the PostgreSQL backup directory. No passwords are written to the cutover marker.

## Backup behavior

Before cutover:

```powershell
npm run db:docker:backup
```

backs up the Windows source.

After cutover, the same command automatically backs up the active Docker PostgreSQL database.

Backups remain outside the repository by default:

```text
~/.skycommand/backups/postgres
```

## Full Docker runtime

After cutover, the normal stack command includes PostgreSQL:

```powershell
npm run skycommand:docker:up
npm run skycommand:docker:status
npm run skycommand:docker:logs
npm run skycommand:docker:stop
```

The resulting runtime is:

```text
skycommand
├── postgres
├── temporal
├── temporal-worker
├── node-worker
├── api
└── web
```

PostgreSQL remains published on `127.0.0.1:55432` for local operator tools/CLI while application containers use the internal Compose service name `postgres:5432`.

## Database build portability

`db_build.js` does not hard-code the Windows-only `English_Canada.1252` locale. New databases use `template0` and the active PostgreSQL cluster locale unless explicit `DB_BUILD_LC_COLLATE`, `DB_BUILD_LC_CTYPE`, or `DB_BUILD_LOCALE_PROVIDER` values are provided.
