const DEV_COMMIT_TOOL_CODE = 'dev_commit';
const DEV_COMMIT_BOUNDARY_PARAMETER_NAMES = Object.freeze([
  'finalizationWorkflowRunId',
  'workflowRunId',
]);
const DEV_COMMIT_BOUNDARY_ERROR_CODE = 'R6_DEV_COMMIT_BOUNDARY_ARGUMENTS_INVALID';

function hasProvidedValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function getDevCommitBoundaryValidation(toolCode, parameters = {}) {
  if (String(toolCode || '').trim() !== DEV_COMMIT_TOOL_CODE) {
    return null;
  }

  const hasFinalizationWorkflowRunId = hasProvidedValue(parameters.finalizationWorkflowRunId);
  const hasWorkflowRunId = hasProvidedValue(parameters.workflowRunId);

  if (hasFinalizationWorkflowRunId === hasWorkflowRunId) {
    return null;
  }

  return {
    code: DEV_COMMIT_BOUNDARY_ERROR_CODE,
    message:
      'dev_commit requires finalizationWorkflowRunId and workflowRunId together; partial R6 boundary binding is not permitted.',
    parameterNames: [...DEV_COMMIT_BOUNDARY_PARAMETER_NAMES],
  };
}

module.exports = {
  DEV_COMMIT_BOUNDARY_ERROR_CODE,
  DEV_COMMIT_BOUNDARY_PARAMETER_NAMES,
  DEV_COMMIT_TOOL_CODE,
  getDevCommitBoundaryValidation,
  hasProvidedValue,
};
