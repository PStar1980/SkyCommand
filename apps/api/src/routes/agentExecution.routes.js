const express = require('express');
const agentController = require('../controllers/agentController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/preview',
  requirePermission('AGENT_AUTHORITY_PREVIEW'),
  requirePermission('AGENT_ACCOUNT_USE'),
  agentController.previewAuthority,
);

module.exports = router;
