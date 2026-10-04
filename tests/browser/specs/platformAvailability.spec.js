const { test, expect } = require('@playwright/test');

const OPERATION_ID = '323e4567-e89b-42d3-a456-426614174001';
const CONTAINER_SERVICES = [
  'web',
  'temporal-volume-init',
  'postgres',
  'temporal',
  'temporal-worker',
  'browser-worker',
  'node-worker',
  'agent-runtime-worker',
  'codex-egress-proxy',
  'codex-mcp-gateway',
  'codex-agent-runtime-worker',
  'codex-control-bridge',
  'api',
  'codex-managed-volume-init',
];

function serviceInventory() {
  return CONTAINER_SERVICES.map((service) => ({
    service,
    name: `skycommand-${service}`,
    state: 'RUNNING',
    health: 'HEALTHY',
    running: true,
  }));
}

async function installFixture(page, { supervisorStatus, hostAgentStatus, actions }) {
  const state = { actionRequests: [], pageErrors: [] };
  page.on('pageerror', (error) => {
    state.pageErrors.push(error.message);
    console.error(`[Platform Availability page error] ${error.stack || error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[Platform Availability console] ${message.text()}`);
  });
  page.on('requestfailed', (request) => console.error(`[Platform Availability request failed] ${request.url()} · ${request.failure()?.errorText}`));
  await page.addInitScript(() =>
    localStorage.setItem('skycommand.admin.sessionToken', 'platform-availability-browser-fixture'),
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });

    if (url.pathname === '/api/auth/me') {
      return json({
        ok: true,
        user: { userId: 'runtime-control-fixture', displayName: 'Runtime Control Fixture' },
        session: {},
        permissions: [
          { permissionCode: 'INFRASTRUCTURE_DOCKER_READ' },
          { permissionCode: 'INFRASTRUCTURE_DOCKER_CONTROL' },
        ],
      });
    }
    if (url.pathname === '/api/infrastructure/providers/docker/skycommand-runtime/status') {
      return json({
        ok: true,
        supervisor: {
          status: supervisorStatus,
          runtimeStatus: supervisorStatus === 'ONLINE' ? 'ONLINE' : 'UNKNOWN',
          engineStatus: supervisorStatus === 'ONLINE' ? 'ONLINE' : 'UNKNOWN',
          services: supervisorStatus === 'ONLINE' ? serviceInventory() : [],
          activeOperation: null,
          lastOperation: null,
        },
        hostAgent: {
          status: hostAgentStatus,
          enabled: true,
          online: hostAgentStatus === 'ONLINE',
          taskQueue: 'skycommand-host-local',
        },
        availableActions: actions,
      });
    }
    if (url.pathname === '/api/infrastructure/providers/docker/skycommand-runtime/actions' && request.method() === 'POST') {
      state.actionRequests.push(request.postDataJSON());
      return json({
        ok: true,
        operation: {
          operationId: request.postDataJSON().operationId || OPERATION_ID,
          status: 'REQUESTED',
          requestedAt: '2026-10-02T12:00:00.000Z',
        },
      }, 202);
    }
    if (url.pathname === '/api/infrastructure/providers/docker/overview') {
      return json({
        ok: true,
        target: { targetCode: 'LOCAL_DOCKER', status: 'ONLINE' },
        provider: { status: 'ONLINE', engineVersion: 'fixture' },
        counts: { projects: 1, containers: 0 },
        projects: [],
        containers: [],
        images: [],
        volumes: [],
        networks: [],
        capturedAt: '2026-10-02T12:00:00.000Z',
        error: null,
      });
    }
    if (request.method() !== 'GET') {
      throw new Error(`Unexpected mutating browser fixture request: ${request.method()} ${url.pathname}`);
    }
    return json({ ok: true, items: [], total: 0, categories: [], unreadCount: 0 });
  });
  return state;
}

test.describe('Phase 19.3B-R4 Platform Availability', () => {
  test('shows state-derived Start/Restart controls and filters Docker Containers from a runtime card', async ({ page }) => {
    const state = await installFixture(page, {
      supervisorStatus: 'OFFLINE',
      hostAgentStatus: 'ONLINE',
      actions: ['START_SUPERVISOR', 'RESTART_HOST_AGENT'],
    });
    await page.goto('/dashboard');

    const panel = page.locator('.sky-server-status-panel');
    await expect(panel.getByRole('heading', { name: 'Runtime inventory', exact: true })).toBeVisible();
    for (const segment of ['Frontend', 'Backend', 'Agent', 'Codex']) {
      await expect(panel.getByText(segment, { exact: true })).toBeVisible();
    }
    await expect(panel.getByRole('button', { name: 'Start Supervisor', exact: true })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Restart Host Agent', exact: true })).toBeEnabled();
    await expect(panel.getByText('SkyCommand Runtime', { exact: true })).toHaveCount(0);
    await expect(panel.getByText(/^\d+ services$/i)).toHaveCount(0);
    for (const service of ['codex-agent-runtime-worker', 'codex-control-bridge', 'codex-egress-proxy', 'codex-mcp-gateway']) {
      await expect(panel.getByRole('link', { name: new RegExp(service.replaceAll('-', '.*'), 'i') })).toHaveCount(1);
    }

    const screenshot = test.info().outputPath('platform-availability-start-state.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await test.info().attach('Platform Availability Start state', { path: screenshot, contentType: 'image/png' });

    const startSupervisor = panel.getByRole('button', { name: 'Start Supervisor', exact: true });
    page.once('dialog', (dialog) => dialog.accept());
    await startSupervisor.click();
    await expect.poll(() => state.actionRequests.length).toBe(1);
    expect(state.actionRequests[0]).toEqual({ action: 'START_SUPERVISOR', operationId: expect.any(String) });

    await page.getByRole('link', { name: /Open Web frontend in Docker Containers, filtered by web/ }).click();
    await expect(page).toHaveURL(/\/docker\/containers\?q=web$/);
    await expect(page.getByRole('heading', { name: 'Container inventory', exact: true })).toBeVisible();
    await expect(page.locator('#dockerContainerSearch')).toHaveValue('web');
    expect(state.pageErrors).toEqual([]);
  });

  test('shows Restart controls when both host processes are observed online', async ({ page }) => {
    const state = await installFixture(page, {
      supervisorStatus: 'ONLINE',
      hostAgentStatus: 'ONLINE',
      actions: [
        'REBUILD_FRONTEND',
        'REBUILD_BACKEND',
        'RESTART_RUNTIME',
        'STOP_RUNTIME',
        'RESTART_SUPERVISOR',
        'RESTART_HOST_AGENT',
      ],
    });
    await page.goto('/dashboard');
    const panel = page.locator('.sky-server-status-panel');
    await expect(panel.getByRole('button', { name: 'Rebuild Frontend', exact: true })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Rebuild Backend', exact: true })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Restart Runtime', exact: true })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Restart Supervisor', exact: true })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Restart Host Agent', exact: true })).toBeEnabled();
    expect(state.pageErrors).toEqual([]);
  });
});
