const toolManifestService = require('../services/toolManifestService');

async function listTools(req, res, next) {
  try {
    const manifest = await toolManifestService.listToolsForUser({
      permissions: req.permissions || [],
    });

    res.json({
      ok: true,
      ...manifest,
    });
  } catch (error) {
    next(error);
  }
}

async function getTool(req, res, next) {
  try {
    const { toolCode } = req.params;

    const result = await toolManifestService.getToolForUser({
      toolCode,
      permissions: req.permissions || [],
    });

    if (!result.found) {
      return res.status(404).json({
        ok: false,
        error: 'Tool not found.',
        toolCode,
      });
    }

    if (!result.allowed) {
      return res.status(403).json({
        ok: false,
        error: 'Permission denied.',
        toolCode,
        permissionCode: result.permissionCode,
      });
    }

    return res.json({
      ok: true,
      tool: result.tool,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listTools,
  getTool,
};
