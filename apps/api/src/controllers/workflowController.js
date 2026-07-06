const authService = require('../services/authService');
const workflowExecutorService = require('../services/workflowExecutorService');

function parseBooleanQuery(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return value === true || value === 'true' || value === '1';
}

async function listDefinitions(req, res, next) {
  try {
    const result = await workflowExecutorService.listWorkflowDefinitions({
      visibleOnly: parseBooleanQuery(req.query?.visibleOnly, true),
      enabledOnly: parseBooleanQuery(req.query?.enabledOnly, true),
      publishedOnly: parseBooleanQuery(req.query?.publishedOnly, true),
      activeOnly: parseBooleanQuery(req.query?.activeOnly, true),
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

async function getManagedDefinition(req, res, next) {
  try {
    const result = await workflowExecutorService.getWorkflowDefinitionForManage(req.params.workflowCode);

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

async function updateDefinition(req, res, next) {
  try {
    const definition = await workflowExecutorService.updateWorkflowDefinition({
      workflowCode: req.params.workflowCode,
      payload: req.body || {},
      user: req.user,
      permissions: req.permissions || [],
    });

    res.json({
      ok: true,
      definition,
      message: `Workflow ${definition.displayName} updated.`,
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

async function archiveDefinition(req, res, next) {
  try {
    const definition = await workflowExecutorService.archiveWorkflowDefinition({
      workflowCode: req.params.workflowCode,
      user: req.user,
      permissions: req.permissions || [],
    });

    res.json({
      ok: true,
      definition,
      message: `Workflow ${definition.displayName} archived.`,
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

async function cloneDefinition(req, res, next) {
  try {
    const definition = await workflowExecutorService.cloneWorkflowDefinition({
      workflowCode: req.params.workflowCode,
      payload: req.body || {},
      user: req.user,
      permissions: req.permissions || [],
    });

    res.status(201).json({
      ok: true,
      definition,
      message: `Workflow cloned as ${definition.displayName}.`,
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

async function createVersion(req, res, next) {
  try {
    const definition = await workflowExecutorService.createWorkflowVersion({
      workflowCode: req.params.workflowCode,
      payload: req.body || {},
      user: req.user,
      permissions: req.permissions || [],
    });

    res.status(201).json({
      ok: true,
      definition,
      message: `Workflow ${definition.displayName} version created${req.body?.publish === false ? '' : ' and published'}.`,
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


async function deleteDefinition(req, res, next) {
  try {
    const deleted = await workflowExecutorService.deleteWorkflowDefinition({
      workflowCode: req.params.workflowCode,
      user: req.user,
      permissions: req.permissions || [],
    });

    res.json({
      ok: true,
      deleted,
      message: `Workflow ${deleted.displayName} deleted.`,
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

async function replaceDefinitionGraph(req, res, next) {
  try {
    const definition = await workflowExecutorService.replaceWorkflowGraph({
      workflowCode: req.params.workflowCode,
      payload: req.body || {},
      user: req.user,
      permissions: req.permissions || [],
    });

    res.json({
      ok: true,
      definition,
      message: `Workflow ${definition.displayName} graph saved.`,
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


async function listApprovals(req, res, next) {
  try {
    const result = await workflowExecutorService.listWorkflowApprovalRequests(req.query || {});

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

async function decideApproval(req, res, next) {
  try {
    const context = authService.getRequestContext(req);
    const result = await workflowExecutorService.decideWorkflowApprovalRequest({
      approvalRequestId: req.params.approvalRequestId,
      payload: req.body || {},
      user: req.user,
      permissions: req.permissions || [],
      context,
    });

    res.json({
      ok: true,
      ...result,
      message: `Approval ${result.approval.status.toLowerCase()}.`,
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

async function approveApproval(req, res, next) {
  req.body = {
    ...(req.body || {}),
    decision: 'APPROVED',
  };

  return decideApproval(req, res, next);
}

async function rejectApproval(req, res, next) {
  req.body = {
    ...(req.body || {}),
    decision: 'REJECTED',
  };

  return decideApproval(req, res, next);
}

module.exports = {
  archiveDefinition,
  cloneDefinition,
  createDefinition,
  createVersion,
  deleteDefinition,
  getBuilderCatalog,
  getDefinition,
  getManagedDefinition,
  getRun,
  listApprovals,
  decideApproval,
  approveApproval,
  rejectApproval,
  listDefinitions,
  listRuns,
  replaceDefinitionGraph,
  startWorkflow,
  updateDefinition,
};
