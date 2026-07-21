const fs = require('fs');
const path = require('path');
const { query } = require('../../../../packages/db/src/connection');
const { validateToolResult } = require('../../../../packages/tools/src/toolResultContract');
const authService = require('./authService');
const toolAdminService = require('./toolAdminService');
const scriptExecutionService = require('./scriptExecutionService');

const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeToolId(value) {
  const toolId = String(value || '').trim();

  if (!UUID_PATTERN.test(toolId)) {
    throw createHttpError(400, 'toolId must be a valid UUID.', {
      code: 'MANAGED_TOOL_VERIFICATION_TOOL_ID_INVALID',
    });
  }

  return toolId;
}

function getPathApi(rootPath) {
  const value = String(rootPath || '');
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') ? path.win32 : path;
}

function resolveRepositoryFile(rootPath, relativePath, label) {
  if (!rootPath) {
    throw createHttpError(409, 'The active repository path is not configured.', {
      code: 'MANAGED_TOOL_VERIFICATION_REPOSITORY_PATH_MISSING',
    });
  }

  if (!relativePath) {
    return null;
  }

  const pathApi = getPathApi(rootPath);
  const root = pathApi.resolve(rootPath);
  const candidate = pathApi.resolve(root, String(relativePath).replace(/[\\/]/g, pathApi.sep));
  const relative = pathApi.relative(root, candidate);

  if (!relative || relative.startsWith('..') || pathApi.isAbsolute(relative)) {
    throw createHttpError(409, `${label} resolves outside the configured repository root.`, {
      code: 'MANAGED_TOOL_VERIFICATION_PATH_UNSAFE',
      label,
      relativePath,
    });
  }

  return candidate;
}

async function fileState(filePath, { parseJson = false } = {}) {
  if (!filePath) {
    return {
      configured: false,
      exists: false,
      readable: false,
      validJson: null,
      value: null,
      error: null,
    };
  }

  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    let value = null;

    if (parseJson) {
      value = JSON.parse(content);
    }

    return {
      configured: true,
      exists: true,
      readable: true,
      validJson: parseJson ? true : null,
      value,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      exists: error.code !== 'ENOENT',
      readable: false,
      validJson: parseJson ? false : null,
      value: null,
      error: error.message,
    };
  }
}

async function loadManagedToolContext(toolId) {
  const normalizedToolId = normalizeToolId(toolId);
  const [toolPayload, pathResult] = await Promise.all([
    toolAdminService.getTool(normalizedToolId),
    query(
      `
        SELECT
          repository.repo_id,
          repository.repo_code,
          repository.repo_name,
          repository.active AS repository_active,
          profile.profile_code,
          repository_path.root_path
        FROM core.tools tool
        JOIN core.repositories repository ON repository.repo_id = tool.script_repo_id
        LEFT JOIN core.repository_paths repository_path
          ON repository_path.repo_id = repository.repo_id
         AND repository_path.active = TRUE
        LEFT JOIN core.config_profiles profile
          ON profile.profile_id = repository_path.profile_id
         AND profile.active = TRUE
         AND profile.profile_code = $2
        WHERE tool.tool_id = $1
        ORDER BY CASE WHEN profile.profile_code = $2 THEN 0 ELSE 1 END
        LIMIT 1
      `,
      [normalizedToolId, PROFILE_CODE],
    ),
  ]);
  const tool = toolPayload.tool;

  if (!tool.managedBySkyCommand) {
    throw createHttpError(409, 'Verification workbench is available only for managed tools.', {
      code: 'MANAGED_TOOL_VERIFICATION_NOT_MANAGED',
      toolId: normalizedToolId,
      toolCode: tool.toolCode,
    });
  }

  const repositoryPath = pathResult.rows[0] || {};

  if (!repositoryPath.root_path || repositoryPath.profile_code !== PROFILE_CODE) {
    throw createHttpError(409, 'The managed tool repository has no active path for this profile.', {
      code: 'MANAGED_TOOL_VERIFICATION_REPOSITORY_PATH_MISSING',
      profileCode: PROFILE_CODE,
      toolCode: tool.toolCode,
    });
  }

  return {
    tool,
    profileCode: PROFILE_CODE,
    repository: {
      repoId: repositoryPath.repo_id,
      repoCode: repositoryPath.repo_code,
      repoName: repositoryPath.repo_name,
      active: repositoryPath.repository_active === true,
      rootPath: repositoryPath.root_path,
    },
  };
}

function decodeJsonPointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveLocalReference(rootSchema, reference) {
  if (reference === '#') {
    return rootSchema;
  }

  if (!String(reference || '').startsWith('#/')) {
    throw new Error(`Only local JSON Schema references are supported: ${reference}`);
  }

  return reference
    .slice(2)
    .split('/')
    .map(decodeJsonPointerToken)
    .reduce((value, token) => value?.[token], rootSchema);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSampleObjects(left, right) {
  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    return { ...left, ...right };
  }

  return right === undefined ? left : right;
}

function createRepresentativeOutputFromSchema(schema, options = {}) {
  const rootSchema = options.rootSchema || schema;
  const depth = Number(options.depth || 0);

  if (depth > 40) {
    throw new Error('Schema sample generation exceeded the maximum depth.');
  }

  if (schema === true) return {};
  if (schema === false) throw new Error('The output schema rejects every possible value.');
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};

  if (schema.$ref) {
    const resolved = resolveLocalReference(rootSchema, schema.$ref);
    if (resolved === undefined) {
      throw new Error(`Local JSON Schema reference could not be resolved: ${schema.$ref}`);
    }
    return createRepresentativeOutputFromSchema(resolved, {
      rootSchema,
      depth: depth + 1,
    });
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return cloneJson(schema.const);
  if (Array.isArray(schema.examples) && schema.examples.length > 0)
    return cloneJson(schema.examples[0]);
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) return cloneJson(schema.default);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return cloneJson(schema.enum[0]);

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.reduce(
      (sample, child) =>
        mergeSampleObjects(
          sample,
          createRepresentativeOutputFromSchema(child, { rootSchema, depth: depth + 1 }),
        ),
      {},
    );
  }

  const branch = Array.isArray(schema.oneOf)
    ? schema.oneOf[0]
    : Array.isArray(schema.anyOf)
      ? schema.anyOf[0]
      : null;
  if (branch) {
    return createRepresentativeOutputFromSchema(branch, { rootSchema, depth: depth + 1 });
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find((item) => item !== 'null') || schema.type[0]
    : schema.type || (schema.properties ? 'object' : schema.items ? 'array' : null);

  switch (type) {
    case 'object': {
      const properties = schema.properties || {};
      const required = new Set(schema.required || []);
      const sample = {};

      for (const [key, childSchema] of Object.entries(properties)) {
        const hasHelpfulValue =
          required.has(key) ||
          childSchema?.default !== undefined ||
          childSchema?.const !== undefined ||
          (Array.isArray(childSchema?.examples) && childSchema.examples.length > 0) ||
          (Array.isArray(childSchema?.enum) && childSchema.enum.length > 0);

        if (hasHelpfulValue) {
          sample[key] = createRepresentativeOutputFromSchema(childSchema, {
            rootSchema,
            depth: depth + 1,
          });
        }
      }

      return sample;
    }
    case 'array': {
      const minimum = Number(schema.minItems || 0);
      if (minimum <= 0) return [];
      const item = createRepresentativeOutputFromSchema(schema.items || {}, {
        rootSchema,
        depth: depth + 1,
      });
      return Array.from({ length: minimum }, () => cloneJson(item));
    }
    case 'integer':
      return Number.isFinite(schema.minimum) ? Math.ceil(schema.minimum) : 0;
    case 'number':
      return Number.isFinite(schema.minimum) ? schema.minimum : 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'string':
    default: {
      let value =
        schema.format === 'date'
          ? '2026-01-01'
          : schema.format === 'date-time'
            ? '2026-01-01T00:00:00.000Z'
            : schema.format === 'uri'
              ? 'https://example.invalid/resource'
              : 'sample';
      const minimumLength = Number(schema.minLength || 0);
      if (value.length < minimumLength) value = value.padEnd(minimumLength, 'x');
      return value;
    }
  }
}

function normalizeSampleOutput(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw createHttpError(400, `Representative output JSON is invalid: ${error.message}`, {
        code: 'MANAGED_TOOL_CONTRACT_SAMPLE_INVALID',
      });
    }
  }

  return value;
}

async function inspectManagedFiles(context) {
  const rootPath = context.repository.rootPath;
  const scriptPath = resolveRepositoryFile(rootPath, context.tool.scriptPath, 'scriptPath');
  const descriptorPath = context.tool.descriptorPath
    ? resolveRepositoryFile(rootPath, context.tool.descriptorPath, 'descriptorPath')
    : null;
  const schemaPath = context.tool.outputSchemaPath
    ? resolveRepositoryFile(rootPath, context.tool.outputSchemaPath, 'outputSchemaPath')
    : null;
  const [script, descriptor, schema] = await Promise.all([
    fileState(scriptPath),
    fileState(descriptorPath, { parseJson: true }),
    fileState(schemaPath, { parseJson: true }),
  ]);

  return {
    script: { ...script, path: scriptPath, relativePath: context.tool.scriptPath },
    descriptor: {
      ...descriptor,
      path: descriptorPath,
      relativePath: context.tool.descriptorPath,
    },
    schema: { ...schema, path: schemaPath, relativePath: context.tool.outputSchemaPath },
  };
}

function createParameterTemplate(parameters = []) {
  return parameters
    .filter((parameter) => parameter.enabled !== false)
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .reduce((result, parameter) => {
      result[parameter.parameterName] = parameter.defaultValue ?? '';
      return result;
    }, {});
}

async function getVerification(toolId) {
  const context = await loadManagedToolContext(toolId);
  const files = await inspectManagedFiles(context);
  const checks = [
    {
      code: 'REPOSITORY_ACTIVE',
      label: 'Repository status',
      status: context.repository.active ? 'PASS' : 'FAIL',
      message: context.repository.active
        ? 'Registered repository is active for managed execution.'
        : 'Registered repository is inactive and cannot launch tools.',
    },
    {
      code: 'SCRIPT_AVAILABLE',
      label: 'Entry script',
      status: files.script.readable ? 'PASS' : 'FAIL',
      message: files.script.readable ? 'Registered entry script is readable.' : files.script.error,
    },
    {
      code: 'DESCRIPTOR_AVAILABLE',
      label: 'Onboarding descriptor',
      status: !files.descriptor.configured
        ? 'NOT_CONFIGURED'
        : files.descriptor.validJson
          ? 'PASS'
          : 'WARNING',
      message: !files.descriptor.configured
        ? 'No descriptor is configured. This does not restrict execution.'
        : files.descriptor.validJson
          ? 'Descriptor is readable JSON and remains informational.'
          : files.descriptor.error,
    },
    {
      code: 'OUTPUT_SCHEMA_AVAILABLE',
      label: 'Output schema',
      status: !context.tool.outputType
        ? 'NOT_CONFIGURED'
        : !files.schema.configured
          ? 'NOT_CONFIGURED'
          : files.schema.validJson
            ? 'PASS'
            : 'WARNING',
      message: !context.tool.outputType
        ? 'No structured output type is configured.'
        : !files.schema.configured
          ? 'No output schema is configured. ToolResult reporting remains optional.'
          : files.schema.validJson
            ? 'Output schema is readable JSON.'
            : files.schema.error,
    },
    {
      code: 'RUNTIME_SUPPORTED',
      label: 'Runtime',
      status: context.tool.runtimeCode === 'node' ? 'PASS' : 'FAIL',
      message:
        context.tool.runtimeCode === 'node'
          ? 'Node.js runtime is supported for managed verification.'
          : `Unsupported managed verification runtime: ${context.tool.runtimeCode}`,
    },
  ];
  const blocked = checks.some((check) => check.status === 'FAIL');

  const safeFiles = Object.fromEntries(
    Object.entries(files).map(([key, file]) => {
      const { value, ...safeFile } = file;
      void value;
      return [key, safeFile];
    }),
  );

  return {
    verification: {
      status: blocked ? 'BLOCKED' : context.tool.enabled ? 'ENABLED' : 'READY_FOR_TEST',
      canContractCheck: !blocked && Boolean(context.tool.outputType),
      canRunControlledTest: !blocked,
      enabled: context.tool.enabled,
      advisoryOnly: true,
      message: blocked
        ? 'Managed tool verification is blocked by a missing runtime file or unsupported runtime.'
        : context.tool.enabled
          ? 'The tool is enabled. Verification remains available and never becomes a launch gate.'
          : 'The disabled managed tool is ready for contract inspection and controlled testing.',
      tool: context.tool,
      repository: context.repository,
      profileCode: context.profileCode,
      files: safeFiles,
      checks,
      parameterTemplate: createParameterTemplate(context.tool.parameters),
      policies: {
        hashesAreRuntimeGates: false,
        contractCheckRequiredForEnablement: false,
        controlledTestRequiredForEnablement: false,
        enabledStateAuthority: 'PostgreSQL core.tools.enabled',
      },
    },
  };
}

async function recordVerificationAudit({
  actor,
  context = {},
  tool,
  action,
  eventType,
  success,
  message,
  metadata = {},
}) {
  try {
    await authService.recordAuditEvent({
      userId: actor?.userId || actor?.user_id || actor?.id || null,
      eventType,
      resourceType: 'core.tools',
      resourceId: tool.toolCode,
      action,
      success,
      message,
      metadata: {
        privilegeCode: 'ADMIN_TOOL_WRITE',
        toolId: tool.toolId,
        managedBySkyCommand: true,
        ...metadata,
      },
      ipAddress: context.ipAddress || null,
      userAgent: context.userAgent || null,
    });
  } catch (error) {
    console.warn('[Managed Tool Verification] Audit write failed:', error.message);
  }
}

async function contractCheck({ toolId, body = {}, actor, context = {} }) {
  const managed = await loadManagedToolContext(toolId);
  const files = await inspectManagedFiles(managed);
  const outputType = managed.tool.outputType;

  if (!outputType) {
    const result = {
      status: 'NOT_CONFIGURED',
      passed: true,
      advisoryOnly: true,
      message:
        'No structured output type is configured. The tool remains runnable through normal catalogue controls.',
      outputType: null,
      schemaValidated: false,
      sampleSource: null,
      sampleOutput: null,
      toolResult: null,
    };
    await recordVerificationAudit({
      actor,
      context,
      tool: managed.tool,
      action: 'contract_check',
      eventType: 'TOOL_CONTRACT_CHECK',
      success: true,
      message: result.message,
      metadata: { status: result.status },
    });
    return { contractCheck: result };
  }

  let schema = null;
  if (managed.tool.outputSchemaPath) {
    if (!files.schema.validJson) {
      const result = {
        status: 'WARNING',
        passed: false,
        advisoryOnly: true,
        message: `Configured output schema could not be loaded: ${files.schema.error || 'Unknown schema error'}`,
        outputType,
        schemaValidated: false,
        sampleSource: null,
        sampleOutput: null,
        toolResult: null,
      };
      await recordVerificationAudit({
        actor,
        context,
        tool: managed.tool,
        action: 'contract_check',
        eventType: 'TOOL_CONTRACT_CHECK',
        success: false,
        message: result.message,
        metadata: { status: result.status, advisoryOnly: true },
      });
      return { contractCheck: result };
    }
    schema = files.schema.value;
  }

  const suppliedSample = normalizeSampleOutput(body.sampleOutput);
  const sampleSource =
    suppliedSample === undefined ? (schema ? 'schema-generated' : 'empty') : 'provided';
  const sampleOutput =
    suppliedSample === undefined
      ? schema
        ? createRepresentativeOutputFromSchema(schema)
        : {}
      : suppliedSample;
  const candidate = {
    schemaVersion: '1.0',
    success: true,
    message: `Representative contract check for ${managed.tool.label}.`,
    outputType,
    output: sampleOutput,
    warnings: [],
    error: null,
    metadata: { contractCheck: true, nonDomainSample: true },
  };

  let result;
  try {
    const validated = validateToolResult(candidate, {
      expectedOutputType: outputType,
      outputSchema: schema,
    });
    result = {
      status: 'PASSED',
      passed: true,
      advisoryOnly: true,
      message: schema
        ? 'Representative ToolResult passed the configured output schema.'
        : 'Representative ToolResult passed the universal envelope contract; no domain schema is configured.',
      outputType,
      schemaValidated: Boolean(schema),
      sampleSource,
      sampleOutput,
      toolResult: validated,
    };
  } catch (error) {
    result = {
      status: 'FAILED',
      passed: false,
      advisoryOnly: true,
      message: error.message,
      errorCode: error.code || 'TOOL_CONTRACT_CHECK_FAILED',
      details: error.details || {},
      outputType,
      schemaValidated: Boolean(schema),
      sampleSource,
      sampleOutput,
      toolResult: candidate,
    };
  }

  await recordVerificationAudit({
    actor,
    context,
    tool: managed.tool,
    action: 'contract_check',
    eventType: 'TOOL_CONTRACT_CHECK',
    success: result.passed,
    message: result.message,
    metadata: {
      status: result.status,
      outputType,
      schemaValidated: result.schemaValidated,
      sampleSource,
      advisoryOnly: true,
    },
  });

  return { contractCheck: result };
}

async function runControlledTest({
  toolId,
  body = {},
  actor,
  currentSession,
  permissions = [],
  context = {},
}) {
  const result = await scriptExecutionService.runManagedToolTest({
    toolId,
    parameters: body.parameters || {},
    confirmed: body.confirmed || body.confirm,
    confirmationPhrase: body.confirmationPhrase || body.confirmationText,
    user: actor,
    session: currentSession,
    permissions,
    context,
  });

  return {
    controlledTest: {
      ...result,
      advisoryOnly: true,
      enabledStateChanged: false,
      message:
        result.summary ||
        'Controlled managed-tool test completed. The catalogue enabled state was not changed.',
    },
  };
}

module.exports = {
  createRepresentativeOutputFromSchema,
  contractCheck,
  getVerification,
  runControlledTest,
};
