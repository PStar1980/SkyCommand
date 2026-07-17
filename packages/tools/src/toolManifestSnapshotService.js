const path = require('path');

const {
  ToolManifestContractError,
  getSkyServerRoot,
} = require('./toolManifestContract');
const {
  assertRegisteredToolMatchesManifest,
  getToolManifestRegistry,
} = require('./toolManifestRegistry');

const TOOL_MANIFEST_VALIDATOR_VERSION = 'phase14.6-v1';
const SNAPSHOT_STATUS = Object.freeze({
  VALID: 'VALID',
  DRIFTED: 'DRIFTED',
  INVALID: 'INVALID',
  MISSING: 'MISSING',
  SUPERSEDED: 'SUPERSEDED',
  UNSNAPSHOTTED: 'UNSNAPSHOTTED',
  UNREGISTERED: 'UNREGISTERED',
});

class ToolManifestSnapshotError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ToolManifestSnapshotError';
    this.code = code;
    this.details = details;
  }
}

function normalizeRepositoryRelativePath(repositoryRoot, absolutePath) {
  const relativePath = path.relative(path.resolve(repositoryRoot), path.resolve(absolutePath));
  return relativePath.replace(/\\/g, '/');
}

function normalizeHash(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function normalizeBoolean(value) {
  return value === true;
}

function getRegisteredToolCode(tool) {
  return String(tool?.tool_code || tool?.toolCode || '').trim();
}

function getRegisteredToolId(tool) {
  return tool?.tool_id || tool?.toolId || null;
}

function getRegisteredToolRepoId(tool) {
  return tool?.script_repo_id || tool?.scriptRepoId || tool?.source_repo_id || tool?.sourceRepoId || null;
}

function buildManifestSnapshotCandidate({
  loadedManifest,
  registeredTool,
  validatorVersion = TOOL_MANIFEST_VALIDATOR_VERSION,
} = {}) {
  if (!loadedManifest?.manifest) {
    throw new ToolManifestSnapshotError(
      'TOOL_MANIFEST_SNAPSHOT_MANIFEST_REQUIRED',
      'A validated loaded manifest is required to build a snapshot candidate.',
    );
  }

  if (!registeredTool) {
    throw new ToolManifestSnapshotError(
      'TOOL_MANIFEST_SNAPSHOT_REGISTERED_TOOL_REQUIRED',
      `Registered tool metadata is required for ${loadedManifest.manifest.toolCode}.`,
      { toolCode: loadedManifest.manifest.toolCode },
    );
  }

  assertRegisteredToolMatchesManifest(registeredTool, loadedManifest);

  const toolId = getRegisteredToolId(registeredTool);
  const sourceRepoId = getRegisteredToolRepoId(registeredTool);

  if (!toolId || !sourceRepoId) {
    throw new ToolManifestSnapshotError(
      'TOOL_MANIFEST_SNAPSHOT_TOOL_IDENTITY_REQUIRED',
      `Registered tool ${loadedManifest.manifest.toolCode} is missing tool_id or script_repo_id.`,
      { toolCode: loadedManifest.manifest.toolCode, toolId, sourceRepoId },
    );
  }

  const { manifest, hashes, repositoryRoot, manifestPath } = loadedManifest;

  return {
    toolId,
    sourceRepoId,
    toolCode: manifest.toolCode,
    manifestVersion: manifest.manifestVersion,
    manifestPath: normalizeRepositoryRelativePath(repositoryRoot, manifestPath),
    runtimeType: manifest.runtime.type,
    entrypointPath: manifest.runtime.entrypoint,
    outputType: manifest.resultContract.outputType,
    resultRequired: normalizeBoolean(manifest.resultContract.required),
    manifestHash: normalizeHash(hashes.manifest),
    entrypointHash: normalizeHash(hashes.entrypoint),
    outputSchemaHash: normalizeHash(hashes.outputSchema),
    contractSampleHash: normalizeHash(hashes.sample),
    validatorVersion: String(validatorVersion || TOOL_MANIFEST_VALIDATOR_VERSION),
    manifestSnapshot: manifest,
  };
}

function getSnapshotDrift(snapshot, candidate) {
  if (!snapshot) {
    return {
      status: SNAPSHOT_STATUS.UNSNAPSHOTTED,
      drifted: true,
      mismatches: [{ field: 'snapshot', snapshot: null, repository: 'present' }],
    };
  }

  if (!candidate) {
    return {
      status: SNAPSHOT_STATUS.MISSING,
      drifted: true,
      mismatches: [{ field: 'manifest', snapshot: 'present', repository: null }],
    };
  }

  const fieldPairs = [
    ['manifestVersion', 'manifest_version'],
    ['manifestPath', 'manifest_path'],
    ['runtimeType', 'runtime_type'],
    ['entrypointPath', 'entrypoint_path'],
    ['outputType', 'output_type'],
    ['resultRequired', 'result_required'],
    ['manifestHash', 'manifest_hash'],
    ['entrypointHash', 'entrypoint_hash'],
    ['outputSchemaHash', 'output_schema_hash'],
    ['contractSampleHash', 'contract_sample_hash'],
  ];
  const mismatches = [];

  fieldPairs.forEach(([candidateField, snapshotField]) => {
    const candidateValue = candidate[candidateField] ?? null;
    const snapshotValue = snapshot[snapshotField] ?? snapshot[candidateField] ?? null;

    if (candidateValue !== snapshotValue) {
      mismatches.push({
        field: snapshotField,
        snapshot: snapshotValue,
        repository: candidateValue,
      });
    }
  });

  return {
    status: mismatches.length > 0 ? SNAPSHOT_STATUS.DRIFTED : SNAPSHOT_STATUS.VALID,
    drifted: mismatches.length > 0,
    mismatches,
  };
}

function buildSnapshotReportRow({ loadedManifest, registeredTool, snapshot = null } = {}) {
  const toolCode = loadedManifest?.manifest?.toolCode || getRegisteredToolCode(registeredTool);

  if (!registeredTool) {
    return {
      toolCode,
      status: SNAPSHOT_STATUS.UNREGISTERED,
      drifted: true,
      snapshotId: null,
      registryDrift: true,
      mismatches: [{ field: 'core.tools', database: null, repository: 'present' }],
    };
  }

  let candidate;

  try {
    candidate = buildManifestSnapshotCandidate({ loadedManifest, registeredTool });
  } catch (error) {
    if (error instanceof ToolManifestContractError || error instanceof ToolManifestSnapshotError) {
      return {
        toolCode,
        status: SNAPSHOT_STATUS.DRIFTED,
        drifted: true,
        snapshotId: snapshot?.tool_manifest_snapshot_id || snapshot?.toolManifestSnapshotId || null,
        registryDrift: true,
        mismatches: error.details?.mismatches || [
          {
            field: 'registered_tool',
            errorCode: error.code,
            message: error.message,
          },
        ],
      };
    }

    throw error;
  }

  const drift = getSnapshotDrift(snapshot, candidate);

  return {
    toolCode,
    toolId: candidate.toolId,
    status: drift.status,
    drifted: drift.drifted,
    snapshotId: snapshot?.tool_manifest_snapshot_id || snapshot?.toolManifestSnapshotId || null,
    registryDrift: false,
    manifestVersion: candidate.manifestVersion,
    manifestPath: candidate.manifestPath,
    outputType: candidate.outputType,
    manifestHash: candidate.manifestHash,
    entrypointHash: candidate.entrypointHash,
    mismatches: drift.mismatches,
    candidate,
  };
}

async function loadRegisteredTools(db, toolCodes) {
  const result = await db.query(
    `
      SELECT
        tool.tool_id,
        tool.tool_code,
        tool.label,
        tool.script_repo_id,
        tool.script_path,
        tool.runtime_code,
        tool.permission_code,
        tool.risk_code,
        tool.requires_confirmation,
        tool.confirmation_text,
        tool.captures_output,
        tool.allow_params,
        tool.enabled,
        category.category_code,
        application.app_code,
        repository.repo_code
      FROM core.tools tool
      JOIN core.tool_categories category
        ON category.category_id = tool.category_id
      JOIN core.applications application
        ON application.app_id = category.app_id
      JOIN core.repositories repository
        ON repository.repo_id = tool.script_repo_id
      WHERE tool.tool_code = ANY($1::text[])
      ORDER BY tool.tool_code
    `,
    [toolCodes],
  );

  return result.rows;
}

async function loadCurrentSnapshots(db, toolIds) {
  if (toolIds.length === 0) {
    return [];
  }

  const result = await db.query(
    `
      SELECT *
      FROM core.tool_manifest_snapshots
      WHERE tool_id = ANY($1::uuid[])
        AND is_current = TRUE
      ORDER BY tool_id
    `,
    [toolIds],
  );

  return result.rows;
}

async function buildToolManifestSnapshotPreview({
  db,
  repositoryRoot = getSkyServerRoot(),
  forceReload = true,
} = {}) {
  if (!db?.query) {
    throw new ToolManifestSnapshotError(
      'TOOL_MANIFEST_SNAPSHOT_DB_REQUIRED',
      'A database client with query() is required.',
    );
  }

  const registry = getToolManifestRegistry({ repositoryRoot, forceReload });
  const toolCodes = registry.manifests.map(({ manifest }) => manifest.toolCode);
  const registeredTools = await loadRegisteredTools(db, toolCodes);
  const registeredByCode = new Map(registeredTools.map((tool) => [tool.tool_code, tool]));
  const toolIds = registeredTools.map((tool) => tool.tool_id);
  const snapshots = await loadCurrentSnapshots(db, toolIds);
  const snapshotsByToolId = new Map(snapshots.map((snapshot) => [snapshot.tool_id, snapshot]));
  const tools = registry.manifests.map((loadedManifest) => {
    const registeredTool = registeredByCode.get(loadedManifest.manifest.toolCode) || null;
    const snapshot = registeredTool ? snapshotsByToolId.get(registeredTool.tool_id) || null : null;
    return buildSnapshotReportRow({ loadedManifest, registeredTool, snapshot });
  });

  return {
    generatedAt: new Date().toISOString(),
    repositoryRoot: registry.repositoryRoot,
    manifestCount: registry.manifests.length,
    registeredCount: registeredTools.length,
    validCount: tools.filter((tool) => tool.status === SNAPSHOT_STATUS.VALID).length,
    unsnapshottedCount: tools.filter((tool) => tool.status === SNAPSHOT_STATUS.UNSNAPSHOTTED).length,
    driftedCount: tools.filter((tool) => tool.status === SNAPSHOT_STATUS.DRIFTED).length,
    unregisteredCount: tools.filter((tool) => tool.status === SNAPSHOT_STATUS.UNREGISTERED).length,
    tools,
  };
}

async function syncToolManifestSnapshots({ db, repositoryRoot = getSkyServerRoot() } = {}) {
  const preview = await buildToolManifestSnapshotPreview({ db, repositoryRoot, forceReload: true });
  const blocked = preview.tools.filter((tool) =>
    tool.status === SNAPSHOT_STATUS.UNREGISTERED || tool.registryDrift === true);

  if (blocked.length > 0) {
    throw new ToolManifestSnapshotError(
      'TOOL_MANIFEST_SNAPSHOT_SYNC_BLOCKED',
      `${blocked.length} manifest-backed tool(s) cannot be snapshotted until registry drift is resolved.`,
      {
        tools: blocked.map((tool) => ({
          toolCode: tool.toolCode,
          status: tool.status,
          mismatches: tool.mismatches,
        })),
      },
    );
  }

  const synced = [];

  for (const tool of preview.tools) {
    const candidate = tool.candidate;

    await db.query(
      `
        UPDATE core.tool_manifest_snapshots
        SET is_current = FALSE,
            validation_status = 'SUPERSEDED',
            superseded_at = COALESCE(superseded_at, CURRENT_TIMESTAMP),
            last_checked_at = CURRENT_TIMESTAMP,
            validation_details = jsonb_build_object(
              'reason', 'superseded_by_manifest_snapshot_sync',
              'supersededByManifestHash', $2::text
            )
        WHERE tool_id = $1::uuid
          AND is_current = TRUE
          AND (manifest_hash <> $2::text OR entrypoint_hash <> $3::text)
      `,
      [candidate.toolId, candidate.manifestHash, candidate.entrypointHash],
    );

    const result = await db.query(
      `
        INSERT INTO core.tool_manifest_snapshots (
          tool_id,
          source_repo_id,
          manifest_version,
          manifest_path,
          runtime_type,
          entrypoint_path,
          output_type,
          result_required,
          manifest_hash,
          entrypoint_hash,
          output_schema_hash,
          contract_sample_hash,
          validator_version,
          validation_status,
          validation_details,
          manifest_snapshot,
          is_current,
          registered_at,
          validated_at,
          last_checked_at,
          superseded_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::text,
          $4::text,
          $5::text,
          $6::text,
          $7::text,
          $8::boolean,
          $9::text,
          $10::text,
          $11::text,
          $12::text,
          $13::text,
          'VALID',
          '{}'::jsonb,
          $14::jsonb,
          TRUE,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          NULL
        )
        ON CONFLICT (tool_id, manifest_hash, entrypoint_hash)
        DO UPDATE SET
          source_repo_id = EXCLUDED.source_repo_id,
          manifest_version = EXCLUDED.manifest_version,
          manifest_path = EXCLUDED.manifest_path,
          runtime_type = EXCLUDED.runtime_type,
          entrypoint_path = EXCLUDED.entrypoint_path,
          output_type = EXCLUDED.output_type,
          result_required = EXCLUDED.result_required,
          output_schema_hash = EXCLUDED.output_schema_hash,
          contract_sample_hash = EXCLUDED.contract_sample_hash,
          validator_version = EXCLUDED.validator_version,
          validation_status = 'VALID',
          validation_details = '{}'::jsonb,
          manifest_snapshot = EXCLUDED.manifest_snapshot,
          is_current = TRUE,
          validated_at = CURRENT_TIMESTAMP,
          last_checked_at = CURRENT_TIMESTAMP,
          superseded_at = NULL
        RETURNING
          tool_manifest_snapshot_id,
          tool_id,
          manifest_hash,
          entrypoint_hash,
          validation_status,
          is_current,
          registered_at,
          last_checked_at
      `,
      [
        candidate.toolId,
        candidate.sourceRepoId,
        candidate.manifestVersion,
        candidate.manifestPath,
        candidate.runtimeType,
        candidate.entrypointPath,
        candidate.outputType,
        candidate.resultRequired,
        candidate.manifestHash,
        candidate.entrypointHash,
        candidate.outputSchemaHash,
        candidate.contractSampleHash,
        candidate.validatorVersion,
        JSON.stringify(candidate.manifestSnapshot),
      ],
    );

    synced.push({ toolCode: tool.toolCode, ...result.rows[0] });
  }

  return {
    status: 'SYNCED',
    syncedAt: new Date().toISOString(),
    manifestCount: preview.manifestCount,
    tools: synced,
  };
}

async function checkToolManifestSnapshots({
  db,
  repositoryRoot = getSkyServerRoot(),
  persistStatus = true,
} = {}) {
  const preview = await buildToolManifestSnapshotPreview({ db, repositoryRoot, forceReload: true });

  if (persistStatus) {
    for (const tool of preview.tools) {
      if (!tool.snapshotId) {
        continue;
      }

      const persistedStatus = tool.status === SNAPSHOT_STATUS.VALID
        ? SNAPSHOT_STATUS.VALID
        : tool.status === SNAPSHOT_STATUS.MISSING
          ? SNAPSHOT_STATUS.MISSING
          : SNAPSHOT_STATUS.DRIFTED;

      await db.query(
        `
          UPDATE core.tool_manifest_snapshots
          SET validation_status = $2::text,
              validation_details = $3::jsonb,
              last_checked_at = CURRENT_TIMESTAMP,
              validated_at = CASE WHEN $2::text = 'VALID' THEN CURRENT_TIMESTAMP ELSE validated_at END
          WHERE tool_manifest_snapshot_id = $1::uuid
        `,
        [
          tool.snapshotId,
          persistedStatus,
          JSON.stringify({ mismatches: tool.mismatches || [] }),
        ],
      );
    }
  }

  return {
    ...preview,
    status:
      preview.unsnapshottedCount === 0
      && preview.driftedCount === 0
      && preview.unregisteredCount === 0
        ? 'VALID'
        : 'ATTENTION',
  };
}

module.exports = {
  SNAPSHOT_STATUS,
  TOOL_MANIFEST_VALIDATOR_VERSION,
  ToolManifestSnapshotError,
  buildManifestSnapshotCandidate,
  buildSnapshotReportRow,
  buildToolManifestSnapshotPreview,
  checkToolManifestSnapshots,
  getSnapshotDrift,
  syncToolManifestSnapshots,
};
