const { getBrowserRuntimeConfig } = require('../config');
const { runBrowserTest } = require('../browserTestRunner');

async function executeBrowserTestActivity(input = {}) {
  const executionType = String(input.executionType || 'TEST').trim().toUpperCase();
  if (executionType !== 'TEST') {
    throw new Error(
      `Browser Worker Phase 2 only supports TEST executions. Received '${executionType || 'blank'}'.`,
    );
  }

  return runBrowserTest(input, getBrowserRuntimeConfig());
}

module.exports = {
  executeBrowserTestActivity,
};
