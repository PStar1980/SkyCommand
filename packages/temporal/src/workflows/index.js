const fredWorkflows = require('./fredIngestionWorkflow');
const skyCommandWorkflowExecutorWorkflows = require('./skyCommandWorkflowExecutorWorkflow');
const hostAgentWorkflows = require('./hostAgentWorkflow');
const agentRunWorkflows = require('./agentRunWorkflow');

module.exports = {
  ...fredWorkflows,
  ...skyCommandWorkflowExecutorWorkflows,
  ...hostAgentWorkflows,
  ...agentRunWorkflows,
};
