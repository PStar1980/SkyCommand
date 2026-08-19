const fredWorkflows = require('./fredIngestionWorkflow');
const skyCommandWorkflowExecutorWorkflows = require('./skyCommandWorkflowExecutorWorkflow');
const hostAgentWorkflows = require('./hostAgentWorkflow');

module.exports = {
  ...fredWorkflows,
  ...skyCommandWorkflowExecutorWorkflows,
  ...hostAgentWorkflows,
};
