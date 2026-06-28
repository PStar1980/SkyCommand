require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const { Connection } = require('@temporalio/client');

const { getTemporalConfig } = require('./config');

async function main() {
  const config = getTemporalConfig();

  const connection = await Connection.connect({
    address: config.address,
  });

  await connection.workflowService.getSystemInfo({});

  console.log(
    JSON.stringify(
      {
        ok: true,
        service: 'Temporal',
        address: config.address,
        namespace: config.namespace,
        taskQueue: config.taskQueue,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        service: 'Temporal',
        error: error.message || String(error),
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
