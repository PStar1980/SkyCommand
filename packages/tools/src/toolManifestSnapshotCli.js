const path = require('path');
const dotenv = require('dotenv');

const {
  buildToolManifestSnapshotPreview,
  checkToolManifestSnapshots,
  syncToolManifestSnapshots,
} = require('./toolManifestSnapshotService');

const SKY_SERVER_ROOT = path.resolve(__dirname, '../../..');

dotenv.config({
  path: path.join(SKY_SERVER_ROOT, '.env'),
});

function printUsage() {
  console.log(`
SkyCommand Tool Manifest Snapshot CLI

Usage:
  npm run tool-manifest:snapshot:preview
  npm run tool-manifest:snapshot:sync
  npm run tool-manifest:snapshot:check

Commands:
  preview   Validate repository manifests and compare them with core.tools and the current snapshot.
  sync      Persist a new current validated snapshot for every manifest-backed registered tool.
  check     Compare repository files with current snapshots, persist drift status, and fail on attention items.

The 00063 tool-manifest snapshot migration must be applied before running these commands.
`);
}

async function runCli(args = process.argv.slice(2), options = {}) {
  const command = args[0] || 'preview';

  if (['--help', '-h', 'help'].includes(command)) {
    printUsage();
    return { status: 'HELP' };
  }

  const dbModule = options.dbModule || require('../../db/src/connection');
  const db = options.db || dbModule.pool;
  let result;

  if (command === 'preview') {
    result = await buildToolManifestSnapshotPreview({ db, repositoryRoot: SKY_SERVER_ROOT });
  } else if (command === 'sync') {
    const client = options.db ? db : await dbModule.pool.connect();

    try {
      if (!options.db) {
        await client.query('BEGIN');
      }

      result = await syncToolManifestSnapshots({ db: client, repositoryRoot: SKY_SERVER_ROOT });

      if (!options.db) {
        await client.query('COMMIT');
      }
    } catch (error) {
      if (!options.db) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw error;
    } finally {
      if (!options.db) {
        client.release();
      }
    }
  } else if (command === 'check') {
    result = await checkToolManifestSnapshots({ db, repositoryRoot: SKY_SERVER_ROOT });
  } else {
    throw new Error(`Unknown tool manifest snapshot command: ${command}`);
  }

  console.log(JSON.stringify(result, null, 2));

  if (command === 'check' && result.status !== 'VALID') {
    process.exitCode = 1;
  }

  return result;
}

if (require.main === module) {
  runCli()
    .catch((error) => {
      console.error(`[SkyCommand] Tool manifest snapshot command failed: ${error.message}`);
      if (error.code) {
        console.error(`Code: ${error.code}`);
      }
      if (error.details) {
        console.error(JSON.stringify(error.details, null, 2));
      }
      process.exitCode = 1;
    })
    .finally(async () => {
      const { pool } = require('../../db/src/connection');
      await pool.end().catch(() => {});
    });
}

module.exports = {
  runCli,
};
