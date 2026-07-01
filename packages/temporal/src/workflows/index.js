const fredWorkflows = require('./fredIngestionWorkflow');
const skyserverWorkflowExecutorWorkflows = require('./skyserverWorkflowExecutorWorkflow');

module.exports = {
  ...fredWorkflows,
  ...skyserverWorkflowExecutorWorkflows,
};
