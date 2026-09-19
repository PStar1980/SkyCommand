const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');

const sourceDir = sourceDirectoryForTest(__filename);
const repoRoot = path.resolve(sourceDir, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const migration = read('packages/db_build/src/migrations/00144__r6_promotion_node_order_correction.sql');
const preflight = read('packages/dev-finalization/src/promotionPreflight.js');

assert.match(migration, /current_workflow_code IN ARRAY ARRAY\['skyserver_dev_commit', 'skycommand-dev-promo-alt'\]/);
assert.match(migration, /new_version_number := expected_old_version \+ 1/);
assert.match(migration, /node_key = 'dev_commit_node'/);
assert.match(migration, /display_order = display_order \+ display_shift/);
assert.match(migration, /WHEN 'github_dev_pr_merge_node' THEN commit_order \+ 1/);
assert.match(migration, /WHEN 'merge_sync_node' THEN commit_order \+ 2/);
assert.match(migration, /WHEN 'local_repo_sync_node' THEN commit_order \+ 3/);
assert.match(migration, /WHEN 'dev_promotion_summary' THEN commit_order \+ 4/);
assert.match(migration, /dev_commit_node' AND to_node\.node_key = 'github_dev_pr_merge_node'/);
assert.match(migration, /github_dev_pr_merge_node' AND to_node\.node_key = 'merge_sync_node'/);
assert.match(migration, /merge_sync_node' AND to_node\.node_key = 'local_repo_sync_node'/);
assert.match(migration, /local_repo_sync_node' AND to_node\.node_key = 'dev_promotion_summary'/);
assert.match(migration, /from_node\.node_key = 'dev_commit_node' AND to_node\.node_key = 'merge_sync_node'/);
assert.match(migration, /definition_snapshot = jsonb_build_object/);
assert.match(migration, /snapshot_nodes IS DISTINCT FROM live_nodes/);
assert.match(migration, /snapshot_edges IS DISTINCT FROM live_edges/);
assert.match(migration, /pinnedWorkflowVersionId', primary_version_id/);
assert.match(migration, /pinnedVersionNumber', 22/);
assert.match(migration, /alternate Assistant grant must remain absent/);
assert.match(preflight, /skyserver_dev_commit: 22/);
assert.match(preflight, /'skycommand-dev-promo-alt': 8/);
assert.doesNotMatch(migration, /DO\s+\$[A-Za-z0-9_]+\$/);
assert.doesNotMatch(migration, /(?<![A-Za-z0-9_])(?:COMMIT|ROLLBACK|START\s+TRANSACTION)(?![A-Za-z0-9_])/i);

console.log('[r6-promotion-node-order:self-test] PASS');
