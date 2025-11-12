require('./core/bootstrap');
const express = require('express');
const path = require('path');
const app = express();

// Health route
app.get('/_health', (req, res) => res.json({ ok: true, service: 'SkyServer' }));

// Serve web frontend (private admin UI)
const webPath = path.join(__dirname, 'web');
app.use(express.static(webPath));

app.listen(process.env.ADMIN_PORT || 7171, () => {
  console.log('[SkyServer] Admin server listening on', process.env.ADMIN_PORT || 7171);
});
