const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { builtinModules } = require('module');
const skycommandRepositoryService = require('./skycommandRepositoryService');

const TOOL_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
const OUTPUT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.v[1-9][0-9]*)?$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const ACCEPTED_VISIBILITY = new Set(['cli', 'admin-web', 'api', 'worker']);
const ACCEPTED_PARAMETER_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'repo',
  'select',
  'path',
  'date',
]);
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'title',
  'description',
  'default',
  'examples',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'minProperties',
  'maxProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'enum',
  'const',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
]);
const ALLOWED_FORMATS = new Set(['date', 'date-time', 'uri']);
const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_NODES = 5000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = Object.freeze({
  script: 256 * 1024,
  descriptor: 64 * 1024,
  schema: 256 * 1024,
});
const MAX_TOTAL_BYTES = 640 * 1024;
const REPOSITORY_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_STAGING_ROOT = path.resolve(REPOSITORY_ROOT, 'logs', 'tool-onboarding');
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGED_SCRIPT_FILENAME = 'tool.js';
const MANAGED_DESCRIPTOR_FILENAME = 'skycommand.tool.json';

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function getActorUserId(actor) {
  return actor?.userId || actor?.user_id || actor?.id || null;
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function byteLength(content) {
  return Buffer.byteLength(content, 'utf8');
}

function normalizeUpload(rawFile, kind, { required = false } = {}) {
  if (!rawFile) {
    if (required) {
      throw createHttpError(400, `${kind} file is required.`, {
        code: 'TOOL_ONBOARDING_FILE_REQUIRED',
        fileKind: kind,
      });
    }

    return null;
  }

  const filename = String(rawFile.filename || '').trim();
  const content = rawFile.content;

  if (
    !filename ||
    path.basename(filename) !== filename ||
    /[\\/]/.test(filename) ||
    filename.includes('\0')
  ) {
    throw createHttpError(400, `${kind} filename is invalid.`, {
      code: 'TOOL_ONBOARDING_FILENAME_INVALID',
      fileKind: kind,
    });
  }

  if (typeof content !== 'string') {
    throw createHttpError(400, `${kind} content must be UTF-8 text.`, {
      code: 'TOOL_ONBOARDING_CONTENT_INVALID',
      fileKind: kind,
    });
  }

  const sizeBytes = byteLength(content);

  if (sizeBytes === 0) {
    throw createHttpError(400, `${kind} file cannot be empty.`, {
      code: 'TOOL_ONBOARDING_FILE_EMPTY',
      fileKind: kind,
    });
  }

  if (sizeBytes > MAX_FILE_BYTES[kind]) {
    throw createHttpError(413, `${kind} file exceeds the Phase 15 upload limit.`, {
      code: 'TOOL_ONBOARDING_FILE_TOO_LARGE',
      fileKind: kind,
      sizeBytes,
      maximumBytes: MAX_FILE_BYTES[kind],
    });
  }

  if (content.includes('\0')) {
    throw createHttpError(400, `${kind} file contains unsupported null bytes.`, {
      code: 'TOOL_ONBOARDING_CONTENT_INVALID',
      fileKind: kind,
    });
  }

  return {
    kind,
    filename,
    content,
    sizeBytes,
    sha256: hashContent(content),
  };
}

function normalizeUploads(body = {}) {
  const files = [
    normalizeUpload(body.script, 'script', { required: true }),
    normalizeUpload(body.descriptor, 'descriptor'),
    normalizeUpload(body.schema, 'schema'),
  ].filter(Boolean);
  const duplicateFilename = files.find(
    (file, index) => files.findIndex((candidate) => candidate.filename === file.filename) !== index,
  );

  if (duplicateFilename) {
    throw createHttpError(400, 'Uploaded onboarding files must use distinct filenames.', {
      code: 'TOOL_ONBOARDING_FILENAME_DUPLICATE',
      filename: duplicateFilename.filename,
    });
  }

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw createHttpError(413, 'Combined onboarding upload exceeds the Phase 15 limit.', {
      code: 'TOOL_ONBOARDING_UPLOAD_TOO_LARGE',
      totalBytes,
      maximumBytes: MAX_TOTAL_BYTES,
    });
  }

  return {
    script: files.find((file) => file.kind === 'script'),
    descriptor: files.find((file) => file.kind === 'descriptor') || null,
    schema: files.find((file) => file.kind === 'schema') || null,
    files,
    totalBytes,
  };
}

function addFinding(findings, severity, code, message, details = {}) {
  findings.push({
    severity,
    code,
    message,
    ...details,
  });
}

function parseJsonFile(file, findings, label) {
  if (!file) {
    return null;
  }

  try {
    return JSON.parse(file.content);
  } catch (error) {
    addFinding(
      findings,
      'ERROR',
      `${label.toUpperCase()}_JSON_INVALID`,
      `${label} is not valid JSON: ${error.message}`,
      {
        fileKind: file.kind,
        filename: file.filename,
        confidence: 'high',
      },
    );
    return null;
  }
}

function getPackageName(specifier) {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(specifier)
  ) {
    return null;
  }

  if (specifier.startsWith('node:')) {
    return specifier.slice(5).split('/')[0];
  }

  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }

  return specifier.split('/')[0];
}

function extractRequiredModules(source) {
  const modules = [];
  const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;

  while ((match = requirePattern.exec(source)) !== null) {
    modules.push(match[1]);
  }

  return [...new Set(modules)];
}

function isSharedAdapterSpecifier(specifier) {
  const normalized = String(specifier || '').replace(/\\/g, '/');

  return (
    /^(?:\.\.\/)+(?:tools\/src|src)(?:\/index\.js)?$/.test(normalized) ||
    normalized === '../../src' ||
    normalized === '../../src/index.js'
  );
}

function loadAvailablePackages() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'),
    );

    return new Set([
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.devDependencies || {}),
    ]);
  } catch {
    return new Set();
  }
}

function inferStringConstant(source, constantName) {
  const escapedName = constantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b(?:const|let|var)\\s+${escapedName}\\s*=\\s*['\"]([^'\"]+)['\"]`);
  return source.match(pattern)?.[1] || null;
}

function inferParametersFromSource(source) {
  const match = source.match(
    /const\s*\[([^\]]+)\]\s*=\s*Array\.isArray\(args\)\s*\?\s*args\s*:\s*\[\]/m,
  );

  if (!match) {
    return [];
  }

  return match[1]
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token, index) => {
      const [rawName, rawDefault] = token.split('=').map((part) => part.trim());
      const parameterName = rawName.replace(/^\.\.\./, '').replace(/^raw(?=[A-Z])/, '');
      const normalizedName = parameterName
        ? parameterName.charAt(0).toLowerCase() + parameterName.slice(1)
        : `parameter${index + 1}`;

      return {
        name: PARAMETER_NAME_PATTERN.test(normalizedName)
          ? normalizedName
          : `parameter${index + 1}`,
        label: normalizedName
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (value) => value.toUpperCase()),
        type: 'string',
        required: rawDefault === undefined,
        defaultValue: rawDefault === undefined ? null : rawDefault.replace(/^['"]|['"]$/g, ''),
        position: index + 1,
        confidence: 'medium',
        source: 'source-analysis',
      };
    });
}

function inspectSource(script, findings) {
  if (!script.filename.toLowerCase().endsWith('.js')) {
    addFinding(
      findings,
      'ERROR',
      'SCRIPT_EXTENSION_UNSUPPORTED',
      'Phase 15.4 accepts one .js entry script.',
      {
        fileKind: 'script',
        filename: script.filename,
        confidence: 'high',
      },
    );
  }

  try {
    new vm.Script(script.content, {
      filename: script.filename,
      displayErrors: true,
    });
    addFinding(
      findings,
      'INFO',
      'SCRIPT_SYNTAX_VALID',
      'Node.js/CommonJS syntax parsed successfully without executing the script.',
      {
        fileKind: 'script',
        filename: script.filename,
        confidence: 'high',
      },
    );
  } catch (error) {
    addFinding(
      findings,
      'ERROR',
      'SCRIPT_SYNTAX_INVALID',
      `Node.js syntax validation failed: ${error.message}`,
      {
        fileKind: 'script',
        filename: script.filename,
        confidence: 'high',
        lineNumber: error.lineNumber || null,
      },
    );
  }

  const usesRunToolCli = /\brunToolCli\s*\(/.test(script.content);
  const modules = extractRequiredModules(script.content);
  const importsSharedAdapter = modules.some(isSharedAdapterSpecifier);
  const inferredToolCode = inferStringConstant(script.content, 'TOOL_CODE');
  const inferredOutputType = inferStringConstant(script.content, 'OUTPUT_TYPE');
  const inferredParameters = inferParametersFromSource(script.content);

  if (usesRunToolCli) {
    addFinding(
      findings,
      'INFO',
      'SHARED_ADAPTER_DETECTED',
      'The script appears to use the shared runToolCli adapter.',
      {
        fileKind: 'script',
        confidence: 'medium-high',
      },
    );
  } else {
    addFinding(
      findings,
      'WARNING',
      'SHARED_ADAPTER_NOT_DETECTED',
      'The shared runToolCli adapter was not detected. The tool may still be configurable, but structured onboarding support will be limited.',
      {
        fileKind: 'script',
        confidence: 'medium',
      },
    );
  }

  if (usesRunToolCli && !importsSharedAdapter) {
    addFinding(
      findings,
      'WARNING',
      'SHARED_ADAPTER_IMPORT_UNUSUAL',
      'runToolCli was detected, but a relative CommonJS import resolving to packages/tools/src was not found.',
      {
        fileKind: 'script',
        confidence: 'medium',
      },
    );
  }

  if (inferredToolCode && !TOOL_CODE_PATTERN.test(inferredToolCode)) {
    addFinding(
      findings,
      'WARNING',
      'SOURCE_TOOL_CODE_INVALID',
      `The source TOOL_CODE value is not a valid catalogue code: ${inferredToolCode}`,
      {
        fileKind: 'script',
        confidence: 'high',
      },
    );
  }

  if (inferredOutputType && !OUTPUT_TYPE_PATTERN.test(inferredOutputType)) {
    addFinding(
      findings,
      'WARNING',
      'SOURCE_OUTPUT_TYPE_INVALID',
      `The source OUTPUT_TYPE value is not a valid contract identifier: ${inferredOutputType}`,
      {
        fileKind: 'script',
        confidence: 'high',
      },
    );
  }

  const availablePackages = loadAvailablePackages();
  const builtinSet = new Set(
    builtinModules.map((name) => name.replace(/^node:/, '').split('/')[0]),
  );
  const dependencies = modules.map((specifier) => {
    const packageName = getPackageName(specifier);
    let availability = 'relative';

    if (packageName) {
      availability = builtinSet.has(packageName)
        ? 'built-in'
        : availablePackages.has(packageName)
          ? 'available'
          : 'missing';
    }

    return { specifier, packageName, availability };
  });

  dependencies
    .filter((dependency) => dependency.availability === 'missing')
    .forEach((dependency) => {
      addFinding(
        findings,
        'ERROR',
        'DEPENDENCY_UNAVAILABLE',
        `Required package is not available in the SkyCommand repository: ${dependency.packageName}`,
        {
          fileKind: 'script',
          dependency: dependency.packageName,
          confidence: 'high',
        },
      );
    });

  dependencies
    .filter(
      (dependency) =>
        dependency.availability === 'relative' && !isSharedAdapterSpecifier(dependency.specifier),
    )
    .forEach((dependency) => {
      addFinding(
        findings,
        'WARNING',
        'RELATIVE_DEPENDENCY_REQUIRES_REVIEW',
        `The single-file upload references another relative module that is not part of this onboarding package: ${dependency.specifier}`,
        {
          fileKind: 'script',
          dependency: dependency.specifier,
          confidence: 'high',
        },
      );
    });

  const securityPatterns = [
    [
      'CHILD_PROCESS_USAGE',
      /(?:require\s*\(\s*['"](?:node:)?child_process['"]|\bexecFile?\s*\(|\bspawn\s*\()/,
      'The script uses child-process execution. Review command construction and risk classification.',
    ],
    [
      'DYNAMIC_CODE_USAGE',
      /\beval\s*\(|\bnew\s+Function\s*\(/,
      'The script uses dynamic code evaluation.',
    ],
    [
      'RAW_ENVIRONMENT_USAGE',
      /\bprocess\.env\b/,
      'The script reads process.env. Confirm that secrets are not logged or returned.',
    ],
    [
      'FILESYSTEM_USAGE',
      /require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/,
      'The script uses filesystem access. Review path boundaries and mutation risk.',
    ],
    [
      'SHELL_OPTION_USAGE',
      /\bshell\s*:\s*true\b/,
      'The script enables shell execution, which requires careful review.',
    ],
    [
      'ENVIRONMENT_DUMP_RISK',
      /console\.(?:log|dir|error)\s*\(\s*process\.env\s*\)/,
      'The script appears to print the complete environment and may expose secrets.',
    ],
    [
      'SECRET_LITERAL_RISK',
      /(?:api[_-]?key|token|password|secret)\s*[:=]\s*['"][^'"]{12,}['"]/i,
      'The script appears to contain a secret-like literal. Remove credentials before onboarding.',
    ],
  ];

  securityPatterns.forEach(([code, pattern, message]) => {
    if (pattern.test(script.content)) {
      addFinding(
        findings,
        ['ENVIRONMENT_DUMP_RISK', 'DYNAMIC_CODE_USAGE', 'SECRET_LITERAL_RISK'].includes(code)
          ? 'ERROR'
          : 'WARNING',
        code,
        message,
        {
          fileKind: 'script',
          confidence: 'medium-high',
        },
      );
    }
  });

  return {
    runtimeCode: 'node',
    usesRunToolCli,
    importsSharedAdapter,
    inferredToolCode,
    inferredOutputType,
    inferredParameters,
    dependencies,
  };
}

function normalizeDescriptorParameters(parameters, findings) {
  if (parameters === undefined) {
    return [];
  }

  if (!Array.isArray(parameters)) {
    addFinding(
      findings,
      'ERROR',
      'DESCRIPTOR_PARAMETERS_INVALID',
      'Descriptor parameters must be an array.',
      {
        fileKind: 'descriptor',
        confidence: 'high',
      },
    );
    return [];
  }

  const seenNames = new Set();
  const seenPositions = new Set();

  return parameters
    .map((parameter, index) => {
      if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) {
        addFinding(
          findings,
          'ERROR',
          'DESCRIPTOR_PARAMETER_INVALID',
          `Descriptor parameter ${index + 1} must be an object.`,
          {
            fileKind: 'descriptor',
            confidence: 'high',
          },
        );
        return null;
      }

      const name = String(parameter.name || '').trim();
      const type = String(parameter.type || 'string')
        .trim()
        .toLowerCase();
      const position = Number(parameter.position ?? index + 1);

      if (!PARAMETER_NAME_PATTERN.test(name)) {
        addFinding(
          findings,
          'ERROR',
          'DESCRIPTOR_PARAMETER_NAME_INVALID',
          `Descriptor parameter ${index + 1} has an invalid name.`,
          {
            fileKind: 'descriptor',
            confidence: 'high',
          },
        );
      } else if (seenNames.has(name)) {
        addFinding(
          findings,
          'ERROR',
          'DESCRIPTOR_PARAMETER_NAME_DUPLICATE',
          `Descriptor parameter name is duplicated: ${name}`,
          {
            fileKind: 'descriptor',
            confidence: 'high',
          },
        );
      }

      seenNames.add(name);

      if (!ACCEPTED_PARAMETER_TYPES.has(type)) {
        addFinding(
          findings,
          'ERROR',
          'DESCRIPTOR_PARAMETER_TYPE_UNSUPPORTED',
          `Descriptor parameter ${name || index + 1} uses unsupported type ${type}.`,
          {
            fileKind: 'descriptor',
            confidence: 'high',
          },
        );
      }

      if (!Number.isInteger(position) || position < 1 || position > 100) {
        addFinding(
          findings,
          'ERROR',
          'DESCRIPTOR_PARAMETER_POSITION_INVALID',
          `Descriptor parameter ${name || index + 1} must have an integer position between 1 and 100.`,
          {
            fileKind: 'descriptor',
            confidence: 'high',
          },
        );
      } else if (seenPositions.has(position)) {
        addFinding(
          findings,
          'ERROR',
          'DESCRIPTOR_PARAMETER_POSITION_DUPLICATE',
          `Descriptor parameter position is duplicated: ${position}`,
          {
            fileKind: 'descriptor',
            confidence: 'high',
          },
        );
      }

      seenPositions.add(position);

      return {
        name,
        label: String(parameter.label || name).trim(),
        type,
        prompt:
          parameter.prompt === undefined || parameter.prompt === null
            ? null
            : String(parameter.prompt),
        required: Boolean(parameter.required),
        defaultValue: parameter.defaultValue ?? null,
        position,
        optionSourceCode: parameter.optionSourceCode || null,
        options: Array.isArray(parameter.options) ? parameter.options : [],
        confidence: 'high',
        source: 'descriptor',
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.position - right.position);
}

function inspectDescriptor(descriptorFile, descriptor, sourceAnalysis, findings) {
  if (!descriptorFile) {
    addFinding(
      findings,
      'INFO',
      'DESCRIPTOR_NOT_PROVIDED',
      'No skycommand.tool.json descriptor was provided. Source analysis will provide best-effort suggestions.',
      {
        fileKind: 'descriptor',
        confidence: 'high',
      },
    );
    return null;
  }

  if (descriptorFile.filename !== 'skycommand.tool.json') {
    addFinding(
      findings,
      'WARNING',
      'DESCRIPTOR_FILENAME_NONSTANDARD',
      'The recommended descriptor filename is skycommand.tool.json.',
      {
        fileKind: 'descriptor',
        filename: descriptorFile.filename,
        confidence: 'high',
      },
    );
  }

  if (!descriptor) {
    return null;
  }

  const descriptorVersion = String(descriptor.descriptorVersion || '').trim();
  const toolCode = String(descriptor.toolCode || '')
    .trim()
    .toLowerCase();
  const runtimeCode = String(descriptor.runtimeCode || '')
    .trim()
    .toLowerCase();
  const entrypoint = String(descriptor.entrypoint || '').trim();
  const outputType = String(descriptor.resultContract?.outputType || '').trim();
  const schemaPath = String(descriptor.resultContract?.schemaPath || '').trim();
  const packagePath = descriptor.packagePath ? String(descriptor.packagePath).trim() : '';
  const visibility = Array.isArray(descriptor.visibility) ? descriptor.visibility.map(String) : [];
  const parameters = normalizeDescriptorParameters(descriptor.parameters, findings);

  if (descriptorVersion !== '1.0') {
    addFinding(
      findings,
      'ERROR',
      'DESCRIPTOR_VERSION_UNSUPPORTED',
      'descriptorVersion must be 1.0.',
      {
        fileKind: 'descriptor',
        confidence: 'high',
      },
    );
  }

  if (!TOOL_CODE_PATTERN.test(toolCode)) {
    addFinding(
      findings,
      'ERROR',
      'DESCRIPTOR_TOOL_CODE_INVALID',
      'Descriptor toolCode must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.',
      {
        fileKind: 'descriptor',
        confidence: 'high',
      },
    );
  }

  if (runtimeCode !== 'node') {
    addFinding(
      findings,
      'ERROR',
      'DESCRIPTOR_RUNTIME_UNSUPPORTED',
      'Phase 15 v1 supports runtimeCode node only.',
      {
        fileKind: 'descriptor',
        confidence: 'high',
      },
    );
  }

  if (
    entrypoint &&
    entrypoint !== sourceAnalysis.filename &&
    entrypoint !== MANAGED_SCRIPT_FILENAME
  ) {
    addFinding(
      findings,
      'ERROR',
      'DESCRIPTOR_ENTRYPOINT_MISMATCH',
      `Descriptor entrypoint ${entrypoint} matches neither uploaded script ${sourceAnalysis.filename} nor the managed entrypoint ${MANAGED_SCRIPT_FILENAME}.`,
      {
        fileKind: 'descriptor',
        confidence: 'high',
      },
    );
  } else if (entrypoint === MANAGED_SCRIPT_FILENAME && sourceAnalysis.filename !== entrypoint) {
    addFinding(
      findings,
      'INFO',
      'DESCRIPTOR_ENTRYPOINT_MANAGED_NAME',
      `The uploaded script ${sourceAnalysis.filename} will be installed as the canonical managed entrypoint ${MANAGED_SCRIPT_FILENAME}.`,
      {
        fileKind: 'descriptor',
        filename: sourceAnalysis.filename,
        managedFilename: MANAGED_SCRIPT_FILENAME,
        confidence: 'high',
      },
    );
  } else if (entrypoint === sourceAnalysis.filename && entrypoint !== MANAGED_SCRIPT_FILENAME) {
    addFinding(
      findings,
      'INFO',
      'DESCRIPTOR_ENTRYPOINT_WILL_BE_NORMALIZED',
      `The uploaded entrypoint ${entrypoint} is valid for analysis and will be normalized to ${MANAGED_SCRIPT_FILENAME} during managed registration.`,
      {
        fileKind: 'descriptor',
        filename: sourceAnalysis.filename,
        managedFilename: MANAGED_SCRIPT_FILENAME,
        confidence: 'high',
      },
    );
  }

  if (outputType && !OUTPUT_TYPE_PATTERN.test(outputType)) {
    addFinding(
      findings,
      'ERROR',
      'DESCRIPTOR_OUTPUT_TYPE_INVALID',
      'Descriptor resultContract.outputType is invalid.',
      {
        fileKind: 'descriptor',
        confidence: 'high',
      },
    );
  }

  let normalizedPackagePath = null;
  if (packagePath) {
    try {
      normalizedPackagePath = skycommandRepositoryService.normalizeToolPackageRelativePath(
        packagePath,
        { toolCode },
      );
    } catch (error) {
      addFinding(findings, 'ERROR', 'DESCRIPTOR_PACKAGE_PATH_UNSAFE', error.message, {
        fileKind: 'descriptor',
        confidence: 'high',
      });
    }
  }

  visibility.forEach((channel) => {
    if (!ACCEPTED_VISIBILITY.has(channel)) {
      addFinding(
        findings,
        'ERROR',
        'DESCRIPTOR_VISIBILITY_UNSUPPORTED',
        `Descriptor visibility channel is unsupported: ${channel}`,
        {
          fileKind: 'descriptor',
          confidence: 'high',
        },
      );
    }
  });

  if (sourceAnalysis.inferredToolCode && toolCode && sourceAnalysis.inferredToolCode !== toolCode) {
    addFinding(
      findings,
      'WARNING',
      'TOOL_CODE_MISMATCH',
      `Descriptor toolCode ${toolCode} differs from source TOOL_CODE ${sourceAnalysis.inferredToolCode}.`,
      {
        fileKind: 'descriptor',
        confidence: 'high',
      },
    );
  }

  if (
    sourceAnalysis.inferredOutputType &&
    outputType &&
    sourceAnalysis.inferredOutputType !== outputType
  ) {
    addFinding(
      findings,
      'WARNING',
      'OUTPUT_TYPE_MISMATCH',
      `Descriptor output type ${outputType} differs from source OUTPUT_TYPE ${sourceAnalysis.inferredOutputType}.`,
      {
        fileKind: 'descriptor',
        confidence: 'high',
      },
    );
  }

  return {
    descriptorVersion,
    toolCode,
    label: String(descriptor.label || '').trim(),
    description: String(descriptor.description || '').trim(),
    runtimeCode,
    entrypoint,
    packagePath: normalizedPackagePath,
    categoryCode: String(descriptor.categoryCode || '')
      .trim()
      .toLowerCase(),
    permissionCode: descriptor.permissionCode
      ? String(descriptor.permissionCode).trim().toUpperCase()
      : null,
    riskCode: String(descriptor.riskCode || 'low')
      .trim()
      .toLowerCase(),
    requiresConfirmation: Boolean(descriptor.requiresConfirmation),
    confirmationText: descriptor.confirmationText || null,
    capturesOutput: descriptor.capturesOutput !== false,
    allowParams: descriptor.allowParams !== false && parameters.length > 0,
    parameters,
    resultContract: {
      outputType: outputType || null,
      schemaPath: schemaPath || null,
    },
    visibility,
  };
}

function resolveLocalSchemaReference(schema, reference) {
  if (reference === '#') {
    return schema;
  }

  if (!String(reference || '').startsWith('#/')) {
    return { resolved: false, remote: true };
  }

  const tokens = reference
    .slice(2)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = schema;

  for (const token of tokens) {
    if (
      !current ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, token)
    ) {
      return { resolved: false, remote: false };
    }
    current = current[token];
  }

  return { resolved: true, remote: false };
}

function inspectSchema(schemaFile, schema, expectedOutputType, findings) {
  if (!schemaFile) {
    if (expectedOutputType) {
      addFinding(
        findings,
        'INFO',
        'SCHEMA_NOT_PROVIDED',
        'No output schema was provided. Structured output can still use the generic renderer.',
        {
          fileKind: 'schema',
          confidence: 'high',
        },
      );
    }
    return null;
  }

  if (!schemaFile.filename.endsWith('.schema.json')) {
    addFinding(
      findings,
      'ERROR',
      'SCHEMA_FILENAME_INVALID',
      'Output schema filename must end with .schema.json.',
      {
        fileKind: 'schema',
        filename: schemaFile.filename,
        confidence: 'high',
      },
    );
  }

  if (!schema) {
    return null;
  }

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    addFinding(
      findings,
      'ERROR',
      'SCHEMA_ROOT_INVALID',
      'Output schema root must be a JSON object.',
      {
        fileKind: 'schema',
        confidence: 'high',
      },
    );
    return null;
  }

  if (expectedOutputType && schemaFile.filename !== `${expectedOutputType}.schema.json`) {
    addFinding(
      findings,
      'ERROR',
      'SCHEMA_OUTPUT_TYPE_FILENAME_MISMATCH',
      `Schema filename must be ${expectedOutputType}.schema.json.`,
      {
        fileKind: 'schema',
        filename: schemaFile.filename,
        confidence: 'high',
      },
    );
  }

  if (expectedOutputType && schema.$id && schema.$id !== expectedOutputType) {
    addFinding(
      findings,
      'WARNING',
      'SCHEMA_ID_MISMATCH',
      `Schema $id ${schema.$id} differs from output type ${expectedOutputType}.`,
      {
        fileKind: 'schema',
        confidence: 'high',
      },
    );
  }

  let nodeCount = 0;
  const visited = new Set();

  function visit(node, depth, location) {
    if (node === true || node === false) {
      return;
    }

    if (!node || typeof node !== 'object') {
      addFinding(
        findings,
        'ERROR',
        'SCHEMA_NODE_INVALID',
        `Schema node ${location} must be an object or boolean.`,
        {
          fileKind: 'schema',
          confidence: 'high',
        },
      );
      return;
    }

    if (visited.has(node)) {
      return;
    }
    visited.add(node);
    nodeCount += 1;

    if (nodeCount > MAX_SCHEMA_NODES) {
      addFinding(
        findings,
        'ERROR',
        'SCHEMA_NODE_LIMIT_EXCEEDED',
        `Schema exceeds the maximum of ${MAX_SCHEMA_NODES} nodes.`,
        {
          fileKind: 'schema',
          confidence: 'high',
        },
      );
      return;
    }

    if (depth > MAX_SCHEMA_DEPTH) {
      addFinding(
        findings,
        'ERROR',
        'SCHEMA_DEPTH_LIMIT_EXCEEDED',
        `Schema exceeds the maximum nesting depth of ${MAX_SCHEMA_DEPTH}.`,
        {
          fileKind: 'schema',
          confidence: 'high',
        },
      );
      return;
    }

    Object.keys(node).forEach((keyword) => {
      if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
        addFinding(
          findings,
          'WARNING',
          'SCHEMA_KEYWORD_UNSUPPORTED',
          `Schema keyword ${keyword} is not interpreted by the current SkyCommand validator.`,
          {
            fileKind: 'schema',
            keyword,
            location,
            confidence: 'high',
          },
        );
      }
    });

    if (node.$ref) {
      const resolution = resolveLocalSchemaReference(schema, node.$ref);
      if (resolution.remote) {
        addFinding(
          findings,
          'ERROR',
          'SCHEMA_REMOTE_REFERENCE_FORBIDDEN',
          `Remote JSON Schema reference is not allowed: ${node.$ref}`,
          {
            fileKind: 'schema',
            location,
            confidence: 'high',
          },
        );
      } else if (!resolution.resolved) {
        addFinding(
          findings,
          'ERROR',
          'SCHEMA_REFERENCE_UNRESOLVED',
          `Local JSON Schema reference cannot be resolved: ${node.$ref}`,
          {
            fileKind: 'schema',
            location,
            confidence: 'high',
          },
        );
      }
    }

    if (node.format && !ALLOWED_FORMATS.has(node.format)) {
      addFinding(
        findings,
        'WARNING',
        'SCHEMA_FORMAT_UNSUPPORTED',
        `Schema format ${node.format} is not interpreted by the current validator.`,
        {
          fileKind: 'schema',
          location,
          confidence: 'high',
        },
      );
    }

    if (node.properties && typeof node.properties === 'object') {
      Object.entries(node.properties).forEach(([key, child]) =>
        visit(child, depth + 1, `${location}.properties.${key}`),
      );
    }
    if (node.items) {
      visit(node.items, depth + 1, `${location}.items`);
    }
    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      visit(node.additionalProperties, depth + 1, `${location}.additionalProperties`);
    }
    ['allOf', 'anyOf', 'oneOf'].forEach((keyword) => {
      if (Array.isArray(node[keyword])) {
        node[keyword].forEach((child, index) =>
          visit(child, depth + 1, `${location}.${keyword}[${index}]`),
        );
      }
    });
    if (node.not) {
      visit(node.not, depth + 1, `${location}.not`);
    }
    ['$defs', 'definitions'].forEach((keyword) => {
      if (node[keyword] && typeof node[keyword] === 'object') {
        Object.entries(node[keyword]).forEach(([key, child]) =>
          visit(child, depth + 1, `${location}.${keyword}.${key}`),
        );
      }
    });
  }

  visit(schema, 0, '$');

  addFinding(
    findings,
    'INFO',
    'SCHEMA_PARSED',
    `Output schema parsed with ${nodeCount} schema node(s).`,
    {
      fileKind: 'schema',
      confidence: 'high',
    },
  );

  return {
    id: schema.$id || null,
    schemaVersion: schema.$schema || null,
    rootType: schema.type || null,
    nodeCount,
  };
}

function buildSuggestions({ script, sourceAnalysis, descriptorAnalysis }) {
  const descriptor = descriptorAnalysis || {};
  const toolCode = descriptor.toolCode || sourceAnalysis.inferredToolCode || '';
  const outputType =
    descriptor.resultContract?.outputType || sourceAnalysis.inferredOutputType || '';
  const parameters = descriptor.parameters?.length
    ? descriptor.parameters
    : sourceAnalysis.inferredParameters;

  return {
    toolCode,
    name: toolCode,
    label:
      descriptor.label ||
      (toolCode
        ? toolCode.replace(/_/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase())
        : ''),
    description: descriptor.description || '',
    runtimeCode: descriptor.runtimeCode || 'node',
    categoryCode: descriptor.categoryCode || '',
    permissionCode: descriptor.permissionCode || null,
    riskCode: descriptor.riskCode || 'low',
    requiresConfirmation: Boolean(descriptor.requiresConfirmation),
    confirmationText: descriptor.confirmationText || null,
    capturesOutput: descriptor.capturesOutput !== false,
    allowParams: parameters.length > 0,
    visibility: descriptor.visibility?.length
      ? descriptor.visibility
      : ['admin-web', 'api', 'cli', 'worker'],
    parameters,
    outputType: outputType || null,
    outputSchemaFilename:
      descriptor.resultContract?.schemaPath || (outputType ? `${outputType}.schema.json` : null),
    scriptFilename: script.filename,
    destinationRelativePath: toolCode
      ? descriptor.packagePath ||
        `${skycommandRepositoryService.DEFAULT_TOOL_PACKAGE_RELATIVE_PATH}/${toolCode}`
      : null,
    confidence: descriptorAnalysis ? 'high' : 'medium',
  };
}

function addCatalogueReferenceFindings(analysis, catalogueOptions = {}) {
  const { suggestions, descriptorAnalysis, findings } = analysis;
  const sets = {
    categories: new Set((catalogueOptions.categories || []).map((item) => item.categoryCode)),
    runtimes: new Set((catalogueOptions.runtimes || []).map((item) => item.runtimeCode)),
    permissions: new Set((catalogueOptions.permissions || []).map((item) => item.permissionCode)),
    risks: new Set((catalogueOptions.risks || []).map((item) => item.riskCode)),
    paramTypes: new Set((catalogueOptions.paramTypes || []).map((item) => item.paramTypeCode)),
    optionSources: new Set(
      (catalogueOptions.optionSources || []).map((item) => item.optionSourceCode),
    ),
    visibility: new Set(
      (catalogueOptions.visibilityChannels || []).map((item) => item.channelCode),
    ),
  };

  if (suggestions.runtimeCode && !sets.runtimes.has(suggestions.runtimeCode)) {
    addFinding(
      findings,
      'ERROR',
      'CATALOGUE_RUNTIME_UNAVAILABLE',
      `Runtime is not active in the SkyCommand catalogue: ${suggestions.runtimeCode}`,
      { confidence: 'high' },
    );
  }

  if (descriptorAnalysis?.categoryCode && !sets.categories.has(descriptorAnalysis.categoryCode)) {
    addFinding(
      findings,
      'ERROR',
      'CATALOGUE_CATEGORY_UNAVAILABLE',
      `Tool category is not active in the SkyCommand catalogue: ${descriptorAnalysis.categoryCode}`,
      { confidence: 'high' },
    );
  }

  if (
    descriptorAnalysis?.permissionCode &&
    !sets.permissions.has(descriptorAnalysis.permissionCode)
  ) {
    addFinding(
      findings,
      'ERROR',
      'CATALOGUE_PERMISSION_UNAVAILABLE',
      `Permission is not active in the SkyCommand catalogue: ${descriptorAnalysis.permissionCode}`,
      { confidence: 'high' },
    );
  }

  if (descriptorAnalysis?.riskCode && !sets.risks.has(descriptorAnalysis.riskCode)) {
    addFinding(
      findings,
      'ERROR',
      'CATALOGUE_RISK_UNAVAILABLE',
      `Risk level is not active in the SkyCommand catalogue: ${descriptorAnalysis.riskCode}`,
      { confidence: 'high' },
    );
  }

  (suggestions.parameters || []).forEach((parameter) => {
    if (parameter.type && !sets.paramTypes.has(parameter.type)) {
      addFinding(
        findings,
        'ERROR',
        'CATALOGUE_PARAMETER_TYPE_UNAVAILABLE',
        `Parameter ${parameter.name} uses a type that is not active in the catalogue: ${parameter.type}`,
        { confidence: 'high' },
      );
    }

    if (parameter.optionSourceCode && !sets.optionSources.has(parameter.optionSourceCode)) {
      addFinding(
        findings,
        'ERROR',
        'CATALOGUE_OPTION_SOURCE_UNAVAILABLE',
        `Parameter ${parameter.name} references an unavailable option source: ${parameter.optionSourceCode}`,
        { confidence: 'high' },
      );
    }
  });

  (suggestions.visibility || []).forEach((channel) => {
    if (!sets.visibility.has(channel)) {
      addFinding(
        findings,
        'ERROR',
        'CATALOGUE_VISIBILITY_UNAVAILABLE',
        `Visibility channel is not active in the catalogue: ${channel}`,
        { confidence: 'high' },
      );
    }
  });

  analysis.summary = summarizeFindings(findings);
  return analysis;
}

function summarizeFindings(findings) {
  const counts = findings.reduce(
    (summary, finding) => {
      const key = String(finding.severity || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(summary, key)) {
        summary[key] += 1;
      }
      return summary;
    },
    { error: 0, warning: 0, info: 0 },
  );

  return {
    ...counts,
    total: findings.length,
    status: counts.error > 0 ? 'BLOCKED' : counts.warning > 0 ? 'REVIEW' : 'READY',
    canContinue: counts.error === 0,
  };
}

function analyzePackageContent(rawBody = {}, options = {}) {
  const uploads = normalizeUploads(rawBody);
  const findings = [];
  const sourceAnalysis = inspectSource(uploads.script, findings);
  sourceAnalysis.filename = uploads.script.filename;
  const descriptorJson = parseJsonFile(uploads.descriptor, findings, 'descriptor');
  const descriptorAnalysis = inspectDescriptor(
    uploads.descriptor,
    descriptorJson,
    sourceAnalysis,
    findings,
  );
  const suggestions = buildSuggestions({
    script: uploads.script,
    sourceAnalysis,
    descriptorAnalysis,
  });
  const schemaJson = parseJsonFile(uploads.schema, findings, 'schema');
  const schemaAnalysis = inspectSchema(
    uploads.schema,
    schemaJson,
    suggestions.outputType,
    findings,
  );

  if (options.existingToolCode && suggestions.toolCode) {
    addFinding(
      findings,
      'ERROR',
      'TOOL_CODE_ALREADY_REGISTERED',
      `Tool code is already registered: ${suggestions.toolCode}`,
      {
        confidence: 'high',
      },
    );
  }

  if (options.destinationExists && suggestions.destinationRelativePath) {
    addFinding(
      findings,
      'ERROR',
      'SKYCOMMAND_TOOL_DESTINATION_EXISTS',
      `Managed destination already exists: ${suggestions.destinationRelativePath}`,
      {
        confidence: 'high',
      },
    );
  }

  return {
    uploads,
    findings,
    sourceAnalysis,
    descriptorAnalysis,
    schemaAnalysis,
    suggestions,
    summary: summarizeFindings(findings),
  };
}

async function cleanupExpiredSessions(stagingRoot = DEFAULT_STAGING_ROOT) {
  let entries;

  try {
    entries = await fs.promises.readdir(stagingRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const cutoff = Date.now() - SESSION_TTL_MS;

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directoryPath = path.join(stagingRoot, entry.name);
        try {
          const stats = await fs.promises.stat(directoryPath);
          if (stats.mtimeMs < cutoff) {
            await fs.promises.rm(directoryPath, { recursive: true, force: true });
          }
        } catch {
          // Best-effort cleanup must not block a new analysis session.
        }
      }),
  );
}

async function stageUploads(uploads, analysis, actor = null, stagingRoot = DEFAULT_STAGING_ROOT) {
  await fs.promises.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  await cleanupExpiredSessions(stagingRoot);

  const sessionId = crypto.randomUUID();
  const sessionPath = path.join(stagingRoot, sessionId);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
  await fs.promises.mkdir(sessionPath, { recursive: false, mode: 0o700 });

  try {
    for (const file of uploads.files) {
      await fs.promises.writeFile(path.join(sessionPath, file.filename), file.content, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    }

    const metadata = {
      sessionId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: analysis.summary.status,
      actorUserId: getActorUserId(actor),
      files: uploads.files.map(({ kind, filename, sizeBytes, sha256 }) => ({
        kind,
        filename,
        sizeBytes,
        sha256,
      })),
      findings: analysis.findings.map(
        ({ severity, code, message, fileKind, filename, confidence }) => ({
          severity,
          code,
          message,
          fileKind: fileKind || null,
          filename: filename || null,
          confidence: confidence || null,
        }),
      ),
      suggestions: analysis.suggestions,
    };

    await fs.promises.writeFile(
      path.join(sessionPath, 'analysis.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );

    return {
      sessionId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: analysis.summary.status,
      files: metadata.files,
    };
  } catch (error) {
    await fs.promises.rm(sessionPath, { recursive: true, force: true });
    throw error;
  }
}

async function recordAuditEvent({
  actor,
  context = {},
  session,
  analysis,
  success = true,
  error = null,
}) {
  try {
    const { query } = require('../../../../packages/db/src/connection');
    await query(
      `
        INSERT INTO auth.audit_events (
          user_id,
          event_type,
          resource_type,
          resource_id,
          action,
          success,
          message,
          metadata,
          ip_address,
          user_agent
        )
        VALUES ($1, $2, 'tool_onboarding_session', $3, 'ANALYZE', $4, $5, $6::jsonb, $7, $8)
      `,
      [
        getActorUserId(actor),
        success ? 'TOOL_ONBOARDING_ANALYZED' : 'TOOL_ONBOARDING_ANALYSIS_FAILED',
        session?.sessionId || null,
        success,
        success
          ? `Tool onboarding package analyzed with status ${analysis?.summary?.status || 'UNKNOWN'}.`
          : `Tool onboarding analysis failed: ${error?.message || 'Unknown error'}`,
        JSON.stringify({
          privilegeCode: 'ADMIN_TOOL_WRITE',
          status: analysis?.summary?.status || null,
          counts: analysis?.summary || null,
          toolCode: analysis?.suggestions?.toolCode || null,
          files: session?.files || [],
          errorCode: error?.details?.code || error?.code || null,
        }),
        context.ipAddress || null,
        context.userAgent || null,
      ],
    );
  } catch (auditError) {
    console.warn('[Tool Onboarding] Audit write failed:', auditError.message);
  }
}

async function getOptions() {
  const toolAdminService = require('./toolAdminService');
  const [readiness, catalogueOptions] = await Promise.all([
    skycommandRepositoryService.getSkycommandRepositoryReadiness(),
    toolAdminService.getOptions(),
  ]);

  return {
    readiness,
    catalogueOptions: {
      ...catalogueOptions,
      packagesRelativePath: readiness.packagesRelativePath,
      defaultToolPackageRelativePath: readiness.defaultToolPackageRelativePath,
    },
    uploadPolicy: {
      runtimeCode: 'node',
      script: {
        required: true,
        acceptedExtensions: ['.js'],
        maximumBytes: MAX_FILE_BYTES.script,
      },
      descriptor: {
        required: false,
        recommendedFilename: 'skycommand.tool.json',
        maximumBytes: MAX_FILE_BYTES.descriptor,
      },
      schema: {
        required: false,
        filenamePattern: '<outputType>.schema.json',
        maximumBytes: MAX_FILE_BYTES.schema,
      },
      maximumTotalBytes: MAX_TOTAL_BYTES,
      sessionTtlHours: SESSION_TTL_MS / (60 * 60 * 1000),
      executesUploadedCode: false,
      installsDependencies: false,
      registersTool: true,
      registrationMode: 'disabled-first',
      writesManagedFiles: true,
      destinationPolicy: {
        allowedRoot: readiness.packagesRelativePath || 'packages',
        defaultRoot: readiness.defaultToolPackageRelativePath || 'packages/tools/custom',
        createNewOnly: true,
      },
    },
  };
}

function getPathApiForRoot(rootPath) {
  const value = String(rootPath || '');
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') ? path.win32 : path;
}

async function pathExists(targetPath) {
  return fs.promises
    .access(targetPath, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

function normalizeSessionId(value) {
  const sessionId = String(value || '').trim();

  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw createHttpError(400, 'A valid onboarding sessionId is required.', {
      code: 'TOOL_ONBOARDING_SESSION_INVALID',
    });
  }

  return sessionId;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function hashJson(value) {
  return hashContent(JSON.stringify(stableValue(value)));
}

async function readOnboardingSession({ sessionId, actor, stagingRoot = DEFAULT_STAGING_ROOT }) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  await cleanupExpiredSessions(stagingRoot);
  const sessionPath = path.join(stagingRoot, normalizedSessionId);
  let metadata;

  try {
    metadata = JSON.parse(
      await fs.promises.readFile(path.join(sessionPath, 'analysis.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw createHttpError(404, 'Tool onboarding session was not found or has expired.', {
        code: 'TOOL_ONBOARDING_SESSION_NOT_FOUND',
        sessionId: normalizedSessionId,
      });
    }

    throw createHttpError(409, 'Tool onboarding session metadata is unavailable.', {
      code: 'TOOL_ONBOARDING_SESSION_METADATA_INVALID',
      sessionId: normalizedSessionId,
    });
  }

  if (!metadata.expiresAt || new Date(metadata.expiresAt).getTime() <= Date.now()) {
    await fs.promises.rm(sessionPath, { recursive: true, force: true }).catch(() => {});
    throw createHttpError(410, 'Tool onboarding session has expired.', {
      code: 'TOOL_ONBOARDING_SESSION_EXPIRED',
      sessionId: normalizedSessionId,
    });
  }

  const actorUserId = getActorUserId(actor);
  if (metadata.actorUserId && actorUserId && metadata.actorUserId !== actorUserId) {
    throw createHttpError(403, 'This onboarding session belongs to another administrator.', {
      code: 'TOOL_ONBOARDING_SESSION_OWNER_MISMATCH',
      sessionId: normalizedSessionId,
    });
  }

  const files = {};
  for (const file of metadata.files || []) {
    if (!file || !['script', 'descriptor', 'schema'].includes(file.kind)) {
      throw createHttpError(409, 'Tool onboarding session contains invalid file metadata.', {
        code: 'TOOL_ONBOARDING_SESSION_METADATA_INVALID',
        sessionId: normalizedSessionId,
      });
    }

    const content = await fs.promises.readFile(path.join(sessionPath, file.filename), 'utf8');
    const actualHash = hashContent(content);
    if (actualHash !== file.sha256) {
      throw createHttpError(
        409,
        'A staged onboarding file no longer matches its analysis evidence.',
        {
          code: 'TOOL_ONBOARDING_SESSION_FILE_CHANGED',
          sessionId: normalizedSessionId,
          filename: file.filename,
        },
      );
    }

    files[file.kind] = { ...file, content };
  }

  if (!files.script) {
    throw createHttpError(409, 'The onboarding session no longer contains its entry script.', {
      code: 'TOOL_ONBOARDING_SESSION_SCRIPT_MISSING',
      sessionId: normalizedSessionId,
    });
  }

  return {
    sessionId: normalizedSessionId,
    sessionPath,
    metadata,
    files,
  };
}

function buildCanonicalDescriptor(payload, catalogueOptions, paths) {
  const category = (catalogueOptions.categories || []).find(
    (item) => item.categoryId === payload.categoryId,
  );

  return {
    descriptorVersion: '1.0',
    toolCode: payload.toolCode,
    label: payload.label,
    description: payload.description || null,
    runtimeCode: payload.runtimeCode,
    entrypoint: MANAGED_SCRIPT_FILENAME,
    packagePath: paths.packageRelativePath,
    categoryCode: category?.categoryCode || null,
    permissionCode: payload.permissionCode || null,
    riskCode: payload.riskCode,
    requiresConfirmation: payload.requiresConfirmation,
    confirmationText: payload.confirmationText || null,
    capturesOutput: payload.capturesOutput,
    allowParams: payload.parameters.some((parameter) => parameter.enabled),
    parameters: payload.parameters
      .filter((parameter) => parameter.enabled)
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((parameter) => ({
        name: parameter.parameterName,
        label: parameter.label,
        type: parameter.paramTypeCode,
        prompt: parameter.prompt || null,
        required: parameter.required,
        defaultValue: parameter.defaultValue,
        position: parameter.displayOrder,
        optionSourceCode: parameter.optionSourceCode || null,
        options: parameter.options.map((option) => ({
          label: option.label,
          value: option.value,
          position: option.displayOrder,
        })),
      })),
    resultContract: payload.outputType
      ? {
          outputType: payload.outputType,
          schemaPath: paths.schemaFilename || null,
        }
      : null,
    visibility: payload.visibility,
  };
}

function buildRegistrationPlan({
  session,
  payload,
  readiness,
  destination,
  catalogueOptions,
  toolCodeExists = false,
  destinationExists = false,
}) {
  const pathApi = getPathApiForRoot(readiness.path.resolvedRootPath);
  const packageRelativePath = destination.packageRelativePath;
  const packagePhysicalPath = destination.packagePhysicalPath;
  const scriptRelativePath = path.posix.join(packageRelativePath, MANAGED_SCRIPT_FILENAME);
  const descriptorRelativePath = path.posix.join(packageRelativePath, MANAGED_DESCRIPTOR_FILENAME);
  const schemaFilename = session.files.schema
    ? `${payload.outputType || 'output'}.schema.json`
    : null;
  const outputSchemaPath = schemaFilename
    ? path.posix.join(packageRelativePath, schemaFilename)
    : null;
  const paths = {
    packageRelativePath,
    packagePhysicalPath,
    scriptRelativePath,
    scriptPhysicalPath: pathApi.join(packagePhysicalPath, MANAGED_SCRIPT_FILENAME),
    descriptorRelativePath,
    descriptorPhysicalPath: pathApi.join(packagePhysicalPath, MANAGED_DESCRIPTOR_FILENAME),
    outputSchemaPath,
    schemaFilename,
    schemaPhysicalPath: schemaFilename ? pathApi.join(packagePhysicalPath, schemaFilename) : null,
  };
  const descriptor = buildCanonicalDescriptor(payload, catalogueOptions, paths);
  const descriptorContent = `${JSON.stringify(descriptor, null, 2)}\n`;
  const filePlan = [
    {
      kind: 'script',
      sourceFilename: session.files.script.filename,
      filename: MANAGED_SCRIPT_FILENAME,
      content: session.files.script.content,
      sha256: hashContent(session.files.script.content),
      relativePath: scriptRelativePath,
      physicalPath: paths.scriptPhysicalPath,
    },
    {
      kind: 'descriptor',
      sourceFilename: session.files.descriptor?.filename || null,
      filename: MANAGED_DESCRIPTOR_FILENAME,
      content: descriptorContent,
      sha256: hashContent(descriptorContent),
      relativePath: descriptorRelativePath,
      physicalPath: paths.descriptorPhysicalPath,
      generated: true,
    },
  ];

  if (session.files.schema) {
    filePlan.push({
      kind: 'schema',
      sourceFilename: session.files.schema.filename,
      filename: schemaFilename,
      content: session.files.schema.content,
      sha256: hashContent(session.files.schema.content),
      relativePath: outputSchemaPath,
      physicalPath: paths.schemaPhysicalPath,
    });
  }

  const runtime = (catalogueOptions.runtimes || []).find(
    (item) => item.runtimeCode === payload.runtimeCode,
  );
  const argumentPreview = payload.parameters
    .filter((parameter) => parameter.enabled)
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((parameter) => `<${parameter.parameterName}${parameter.required ? '' : '?'}>`);
  const blockers = [];

  if ((session.metadata.findings || []).some((finding) => finding.severity === 'ERROR')) {
    blockers.push({
      code: 'TOOL_ONBOARDING_STATIC_ERRORS',
      message:
        'The staged package contains blocking static-analysis errors and must be corrected and uploaded again.',
    });
  }

  if (toolCodeExists) {
    blockers.push({
      code: 'TOOL_CODE_ALREADY_REGISTERED',
      message: `Tool code is already registered: ${payload.toolCode}`,
    });
  }

  if (destinationExists) {
    blockers.push({
      code: 'SKYCOMMAND_TOOL_DESTINATION_EXISTS',
      message: `Managed destination already exists: ${packageRelativePath}`,
    });
  }

  if (session.files.schema && !payload.outputType) {
    blockers.push({
      code: 'TOOL_ONBOARDING_OUTPUT_TYPE_REQUIRED',
      message: 'Structured output type is required when an output schema is uploaded.',
    });
  }

  if (
    session.files.schema &&
    session.files.schema.filename !== `${payload.outputType}.schema.json`
  ) {
    blockers.push({
      code: 'SCHEMA_FILENAME_OUTPUT_TYPE_MISMATCH',
      message: `Uploaded schema filename must be ${payload.outputType}.schema.json before registration.`,
    });
  }

  const warnings = (session.metadata.findings || []).filter(
    (finding) => finding.severity === 'WARNING',
  );
  const databasePreview = {
    tool: {
      toolCode: payload.toolCode,
      name: payload.name,
      label: payload.label,
      description: payload.description,
      categoryId: payload.categoryId,
      scriptRepoId: payload.scriptRepoId,
      scriptPath: scriptRelativePath,
      runtimeCode: payload.runtimeCode,
      permissionCode: payload.permissionCode,
      riskCode: payload.riskCode,
      requiresConfirmation: payload.requiresConfirmation,
      confirmationText: payload.confirmationText,
      capturesOutput: payload.capturesOutput,
      allowParams: payload.parameters.some((parameter) => parameter.enabled),
      displayOrder: payload.displayOrder,
      enabled: false,
      outputType: payload.outputType,
      outputSchemaPath,
      managedBySkyCommand: true,
    },
    visibility: payload.visibility,
    parameters: payload.parameters,
  };
  const fingerprint = hashJson({
    sessionId: session.sessionId,
    databasePreview,
    files: filePlan.map(({ kind, filename, sha256, relativePath }) => ({
      kind,
      filename,
      sha256,
      relativePath,
    })),
  });

  return {
    sessionId: session.sessionId,
    status: blockers.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'REVIEW' : 'READY',
    canRegister: blockers.length === 0,
    warningsRequireAcceptance: false,
    warningReviewMode: 'advisory',
    blockers,
    warnings,
    fingerprint,
    commandPreview: {
      executable: runtime?.executable || payload.runtimeCode,
      scriptPath: scriptRelativePath,
      arguments: argumentPreview,
      display: [runtime?.executable || payload.runtimeCode, scriptRelativePath, ...argumentPreview]
        .map((item) => (String(item).includes(' ') ? `"${item}"` : item))
        .join(' '),
    },
    paths,
    files: filePlan.map(({ content, ...file }) => file),
    databasePreview,
    descriptor,
    internal: {
      payload: {
        ...payload,
        scriptPath: scriptRelativePath,
        outputSchemaPath,
        enabled: false,
        allowParams: payload.parameters.some((parameter) => parameter.enabled),
      },
      filePlan,
    },
  };
}

async function buildServerRegistrationPlan({ sessionId, configuration = {}, actor }) {
  const [readiness, session] = await Promise.all([
    skycommandRepositoryService.assertSkycommandRepositoryReady(),
    readOnboardingSession({ sessionId, actor }),
  ]);
  const toolAdminService = require('./toolAdminService');
  const catalogueOptions = await toolAdminService.getOptions();
  const rawToolCode = String(configuration.toolCode || '')
    .trim()
    .toLowerCase();

  if (!TOOL_CODE_PATTERN.test(rawToolCode)) {
    throw createHttpError(400, 'toolCode must use lowercase letters, numbers, and underscores.', {
      code: 'TOOL_ONBOARDING_TOOL_CODE_INVALID',
    });
  }

  const destination = skycommandRepositoryService.resolveToolPackageDestination(
    readiness.path.resolvedRootPath,
    configuration.packageRelativePath,
    { toolCode: rawToolCode },
  );
  const scriptRelativePath = path.posix.join(
    destination.packageRelativePath,
    MANAGED_SCRIPT_FILENAME,
  );
  const schemaRelativePath = session.files.schema
    ? path.posix.join(
        destination.packageRelativePath,
        `${String(configuration.outputType || '').trim()}.schema.json`,
      )
    : null;
  const payload = await toolAdminService.validateToolConfiguration({
    ...configuration,
    toolCode: rawToolCode,
    scriptRepoId: readiness.repository.repoId,
    scriptPath: scriptRelativePath,
    runtimeCode: 'node',
    enabled: false,
    outputSchemaPath: schemaRelativePath,
    allowParams: Array.isArray(configuration.parameters)
      ? configuration.parameters.some((parameter) => parameter.enabled !== false)
      : false,
  });
  const [collisionResult, destinationExists] = await Promise.all([
    require('../../../../packages/db/src/connection').pool.query(
      'SELECT 1 FROM core.tools WHERE tool_code = $1 LIMIT 1',
      [payload.toolCode],
    ),
    pathExists(destination.packagePhysicalPath),
  ]);

  return buildRegistrationPlan({
    session,
    payload,
    readiness,
    destination,
    catalogueOptions,
    toolCodeExists: collisionResult.rowCount > 0,
    destinationExists,
  });
}

async function previewToolRegistration({ body = {}, actor }) {
  const plan = await buildServerRegistrationPlan({
    sessionId: body.sessionId,
    configuration: body.configuration || {},
    actor,
  });
  const { internal, ...safePlan } = plan;
  return { preview: safePlan };
}

async function writeManagedPackageStaging(plan) {
  const pathApi = getPathApiForRoot(plan.paths.packagePhysicalPath);
  const packageParentPath = pathApi.dirname(plan.paths.packagePhysicalPath);
  await fs.promises.mkdir(packageParentPath, { recursive: true, mode: 0o700 });
  const stagingName = `.skycommand-onboarding-${plan.sessionId}-${crypto.randomUUID().slice(0, 8)}`;
  const stagingPath = pathApi.join(packageParentPath, stagingName);
  await fs.promises.mkdir(stagingPath, { recursive: false, mode: 0o700 });

  try {
    for (const file of plan.internal.filePlan) {
      await fs.promises.writeFile(pathApi.join(stagingPath, file.filename), file.content, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    }
    return stagingPath;
  } catch (error) {
    await fs.promises.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function verifyPromotedFiles(plan) {
  for (const file of plan.internal.filePlan) {
    const content = await fs.promises.readFile(file.physicalPath, 'utf8');
    if (hashContent(content) !== file.sha256) {
      throw createHttpError(500, 'Managed tool file verification failed after promotion.', {
        code: 'TOOL_ONBOARDING_PROMOTION_VERIFICATION_FAILED',
        filename: file.filename,
      });
    }
  }
}

async function recordRegistrationFailure({
  actor,
  context = {},
  sessionId,
  toolCode,
  error,
  toolId,
}) {
  try {
    const { query } = require('../../../../packages/db/src/connection');
    await query(
      `
        INSERT INTO auth.audit_events (
          user_id, event_type, resource_type, resource_id, action, success,
          message, metadata, ip_address, user_agent
        )
        VALUES ($1, 'TOOL_ONBOARDING_REGISTRATION_FAILED', 'tool_onboarding_session', $2,
                'REGISTER', FALSE, $3, $4::jsonb, $5, $6)
      `,
      [
        getActorUserId(actor),
        sessionId || null,
        `Managed tool registration failed: ${error?.message || 'Unknown error'}`,
        JSON.stringify({
          privilegeCode: 'ADMIN_TOOL_WRITE',
          toolCode: toolCode || null,
          toolId: toolId || null,
          errorCode: error?.details?.code || error?.code || null,
        }),
        context.ipAddress || null,
        context.userAgent || null,
      ],
    );
  } catch (auditError) {
    console.warn('[Tool Onboarding] Registration failure audit write failed:', auditError.message);
  }
}

async function registerToolPackage({ body = {}, actor, context = {} }) {
  let stagingPath = null;
  let stagedTool = null;
  let plan = null;

  try {
    plan = await buildServerRegistrationPlan({
      sessionId: body.sessionId,
      configuration: body.configuration || {},
      actor,
    });

    if (!plan.canRegister) {
      throw createHttpError(409, 'Tool onboarding preview contains blocking findings.', {
        code: 'TOOL_ONBOARDING_REGISTRATION_BLOCKED',
        blockers: plan.blockers,
      });
    }

    // Preview/file hashes are registration evidence only. Registration always rebuilds and
    // revalidates the current plan; neither a preview token nor a stored file hash is a runtime gate.
    const previewEvidenceMatched =
      !body.previewFingerprint || body.previewFingerprint === plan.fingerprint;

    await skycommandRepositoryService.assertSkycommandRepositoryReady();
    stagingPath = await writeManagedPackageStaging(plan);
    const toolAdminService = require('./toolAdminService');
    stagedTool = await toolAdminService.createManagedTool({
      body: plan.internal.payload,
      actor,
      context,
      registration: {
        sessionId: plan.sessionId,
        originalFilename: plan.internal.filePlan.find((file) => file.kind === 'script')
          .sourceFilename,
        descriptorPath: plan.paths.descriptorRelativePath,
        fileHash: plan.internal.filePlan.find((file) => file.kind === 'script').sha256,
      },
    });

    if (await pathExists(plan.paths.packagePhysicalPath)) {
      throw createHttpError(409, 'Managed tool destination was created after preview.', {
        code: 'SKYCOMMAND_TOOL_DESTINATION_EXISTS',
        destination: plan.paths.packageRelativePath,
      });
    }

    await fs.promises.rename(stagingPath, plan.paths.packagePhysicalPath);
    stagingPath = null;
    await verifyPromotedFiles(plan);
    const finalizedTool = await toolAdminService.markManagedToolRegistered({
      toolId: stagedTool.tool.toolId,
      actor,
      context,
      registration: {
        sessionId: plan.sessionId,
        packagePath: plan.paths.packageRelativePath,
        files: plan.files.map(({ kind, filename, sha256, relativePath }) => ({
          kind,
          filename,
          sha256,
          relativePath,
        })),
        previewEvidenceMatched,
      },
    });

    const session = await readOnboardingSession({ sessionId: plan.sessionId, actor });
    await fs.promises.rm(session.sessionPath, { recursive: true, force: true });

    return {
      registration: {
        status: 'REGISTERED_DISABLED',
        message:
          'Managed tool files were promoted and the catalogue record was registered disabled.',
        enabled: false,
        tool: finalizedTool.tool,
        paths: plan.paths,
        files: plan.files,
        nextStep:
          'Open the disabled tool in Manage Tools to run the advisory contract check, perform a controlled test, and explicitly enable it when ready.',
      },
    };
  } catch (error) {
    if (stagingPath) {
      await fs.promises.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    }
    await recordRegistrationFailure({
      actor,
      context,
      sessionId: body.sessionId,
      toolCode: plan?.internal?.payload?.toolCode || body.configuration?.toolCode,
      toolId: stagedTool?.tool?.toolId || null,
      error,
    });

    if (stagedTool?.tool?.toolId) {
      error.details = {
        ...(error.details || {}),
        disabledToolId: stagedTool.tool.toolId,
        disabledToolCode: stagedTool.tool.toolCode,
        recovery:
          'A disabled managed catalogue record may remain. Inspect it in Manage Tools before retrying.',
      };
    }
    throw error;
  }
}

async function analyzeToolPackage({ body = {}, actor, context = {} }) {
  let session = null;
  let analysis = null;

  try {
    const readiness = await skycommandRepositoryService.assertSkycommandRepositoryReady();
    const toolAdminService = require('./toolAdminService');
    const catalogueOptions = await toolAdminService.getOptions();
    analysis = addCatalogueReferenceFindings(analyzePackageContent(body), catalogueOptions);

    const toolCode = analysis.suggestions.toolCode;
    let existingToolCode = false;
    let destinationExists = false;

    if (toolCode && TOOL_CODE_PATTERN.test(toolCode)) {
      const { pool } = require('../../../../packages/db/src/connection');
      const collisionResult = await pool.query(
        'SELECT 1 FROM core.tools WHERE tool_code = $1 LIMIT 1',
        [toolCode],
      );
      existingToolCode = collisionResult.rowCount > 0;
      const destination = skycommandRepositoryService.resolveToolPackageDestination(
        readiness.path.resolvedRootPath,
        analysis.suggestions.destinationRelativePath,
        { toolCode },
      );
      destinationExists = await pathExists(destination.packagePhysicalPath);
    }

    if (existingToolCode || destinationExists) {
      analysis = addCatalogueReferenceFindings(
        analyzePackageContent(body, { existingToolCode, destinationExists }),
        catalogueOptions,
      );
    }

    session = await stageUploads(analysis.uploads, analysis, actor);
    await recordAuditEvent({ actor, context, session, analysis, success: true });

    return {
      readiness,
      session,
      summary: analysis.summary,
      findings: analysis.findings,
      suggestions: analysis.suggestions,
      analysis: {
        source: {
          runtimeCode: analysis.sourceAnalysis.runtimeCode,
          usesRunToolCli: analysis.sourceAnalysis.usesRunToolCli,
          importsSharedAdapter: analysis.sourceAnalysis.importsSharedAdapter,
          inferredToolCode: analysis.sourceAnalysis.inferredToolCode,
          inferredOutputType: analysis.sourceAnalysis.inferredOutputType,
          inferredParameters: analysis.sourceAnalysis.inferredParameters,
          dependencies: analysis.sourceAnalysis.dependencies,
        },
        descriptor: analysis.descriptorAnalysis,
        schema: analysis.schemaAnalysis,
      },
    };
  } catch (error) {
    await recordAuditEvent({ actor, context, session, analysis, success: false, error });
    throw error;
  }
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  SESSION_TTL_MS,
  analyzePackageContent,
  buildRegistrationPlan,
  getOptions,
  analyzeToolPackage,
  previewToolRegistration,
  registerToolPackage,
};
