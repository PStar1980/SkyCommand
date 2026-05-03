const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/login', authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);
router.get('/permissions', requireAuth, authController.permissions);

module.exports = router;
