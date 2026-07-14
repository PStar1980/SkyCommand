const express = require('express');
const workerController = require('../controllers/workerController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get('/health', requirePermission('WORKER_SCHEDULE_READ'), workerController.getHealth);
router.get('/tools', requirePermission('WORKER_SCHEDULE_READ'), workerController.listWorkerTools);
router.get('/nodes', requirePermission('WORKER_ADMIN'), workerController.listWorkerNodes);
router.get('/runs', requirePermission('WORKER_SCHEDULE_READ'), workerController.listScheduleRuns);

router.get('/schedules', requirePermission('WORKER_SCHEDULE_READ'), workerController.listSchedules);
router.post(
  '/schedules',
  requirePermission('WORKER_SCHEDULE_CREATE'),
  workerController.createSchedule,
);
router.get(
  '/schedules/:scheduleId',
  requirePermission('WORKER_SCHEDULE_READ'),
  workerController.getSchedule,
);
router.patch(
  '/schedules/:scheduleId',
  requirePermission('WORKER_SCHEDULE_CHANGE'),
  workerController.updateSchedule,
);
router.patch(
  '/schedules/:scheduleId/status',
  requirePermission('WORKER_SCHEDULE_CHANGE'),
  workerController.updateScheduleStatus,
);
router.post(
  '/schedules/:scheduleId/queue',
  requirePermission('WORKER_SCHEDULE_RUN_IMMEDIATE'),
  workerController.queueScheduleNow,
);
router.post(
  '/schedules/:scheduleId/unqueue',
  requirePermission('WORKER_SCHEDULE_CHANGE'),
  workerController.unqueueSchedule,
);
router.post(
  '/schedules/:scheduleId/run-now',
  requirePermission('WORKER_SCHEDULE_RUN_IMMEDIATE'),
  workerController.runScheduleNow,
);
router.delete(
  '/schedules/:scheduleId',
  requirePermission('WORKER_SCHEDULE_CHANGE'),
  workerController.deleteSchedule,
);
router.get(
  '/schedules/:scheduleId/runs',
  requirePermission('WORKER_SCHEDULE_READ'),
  workerController.listRunsForSchedule,
);

router.get('/listeners', requirePermission('WORKER_LISTENER_READ'), workerController.listListeners);
router.post(
  '/listeners',
  requirePermission('WORKER_LISTENER_CREATE'),
  workerController.createListener,
);
router.get(
  '/listeners/:listenerId',
  requirePermission('WORKER_LISTENER_READ'),
  workerController.getListener,
);
router.patch(
  '/listeners/:listenerId',
  requirePermission('WORKER_LISTENER_CHANGE'),
  workerController.updateListener,
);
router.patch(
  '/listeners/:listenerId/status',
  requirePermission('WORKER_LISTENER_CHANGE'),
  workerController.updateListenerStatus,
);
router.get(
  '/listeners/:listenerId/events',
  requirePermission('WORKER_EVENT_READ'),
  workerController.listEventsForListener,
);
router.get(
  '/listener-events',
  requirePermission('WORKER_EVENT_READ'),
  workerController.listListenerEvents,
);

module.exports = router;
