const notificationService = require('../services/notificationService');

async function list(req, res, next) {
  try {
    const result = await notificationService.listUserNotifications({
      userId: req.user?.userId,
      status: req.query?.status,
      limit: req.query?.limit,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function markRead(req, res, next) {
  try {
    const notification = await notificationService.markNotificationRead({
      userId: req.user?.userId,
      notificationId: req.params.notificationId,
    });
    res.json({ ok: true, notification });
  } catch (error) {
    next(error);
  }
}

async function markAllRead(req, res, next) {
  try {
    const result = await notificationService.markAllNotificationsRead(req.user?.userId);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
}

module.exports = { list, markRead, markAllRead };
