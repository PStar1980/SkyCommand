const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);

const fs = require('node:fs');
const path = require('node:path');

const pageSource = fs.readFileSync(path.join(sourceDir, 'SkyWorkflows.jsx'), 'utf8');
const serviceSource = fs.readFileSync(
  path.join(sourceDir, '..', 'services', 'workflowService.js'),
  'utf8',
);
const temporalSource = fs.readFileSync(
  path.join(sourceDir, '..', '..', '..', 'api', 'src', 'services', 'temporalService.js'),
  'utf8',
);
const executorSource = fs.readFileSync(
  path.join(sourceDir, '..', '..', '..', 'api', 'src', 'services', 'workflowExecutorService.js'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  pageSource.includes("const [selectedRunId, setSelectedRunId] = useState('');")
    && pageSource.includes('selectedRunIdRef')
    && pageSource.includes('selectedRunDetailLoading')
    && pageSource.includes('selectedRunDetailError'),
  'Workflow Operations must expose immediate selection and bounded detail loading/error state.',
);

assert(
  pageSource.includes('runDetailRequestSequenceRef')
    && pageSource.includes('const isCurrentRequest = () =>')
    && pageSource.includes('selectedRunIdRef.current === normalizedRunId'),
  'Workflow Operations must ignore stale detail responses after rapid row selection.',
);

assert(
  pageSource.includes('data-workflow-run-id={run.workflowRunRecordId}')
    && pageSource.includes("data-selected-run-id={selectedRun?.workflowRunRecordId || ''}")
    && pageSource.includes("selectedRunId === run.workflowRunRecordId ? 'sky-selected-row'"),
  'Workflow Operations row selection must be synchronously observable and testable.',
);

assert(
  pageSource.includes('async function openWorkflowDetails')
    && pageSource.includes('workflowService.getRunDiagnostics(workflowRunRecordId)')
    && pageSource.includes('Loading Temporal diagnostics'),
  'Temporal history must be lazy and explicit through Workflow Details diagnostics.',
);

assert(
  pageSource.includes('selectedRunStatusRef.current')
    && pageSource.includes('isActiveRun(nextSelectedRun)')
    && pageSource.includes('telemetry: true'),
  'History polling must refresh active runs and the active-to-terminal transition only.',
);

assert(
  serviceSource.includes("function getRunDiagnostics(workflowRunRecordId)")
    && serviceSource.includes('/diagnostics'),
  'The frontend service must expose a dedicated diagnostics endpoint.',
);

assert(
  temporalSource.includes('async function getWorkflowRuntimeDetail({ workflowId, runId, includeHistory = false } = {})'),
  'Temporal runtime detail must default to metadata-only history behavior.',
);

assert(
  executorSource.includes('async function getWorkflowRun(workflowRunRecordId, { includeTemporalHistory = false } = {})')
    && executorSource.includes('async function getWorkflowRunDiagnostics(workflowRunRecordId)'),
  'The API must separate ordinary run detail from explicit Temporal diagnostics.',
);

console.log('Workflow Operations performance correction self-test passed.');
