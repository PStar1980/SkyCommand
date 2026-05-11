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
const authService = require('./services/authService');
const scriptExecutionService = require('./services/scriptExecutionService');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/_health', (req, res) => {
    res.json({ ok: true, service: 'SkyServer API' });
  });

  app.get('/_db/health', async (req, res) => {
    try {
      const db = await testConnection();

      res.json({
        ok: true,
        service: 'SkyServer API',
        database: db.database,
        timestamp: db.now,
      });
    } catch (error) {
      console.error('[SkyServer DB] Health check failed:', error);

      res.status(500).json({
        ok: false,
        service: 'SkyServer API',
        error: 'Database connection failed',
      });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/tools', toolsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/macro', macroRoutes);
  app.use('/api/ingestion', ingestionRoutes);
  app.use('/api/worker', workerRoutes);

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
    console.error('[SkyServer API] Unhandled error:', error);

    res.status(500).json({
      ok: false,
      error: 'Internal server error.',
    });
  });

  return app;
}

async function runStartupMaintenance() {
  const sessionConfig = authService.getSessionConfig();

  console.log(
    `[SkyServer API] Session expiry: ${sessionConfig.sessionMinutes} minute(s) | revoke on start: ${sessionConfig.revokeSessionsOnStart}`,
  );

  if (authService.shouldRevokeSessionsOnStart()) {
    try {
      const revokeResult = await authService.revokeActiveSessionsOnStartup({
        reason: 'API_STARTUP',
      });

      if (revokeResult.revokedCount > 0) {
        console.warn(
          `[SkyServer API] Revoked ${revokeResult.revokedCount} active session(s) on startup.`,
        );
      } else {
        console.log('[SkyServer API] No active sessions required startup revocation.');
      }
    } catch (error) {
      console.warn('[SkyServer API] Startup session revocation failed:', error.message);
    }
  }

  try {
    const staleExecutionResult = await scriptExecutionService.markStaleStartedExecutions({
      reason: 'api_startup',
    });

    if (staleExecutionResult.cleanedCount > 0) {
      console.warn(
        `[SkyServer API] Cleaned ${staleExecutionResult.cleanedCount} stale STARTED script execution row(s).`,
      );
    }
  } catch (error) {
    console.warn('[SkyServer API] Startup stale execution cleanup failed:', error.message);
  }
}

if (require.main === module) {
  const port = Number(process.env.API_PORT || process.env.ADMIN_PORT || 7171);
  const app = createApp();

  app.listen(port, () => {
    console.log(`[SkyServer API] Listening on port ${port}`);

    runStartupMaintenance().catch((error) => {
      console.warn('[SkyServer API] Startup maintenance failed:', error.message);
    });
  });
}

module.exports = {
  createApp,
};
