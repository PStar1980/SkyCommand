const { validateJsonSchema } = require('./jsonSchemaValidator');
const DEFAULT_TOOL_RESULT_MAX_BYTES = 1024 * 1024;
const TOOL_RESULT_SCHEMA_VERSION = '1.0';
const SUPPORTED_TOOL_RESULT_SCHEMA_VERSIONS = new Set([TOOL_RESULT_SCHEMA_VERSION]);
const LEGACY_TOOL_OUTPUT_TYPE = 'legacy_tool_execution.v1';
const OUTPUT_TYPE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{2,119}$/;

class ToolResultContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ToolResultContractError';
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonSafe(value, path = 'result', seen = new Set(), depth = 0) {
  if (depth > 40) {
    throw new ToolResultContractError(
      'TOOL_RESULT_MAX_DEPTH_EXCEEDED',
      `Structured tool result exceeds the maximum nesting depth at ${path}.`,
      { path, maxDepth: 40 },
    );
  }

  if (value === null) {
    return;
  }

  const valueType = typeof value;

  if (['string', 'boolean'].includes(valueType)) {
    return;
  }

  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw new ToolResultContractError(
        'TOOL_RESULT_NON_FINITE_NUMBER',
        `Structured tool result contains a non-finite number at ${path}.`,
        { path },
      );
    }
    return;
  }

  if (['undefined', 'function', 'symbol', 'bigint'].includes(valueType)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_UNSAFE_VALUE',
      `Structured tool result contains an unsupported ${valueType} value at ${path}.`,
      { path, valueType },
    );
  }

  if (value instanceof Date) {
    return;
  }

  if (seen.has(value)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_CIRCULAR_REFERENCE',
      `Structured tool result contains a circular reference at ${path}.`,
      { path },
    );
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`, seen, depth + 1));
  } else if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, nestedValue]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new ToolResultContractError(
          'TOOL_RESULT_UNSAFE_KEY',
          `Structured tool result contains an unsafe object key at ${path}.${key}.`,
          { path: `${path}.${key}`, key },
        );
      }

      assertJsonSafe(nestedValue, `${path}.${key}`, seen, depth + 1);
    });
  } else {
    throw new ToolResultContractError(
      'TOOL_RESULT_UNSAFE_OBJECT',
      `Structured tool result contains an unsupported object at ${path}.`,
      { path, constructorName: value?.constructor?.name || null },
    );
  }

  seen.delete(value);
}

function normalizeMaximumBytes(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TOOL_RESULT_MAX_BYTES;
}

function normalizeMessage(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const message = String(value).trim();

  if (message.length > 4000) {
    throw new ToolResultContractError(
      'TOOL_RESULT_MESSAGE_TOO_LONG',
      'Structured tool result message exceeds 4,000 characters.',
      { length: message.length },
    );
  }

  return message;
}

function validateToolResult(candidate, options = {}) {
  if (!isPlainObject(candidate)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_NOT_OBJECT',
      'Structured tool result must be a JSON object.',
    );
  }

  const schemaVersion = String(candidate.schemaVersion || '').trim();

  if (!SUPPORTED_TOOL_RESULT_SCHEMA_VERSIONS.has(schemaVersion)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported structured tool result schema version: ${schemaVersion || '(blank)'}.`,
      {
        schemaVersion: schemaVersion || null,
        supportedVersions: [...SUPPORTED_TOOL_RESULT_SCHEMA_VERSIONS],
      },
    );
  }

  if (typeof candidate.success !== 'boolean') {
    throw new ToolResultContractError(
      'TOOL_RESULT_SUCCESS_NOT_BOOLEAN',
      'Structured tool result success must be a boolean.',
    );
  }

  const outputType = String(candidate.outputType || '').trim();

  if (!OUTPUT_TYPE_PATTERN.test(outputType)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_INVALID_OUTPUT_TYPE',
      'Structured tool result outputType must be a stable lowercase code such as macro_ingestion_summary.v1.',
      { outputType: outputType || null },
    );
  }

  if (!Object.prototype.hasOwnProperty.call(candidate, 'output')) {
    throw new ToolResultContractError(
      'TOOL_RESULT_OUTPUT_MISSING',
      'Structured tool result must include an output field.',
      { outputType },
    );
  }

  const expectedOutputType = String(options.expectedOutputType || '').trim();

  if (expectedOutputType && outputType !== expectedOutputType) {
    throw new ToolResultContractError(
      'TOOL_RESULT_OUTPUT_TYPE_MISMATCH',
      `Structured tool result outputType ${outputType} does not match the declared contract ${expectedOutputType}.`,
      { outputType, expectedOutputType },
    );
  }

  if (candidate.warnings !== undefined && !Array.isArray(candidate.warnings)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_WARNINGS_NOT_ARRAY',
      'Structured tool result warnings must be an array.',
    );
  }

  if (candidate.error !== undefined && candidate.error !== null && !isPlainObject(candidate.error)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_ERROR_NOT_OBJECT',
      'Structured tool result error must be an object or null.',
    );
  }

  if (candidate.metadata !== undefined && candidate.metadata !== null && !isPlainObject(candidate.metadata)) {
    throw new ToolResultContractError(
      'TOOL_RESULT_METADATA_NOT_OBJECT',
      'Structured tool result metadata must be an object.',
    );
  }

  const normalized = {
    schemaVersion,
    success: candidate.success,
    message: normalizeMessage(candidate.message),
    outputType,
    output: candidate.output,
    warnings: candidate.warnings || [],
    error: candidate.error || null,
    metadata: candidate.metadata || {},
  };

  assertJsonSafe(normalized);

  if (options.outputSchema) {
    try {
      validateJsonSchema(normalized.output, options.outputSchema, {
        schemaName: expectedOutputType || outputType,
        path: '$.output',
      });
    } catch (error) {
      throw new ToolResultContractError(
        'TOOL_RESULT_OUTPUT_SCHEMA_INVALID',
        error.message || 'Structured tool result output failed its declared JSON Schema.',
        {
          outputType,
          expectedOutputType: expectedOutputType || null,
          errors: Array.isArray(error.errors) ? error.errors : [],
        },
      );
    }
  }

  const serialized = JSON.stringify(normalized);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  const maximumBytes = normalizeMaximumBytes(options.maxBytes);

  if (byteLength > maximumBytes) {
    throw new ToolResultContractError(
      'TOOL_RESULT_TOO_LARGE',
      `Structured tool result exceeds the maximum size of ${maximumBytes} bytes.`,
      { byteLength, maximumBytes },
    );
  }

  return JSON.parse(serialized);
}

function isToolResult(value) {
  return (
    isPlainObject(value)
    && typeof value.schemaVersion === 'string'
    && typeof value.success === 'boolean'
    && typeof value.outputType === 'string'
    && Object.prototype.hasOwnProperty.call(value, 'output')
  );
}

function getToolResultDomainOutput(value) {
  return isToolResult(value) ? value.output : value;
}

function createLegacyToolResult({
  success = true,
  message,
  executionId = null,
  toolCode = null,
  status = null,
  durationMs = null,
} = {}) {
  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success: Boolean(success),
    message: message || (success ? 'Tool completed successfully.' : 'Tool execution failed.'),
    outputType: LEGACY_TOOL_OUTPUT_TYPE,
    output: {
      executionId,
      toolCode,
      status,
      durationMs,
      structuredOutputAvailable: false,
    },
    warnings: [],
    error: success
      ? null
      : {
          code: 'LEGACY_TOOL_EXECUTION_FAILED',
          message: message || 'Tool execution failed.',
        },
    metadata: {
      legacyTool: true,
    },
  });
}

function serializeContractError(error) {
  if (!error) {
    return null;
  }

  return {
    code: error.code || 'TOOL_RESULT_CONTRACT_ERROR',
    message: error.message || String(error),
    details: isPlainObject(error.details) ? error.details : {},
  };
}

module.exports = {
  DEFAULT_TOOL_RESULT_MAX_BYTES,
  LEGACY_TOOL_OUTPUT_TYPE,
  SUPPORTED_TOOL_RESULT_SCHEMA_VERSIONS,
  TOOL_RESULT_SCHEMA_VERSION,
  ToolResultContractError,
  createLegacyToolResult,
  getToolResultDomainOutput,
  isPlainObject,
  isToolResult,
  normalizeMaximumBytes,
  serializeContractError,
  validateToolResult,
};
