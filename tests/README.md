# SkyCommand Tests

SkyCommand keeps automated verification under this top-level directory so test code can remain versioned with the application while being excluded cleanly from runtime and compact handoff artifacts.

## Layout

- `self/` mirrors the former source locations of the existing `*SelfTest.js` scripts. This preserves clear ownership while removing test files from production source directories.
- `_support/sourceTestBootstrap.js` lets migrated self-tests resolve relative imports and source-file paths as though they still lived beside the production code they verify.
- Future test families can live beside `self/` (for example `browser/`, `unit/`, `contract/`, and `integration/`) without mixing test code back into `apps/`, `packages/`, or `scripts/`.

## Validation

Existing npm `*:self-test` commands continue to be the public entry points. `npm run validate` syntax-checks the centralized tests and runs the configured routine self-test suite.

## Repository ZIP packaging

`generateRepoZip` excludes the top-level `tests/` directory by default so the normal repository handoff archive stays focused on application/runtime code. Pass `--include-tests` when a full engineering archive including tests is required.
