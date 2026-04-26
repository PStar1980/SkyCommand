require('./core/bootstrap');

const express = require('express');
const path = require('path');
const { testConnection } = require('./db/connection');

const app = express();

// Health route
app.get('/_health', (req, res) => res.json({ ok: true, service: 'SkyServer' }));

// Database health route
app.get('/_db/health', async (req, res) => {
  try {
    const db = await testConnection();

    res.json({
      ok: true,
      service: 'SkyServer',
      database: db.database,
      timestamp: db.now,
    });
  } catch (error) {
    console.error('[SkyServer DB] Health check failed:', error);

    res.status(500).json({
      ok: false,
      service: 'SkyServer',
      error: 'Database connection failed',
    });
  }
});

// Serve web frontend (private admin UI)
const webPath = path.join(__dirname, 'web');
app.use(express.static(webPath));

app.listen(process.env.ADMIN_PORT || 7171, () => {
  console.log('[SkyServer] Admin server listening on', process.env.ADMIN_PORT || 7171);
});
