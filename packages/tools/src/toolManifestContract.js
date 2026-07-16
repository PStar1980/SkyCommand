const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { isPlainObject, validateJsonSchema } = require('./jsonSchemaValidator');

const TOOL_MANIFEST_VERSION = '1.0';
const TOOL_MANIFEST_FILE_NAME = 'skycommand.tool.json';
const SUPPORTED_TOOL_MANIFEST_VERSIONS = new Set([TOOL_MANIFEST_VERSION]);
const SUPPORTED_RUNTIME_TYPES = new Set(['node', 'powershell', 'pwsh', 'python']);
const SUPPORTED_PARAMETER_TYPES = new Set([
  'string',
  'integer',
  'number',
  'boolean',
  'select',
  'string_array',
  'date',
  'json',
  'path',
]);
const SUPPORTED_BINDING_MODES = new Set(['argv_flag', 'argv_positional', 'environment', 'stdin_json']);
const TOOL_CODE_PATTERN = /^[a-z0-9][a-z0-9_:-]{2,79}$/;
const PARAMETER_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const OUTPUT_TYPE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{2,119}$/;
const PERMISSION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,99}$/;

class ToolManifestContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ToolManifestContractError';
    this.code = code;
    this.details = details;
  }
}

function getSkyServerRoot() {
  return path.resolve(__dirname, '../../..');
}

function readJsonFile(filePath, label) {
  let raw;

  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_FILE_READ_FAILED',
      `${label} could not be read: ${error.message}`,
      { filePath },
    );
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_INVALID_JSON',
      `${label} is not valid JSON: ${error.message}`,
      { filePath },
    );
  }
}

function assertPathInsideRoot(candidatePath, rootPath, label = 'Path') {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relativePath = path.relative(resolvedRoot, resolvedCandidate);

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return resolvedCandidate;
  }

  throw new ToolManifestContractError(
    'TOOL_MANIFEST_PATH_OUTSIDE_ROOT',
    `${label} resolves outside the approved repository root.`,
    { resolvedRoot, resolvedCandidate },
  );
}

function assertSafeRepositoryRelativePath(value, label) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PATH_REQUIRED',
      `${label} is required.`,
      { label },
    );
  }

  if (normalized.includes('\0')) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PATH_NULL_BYTE',
      `${label} contains an invalid null byte.`,
      { label },
    );
  }

  if (path.isAbsolute(normalized)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PATH_ABSOLUTE',
      `${label} must be repository-relative, not absolute.`,
      { label, value: normalized },
    );
  }

  const normalizedSlashes = normalized.replace(/\\/g, '/');
  const segments = normalizedSlashes.split('/');

  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PATH_TRAVERSAL',
      `${label} must not contain path traversal or empty segments.`,
      { label, value: normalized },
    );
  }

  return normalizedSlashes;
}

function resolveRepositoryFile(repositoryRoot, relativePath, label, options = {}) {
  const safeRelativePath = assertSafeRepositoryRelativePath(relativePath, label);
  const resolvedPath = assertPathInsideRoot(path.join(repositoryRoot, safeRelativePath), repositoryRoot, label);

  if (options.requireExists !== false) {
    if (!fs.existsSync(resolvedPath)) {
      throw new ToolManifestContractError(
        'TOOL_MANIFEST_REFERENCED_FILE_MISSING',
        `${label} was not found.`,
        { label, relativePath: safeRelativePath, resolvedPath },
      );
    }

    const stats = fs.lstatSync(resolvedPath);

    if (!stats.isFile()) {
      throw new ToolManifestContractError(
        'TOOL_MANIFEST_REFERENCED_PATH_NOT_FILE',
        `${label} must resolve to a regular file.`,
        { label, relativePath: safeRelativePath, resolvedPath },
      );
    }

    const realRoot = fs.realpathSync(repositoryRoot);
    const realFile = fs.realpathSync(resolvedPath);
    assertPathInsideRoot(realFile, realRoot, label);
  }

  return {
    relativePath: safeRelativePath,
    resolvedPath,
  };
}

function normalizeNonBlankString(value, label, options = {}) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_VALUE_REQUIRED',
      `${label} is required.`,
      { label },
    );
  }

  if (options.maxLength && normalized.length > options.maxLength) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_VALUE_TOO_LONG',
      `${label} exceeds ${options.maxLength} characters.`,
      { label, length: normalized.length, maxLength: options.maxLength },
    );
  }

  return normalized;
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_BOOLEAN_REQUIRED',
      `Expected a boolean value, received ${typeof value}.`,
      { value },
    );
  }

  return value;
}

function assertAllowedKeys(value, allowedKeys, label) {
  if (!isPlainObject(value)) {
    return;
  }

  const allowed = new Set(allowedKeys);
  const unexpectedKeys = Object.keys(value).filter((key) => !allowed.has(key));

  if (unexpectedKeys.length > 0) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_UNEXPECTED_FIELD',
      `${label} contains unsupported field(s): ${unexpectedKeys.join(', ')}.`,
      { label, unexpectedKeys },
    );
  }
}

function assertDefaultMatchesType(defaultValue, type, parameterName) {
  if (defaultValue === undefined || defaultValue === null) {
    return;
  }

  const fail = () => {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PARAMETER_DEFAULT_INVALID',
      `Default value for parameter ${parameterName} does not match type ${type}.`,
      { parameterName, type, defaultValue },
    );
  };

  if (type === 'integer' && !Number.isInteger(defaultValue)) {
    fail();
  }

  if (type === 'number' && (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue))) {
    fail();
  }

  if (type === 'boolean' && typeof defaultValue !== 'boolean') {
    fail();
  }

  if (type === 'string_array' && (!Array.isArray(defaultValue) || defaultValue.some((item) => typeof item !== 'string'))) {
    fail();
  }

  if (['string', 'select', 'date', 'path'].includes(type) && typeof defaultValue !== 'string') {
    fail();
  }

  if (type === 'json' && defaultValue === undefined) {
    fail();
  }
}

function normalizeBinding(binding, parameterName, parameterType, isSecret) {
  if (!isPlainObject(binding)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PARAMETER_BINDING_REQUIRED',
      `Parameter ${parameterName} must declare a binding object.`,
      { parameterName },
    );
  }

  assertAllowedKeys(
    binding,
    ['mode', 'flag', 'repeat', 'separator', 'position', 'variable', 'property'],
    `parameters.${parameterName}.binding`,
  );

  const mode = normalizeNonBlankString(binding.mode, `parameters.${parameterName}.binding.mode`);

  if (!SUPPORTED_BINDING_MODES.has(mode)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_BINDING_MODE_UNSUPPORTED',
      `Parameter ${parameterName} uses unsupported binding mode ${mode}.`,
      { parameterName, mode, supportedModes: [...SUPPORTED_BINDING_MODES] },
    );
  }

  if (isSecret && ['argv_flag', 'argv_positional'].includes(mode)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_SECRET_ARGV_FORBIDDEN',
      `Secret parameter ${parameterName} must use environment or stdin_json binding.`,
      { parameterName, mode },
    );
  }

  const normalized = { mode };

  if (mode === 'argv_flag') {
    const flag = normalizeNonBlankString(binding.flag, `parameters.${parameterName}.binding.flag`);

    if (!/^--[a-z0-9][a-z0-9-]*$/.test(flag)) {
      throw new ToolManifestContractError(
        'TOOL_MANIFEST_PARAMETER_FLAG_INVALID',
        `Parameter ${parameterName} flag must look like --parameter-name.`,
        { parameterName, flag },
      );
    }

    normalized.flag = flag;
    normalized.repeat = normalizeBoolean(binding.repeat, parameterType === 'string_array');
    normalized.separator = binding.separator === undefined ? ',' : String(binding.separator);
  }

  if (mode === 'argv_positional') {
    const position = Number(binding.position);

    if (!Number.isInteger(position) || position < 0 || position > 99) {
      throw new ToolManifestContractError(
        'TOOL_MANIFEST_POSITION_INVALID',
        `Parameter ${parameterName} positional binding requires an integer position from 0 to 99.`,
        { parameterName, position: binding.position },
      );
    }

    normalized.position = position;
  }

  if (mode === 'environment') {
    const variable = normalizeNonBlankString(binding.variable, `parameters.${parameterName}.binding.variable`);

    if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(variable)) {
      throw new ToolManifestContractError(
        'TOOL_MANIFEST_ENVIRONMENT_VARIABLE_INVALID',
        `Parameter ${parameterName} environment variable must be an uppercase environment key.`,
        { parameterName, variable },
      );
    }

    normalized.variable = variable;
  }

  if (mode === 'stdin_json') {
    normalized.property = normalizeNonBlankString(
      binding.property || parameterName,
      `parameters.${parameterName}.binding.property`,
    );
  }

  return normalized;
}

function normalizeParameter(parameter, index) {
  if (!isPlainObject(parameter)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PARAMETER_NOT_OBJECT',
      `Parameter at index ${index} must be an object.`,
      { index },
    );
  }

  assertAllowedKeys(
    parameter,
    ['name', 'label', 'description', 'type', 'required', 'secret', 'defaultValue', 'allowedValues', 'binding'],
    `parameters[${index}]`,
  );

  const name = normalizeNonBlankString(parameter.name, `parameters[${index}].name`);

  if (!PARAMETER_NAME_PATTERN.test(name)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PARAMETER_NAME_INVALID',
      `Parameter name ${name} must be lowercase snake_case.`,
      { name },
    );
  }

  const type = normalizeNonBlankString(parameter.type, `parameters.${name}.type`);

  if (!SUPPORTED_PARAMETER_TYPES.has(type)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PARAMETER_TYPE_UNSUPPORTED',
      `Parameter ${name} uses unsupported type ${type}.`,
      { name, type, supportedTypes: [...SUPPORTED_PARAMETER_TYPES] },
    );
  }

  const required = normalizeBoolean(parameter.required, false);
  const secret = normalizeBoolean(parameter.secret, false);
  const allowedValues = parameter.allowedValues === undefined ? null : parameter.allowedValues;

  if (allowedValues !== null && (!Array.isArray(allowedValues) || allowedValues.length === 0)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_ALLOWED_VALUES_INVALID',
      `Parameter ${name} allowedValues must be a non-empty array.`,
      { name },
    );
  }

  assertDefaultMatchesType(parameter.defaultValue, type, name);

  if (
    allowedValues
    && parameter.defaultValue !== undefined
    && !allowedValues.some((value) => JSON.stringify(value) === JSON.stringify(parameter.defaultValue))
  ) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_DEFAULT_NOT_ALLOWED',
      `Default value for parameter ${name} is not present in allowedValues.`,
      { name, defaultValue: parameter.defaultValue },
    );
  }

  return {
    name,
    label: normalizeNonBlankString(parameter.label || name, `parameters.${name}.label`, { maxLength: 160 }),
    description: parameter.description ? String(parameter.description).trim() : '',
    type,
    required,
    secret,
    defaultValue: parameter.defaultValue ?? null,
    allowedValues,
    binding: normalizeBinding(parameter.binding, name, type, secret),
  };
}

function normalizeManifest(candidate, options = {}) {
  if (!isPlainObject(candidate)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_NOT_OBJECT',
      'Tool manifest must be a JSON object.',
    );
  }

  assertAllowedKeys(
    candidate,
    [
      'manifestVersion',
      'toolCode',
      'displayName',
      'description',
      'runtime',
      'parameters',
      'resultContract',
      'permissions',
      'execution',
      'registration',
    ],
    'manifest',
  );

  const manifestVersion = normalizeNonBlankString(candidate.manifestVersion, 'manifestVersion');

  if (!SUPPORTED_TOOL_MANIFEST_VERSIONS.has(manifestVersion)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_VERSION_UNSUPPORTED',
      `Unsupported tool manifest version ${manifestVersion}.`,
      { manifestVersion, supportedVersions: [...SUPPORTED_TOOL_MANIFEST_VERSIONS] },
    );
  }

  const toolCode = normalizeNonBlankString(candidate.toolCode, 'toolCode');

  if (!TOOL_CODE_PATTERN.test(toolCode)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_TOOL_CODE_INVALID',
      'toolCode must be a stable lowercase code using letters, digits, underscores, colons, or hyphens.',
      { toolCode },
    );
  }

  if (!isPlainObject(candidate.runtime)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_RUNTIME_REQUIRED',
      'runtime must be an object.',
      { toolCode },
    );
  }

  assertAllowedKeys(candidate.runtime, ['type', 'entrypoint'], 'runtime');

  const runtimeType = normalizeNonBlankString(candidate.runtime.type, 'runtime.type');

  if (!SUPPORTED_RUNTIME_TYPES.has(runtimeType)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_RUNTIME_UNSUPPORTED',
      `Unsupported runtime type ${runtimeType}.`,
      { runtimeType, supportedTypes: [...SUPPORTED_RUNTIME_TYPES] },
    );
  }

  const parameters = Array.isArray(candidate.parameters)
    ? candidate.parameters.map(normalizeParameter)
    : [];
  const parameterNames = parameters.map((parameter) => parameter.name);

  if (new Set(parameterNames).size !== parameterNames.length) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PARAMETER_DUPLICATE',
      'Tool manifest parameter names must be unique.',
      { parameterNames },
    );
  }

  const positionalBindings = parameters
    .filter((parameter) => parameter.binding.mode === 'argv_positional')
    .map((parameter) => parameter.binding.position);

  if (new Set(positionalBindings).size !== positionalBindings.length) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_POSITION_DUPLICATE',
      'Positional parameter bindings must use unique positions.',
      { positionalBindings },
    );
  }

  if (!isPlainObject(candidate.resultContract)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_RESULT_CONTRACT_REQUIRED',
      'resultContract must be an object.',
      { toolCode },
    );
  }

  assertAllowedKeys(
    candidate.resultContract,
    ['required', 'schemaVersion', 'outputType', 'schemaPath', 'samplePath'],
    'resultContract',
  );

  const outputType = normalizeNonBlankString(candidate.resultContract.outputType, 'resultContract.outputType');

  if (!OUTPUT_TYPE_PATTERN.test(outputType)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_OUTPUT_TYPE_INVALID',
      'resultContract.outputType must be a stable lowercase semantic contract code.',
      { outputType },
    );
  }

  const permissions = Array.isArray(candidate.permissions) ? candidate.permissions : [];
  const normalizedPermissions = permissions.map((permission) => {
    const normalized = normalizeNonBlankString(permission, 'permissions[]');

    if (!PERMISSION_CODE_PATTERN.test(normalized)) {
      throw new ToolManifestContractError(
        'TOOL_MANIFEST_PERMISSION_INVALID',
        `Permission code ${normalized} must use uppercase snake case.`,
        { permission: normalized },
      );
    }

    return normalized;
  });

  if (new Set(normalizedPermissions).size !== normalizedPermissions.length) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_PERMISSION_DUPLICATE',
      'Tool manifest permissions must be unique.',
      { permissions: normalizedPermissions },
    );
  }

  const execution = isPlainObject(candidate.execution) ? candidate.execution : {};
  assertAllowedKeys(
    execution,
    ['timeoutMs', 'allowManual', 'allowSchedules', 'allowWorkflows', 'capturesOutput'],
    'execution',
  );
  const timeoutMs = Number(execution.timeoutMs ?? 180000);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 86400000) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_TIMEOUT_INVALID',
      'execution.timeoutMs must be an integer from 1,000 to 86,400,000 milliseconds.',
      { timeoutMs: execution.timeoutMs },
    );
  }

  const registration = isPlainObject(candidate.registration) ? candidate.registration : {};
  assertAllowedKeys(
    registration,
    ['applicationCode', 'categoryCode', 'riskCode', 'requiresConfirmation', 'confirmationText'],
    'registration',
  );

  const normalized = {
    manifestVersion,
    toolCode,
    displayName: normalizeNonBlankString(candidate.displayName, 'displayName', { maxLength: 160 }),
    description: candidate.description ? String(candidate.description).trim() : '',
    runtime: {
      type: runtimeType,
      entrypoint: assertSafeRepositoryRelativePath(candidate.runtime.entrypoint, 'runtime.entrypoint'),
    },
    parameters,
    resultContract: {
      required: normalizeBoolean(candidate.resultContract.required, true),
      schemaVersion: normalizeNonBlankString(
        candidate.resultContract.schemaVersion || '1.0',
        'resultContract.schemaVersion',
      ),
      outputType,
      schemaPath: candidate.resultContract.schemaPath
        ? assertSafeRepositoryRelativePath(candidate.resultContract.schemaPath, 'resultContract.schemaPath')
        : null,
      samplePath: candidate.resultContract.samplePath
        ? assertSafeRepositoryRelativePath(candidate.resultContract.samplePath, 'resultContract.samplePath')
        : null,
    },
    permissions: normalizedPermissions,
    execution: {
      timeoutMs,
      allowManual: normalizeBoolean(execution.allowManual, true),
      allowSchedules: normalizeBoolean(execution.allowSchedules, true),
      allowWorkflows: normalizeBoolean(execution.allowWorkflows, true),
      capturesOutput: normalizeBoolean(execution.capturesOutput, true),
    },
    registration: {
      applicationCode: registration.applicationCode
        ? normalizeNonBlankString(registration.applicationCode, 'registration.applicationCode')
        : null,
      categoryCode: registration.categoryCode
        ? normalizeNonBlankString(registration.categoryCode, 'registration.categoryCode')
        : null,
      riskCode: registration.riskCode
        ? normalizeNonBlankString(registration.riskCode, 'registration.riskCode')
        : null,
      requiresConfirmation: normalizeBoolean(registration.requiresConfirmation, false),
      confirmationText: registration.confirmationText
        ? String(registration.confirmationText).trim()
        : '',
    },
  };

  if (options.manifestSchema) {
    validateJsonSchema(normalized, options.manifestSchema, {
      schemaName: 'skycommand.tool.v1',
    });
  }

  return normalized;
}

function calculateFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function calculateJsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function loadToolManifest(manifestPath, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || getSkyServerRoot());
  const safeManifestPath = path.resolve(manifestPath);
  assertPathInsideRoot(safeManifestPath, repositoryRoot, 'Tool manifest');

  if (!fs.existsSync(safeManifestPath)) {
    throw new ToolManifestContractError(
      'TOOL_MANIFEST_FILE_MISSING',
      `Tool manifest was not found: ${safeManifestPath}`,
      { manifestPath: safeManifestPath },
    );
  }

  const manifestSchemaPath = options.manifestSchemaPath
    || path.join(repositoryRoot, 'packages', 'tools', 'contracts', 'skycommand.tool.v1.schema.json');
  const manifestSchema = fs.existsSync(manifestSchemaPath)
    ? readJsonFile(manifestSchemaPath, 'Tool manifest JSON Schema')
    : null;
  const candidate = readJsonFile(safeManifestPath, 'Tool manifest');
  const manifest = normalizeManifest(candidate, { manifestSchema });
  const entrypoint = resolveRepositoryFile(
    repositoryRoot,
    manifest.runtime.entrypoint,
    'runtime.entrypoint',
    { requireExists: options.requireFiles !== false },
  );
  const outputSchema = manifest.resultContract.schemaPath
    ? resolveRepositoryFile(
        repositoryRoot,
        manifest.resultContract.schemaPath,
        'resultContract.schemaPath',
        { requireExists: options.requireFiles !== false },
      )
    : null;
  const sample = manifest.resultContract.samplePath
    ? resolveRepositoryFile(
        repositoryRoot,
        manifest.resultContract.samplePath,
        'resultContract.samplePath',
        { requireExists: options.requireFiles !== false },
      )
    : null;

  const outputSchemaJson = outputSchema && fs.existsSync(outputSchema.resolvedPath)
    ? readJsonFile(outputSchema.resolvedPath, 'Tool output JSON Schema')
    : null;
  const sampleToolResult = sample && fs.existsSync(sample.resolvedPath)
    ? readJsonFile(sample.resolvedPath, 'Tool contract-check sample')
    : null;

  return {
    manifest,
    manifestPath: safeManifestPath,
    repositoryRoot,
    paths: {
      entrypoint,
      outputSchema,
      sample,
    },
    outputSchema: outputSchemaJson,
    sampleToolResult,
    hashes: {
      manifest: calculateJsonHash(manifest),
      entrypoint: fs.existsSync(entrypoint.resolvedPath) ? calculateFileHash(entrypoint.resolvedPath) : null,
      outputSchema:
        outputSchema && fs.existsSync(outputSchema.resolvedPath)
          ? calculateFileHash(outputSchema.resolvedPath)
          : null,
      sample:
        sample && fs.existsSync(sample.resolvedPath)
          ? calculateFileHash(sample.resolvedPath)
          : null,
    },
  };
}

function summarizeToolManifest(loadedManifest) {
  const { manifest, hashes, paths } = loadedManifest;

  return {
    manifestVersion: manifest.manifestVersion,
    toolCode: manifest.toolCode,
    displayName: manifest.displayName,
    description: manifest.description,
    runtime: manifest.runtime,
    parameters: manifest.parameters,
    resultContract: manifest.resultContract,
    permissions: manifest.permissions,
    execution: manifest.execution,
    registration: manifest.registration,
    resolvedPaths: {
      entrypoint: paths.entrypoint.relativePath,
      outputSchema: paths.outputSchema?.relativePath || null,
      sample: paths.sample?.relativePath || null,
    },
    hashes,
  };
}

module.exports = {
  PARAMETER_NAME_PATTERN,
  PERMISSION_CODE_PATTERN,
  SUPPORTED_BINDING_MODES,
  SUPPORTED_PARAMETER_TYPES,
  SUPPORTED_RUNTIME_TYPES,
  SUPPORTED_TOOL_MANIFEST_VERSIONS,
  TOOL_CODE_PATTERN,
  TOOL_MANIFEST_FILE_NAME,
  TOOL_MANIFEST_VERSION,
  ToolManifestContractError,
  assertPathInsideRoot,
  assertSafeRepositoryRelativePath,
  getSkyServerRoot,
  loadToolManifest,
  normalizeManifest,
  resolveRepositoryFile,
  summarizeToolManifest,
};
