const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const serviceRoot = __dirname;
const workflowSource = fs.readFileSync(
  path.join(serviceRoot, 'workflowExecutorService.js'),
  'utf8',
);
const executionSource = fs.readFileSync(
  path.join(serviceRoot, 'scriptExecutionService.js'),
  'utf8',
);
const controllerSource = fs.readFileSync(
  path.join(serviceRoot, '..', 'controllers', 'toolsController.js'),
  'utf8',
);

assert(
  workflowSource.includes("confirmationMode: 'WORKFLOW_AUTOMATION'"),
  'Workflow tool nodes must explicitly use the workflow automation confirmation mode.',
);
assert(
  workflowSource.includes("source: 'PUBLISHED_WORKFLOW_EXECUTION'"),
  'Workflow tool execution should retain explicit workflow authorization evidence.',
);
assert(
  !workflowSource.includes('PREVIOUS_HUMAN_APPROVAL'),
  'High-risk workflow execution must not depend on an immediately preceding approval node.',
);
assert(
  !workflowSource.includes('isApprovedHumanCheckpoint'),
  'The obsolete previous-approval confirmation bridge must remain removed.',
);

const permissionIndex = executionSource.indexOf('await assertRunAllowed({');
const confirmationIndex = executionSource.indexOf('const confirmationDecision = assertConfirmationIfRequired({');
assert(
  permissionIndex >= 0 && confirmationIndex > permissionIndex,
  'Tool permissions and risk permissions must still be enforced before confirmation policy is evaluated.',
);
assert(
  executionSource.includes("const CONFIRMATION_MODE_WORKFLOW = 'WORKFLOW_AUTOMATION';"),
  'The script execution service must define an explicit workflow confirmation mode.',
);
assert(
  executionSource.includes('if (normalizedMode === CONFIRMATION_MODE_WORKFLOW)'),
  'Workflow confirmation mode must bypass only the interactive confirmation check.',
);
assert(
  executionSource.includes("launchChannel:\n          confirmationDecision.mode === CONFIRMATION_MODE_WORKFLOW ? 'WORKFLOW' : 'INTERACTIVE'"),
  'Tool History must retain evidence of workflow versus interactive launch channels.',
);
assert(
  !controllerSource.includes('confirmationMode:'),
  'The public manual Run Tools controller must not accept a caller-supplied workflow bypass mode.',
);
assert(
  controllerSource.includes('confirmationPhrase: body.confirmationPhrase || body.confirmationText'),
  'Manual Run Tools must continue forwarding interactive confirmation phrases.',
);

console.log('Workflow tool confirmation policy self-test passed.');
