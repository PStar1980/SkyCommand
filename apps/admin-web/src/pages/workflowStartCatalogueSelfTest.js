const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const addToolSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/AddTool.jsx'),
  'utf8',
);
const workflowSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/SkyWorkflows.jsx'),
  'utf8',
);
const cssSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/App.css'),
  'utf8',
);
const graphSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/components/WorkflowVisualGraph.jsx'),
  'utf8',
);
const approvalOverlaySource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/components/WorkflowApprovalOverlay.jsx'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  addToolSource.includes('className="form-control sky-form-control sky-tool-upload-input"'),
  'Add Tool file inputs must use the shared SkyCommand form-control skin.',
);
assert(
  cssSource.includes('.sky-tool-upload-input::file-selector-button'),
  'Add Tool file inputs must style the browser file-selector button.',
);
assert(
  workflowSource.includes('id="startWorkflowSearchFilter"') &&
    workflowSource.includes('id="startWorkflowStructureFilter"') &&
    workflowSource.includes('id="startWorkflowParameterFilter"') &&
    workflowSource.includes('id="startWorkflowNodeScaleFilter"'),
  'Start Workflow must provide search and workflow catalogue filters.',
);
assert(
  workflowSource.includes('renderStartWorkflowPagination()') &&
    workflowSource.includes('aria-label="Start workflow pagination"'),
  'Start Workflow must provide Tool Operations-style pagination.',
);
assert(
  workflowSource.includes("renderStartWorkflowSortableHeader('Workflow', 'workflow')") &&
    workflowSource.includes("renderStartWorkflowSortableHeader('Structure', 'structure')") &&
    workflowSource.includes("renderStartWorkflowSortableHeader('Nodes', 'nodes')") &&
    workflowSource.includes("renderStartWorkflowSortableHeader('Edges', 'edges')") &&
    workflowSource.includes("renderStartWorkflowSortableHeader('Runtime parameters', 'runtimeParameters')") &&
    workflowSource.includes("renderStartWorkflowSortableHeader('Published version', 'publishedVersion')") &&
    workflowSource.includes("renderStartWorkflowSortableHeader('Status', 'status')") &&
    workflowSource.includes('Shift+click to add to multi-column sorting') &&
    workflowSource.includes('Clear sorting'),
  'Start Workflow catalogue headers must use the canonical multi-column sorting controls.',
);
assert(
  workflowSource.includes('sky-canonical-operations-table-frame') &&
    workflowSource.includes('sky-canonical-operations-table align-middle mb-0') &&
    workflowSource.includes('sky-canonical-operations-pagination-row') &&
    workflowSource.includes('id="startWorkflowRowsSelect"') &&
    workflowSource.includes('startWorkflowAvailablePageSizes.map') &&
    workflowSource.includes('changeStartWorkflowPageSize') &&
    workflowSource.includes('startWorkflowBrowserRef.current?.scrollIntoView') &&
    workflowSource.includes('className="btn btn-sm sky-pagination-nav-button"'),
  'Start Workflow catalogue must use the canonical table frame, row treatment, centered gold pagination, and smart Rows selector.',
);
assert(
  workflowSource.includes('onClick={() => handleDefinitionSelect(definition.workflowCode)}') &&
    workflowSource.includes('<span className="sky-pill sky-pill-success">') &&
    !workflowSource.includes("{selected ? 'Selected' : 'Select workflow'}") &&
    !workflowSource.includes('id="workflowStartDefinition"'),
  'Start Workflow must use row selection without a redundant Actions column or legacy dropdown.',
);
assert(
  workflowSource.includes('{selectedDefinition && (') &&
    workflowSource.includes('className="sky-card sky-workflow-start-config-card"'),
  'Workflow information and parameter entry must appear only after a workflow is selected.',
);
assert(
  workflowSource.includes('inspectorMode="navigation"') &&
    !workflowSource.includes('inspectorMode="full"'),
  'Start Workflow must remove the full node inspector while retaining lightweight graph navigation.',
);
assert(
  workflowSource.includes('className="sky-workflow-start-detail-stack"') &&
    cssSource.includes('.sky-workflow-start-detail-stack .sky-workflow-visual-map') &&
    cssSource.includes('overflow-x: auto;'),
  'Start Workflow graph must stay page-width and scroll horizontally like Workflow Operations.',
);
assert(
  !workflowSource.includes('Runtime values are saved into workflow context as <code>params</code>'),
  'Start Workflow must not repeat workflow parameter authoring instructions in the launch card.',
);
assert(
  workflowSource.includes('function WorkflowNodeParameterCard({') &&
    workflowSource.includes('isVisualNodeCompleted(') &&
    workflowSource.includes('<WorkflowNodeOutputLedger') &&
    workflowSource.includes('<WorkflowNodeParameterCard'),
  'Start Workflow must switch between focused output and saved node parameters based on node completion.',
);
assert(
  workflowSource.includes('PerformanceTelemetryTable,') &&
    workflowSource.includes('ArchiveBuildBreakdownTable,') &&
    workflowSource.includes("from '../components/tools/StructuredToolResultDisplay.jsx'") &&
    workflowSource.includes(
      '<PerformanceTelemetryTable telemetry={output.performanceTelemetry} />',
    ) &&
    workflowSource.includes(
      '<ArchiveBuildBreakdownTable telemetry={output.performanceTelemetry} />',
    ) &&
    !workflowSource.includes('RepositoryPerformanceTelemetry') &&
    !workflowSource.includes('performance={output.performance}'),
  'Workflow focused node output must use the shared current performanceTelemetry renderer instead of the legacy output.performance contract.',
);

assert(
  (
    workflowSource.match(
      /<PerformanceTelemetryTable telemetry=\{output\.performanceTelemetry\} \/>/g,
    ) || []
  ).length >= 6,
  'Macro ingestion, Repository Map, Repository Zip, Dev Commit, Repo Merge / Sync, and Local Repository Sync must all render performance telemetry in focused node output.',
);
assert(
  workflowSource.includes('MacroIngestionWorkloadTelemetryTable,') &&
    workflowSource.includes('<MacroIngestionWorkloadTelemetryTable telemetry={output.performanceTelemetry} />'),
  'Macro ingestion focused output must render source workload and slow-indicator telemetry.',
);

assert(
  workflowSource.includes('TransportTelemetryTable') &&
    (workflowSource.match(/<TransportTelemetryTable telemetry=\{output\.transportTelemetry\} \/>/g) || []).length >= 3,
  'Dev Commit, Repo Merge / Sync, and Local Repository Sync must render transport / dispatch telemetry in focused node output.',
)

assert(
  workflowSource.includes('ProcessEnvelopeTelemetryTable') &&
    (workflowSource.match(/<ProcessEnvelopeTelemetryTable toolResult=\{toolResult\} \/>/g) || []).length >= 3,
  'Host-routed Git tools must render process-envelope telemetry in focused node output.',
);

assert(
  !workflowSource.includes('Start workflow with parameters') &&
    workflowSource.includes("{starting ? 'Running workflow...' : 'Start Workflow'}"),
  'Start Workflow must use one consistent launch button label for every workflow.',
);

assert(
  workflowSource.includes('function getClearedRuntimeParameterValues(parameters = [])') &&
    workflowSource.includes('setRuntimeParameterValues(getClearedRuntimeParameterValues(runtimeParameters));'),
  'A successful Start Workflow launch must clear operator-entered runtime parameter values to prevent accidental duplicate execution.',
);
assert(
  !workflowSource.includes('headerActions={selectedRun ? <SmartRunStatusBadges run={selectedRun} /> : null}') &&
    graphSource.includes("justify-content-end gap-2 ms-auto") &&
    graphSource.includes("!runtimeMode ? (") &&
    !graphSource.includes("hasRuntimeExecution && runtimeCounts.completed > 0") &&
    graphSource.includes("runtimeCounts.active > 0 && activeNode"),
  'Runtime Status Overlay pills must align right and omit graph-size and completed-count pills.',
);
assert(
  graphSource.includes('const viewportRef = useRef(null);') &&
    graphSource.includes("viewport.scrollTo({ behavior: 'auto', left: 0 });") &&
    graphSource.includes('ref={viewportRef}') &&
    cssSource.includes('padding-inline-start: 1.75rem;'),
  'Workflow runtime lanes must reset to the left edge and preserve first-node breathing room.',
);
assert(
  !graphSource.includes('<div className="sky-workflow-visual-branch-list">'),
  'Condition gate cards must not render branch target pills that stretch the visual node.',
);
assert(
  graphSource.includes('<div className="sky-workflow-visual-edge-label">next</div>') &&
    !graphSource.includes("taken ' : ''") &&
    !graphSource.includes('is-runtime-branch-taken'),
  'Condition gates must use the same compact next connector as every other workflow node.',
);
assert(
  graphSource.includes('function getLastCompletedRuntimeNodeIndex(') &&
    graphSource.includes('completedRun && lastCompletedNodeIndex >= 0') &&
    workflowSource.includes('const completedStartRun = !isHistoryMode'),
  'Completed workflow runs must transfer graph focus to the final completed node on both history and start pages.',
);
assert(
  graphSource.includes('nodeElement.getBoundingClientRect()') &&
    graphSource.includes('viewport.scrollLeft') &&
    graphSource.includes("behavior: prefersReducedWorkflowMotion() ? 'auto' : 'smooth'"),
  'Follow-active mode must center the current node while respecting reduced-motion preferences.',
);
assert(
  cssSource.includes('.sky-workflow-visual-node.is-runtime-completed {') &&
    cssSource.includes('border-color: rgba(255, 210, 97, 0.78);') &&
    cssSource.includes('.sky-workflow-visual-edge.is-runtime-active-edge .sky-workflow-visual-edge-line::after') &&
    cssSource.includes('transform: translateX(430%);'),
  'Completed nodes must glow gold and the active connector charge must travel left to right.',
);


assert(
  graphSource.includes('function getRuntimeConditionRoutes(') &&
    graphSource.includes('runtimeBranchEdgeIndices.has(index)') &&
    graphSource.includes('activeBranchEdgeIndices.has(index)') &&
    !graphSource.includes('sky-workflow-runtime-route') &&
    !cssSource.includes('.sky-workflow-runtime-route'),
  'Condition and approval routes must be conveyed by graph illumination without adding route details to runtime node cards.',
);

assert(
  graphSource.includes("label: 'Approval'") &&
    !graphSource.includes("label: 'Human checkpoint'") &&
    graphSource.includes('function formatApprovalCountdown(') &&
    graphSource.includes('Approve Timeout: ${formatApprovalCountdown(') &&
    graphSource.includes("return 'Approved';") &&
    graphSource.includes("return 'Rejected';") &&
    graphSource.includes("window.setInterval(() => setApprovalClockMs(Date.now()), 1000)") &&
    !graphSource.includes('pieces.push(`Approval ${String(approval.status).toLowerCase()}`);'),
  'Approval runtime cards must use the compact Approval label, live timeout countdown, terminal decision text, and omit duplicated approval status from Runtime details.',
);
assert(
  graphSource.includes('↪ Return to active node') &&
    graphSource.includes('suspendFollowForManualNavigation') &&
    graphSource.includes('onPointerDown={handleViewportPointerDown}') &&
    graphSource.includes('onWheel={handleViewportWheel}'),
  'Manual graph navigation must suspend auto-follow and offer a return-to-active action.',
);
assert(
  cssSource.includes('.sky-workflow-visual-node.is-selected {') &&
    cssSource.includes('outline: 4px solid rgba(255, 217, 120, 0.98);') &&
    cssSource.includes('.sky-workflow-visual-edge.is-runtime-branch-path-edge') &&
    cssSource.includes('@media (prefers-reduced-motion: reduce)'),
  'Runtime graphs must distinguish selected nodes, illuminate chosen branch paths, and support reduced motion.',
);
assert(
  graphSource.includes('const approvalPaused = Boolean(hasInFlightRun && pendingApproval);') &&
    graphSource.includes('const selectionLocked = hasInFlightRun && !approvalPaused;') &&
    graphSource.includes('onApprovalReview?.(approval, index, node)') &&
    graphSource.includes('selected={!selectionLocked && selectedNodeIndex === index}') &&
    workflowSource.includes('const workflowSelectionLocked = Boolean(isActiveRun(selectedRun) && !workflowApprovalPaused);') &&
    workflowSource.includes('const approvalPauseFocusRef = useRef({') &&
    workflowSource.includes('approvalFocusAlreadyApplied') &&
    workflowSource.includes('setSelectedRuntimeNodeIndex(approvalNodeIndex)') &&
    workflowSource.includes('onApprovalReview={handleApprovalReview}') &&
    approvalOverlaySource.includes('Approve and continue') &&
    approvalOverlaySource.includes('workflowService.decideApproval') &&
    cssSource.includes('.sky-workflow-approval-node-action') &&
    cssSource.includes('.sky-card .alert-info,') &&
    cssSource.includes('.sky-workflow-visual-node.is-selection-locked {'),
  'Active execution must lock inspection, pending approvals must unlock the graph and focus the approval node once, and approval decisions must be available from the approval node.',
);


assert(
  workflowSource.includes('await loadRunDetail(stillVisible.workflowRunRecordId);\n        return items;') &&
    workflowSource.includes('const loadedRuns = (await loadRuns(filters, { keepSelection })) || [];') &&
    workflowSource.includes('if (!isHistoryMode) {\n        await loadDefinitions({ keepSelection });\n      }'),
  'Workflow Operations manual refresh must preserve selected-run data, return the refreshed run collection, and avoid reloading unrelated definitions.',
);

assert(
  workflowSource.includes("structuredToolResult?.outputType === 'git_local_sync_summary.v1'") &&
    workflowSource.includes('function GitLocalSyncOutput({ toolResult })') &&
    workflowSource.includes('Four-way synchronized') &&
    workflowSource.includes('Host sync command'),
  'Workflow operation detail must render guarded host local-sync evidence and copy-ready follow-up guidance.',
);

assert(
  workflowSource.includes('id="workflowHistorySearch"') &&
    workflowSource.includes('clearHistoryFilters') &&
    workflowSource.includes('Workflow Details') &&
    !workflowSource.includes('View details'),
  'Workflow Operations must provide search, Clear filters, and row-level Workflow Details actions.',
);

console.log('[SkyCommand] Start Workflow catalogue, conditional node detail, and Add Tool upload UI self-test passed.');
