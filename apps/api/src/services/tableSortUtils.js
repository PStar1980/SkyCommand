function createSortError(message, details = {}) {
  const error = new Error(message);
  error.statusCode = 400;
  error.details = details;
  return error;
}

function normalizeSortDirection(value) {
  const direction = String(value || '').trim().toLowerCase();

  if (!['asc', 'desc'].includes(direction)) {
    throw createSortError(`Unsupported sort direction '${value}'.`, {
      allowedDirections: ['asc', 'desc'],
    });
  }

  return direction;
}

function parseWhitelistedSortSpec(sortValue, { sortFields = {}, maxSorts = 6 } = {}) {
  const rawSort = String(sortValue || '').trim();

  if (!rawSort) {
    return [];
  }

  const tokens = rawSort
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length > maxSorts) {
    throw createSortError(`A maximum of ${maxSorts} sort columns is supported.`, {
      maxSorts,
    });
  }

  const seenFields = new Set();

  return tokens.map((token) => {
    const match = token.match(/^([A-Za-z][A-Za-z0-9]*):(asc|desc)$/i);

    if (!match) {
      throw createSortError(`Invalid sort expression '${token}'.`, {
        expectedFormat: 'field:asc,otherField:desc',
      });
    }

    const requestedField = match[1];
    const field = Object.keys(sortFields).find(
      (candidate) => candidate.toLowerCase() === requestedField.toLowerCase(),
    );

    if (!field) {
      throw createSortError(`Unsupported sort field '${requestedField}'.`, {
        allowedFields: Object.keys(sortFields),
      });
    }

    if (seenFields.has(field)) {
      throw createSortError(`Sort field '${field}' may only be specified once.`, {
        field,
      });
    }

    seenFields.add(field);

    return {
      field,
      direction: normalizeSortDirection(match[2]),
      expression: sortFields[field],
    };
  });
}

function buildWhitelistedOrderBy({
  sortValue,
  sortFields = {},
  defaultSorts = [],
  tieBreakers = [],
  maxSorts = 6,
} = {}) {
  const parsed = parseWhitelistedSortSpec(sortValue, { sortFields, maxSorts });
  const activeSorts = parsed.length > 0
    ? parsed
    : defaultSorts.map((sort) => {
        const expression = sortFields[sort.field];

        if (!expression) {
          throw new Error(`Default sort field '${sort.field}' is not whitelisted.`);
        }

        return {
          field: sort.field,
          direction: normalizeSortDirection(sort.direction),
          expression,
        };
      });

  const clauses = activeSorts.map(
    (sort) => `${sort.expression} ${sort.direction.toUpperCase()} NULLS LAST`,
  );

  for (const tieBreaker of tieBreakers) {
    if (tieBreaker) {
      clauses.push(String(tieBreaker).trim());
    }
  }

  if (clauses.length === 0) {
    throw new Error('At least one default sort or tie-breaker is required.');
  }

  return `ORDER BY ${clauses.join(', ')}`;
}

module.exports = {
  buildWhitelistedOrderBy,
  parseWhitelistedSortSpec,
};
