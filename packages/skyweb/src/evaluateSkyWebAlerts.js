require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const skywebAlertsService = require('../../../apps/api/src/services/skywebAlertsService');

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInteger(value, fallback = 500, max = 5000) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

async function main() {
  const maxRules = parsePositiveInteger(process.argv[2], 500, 5000);
  const activeOnly = parseBoolean(process.argv[3], true);
  const scheduleCode = process.env.SKYWEB_ALERT_SCHEDULE_CODE || null;
  const scheduleRunId = process.env.SKYWEB_ALERT_SCHEDULE_RUN_ID || null;
  const workerNodeId = process.env.SKYWEB_ALERT_WORKER_NODE_ID || null;
  const workerNodeName = process.env.SKYWEB_ALERT_WORKER_NODE_NAME || null;

  const summary = await skywebAlertsService.evaluateActiveAlertRulesForAllUsers({
    maxRules,
    activeOnly,
    evaluationSource: 'worker_schedule',
    scheduleCode,
    scheduleRunId,
    workerNodeId,
    workerNodeName,
  });

  console.log(
    [
      'SkyWeb scheduled alert evaluation complete:',
      `${summary.evaluatedCount} evaluated`,
      `${summary.triggeredCount} triggered`,
      `${summary.okCount} ok`,
      `${summary.errorCount} error`,
      `${summary.failedCount} failed`,
      `batch ${summary.batchId}`,
    ].join(' '),
  );

  if (summary.failedCount > 0) {
    console.warn(
      JSON.stringify(
        {
          failedAlerts: summary.results
            .filter((result) => result.status === 'failed')
            .map((result) => ({
              alertKey: result.alertKey,
              userId: result.userId,
              error: result.error,
            })),
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
