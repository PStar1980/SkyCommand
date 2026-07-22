#!/usr/bin/env node

const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const { runToolCli } = require("../../tools/src");

const TOOL_CODE = "db_object_compare";
const OUTPUT_TYPE = "postgresql_database_comparison_summary.v1";
const SKYCOMMAND_ROOT = path.resolve(__dirname, "../../..");
const ENV_PATH = path.join(SKYCOMMAND_ROOT, ".env");
const DATABASE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const MAX_DIFFERENCE_DETAILS = Math.min(
  1000,
  Math.max(
    1,
    Number.parseInt(
      process.env.DB_COMPARE_MAX_DIFFERENCE_DETAILS || "1000",
      10,
    ) || 1000,
  ),
);

dotenv.config({ path: ENV_PATH });

const USER_SCHEMA_FILTER = `
  n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
`;

const CATALOG_QUERIES = Object.freeze([
  {
    name: "schemas",
    sql: `
      SELECT
        'schema'::text AS object_type,
        n.nspname::text AS schema_name,
        n.nspname::text AS object_name,
        ''::text AS identity,
        jsonb_build_object(
          'owner', pg_get_userbyid(n.nspowner)
        ) AS definition
      FROM pg_namespace n
      WHERE ${USER_SCHEMA_FILTER}
    `,
  },
  {
    name: "relations",
    sql: `
      SELECT
        CASE c.relkind
          WHEN 'r' THEN 'table'
          WHEN 'p' THEN 'partitioned_table'
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized_view'
          WHEN 'f' THEN 'foreign_table'
        END::text AS object_type,
        n.nspname::text AS schema_name,
        c.relname::text AS object_name,
        ''::text AS identity,
        jsonb_build_object(
          'persistence', c.relpersistence,
          'rowSecurity', c.relrowsecurity,
          'forceRowSecurity', c.relforcerowsecurity,
          'replicaIdentity', c.relreplident,
          'partitionKey', CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) ELSE NULL END,
          'viewDefinition', CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) ELSE NULL END,
          'accessMethod', am.amname,
          'options', COALESCE(to_jsonb(c.reloptions), '[]'::jsonb)
        ) AS definition
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_am am ON am.oid = c.relam
      WHERE ${USER_SCHEMA_FILTER}
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    `,
  },
  {
    name: "columns",
    sql: `
      SELECT
        'column'::text AS object_type,
        n.nspname::text AS schema_name,
        c.relname::text AS object_name,
        a.attname::text AS identity,
        jsonb_build_object(
          'ordinal', a.attnum,
          'dataType', format_type(a.atttypid, a.atttypmod),
          'notNull', a.attnotnull,
          'defaultExpression', pg_get_expr(ad.adbin, ad.adrelid, true),
          'identity', a.attidentity,
          'generated', a.attgenerated,
          'storage', a.attstorage,
          'collation', CASE
            WHEN a.attcollation = 0 THEN NULL
            ELSE quote_ident(coll_n.nspname) || '.' || quote_ident(coll.collname)
          END
        ) AS definition
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
      LEFT JOIN pg_namespace coll_n ON coll_n.oid = coll.collnamespace
      WHERE ${USER_SCHEMA_FILTER}
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND a.attnum > 0
        AND NOT a.attisdropped
    `,
  },
  {
    name: "constraints",
    sql: `
      SELECT
        'constraint'::text AS object_type,
        n.nspname::text AS schema_name,
        c.relname::text AS object_name,
        con.conname::text AS identity,
        jsonb_build_object(
          'constraintType', con.contype,
          'definition', pg_get_constraintdef(con.oid, true),
          'deferrable', con.condeferrable,
          'initiallyDeferred', con.condeferred,
          'validated', con.convalidated
        ) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${USER_SCHEMA_FILTER}
    `,
  },
  {
    name: "indexes",
    sql: `
      SELECT
        'index'::text AS object_type,
        n.nspname::text AS schema_name,
        table_class.relname::text AS object_name,
        index_class.relname::text AS identity,
        jsonb_build_object(
          'definition', pg_get_indexdef(i.indexrelid),
          'unique', i.indisunique,
          'primary', i.indisprimary,
          'valid', i.indisvalid,
          'ready', i.indisready,
          'clustered', i.indisclustered,
          'replicaIdentity', i.indisreplident
        ) AS definition
      FROM pg_index i
      JOIN pg_class table_class ON table_class.oid = i.indrelid
      JOIN pg_class index_class ON index_class.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = table_class.relnamespace
      WHERE ${USER_SCHEMA_FILTER}
    `,
  },
  {
    name: "triggers",
    sql: `
      SELECT
        'trigger'::text AS object_type,
        n.nspname::text AS schema_name,
        c.relname::text AS object_name,
        t.tgname::text AS identity,
        jsonb_build_object(
          'definition', pg_get_triggerdef(t.oid, true),
          'enabled', t.tgenabled
        ) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${USER_SCHEMA_FILTER}
        AND NOT t.tgisinternal
    `,
  },
  {
    name: "policies",
    sql: `
      SELECT
        'row_security_policy'::text AS object_type,
        n.nspname::text AS schema_name,
        c.relname::text AS object_name,
        p.polname::text AS identity,
        jsonb_build_object(
          'permissive', p.polpermissive,
          'command', p.polcmd,
          'roles', ARRAY(
            SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END
            FROM unnest(p.polroles) AS role_oid
            ORDER BY 1
          ),
          'usingExpression', pg_get_expr(p.polqual, p.polrelid, true),
          'checkExpression', pg_get_expr(p.polwithcheck, p.polrelid, true)
        ) AS definition
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${USER_SCHEMA_FILTER}
    `,
  },
  {
    name: "sequences",
    sql: `
      SELECT
        'sequence'::text AS object_type,
        n.nspname::text AS schema_name,
        c.relname::text AS object_name,
        ''::text AS identity,
        jsonb_build_object(
          'dataType', format_type(s.seqtypid, NULL),
          'start', s.seqstart,
          'increment', s.seqincrement,
          'minimum', s.seqmin,
          'maximum', s.seqmax,
          'cache', s.seqcache,
          'cycle', s.seqcycle,
          'ownedBy', (
            SELECT quote_ident(owner_n.nspname) || '.' || quote_ident(owner_c.relname) || '.' || quote_ident(owner_a.attname)
            FROM pg_depend d
            JOIN pg_class owner_c ON owner_c.oid = d.refobjid
            JOIN pg_namespace owner_n ON owner_n.oid = owner_c.relnamespace
            JOIN pg_attribute owner_a ON owner_a.attrelid = owner_c.oid AND owner_a.attnum = d.refobjsubid
            WHERE d.classid = 'pg_class'::regclass
              AND d.objid = c.oid
              AND d.deptype IN ('a', 'i')
            ORDER BY d.deptype DESC
            LIMIT 1
          )
        ) AS definition
      FROM pg_sequence s
      JOIN pg_class c ON c.oid = s.seqrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${USER_SCHEMA_FILTER}
    `,
  },
  {
    name: "routines",
    sql: `
      SELECT
        CASE p.prokind
          WHEN 'p' THEN 'procedure'
          WHEN 'w' THEN 'window_function'
          ELSE 'function'
        END::text AS object_type,
        n.nspname::text AS schema_name,
        p.proname::text AS object_name,
        pg_get_function_identity_arguments(p.oid)::text AS identity,
        jsonb_build_object(
          'definition', pg_get_functiondef(p.oid)
        ) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ${USER_SCHEMA_FILTER}
        AND p.prokind IN ('f', 'p', 'w')
    `,
  },
  {
    name: "enums",
    sql: `
      SELECT
        'enum_type'::text AS object_type,
        n.nspname::text AS schema_name,
        t.typname::text AS object_name,
        ''::text AS identity,
        jsonb_build_object(
          'labels', COALESCE(
            (
              SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
              FROM pg_enum e
              WHERE e.enumtypid = t.oid
            ),
            '[]'::jsonb
          )
        ) AS definition
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE ${USER_SCHEMA_FILTER}
        AND t.typtype = 'e'
    `,
  },
  {
    name: "domains",
    sql: `
      SELECT
        'domain_type'::text AS object_type,
        n.nspname::text AS schema_name,
        t.typname::text AS object_name,
        ''::text AS identity,
        jsonb_build_object(
          'baseType', format_type(t.typbasetype, t.typtypmod),
          'notNull', t.typnotnull,
          'defaultExpression', t.typdefault,
          'collation', CASE
            WHEN t.typcollation = 0 THEN NULL
            ELSE quote_ident(coll_n.nspname) || '.' || quote_ident(coll.collname)
          END,
          'constraints', COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', con.conname,
                  'definition', pg_get_constraintdef(con.oid, true)
                )
                ORDER BY con.conname
              )
              FROM pg_constraint con
              WHERE con.contypid = t.oid
            ),
            '[]'::jsonb
          )
        ) AS definition
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      LEFT JOIN pg_collation coll ON coll.oid = t.typcollation
      LEFT JOIN pg_namespace coll_n ON coll_n.oid = coll.collnamespace
      WHERE ${USER_SCHEMA_FILTER}
        AND t.typtype = 'd'
    `,
  },
  {
    name: "composite_types",
    sql: `
      SELECT
        'composite_type'::text AS object_type,
        n.nspname::text AS schema_name,
        t.typname::text AS object_name,
        ''::text AS identity,
        jsonb_build_object(
          'attributes', COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', a.attname,
                  'ordinal', a.attnum,
                  'dataType', format_type(a.atttypid, a.atttypmod),
                  'notNull', a.attnotnull
                )
                ORDER BY a.attnum
              )
              FROM pg_attribute a
              WHERE a.attrelid = c.oid
                AND a.attnum > 0
                AND NOT a.attisdropped
            ),
            '[]'::jsonb
          )
        ) AS definition
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_class c ON c.oid = t.typrelid AND c.relkind = 'c'
      WHERE ${USER_SCHEMA_FILTER}
    `,
  },
  {
    name: "extensions",
    sql: `
      SELECT
        'extension'::text AS object_type,
        n.nspname::text AS schema_name,
        e.extname::text AS object_name,
        ''::text AS identity,
        jsonb_build_object(
          'version', e.extversion,
          'relocatable', e.extrelocatable
        ) AS definition
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
    `,
  },
  {
    name: "event_triggers",
    sql: `
      SELECT
        'event_trigger'::text AS object_type,
        ''::text AS schema_name,
        e.evtname::text AS object_name,
        ''::text AS identity,
        jsonb_build_object(
          'event', e.evtevent,
          'enabled', e.evtenabled,
          'tags', COALESCE(to_jsonb(e.evttags), '[]'::jsonb),
          'function', e.evtfoid::regprocedure::text
        ) AS definition
      FROM pg_event_trigger e
    `,
  },
]);

function requireEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === null || value === "") {
    const error = new Error(`Missing required environment variable: ${name}`);
    error.code = "DATABASE_ENVIRONMENT_MISSING";
    throw error;
  }

  return value;
}

function normalizeDatabaseName(value, label) {
  const databaseName = String(value || "").trim();

  if (!databaseName) {
    const error = new Error(`${label} is required.`);
    error.code = "DATABASE_NAME_REQUIRED";
    throw error;
  }

  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    const error = new Error(
      `${label} must start with a letter and contain only letters, numbers, and underscores, with a maximum length of 63 characters.`,
    );
    error.code = "DATABASE_NAME_INVALID";
    throw error;
  }

  return databaseName;
}

function parseArguments(args = []) {
  const [rawDatabaseA, rawDatabaseB] = Array.isArray(args) ? args : [];

  return {
    databaseA: normalizeDatabaseName(rawDatabaseA, "databaseA"),
    databaseB: normalizeDatabaseName(rawDatabaseB, "databaseB"),
  };
}

function createPool(databaseName) {
  return new Pool({
    host: requireEnv("PGHOST"),
    port: Number(process.env.PGPORT || 5432),
    database: databaseName,
    user: requireEnv("PGUSER"),
    password: requireEnv("PGPASSWORD"),
    application_name: "skycommand_db_object_compare",
    connectionTimeoutMillis: Number(
      process.env.DB_COMPARE_CONNECTION_TIMEOUT_MS || 10000,
    ),
    statement_timeout: Number(
      process.env.DB_COMPARE_STATEMENT_TIMEOUT_MS || 120000,
    ),
    max: 2,
  });
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function normalizeCatalogRow(row) {
  const objectType = String(row.object_type || "").trim();
  const schemaName = String(row.schema_name || "").trim();
  const objectName = String(row.object_name || "").trim();
  const identity = String(row.identity || "").trim();
  const definition = stableValue(row.definition || {});
  const objectKey = [objectType, schemaName, objectName, identity].join("|");

  return {
    objectType,
    schemaName,
    objectName,
    identity,
    objectKey,
    fingerprint: sha256(stableStringify(definition)),
  };
}

async function loadDatabaseObjects(databaseName) {
  const pool = createPool(databaseName);
  const startedAt = Date.now();

  try {
    await pool.query("SELECT 1");
    const rows = [];

    for (const queryDefinition of CATALOG_QUERIES) {
      const result = await pool.query(queryDefinition.sql);
      result.rows.forEach((row) => rows.push(normalizeCatalogRow(row)));
    }

    rows.sort((left, right) => left.objectKey.localeCompare(right.objectKey));

    return {
      databaseName,
      online: true,
      durationMs: Date.now() - startedAt,
      objects: rows,
      fingerprint: sha256(
        rows.map((row) => `${row.objectKey}:${row.fingerprint}`).join("\n"),
      ),
    };
  } catch (error) {
    error.code = error.code || "DATABASE_OBJECT_LOAD_FAILED";
    error.databaseName = databaseName;
    throw error;
  } finally {
    await pool.end().catch(() => {});
  }
}

function createDifference(kind, object, counterpart = null) {
  return {
    kind,
    objectType: object.objectType,
    schemaName: object.schemaName,
    objectName: object.objectName,
    identity: object.identity,
    objectKey: object.objectKey,
    databaseAFingerprint:
      kind === "ONLY_IN_DATABASE_B" ? "" : object.fingerprint,
    databaseBFingerprint:
      kind === "ONLY_IN_DATABASE_A"
        ? ""
        : counterpart?.fingerprint || object.fingerprint,
  };
}

function createTypeSummary(
  typeName,
  databaseAObjects,
  databaseBObjects,
  differences,
) {
  const typeDifferences = differences.filter(
    (difference) => difference.objectType === typeName,
  );

  return {
    objectType: typeName,
    databaseACount: databaseAObjects.filter(
      (item) => item.objectType === typeName,
    ).length,
    databaseBCount: databaseBObjects.filter(
      (item) => item.objectType === typeName,
    ).length,
    onlyInDatabaseA: typeDifferences.filter(
      (item) => item.kind === "ONLY_IN_DATABASE_A",
    ).length,
    onlyInDatabaseB: typeDifferences.filter(
      (item) => item.kind === "ONLY_IN_DATABASE_B",
    ).length,
    definitionMismatches: typeDifferences.filter(
      (item) => item.kind === "DEFINITION_MISMATCH",
    ).length,
  };
}

function compareObjectSets(databaseAResult, databaseBResult) {
  const databaseAMap = new Map(
    databaseAResult.objects.map((object) => [object.objectKey, object]),
  );
  const databaseBMap = new Map(
    databaseBResult.objects.map((object) => [object.objectKey, object]),
  );
  const allKeys = [
    ...new Set([...databaseAMap.keys(), ...databaseBMap.keys()]),
  ].sort();
  const differences = [];
  let matchedCount = 0;

  allKeys.forEach((objectKey) => {
    const objectA = databaseAMap.get(objectKey) || null;
    const objectB = databaseBMap.get(objectKey) || null;

    if (!objectA) {
      differences.push(createDifference("ONLY_IN_DATABASE_B", objectB));
      return;
    }

    if (!objectB) {
      differences.push(createDifference("ONLY_IN_DATABASE_A", objectA));
      return;
    }

    if (objectA.fingerprint !== objectB.fingerprint) {
      differences.push(
        createDifference("DEFINITION_MISMATCH", objectA, objectB),
      );
      return;
    }

    matchedCount += 1;
  });

  const allTypes = [
    ...new Set([
      ...databaseAResult.objects.map((item) => item.objectType),
      ...databaseBResult.objects.map((item) => item.objectType),
    ]),
  ].sort();
  const detailRows = differences.slice(0, MAX_DIFFERENCE_DETAILS);

  return {
    databasesMatch: differences.length === 0,
    matchedCount,
    onlyInDatabaseACount: differences.filter(
      (difference) => difference.kind === "ONLY_IN_DATABASE_A",
    ).length,
    onlyInDatabaseBCount: differences.filter(
      (difference) => difference.kind === "ONLY_IN_DATABASE_B",
    ).length,
    definitionMismatchCount: differences.filter(
      (difference) => difference.kind === "DEFINITION_MISMATCH",
    ).length,
    totalDifferenceCount: differences.length,
    differenceDetailsReturned: detailRows.length,
    differenceDetailsTruncated: detailRows.length < differences.length,
    byType: allTypes.map((typeName) =>
      createTypeSummary(
        typeName,
        databaseAResult.objects,
        databaseBResult.objects,
        differences,
      ),
    ),
    differences: detailRows,
  };
}

async function executeDatabaseComparison(args = []) {
  const startedAt = Date.now();
  const { databaseA, databaseB } = parseArguments(args);

  console.log(`[SkyCommand DB Compare] Env file: ${ENV_PATH}`);
  console.log(
    `[SkyCommand DB Compare] Server: ${requireEnv("PGUSER")}@${requireEnv("PGHOST")}:${process.env.PGPORT || 5432}`,
  );
  console.log(`[SkyCommand DB Compare] Database A: ${databaseA}`);
  console.log(`[SkyCommand DB Compare] Database B: ${databaseB}`);
  console.log(
    "[SkyCommand DB Compare] Loading migration-relevant PostgreSQL object catalogues...",
  );

  const [databaseAResult, databaseBResult] = await Promise.all([
    loadDatabaseObjects(databaseA),
    loadDatabaseObjects(databaseB),
  ]);
  const comparison = compareObjectSets(databaseAResult, databaseBResult);

  return {
    comparedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    comparisonCompleted: true,
    databasesOnline: true,
    databasesMatch: comparison.databasesMatch,
    status: comparison.databasesMatch ? "MATCH" : "DIFFERENT",
    databaseA,
    databaseB,
    databaseAFingerprint: databaseAResult.fingerprint,
    databaseBFingerprint: databaseBResult.fingerprint,
    databaseAObjectCount: databaseAResult.objects.length,
    databaseBObjectCount: databaseBResult.objects.length,
    matchedObjectCount: comparison.matchedCount,
    onlyInDatabaseACount: comparison.onlyInDatabaseACount,
    onlyInDatabaseBCount: comparison.onlyInDatabaseBCount,
    definitionMismatchCount: comparison.definitionMismatchCount,
    totalDifferenceCount: comparison.totalDifferenceCount,
    differenceDetailsReturned: comparison.differenceDetailsReturned,
    differenceDetailsTruncated: comparison.differenceDetailsTruncated,
    byType: comparison.byType,
    differences: comparison.differences,
  };
}

function createDatabaseComparisonToolResult(result) {
  const warnings = result.differenceDetailsTruncated
    ? [
        {
          code: "DATABASE_DIFFERENCE_DETAILS_TRUNCATED",
          message: `Only ${result.differenceDetailsReturned} of ${result.totalDifferenceCount} difference detail rows were returned.`,
        },
      ]
    : [];

  return {
    schemaVersion: "1.0",
    success: true,
    message: result.databasesMatch
      ? `${result.databaseA} and ${result.databaseB} contain matching PostgreSQL object definitions.`
      : `${result.databaseA} and ${result.databaseB} differ by ${result.totalDifferenceCount} PostgreSQL object(s).`,
    outputType: OUTPUT_TYPE,
    output: result,
    warnings,
    error: null,
    metadata: {
      comparisonScope: "migration_relevant_catalogue_objects",
    },
  };
}

function createDatabaseComparisonFailureToolResult(error) {
  const rawArgs = process.argv.slice(2);

  return {
    schemaVersion: "1.0",
    success: false,
    message: error?.message || "PostgreSQL database object comparison failed.",
    outputType: OUTPUT_TYPE,
    output: {
      comparedAt: new Date().toISOString(),
      durationMs: 0,
      comparisonCompleted: false,
      databasesOnline: false,
      databasesMatch: false,
      status: "FAILED",
      databaseA: String(rawArgs[0] || error?.databaseName || ""),
      databaseB: String(rawArgs[1] || ""),
      databaseAFingerprint: "",
      databaseBFingerprint: "",
      databaseAObjectCount: 0,
      databaseBObjectCount: 0,
      matchedObjectCount: 0,
      onlyInDatabaseACount: 0,
      onlyInDatabaseBCount: 0,
      definitionMismatchCount: 0,
      totalDifferenceCount: 0,
      differenceDetailsReturned: 0,
      differenceDetailsTruncated: false,
      byType: [],
      differences: [],
    },
    warnings: [],
    error: {
      code: error?.code || "DATABASE_OBJECT_COMPARE_FAILED",
      message:
        error?.message || "PostgreSQL database object comparison failed.",
      details: error?.databaseName ? { databaseName: error.databaseName } : {},
    },
    metadata: {},
  };
}

function renderDatabaseComparison(result) {
  console.log(
    `[SkyCommand DB Compare] ${result.databaseA}: ${result.databaseAObjectCount} object(s), fingerprint ${result.databaseAFingerprint}`,
  );
  console.log(
    `[SkyCommand DB Compare] ${result.databaseB}: ${result.databaseBObjectCount} object(s), fingerprint ${result.databaseBFingerprint}`,
  );

  if (result.databasesMatch) {
    console.log(
      `[SkyCommand DB Compare] MATCH: all ${result.matchedObjectCount} compared objects are equivalent.`,
    );
    return;
  }

  console.log(
    `[SkyCommand DB Compare] DIFFERENT: ${result.totalDifferenceCount} difference(s) (${result.onlyInDatabaseACount} only in ${result.databaseA}, ${result.onlyInDatabaseBCount} only in ${result.databaseB}, ${result.definitionMismatchCount} definition mismatch(es)).`,
  );

  result.differences.forEach((difference) => {
    const identitySuffix = difference.identity
      ? ` [${difference.identity}]`
      : "";
    console.log(
      `[SkyCommand DB Compare] ${difference.kind}: ${difference.objectType} ${difference.schemaName ? `${difference.schemaName}.` : ""}${difference.objectName}${identitySuffix}`,
    );
  });

  if (result.differenceDetailsTruncated) {
    console.log(
      `[SkyCommand DB Compare] Difference display truncated to ${result.differenceDetailsReturned} row(s).`,
    );
  }
}

async function main() {
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: OUTPUT_TYPE,
    execute: executeDatabaseComparison,
    createToolResult: createDatabaseComparisonToolResult,
    createFailureToolResult: createDatabaseComparisonFailureToolResult,
    renderConsole: renderDatabaseComparison,
    // A completed comparison is an execution success even when the databases differ.
    // Workflow conditions should branch on output.databasesMatch.
    shouldFailProcess: () => false,
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  CATALOG_QUERIES,
  compareObjectSets,
  createDatabaseComparisonFailureToolResult,
  createDatabaseComparisonToolResult,
  executeDatabaseComparison,
  loadDatabaseObjects,
  main,
  normalizeCatalogRow,
  normalizeDatabaseName,
  parseArguments,
  renderDatabaseComparison,
  sha256,
  stableStringify,
};
