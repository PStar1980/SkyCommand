const { getBrowserRuntimeConfig } = require('../config');
const { runBrowserTest } = require('../browserTestRunner');
const { runBrowserAutomation } = require('../browserAutomationRunner');

async function executeBrowserTestActivity(input = {}) {
  const executionType = String(input.executionType || 'TEST').trim().toUpperCase();
  if (executionType !== 'TEST') {
    throw new Error(
      `Browser Worker Phase 2 only supports TEST executions. Received '${executionType || 'blank'}'.`,
    );
  }

  return runBrowserTest(input, getBrowserRuntimeConfig());
}



async function executeBrowserAutomationActivity(input = {}) {
  const executionType = String(input.executionType || 'AUTOMATION').trim().toUpperCase();
  if (executionType !== 'AUTOMATION') {
    throw new Error(`Browser Worker automation activity requires AUTOMATION executionType. Received '${executionType || 'blank'}'.`);
  }

  return runBrowserAutomation(input, getBrowserRuntimeConfig());
}

module.exports = {
  executeBrowserAutomationActivity,
  executeBrowserTestActivity,
};
