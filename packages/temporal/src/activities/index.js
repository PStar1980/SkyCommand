const fredActivities = require('./fredActivities');
const skyCommandWorkflowActivities = require('./skyCommandWorkflowActivities');

module.exports = {
  ...fredActivities,
  ...skyCommandWorkflowActivities,
};
