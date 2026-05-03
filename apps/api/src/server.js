require('../../../scripts/node/util/bootstrap');

const express = require('express');
const path = require('path');
const { testConnection } = require('../../../packages/db/src/connection');
const authRoutes = require('./routes/auth.routes');

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

if (require.main === module) {
  const port = Number(process.env.API_PORT || process.env.ADMIN_PORT || 7171);
  const app = createApp();

  app.listen(port, () => {
    console.log(`[SkyServer API] Listening on port ${port}`);
  });
}

module.exports = {
  createApp,
};
