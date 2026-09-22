const { Connection, Client } = require('@temporalio/client');

const { pool } = require('../../../../packages/db/src/connection');
const { getTemporalConfig } = require('../../../../packages/temporal/src/config');

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function claimOutbox(runId = null) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM worker.execution_outbox
        WHERE event_type = 'AGENT_RUN_DISPATCH'
          AND (
            dispatch_state IN ('PENDING', 'RECONCILING', 'FAILED')
            OR (dispatch_state = 'DISPATCHING' AND claimed_at <= CURRENT_TIMESTAMP - INTERVAL '30 seconds')
          )
          AND available_at <= CURRENT_TIMESTAMP
          AND ($1::uuid IS NULL OR aggregate_id = $1)
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [runId],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    const updated = await client.query(
      `UPDATE worker.execution_outbox
          SET dispatch_state = 'DISPATCHING', attempts = attempts + 1, claimed_at = CURRENT_TIMESTAMP
        WHERE execution_outbox_id = $1
        RETURNING *`,
      [row.execution_outbox_id],
    );
    return updated.rows[0];
  });
}

async function markDispatchFailure(outboxId, error) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE worker.execution_outbox
          SET dispatch_state = 'RECONCILING', available_at = CURRENT_TIMESTAMP + INTERVAL '5 seconds',
              last_error_code = $2, last_error_message = $3
        WHERE execution_outbox_id = $1`,
      [outboxId, error?.code || 'AGENT_TEMPORAL_DISPATCH_FAILED', String(error?.message || error).slice(0, 1000)],
    );
  });
}

async function dispatchClaimedOutbox(outbox) {
  const config = getTemporalConfig();
  const connection = await Connection.connect({ address: config.address });
  try {
    const client = new Client({ connection, namespace: config.namespace });
    let handle;
    let temporalRunId = null;
    try {
      handle = await client.workflow.start('agentRunWorkflow', {
        taskQueue: config.taskQueue,
        workflowId: outbox.stable_workflow_id,
        args: [outbox.payload],
      });
      temporalRunId = handle.firstExecutionRunId || null;
      try {
        const description = await handle.describe();
        temporalRunId = description?.runId || description?.workflowExecution?.runId || temporalRunId;
      } catch {
        // The stable Workflow ID and durable outbox state are sufficient to reconcile a start whose response is uncertain.
      }
    } catch (error) {
      const message = String(error?.message || error);
      if (!/already started|workflow execution already exists|ALREADY_EXISTS/i.test(message)) throw error;
      handle = client.workflow.getHandle(outbox.stable_workflow_id);
      const description = await handle.describe();
      temporalRunId = description?.runId || description?.workflowExecution?.runId || null;
    }
    await withTransaction(async (db) => {
      await db.query(
        `UPDATE worker.execution_outbox
            SET dispatch_state = 'DISPATCHED', temporal_workflow_id = $2, temporal_run_id = $3,
                dispatched_at = CURRENT_TIMESTAMP, last_error_code = NULL, last_error_message = NULL
          WHERE execution_outbox_id = $1`,
        [outbox.execution_outbox_id, outbox.stable_workflow_id, temporalRunId],
      );
      await db.query(`UPDATE worker.agent_runs SET status = CASE WHEN status = 'ADMITTED' THEN 'QUEUED' ELSE status END WHERE agent_run_id = $1`, [outbox.aggregate_id]);
      await db.query(
        `INSERT INTO worker.agent_temporal_segments (agent_run_id, temporal_workflow_id, temporal_run_id, segment_kind, status)
         VALUES ($1, $2, $3, 'START', 'RUNNING')
         ON CONFLICT (agent_run_id, temporal_run_id) DO NOTHING`,
        [outbox.aggregate_id, outbox.stable_workflow_id, temporalRunId || `unknown:${outbox.execution_outbox_id}`],
      );
    });
    return { dispatched: true, runId: outbox.aggregate_id, workflowId: outbox.stable_workflow_id, temporalRunId };
  } finally {
    await connection.close();
  }
}

async function dispatchAgentRun(runId) {
  const outbox = await claimOutbox(runId);
  if (!outbox) return { dispatched: false, reason: 'NO_PENDING_OUTBOX' };
  try {
    return await dispatchClaimedOutbox(outbox);
  } catch (error) {
    await markDispatchFailure(outbox.execution_outbox_id, error);
    throw error;
  }
}

async function dispatchAgentRunOutboxBatch(limit = 10) {
  const results = [];
  for (let index = 0; index < limit; index += 1) {
    const outbox = await claimOutbox();
    if (!outbox) break;
    try {
      results.push(await dispatchClaimedOutbox(outbox));
    } catch (error) {
      await markDispatchFailure(outbox.execution_outbox_id, error);
      results.push({ dispatched: false, runId: outbox.aggregate_id, errorCode: error?.code || 'AGENT_TEMPORAL_DISPATCH_FAILED' });
    }
  }
  return results;
}

function startAgentRunOutboxDispatcher({ intervalMs = 2000 } = {}) {
  let stopped = false;
  const poll = () => {
    if (stopped) return;
    dispatchAgentRunOutboxBatch().catch((error) => console.warn(`[AgentExecution] Outbox dispatcher poll failed: ${error.message}`));
  };
  poll();
  const timer = setInterval(poll, intervalMs);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = {
  dispatchAgentRun,
  dispatchAgentRunOutboxBatch,
  startAgentRunOutboxDispatcher,
};
