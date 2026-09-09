function normalizeLinkedId(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function linkWorkflowRun(testInfo, workflowRunId) {
  if (!testInfo || !Array.isArray(testInfo.annotations)) {
    throw new Error('Playwright testInfo with annotations is required.');
  }
  testInfo.annotations.push({
    type: 'skycommand-workflow-run',
    description: normalizeLinkedId(workflowRunId, 'workflowRunId'),
  });
}

module.exports = {
  linkWorkflowRun,
};
