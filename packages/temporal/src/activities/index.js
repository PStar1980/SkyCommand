const fredActivities = require('./fredActivities');
const skyCommandWorkflowActivities = require('./skyCommandWorkflowActivities');
const agentRunActivities = require('./agentRunActivities');

module.exports = {
  ...fredActivities,
  ...skyCommandWorkflowActivities,
  ...agentRunActivities,
};
