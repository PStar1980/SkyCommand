class JsonSchemaValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'JsonSchemaValidationError';
    this.code = 'JSON_SCHEMA_VALIDATION_FAILED';
    this.errors = errors;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function decodeJsonPointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveLocalReference(rootSchema, reference) {
  if (reference === '#') {
    return rootSchema;
  }

  if (!String(reference || '').startsWith('#/')) {
    throw new JsonSchemaValidationError(
      `Only local JSON Schema references are supported: ${reference}`,
      [{ path: '$schema', keyword: '$ref', message: `Unsupported reference ${reference}` }],
    );
  }

  const tokens = reference
    .slice(2)
    .split('/')
    .map(decodeJsonPointerToken);

  let current = rootSchema;

  for (const token of tokens) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) {
      throw new JsonSchemaValidationError(
        `JSON Schema reference could not be resolved: ${reference}`,
        [{ path: '$schema', keyword: '$ref', message: `Unresolved reference ${reference}` }],
      );
    }

    current = current[token];
  }

  return current;
}

function getJsonType(value) {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (Number.isInteger(value)) {
    return 'integer';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  if (isPlainObject(value)) {
    return 'object';
  }

  return typeof value;
}

function matchesType(value, expectedType) {
  if (expectedType === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }

  if (expectedType === 'integer') {
    return Number.isInteger(value);
  }

  if (expectedType === 'object') {
    return isPlainObject(value);
  }

  if (expectedType === 'array') {
    return Array.isArray(value);
  }

  if (expectedType === 'null') {
    return value === null;
  }

  return typeof value === expectedType;
}

function joinPath(basePath, token) {
  if (/^\d+$/.test(String(token))) {
    return `${basePath}[${token}]`;
  }

  return `${basePath}.${token}`;
}

function addError(errors, path, keyword, message, details = {}) {
  errors.push({ path, keyword, message, ...details });
}

function validateFormat(value, format) {
  if (typeof value !== 'string') {
    return true;
  }

  if (format === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  }

  if (format === 'date-time') {
    return !Number.isNaN(Date.parse(value));
  }

  if (format === 'uri') {
    try {
      const parsed = new URL(value);
      return Boolean(parsed.protocol);
    } catch (_error) {
      return false;
    }
  }

  return true;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateNode(value, schema, rootSchema, path, errors) {
  if (schema === true || schema === undefined) {
    return;
  }

  if (schema === false) {
    addError(errors, path, 'falseSchema', 'Value is not permitted by this schema.');
    return;
  }

  if (!isPlainObject(schema)) {
    addError(errors, path, 'schema', 'Schema node must be an object or boolean.');
    return;
  }

  if (schema.$ref) {
    const referencedSchema = resolveLocalReference(rootSchema, schema.$ref);
    validateNode(value, referencedSchema, rootSchema, path, errors);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((nestedSchema) => {
      validateNode(value, nestedSchema, rootSchema, path, errors);
    });
  }

  if (Array.isArray(schema.anyOf)) {
    const branchMatches = schema.anyOf.some((nestedSchema) => {
      const branchErrors = [];
      validateNode(value, nestedSchema, rootSchema, path, branchErrors);
      return branchErrors.length === 0;
    });

    if (!branchMatches) {
      addError(errors, path, 'anyOf', 'Value does not match any allowed schema branch.');
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const matchingBranches = schema.oneOf.filter((nestedSchema) => {
      const branchErrors = [];
      validateNode(value, nestedSchema, rootSchema, path, branchErrors);
      return branchErrors.length === 0;
    }).length;

    if (matchingBranches !== 1) {
      addError(errors, path, 'oneOf', `Value must match exactly one schema branch; matched ${matchingBranches}.`);
    }
  }

  if (schema.not) {
    const branchErrors = [];
    validateNode(value, schema.not, rootSchema, path, branchErrors);

    if (branchErrors.length === 0) {
      addError(errors, path, 'not', 'Value matches a disallowed schema.');
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !valuesEqual(value, schema.const)) {
    addError(errors, path, 'const', `Value must equal ${JSON.stringify(schema.const)}.`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => valuesEqual(value, item))) {
    addError(errors, path, 'enum', `Value must be one of: ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}.`);
  }

  if (schema.type !== undefined) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const typeMatches = expectedTypes.some((expectedType) => matchesType(value, expectedType));

    if (!typeMatches) {
      addError(
        errors,
        path,
        'type',
        `Expected ${expectedTypes.join(' or ')}, received ${getJsonType(value)}.`,
        { expectedTypes, actualType: getJsonType(value) },
      );
      return;
    }
  }

  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      addError(errors, path, 'minLength', `String must contain at least ${schema.minLength} characters.`);
    }

    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      addError(errors, path, 'maxLength', `String must contain no more than ${schema.maxLength} characters.`);
    }

    if (schema.pattern) {
      let pattern;

      try {
        pattern = new RegExp(schema.pattern);
      } catch (error) {
        addError(errors, path, 'pattern', `Schema contains an invalid regular expression: ${error.message}`);
        pattern = null;
      }

      if (pattern && !pattern.test(value)) {
        addError(errors, path, 'pattern', `String does not match pattern ${schema.pattern}.`);
      }
    }

    if (schema.format && !validateFormat(value, schema.format)) {
      addError(errors, path, 'format', `String is not a valid ${schema.format}.`);
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      addError(errors, path, 'minimum', `Number must be greater than or equal to ${schema.minimum}.`);
    }

    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      addError(errors, path, 'maximum', `Number must be less than or equal to ${schema.maximum}.`);
    }

    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      addError(errors, path, 'exclusiveMinimum', `Number must be greater than ${schema.exclusiveMinimum}.`);
    }

    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      addError(errors, path, 'exclusiveMaximum', `Number must be less than ${schema.exclusiveMaximum}.`);
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      addError(errors, path, 'minItems', `Array must contain at least ${schema.minItems} item(s).`);
    }

    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      addError(errors, path, 'maxItems', `Array must contain no more than ${schema.maxItems} item(s).`);
    }

    if (schema.uniqueItems) {
      const serializedItems = value.map((item) => JSON.stringify(item));
      if (new Set(serializedItems).size !== serializedItems.length) {
        addError(errors, path, 'uniqueItems', 'Array items must be unique.');
      }
    }

    if (schema.items) {
      value.forEach((item, index) => {
        validateNode(item, schema.items, rootSchema, joinPath(path, index), errors);
      });
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    required.forEach((propertyName) => {
      if (!Object.prototype.hasOwnProperty.call(value, propertyName)) {
        addError(errors, joinPath(path, propertyName), 'required', 'Required property is missing.');
      }
    });

    Object.entries(properties).forEach(([propertyName, propertySchema]) => {
      if (Object.prototype.hasOwnProperty.call(value, propertyName)) {
        validateNode(value[propertyName], propertySchema, rootSchema, joinPath(path, propertyName), errors);
      }
    });

    Object.keys(value).forEach((propertyName) => {
      if (Object.prototype.hasOwnProperty.call(properties, propertyName)) {
        return;
      }

      if (schema.additionalProperties === false) {
        addError(errors, joinPath(path, propertyName), 'additionalProperties', 'Additional property is not allowed.');
        return;
      }

      if (isPlainObject(schema.additionalProperties) || typeof schema.additionalProperties === 'boolean') {
        validateNode(
          value[propertyName],
          schema.additionalProperties,
          rootSchema,
          joinPath(path, propertyName),
          errors,
        );
      }
    });

    if (Number.isInteger(schema.minProperties) && Object.keys(value).length < schema.minProperties) {
      addError(errors, path, 'minProperties', `Object must contain at least ${schema.minProperties} properties.`);
    }

    if (Number.isInteger(schema.maxProperties) && Object.keys(value).length > schema.maxProperties) {
      addError(errors, path, 'maxProperties', `Object must contain no more than ${schema.maxProperties} properties.`);
    }
  }
}

function validateJsonSchema(value, schema, options = {}) {
  const errors = [];
  validateNode(value, schema, schema, options.path || '$', errors);

  if (errors.length > 0 && options.throwOnError !== false) {
    const schemaName = options.schemaName ? ` ${options.schemaName}` : '';
    const preview = errors
      .slice(0, 5)
      .map((error) => `${error.path}: ${error.message}`)
      .join('; ');

    throw new JsonSchemaValidationError(
      `Value failed JSON Schema${schemaName} validation: ${preview}`,
      errors,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  JsonSchemaValidationError,
  isPlainObject,
  validateJsonSchema,
};
