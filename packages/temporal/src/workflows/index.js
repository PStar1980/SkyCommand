const fredWorkflows = require('./fredIngestionWorkflow');
const skyCommandWorkflowExecutorWorkflows = require('./skyCommandWorkflowExecutorWorkflow');

module.exports = {
  ...fredWorkflows,
  ...skyCommandWorkflowExecutorWorkflows,
};
