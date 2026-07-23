const assert = require('node:assert/strict');
const {
  evaluateConditionNode,
  resolveConditionBranchIndex,
} = require('./workflowConditionService');
const { WorkflowServiceError } = require('./workflowServiceError');

function buildContext(readyForDevelopmentPromotion) {
  return {
    conditionEvaluation: {
      nodes: {
        repo_status_node: {
          output: {
            readyForDevelopmentPromotion,
          },
        },
      },
    },
  };
}

function buildDatabaseComparisonContext(databasesMatch) {
  return {
    conditionEvaluation: {
      nodes: {
        db_compare_node: {
          output: {
            databasesMatch,
          },
        },
      },
    },
  };
}

function run() {
  const node = {
    nodeKey: 'promotion_gate_node',
    displayName: 'Promotion Ready',
  };
  const parameters = {
    leftPath: 'nodes.repo_status_node.output.readyForDevelopmentPromotion',
    operator: 'TRUTHY',
    leftType: 'BOOLEAN',
    onFalse: 'STOP_SUCCESS',
    trueTargetNodeKey: 'repo_map_node',
    falseTargetNodeKey: 'promotion_summary_node',
  };

  const passed = evaluateConditionNode({
    node,
    parameters,
    context: buildContext(true),
  });

  assert.equal(passed.passed, true);
  assert.equal(passed.branchLabel, 'TRUE');
  assert.equal(passed.branchTargetNodeKey, 'repo_map_node');
  assert.equal(passed.leftPathResolved, true);
  assert.equal(passed.leftPathUsedFallback, false);
  assert.equal(passed.contextUpdates['conditions.promotion_gate_node.passed'], true);
  assert.equal(
    resolveConditionBranchIndex({
      output: passed,
      currentIndex: 1,
      executionPlan: {
        nodeIndexByKey: new Map([
          ['repo_status_node', 0],
          ['promotion_gate_node', 1],
          ['repo_map_node', 2],
          ['promotion_summary_node', 6],
        ]),
      },
    }),
    2,
  );

  const blocked = evaluateConditionNode({
    node,
    parameters,
    context: buildContext(false),
  });

  assert.equal(blocked.passed, false);
  assert.equal(blocked.branchLabel, 'FALSE');
  assert.equal(blocked.branchTargetNodeKey, 'promotion_summary_node');
  assert.equal(blocked.onFalse, 'STOP_SUCCESS');
  assert.equal(blocked.contextUpdates['conditions.promotion_gate_node.passed'], false);
  assert.equal(
    resolveConditionBranchIndex({
      output: blocked,
      currentIndex: 1,
      executionPlan: {
        nodeIndexByKey: new Map([
          ['repo_status_node', 0],
          ['promotion_gate_node', 1],
          ['repo_map_node', 2],
          ['promotion_summary_node', 6],
        ]),
      },
    }),
    6,
  );

  const fallback = evaluateConditionNode({
    node,
    parameters: {
      ...parameters,
      leftPath: 'nodes.missing.output.readyForDevelopmentPromotion',
      leftValue: 'false',
      falseTargetNodeKey: '',
    },
    context: buildContext(true),
  });

  assert.equal(fallback.passed, false);
  assert.equal(fallback.leftPathResolved, false);
  assert.equal(fallback.leftPathUsedFallback, true);

  assert.throws(
    () =>
      evaluateConditionNode({
        node,
        parameters: {
          ...parameters,
          leftPath: 'nodes.missing.output.readyForDevelopmentPromotion',
          leftValue: '',
        },
        context: buildContext(true),
      }),
    (error) => {
      assert.ok(error instanceof WorkflowServiceError);
      assert.equal(error.details?.code, 'WORKFLOW_CONDITION_PATH_NOT_FOUND');
      return true;
    },
  );

  const comparisonNode = {
    nodeKey: 'database_match_gate_node',
    displayName: 'Databases Match',
  };
  const comparisonParameters = {
    leftPath: 'nodes.db_compare_node.output.databasesMatch',
    operator: 'TRUTHY',
    leftType: 'BOOLEAN',
    onFalse: 'CONTINUE',
    trueTargetNodeKey: 'matching_summary_node',
    falseTargetNodeKey: 'difference_summary_node',
  };
  const comparisonPlan = {
    nodeIndexByKey: new Map([
      ['db_compare_node', 3],
      ['database_match_gate_node', 4],
      ['matching_summary_node', 5],
      ['difference_summary_node', 6],
    ]),
  };

  const matchingComparison = evaluateConditionNode({
    node: comparisonNode,
    parameters: comparisonParameters,
    context: buildDatabaseComparisonContext(true),
  });

  assert.equal(matchingComparison.passed, true);
  assert.equal(matchingComparison.leftPathResolved, true);
  assert.equal(matchingComparison.branchTargetNodeKey, 'matching_summary_node');
  assert.equal(
    resolveConditionBranchIndex({
      output: matchingComparison,
      currentIndex: 4,
      executionPlan: comparisonPlan,
    }),
    5,
  );

  const differentComparison = evaluateConditionNode({
    node: comparisonNode,
    parameters: comparisonParameters,
    context: buildDatabaseComparisonContext(false),
  });

  assert.equal(differentComparison.passed, false);
  assert.equal(differentComparison.leftPathResolved, true);
  assert.equal(differentComparison.branchLabel, 'FALSE');
  assert.equal(differentComparison.branchTargetNodeKey, 'difference_summary_node');
  assert.equal(
    resolveConditionBranchIndex({
      output: differentComparison,
      currentIndex: 4,
      executionPlan: comparisonPlan,
    }),
    6,
  );

  console.log(
    '[SkyCommand] Workflow condition promotion and database-comparison routing self-test passed.',
  );
}

run();
