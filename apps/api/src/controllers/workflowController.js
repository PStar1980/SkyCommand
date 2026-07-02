const authService = require('../services/authService');
const workflowExecutorService = require('../services/workflowExecutorService');

async function listDefinitions(req, res, next) {
  try {
    const result = await workflowExecutorService.listWorkflowDefinitions({
      visibleOnly: true,
      enabledOnly: true,
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function getDefinition(req, res, next) {
  try {
    const result = await workflowExecutorService.getWorkflowDefinition(req.params.workflowCode);

    res.json({
      ok: true,
      definition: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        ok: false,
        error: error.message,
        details: error.details || undefined,
      });
    }

    return next(error);
  }
}

async function getBuilderCatalog(req, res, next) {
  try {
    const result = await workflowExecutorService.listBuilderCatalog({
      permissions: req.permissions || [],
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function createDefinition(req, res, next) {
  try {
    const definition = await workflowExecutorService.createWorkflowDefinition({
      payload: req.body || {},
      user: req.user,
      permissions: req.permissions || [],
    });

    res.status(201).json({
      ok: true,
      definition,
      message: `Workflow ${definition.displayName} created${definition.publishedVersionId ? ' and published' : ''}.`,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        ok: false,
        error: error.message,
        details: error.details || undefined,
      });
    }

    return next(error);
  }
}

async function startWorkflow(req, res, next) {
  try {
    const context = authService.getRequestContext(req);
    const body = req.body || {};
    const input = body.input || body;
    const executorMode = String(body.executorMode || input.executorMode || 'temporal').trim().toLowerCase();
    const execute = executorMode === 'inline'
      ? workflowExecutorService.executeWorkflow
      : workflowExecutorService.startWorkflowWithTemporal;
    const result = await execute({
      workflowCode: req.params.workflowCode,
      input,
      user: req.user,
      session: req.session,
      permissions: req.permissions || [],
      context,
    });

    res.status(result.started ? 202 : result.ok ? 200 : 500).json({
      ok: result.ok,
      executorMode,
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        ok: false,
        error: error.message,
        details: error.details || undefined,
      });
    }

    return next(error);
  }
}

async function listRuns(req, res, next) {
  try {
    const result = await workflowExecutorService.listWorkflowRuns(req.query || {});

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function getRun(req, res, next) {
  try {
    const result = await workflowExecutorService.getWorkflowRun(req.params.workflowRunRecordId);

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        ok: false,
        error: error.message,
        details: error.details || undefined,
      });
    }

    return next(error);
  }
}

module.exports = {
  createDefinition,
  getBuilderCatalog,
  getDefinition,
  getRun,
  listDefinitions,
  listRuns,
  startWorkflow,
};
