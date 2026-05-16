const express = require('express');
const skywebController = require('../controllers/skywebController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get('/profile', requirePermission('SKYWEB_PROFILE_READ'), skywebController.getProfile);
router.patch('/profile', requirePermission('SKYWEB_PROFILE_WRITE'), skywebController.updateProfile);

module.exports = router;
