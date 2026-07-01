const fredActivities = require('./fredActivities');
const skyserverWorkflowActivities = require('./skyserverWorkflowActivities');

module.exports = {
  ...fredActivities,
  ...skyserverWorkflowActivities,
};
