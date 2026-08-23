const express = require('express');
const authController = require('../controllers/authController');
const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/login', authController.login);
router.post('/logout', requireAuth, authController.logout);
router.post('/change-password', requireAuth, authController.changePassword);
router.get('/me', requireAuth, authController.me);
router.get('/permissions', requireAuth, authController.permissions);
router.get('/notifications', requireAuth, notificationController.list);
router.patch('/notifications/:notificationId/read', requireAuth, notificationController.markRead);
router.post('/notifications/read-all', requireAuth, notificationController.markAllRead);

module.exports = router;
