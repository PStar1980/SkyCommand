const assert = require('assert');
const {
  buildWhitelistedOrderBy,
  parseWhitelistedSortSpec,
} = require('./tableSortUtils');

const sortFields = {
  category: 'category',
  startedAt: 'started_at',
  durationMs: 'duration_ms',
};

assert.deepStrictEqual(
  parseWhitelistedSortSpec('category:asc,startedAt:desc', { sortFields }),
  [
    { field: 'category', direction: 'asc', expression: 'category' },
    { field: 'startedAt', direction: 'desc', expression: 'started_at' },
  ],
  'Whitelisted table sorting must preserve multi-column priority and direction.',
);

assert.strictEqual(
  buildWhitelistedOrderBy({
    sortValue: 'category:asc,startedAt:desc',
    sortFields,
    defaultSorts: [{ field: 'startedAt', direction: 'desc' }],
    tieBreakers: ['execution_id DESC'],
  }),
  'ORDER BY category ASC NULLS LAST, started_at DESC NULLS LAST, execution_id DESC',
  'Whitelisted table sorting must produce deterministic server-side ORDER BY clauses.',
);

assert.strictEqual(
  buildWhitelistedOrderBy({
    sortValue: '',
    sortFields,
    defaultSorts: [{ field: 'startedAt', direction: 'desc' }],
    tieBreakers: ['execution_id DESC'],
  }),
  'ORDER BY started_at DESC NULLS LAST, execution_id DESC',
  'Empty sort input must fall back to the configured default ordering.',
);

for (const invalidSpec of [
  'startedAt:sideways',
  'dropTable:asc',
  'category:asc,category:desc',
  'startedAt desc',
]) {
  assert.throws(
    () => parseWhitelistedSortSpec(invalidSpec, { sortFields }),
    (error) => error?.statusCode === 400,
    `Unsafe or invalid sort expression '${invalidSpec}' must be rejected with HTTP 400 semantics.`,
  );
}

console.log('Whitelisted table sort utility self-test passed.');
