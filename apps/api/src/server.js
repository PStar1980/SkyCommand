require('../../../scripts/node/util/bootstrap');

const express = require('express');
const path = require('path');
const { testConnection } = require('../../../packages/db/src/connection');
const authRoutes = require('./routes/auth.routes');
const toolsRoutes = require('./routes/tools.routes');
const adminRoutes = require('./routes/admin.routes');
const macroRoutes = require('./routes/macro.routes');
const ingestionRoutes = require('./routes/ingestion.routes');
const workerRoutes = require('./routes/worker.routes');
const temporalRoutes = require('./routes/temporal.routes');
const workflowRoutes = require('./routes/workflow.routes');
const publicRoutes = require('./routes/public.routes');
const skywebRoutes = require('./routes/skyweb.routes');
const authService = require('./services/authService');
const scriptExecutionService = require('./services/scriptExecutionService');
const apiTelemetryService = require('./services/apiTelemetryService');
const { apiTelemetryMiddleware } = require('./middleware/apiTelemetryMiddleware');
const apiDockerPreflight = require('./services/apiDockerPreflight');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(apiTelemetryMiddleware);

  app.get('/_health', (req, res) => {
    res.json({ ok: true, service: 'SkyCommand API' });
  });

  app.get('/_db/health', async (req, res) => {
    try {
      const db = await testConnection();

      res.json({
        ok: true,
        service: 'SkyCommand API',
        database: db.database,
        timestamp: db.now,
        version: db.version,
        serverPort: db.server_port,
      });
    } catch (error) {
      console.error('[SkyCommand DB] Health check failed:', error);

      res.status(500).json({
        ok: false,
        service: 'SkyCommand API',
        error: 'Database connection failed',
      });
    }
  });

  app.use('/api/public', publicRoutes);

  app.use('/api/auth', authRoutes);
  app.use('/api/tools', toolsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/macro', macroRoutes);
  app.use('/api/ingestion', ingestionRoutes);
  app.use('/api/worker', workerRoutes);
  app.use('/api/temporal', temporalRoutes);
  app.use('/api/workflows', workflowRoutes);
  app.use('/api/skyweb', skywebRoutes);

  if (process.env.SERVE_ADMIN_WEB === 'true') {
    const adminWebPath = path.resolve(__dirname, '../../admin-web/dist');
    app.use(express.static(adminWebPath));

    app.get(/.*/, (req, res) => {
      res.sendFile(path.join(adminWebPath, 'index.html'));
    });
  }

  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: 'Route not found.',
      path: req.originalUrl,
    });
  });

  app.use((error, req, res, next) => {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const responseBody = {
      ok: false,
      error: statusCode >= 500 ? 'Internal server error.' : error.message,
    };

    if (statusCode < 500 && error?.details) {
      responseBody.details = error.details;
    }

    console.error('[SkyCommand API] Unhandled error:', error);

    res.status(statusCode).json(responseBody);
  });

  return app;
}

async function runStartupMaintenance() {
  const sessionConfig = authService.getSessionConfig();

  console.log(
    `[SkyCommand API] Session expiry: ${sessionConfig.sessionMinutes} minute(s) | revoke on start: ${sessionConfig.revokeSessionsOnStart}`,
  );

  if (authService.shouldRevokeSessionsOnStart()) {
    try {
      const revokeResult = await authService.revokeActiveSessionsOnStartup({
        reason: 'API_STARTUP',
      });

      if (revokeResult.revokedCount > 0) {
        console.warn(
          `[SkyCommand API] Revoked ${revokeResult.revokedCount} active session(s) on startup.`,
        );
      } else {
        console.log('[SkyCommand API] No active sessions required startup revocation.');
      }
    } catch (error) {
      console.warn('[SkyCommand API] Startup session revocation failed:', error.message);
    }
  }

  try {
    const staleExecutionResult = await scriptExecutionService.markStaleStartedExecutions({
      reason: 'api_startup',
    });

    if (staleExecutionResult.cleanedCount > 0) {
      console.warn(
        `[SkyCommand API] Cleaned ${staleExecutionResult.cleanedCount} stale STARTED script execution row(s).`,
      );
    }
  } catch (error) {
    console.warn('[SkyCommand API] Startup stale execution cleanup failed:', error.message);
  }

  try {
    const retentionResult = await apiTelemetryService.pruneApiRequestTelemetry();

    console.log(
      `[SkyCommand API] API telemetry retention: ${retentionResult.retentionDays} day(s)` +
        (retentionResult.deletedCount > 0
          ? ` | pruned ${retentionResult.deletedCount} expired row(s)`
          : ''),
    );
  } catch (error) {
    if (error?.code === '42P01') {
      console.warn('[SkyCommand API] API telemetry retention skipped until migration 00071 is applied.');
    } else {
      console.warn('[SkyCommand API] API telemetry retention cleanup failed:', error.message);
    }
  }
}

async function startServer() {
  const port = Number(process.env.API_PORT || process.env.ADMIN_PORT || 7171);
  await apiDockerPreflight.assertDockerApiConfiguration();

  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`[SkyCommand API] Listening on port ${port}`);

    runStartupMaintenance().catch((error) => {
      console.warn('[SkyCommand API] Startup maintenance failed:', error.message);
    });
  });

  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('[SkyCommand API] Failed to start:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  startServer,
};
