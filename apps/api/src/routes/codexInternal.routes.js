const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const agentCapabilityAuthorizationService = require('../services/agentCapabilityAuthorizationService');

const router = express.Router();
const EFFECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_FILE = process.env.CODEX_CONTROL_BRIDGE_TOKEN_FILE || '/run/codex-api-bridge/api-bridge-token';

function token() {
  const value = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (value.length < 40) throw new Error('Codex internal control credential is invalid.');
  return value;
}

function equal(left, right) {
  const a = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

router.post('/managed-capability-dispatch', async (req, res) => {
  const supplied = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
  try {
    if (!equal(supplied, token())) return res.status(401).json({ ok: false, code: 'CODEX_INTERNAL_UNAUTHORIZED' });
    const effectId = String(req.body?.effectId || '').trim();
    const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
    if (!EFFECT_ID_PATTERN.test(effectId) || credential.length < 20 || credential.length > 512) {
      return res.status(400).json({ ok: false, code: 'CODEX_INTERNAL_CAPABILITY_CONTEXT_INVALID' });
    }
    const effect = await agentCapabilityAuthorizationService.dispatchManagedCapability({
      effectId,
      credential,
      runtimeWorker: {
        identity: 'codex-mcp-gateway',
        generation: typeof req.body?.runtimeWorker?.generation === 'string' ? req.body.runtimeWorker.generation.slice(0, 128) : null,
        taskQueue: 'codex-managed-mcp',
        source: 'CODEX_APP_SERVER',
      },
    });
    return res.status(200).json({ ok: true, effect });
  } catch (error) {
    console.warn('[CodexInternal] Managed capability dispatch failed:', error.code || error.message);
    return res.status(503).json({ ok: false, code: 'CODEX_MANAGED_CAPABILITY_DISPATCH_FAILED' });
  }
});

module.exports = router;
