class WorkflowServiceError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'WorkflowServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = {
  WorkflowServiceError,
};
