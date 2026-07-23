const SUCCESS_STATUS = 'SUCCESS';
const TOOL_EXECUTION_FAILED_STATUS_CODE = 422;

function normalizeText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function getToolExecutionFailureMessage(execution = {}) {
  const summary = normalizeText(execution.summary);

  if (summary) {
    return summary;
  }

  const structuredMessage = normalizeText(execution.toolResult?.message);

  if (structuredMessage) {
    return structuredMessage;
  }

  const toolLabel = normalizeText(execution.label) || normalizeText(execution.toolCode) || 'Tool';

  return `${toolLabel} execution failed.`;
}

function buildToolExecutionHttpResponse(execution = {}) {
  const succeeded = normalizeText(execution.status).toUpperCase() === SUCCESS_STATUS;

  return {
    statusCode: succeeded ? 200 : TOOL_EXECUTION_FAILED_STATUS_CODE,
    body: {
      ok: succeeded,
      ...(succeeded ? {} : { error: getToolExecutionFailureMessage(execution) }),
      execution,
    },
  };
}

module.exports = {
  TOOL_EXECUTION_FAILED_STATUS_CODE,
  buildToolExecutionHttpResponse,
  getToolExecutionFailureMessage,
};
