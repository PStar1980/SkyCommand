const express = require('express');
const agentController = require('../controllers/agentController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth);

router.get('/options', requirePermission('AGENT_PROJECT_READ'), agentController.listProjectOptions);
router.get('/', requirePermission('AGENT_PROJECT_READ'), agentController.listProjects);
router.post('/', requirePermission('AGENT_PROJECT_MANAGE'), agentController.createProject);
router.get('/:projectId', requirePermission('AGENT_PROJECT_READ'), agentController.getProject);
router.patch('/:projectId', requirePermission('AGENT_PROJECT_MANAGE'), agentController.updateProject);
router.get('/:projectId/member-options', requirePermission('AGENT_PROJECT_MANAGE'), agentController.listProjectUsers);
router.post('/:projectId/memberships', requirePermission('AGENT_PROJECT_MANAGE'), agentController.upsertProjectMember);
router.post('/:projectId/repositories', requirePermission('AGENT_PROJECT_MANAGE'), agentController.bindRepository);
router.post('/:projectId/workspaces', requirePermission('AGENT_PROJECT_MANAGE'), agentController.bindWorkspace);
router.post('/:projectId/allow-rules', requirePermission('AGENT_PROJECT_MANAGE'), agentController.setProjectAgentAllowRule);

module.exports = router;
