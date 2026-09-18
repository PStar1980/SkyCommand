function applyR5RepositoryZipParameters({
  workflowCode,
  nodeKey,
  targetCode,
  parameters = {},
} = {}) {
  const mergedParameters = { ...parameters };

  if (
    String(workflowCode || '').trim() === 'dev_change_finalize' &&
    String(nodeKey || '').trim() === 'repo_zip_node' &&
    String(targetCode || '').trim() === 'repo_zip_generate'
  ) {
    // R5's final ZIP is review evidence and must contain the R5 tests. This
    // default is workflow-scoped so ordinary repository ZIPs keep their
    // existing compact, tests-excluded behavior.
    mergedParameters.includeTests = true;
  }

  return mergedParameters;
}

module.exports = {
  applyR5RepositoryZipParameters,
};
