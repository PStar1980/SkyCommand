const { test, expect } = require('@playwright/test');
const { loginToSkyCommand } = require('../../helpers/skyCommandAuth');

function isRunDetailPath(pathname) {
  return /\/api\/workflows\/runs\/[^/]+$/.test(pathname);
}

test.describe('Workflow Operations performance correction', () => {
  test.beforeEach(async ({ page }) => {
    await loginToSkyCommand(page);
  });

  test('selects immediately, ignores stale detail, and lazily requests diagnostics', async ({
    page,
  }) => {
    await page.goto('/workflows/history');

    const rows = page.locator('tr[data-workflow-run-id]');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });

    const r5Rows = rows.filter({ hasText: 'dev_change_finalize' });
    const r5Count = await r5Rows.count();
    test.skip(r5Count < 3, 'R5 acceptance requires at least three persisted R5 runs.');

    const runIds = [];
    for (let index = 0; index < 3; index += 1) {
      runIds.push(await r5Rows.nth(index).getAttribute('data-workflow-run-id'));
    }
    expect(runIds.every(Boolean)).toBe(true);

    const normalDetailRequests = [];
    const telemetryRequests = [];
    const diagnosticsRequests = [];
    await page.on('request', (request) => {
      const url = new URL(request.url());
      if (isRunDetailPath(url.pathname)) normalDetailRequests.push(request);
      if (/\/telemetry$/.test(url.pathname)) telemetryRequests.push(request);
      if (/\/diagnostics$/.test(url.pathname)) diagnosticsRequests.push(request);
    });

    await page.route('**/api/workflows/runs/*', async (route) => {
      const url = new URL(route.request().url());
      if (isRunDetailPath(url.pathname)) {
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      if (/\/diagnostics$/.test(url.pathname)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    const firstRow = page.locator(`tr[data-workflow-run-id="${runIds[0]}"]`);
    const secondRow = page.locator(`tr[data-workflow-run-id="${runIds[1]}"]`);
    const thirdRow = page.locator(`tr[data-workflow-run-id="${runIds[2]}"]`);

    const clickStartedAt = Date.now();
    await firstRow.click();
    await expect(firstRow).toHaveClass(/sky-selected-row/, { timeout: 500 });
    expect(Date.now() - clickStartedAt).toBeLessThan(500);

    normalDetailRequests.length = 0;
    telemetryRequests.length = 0;
    diagnosticsRequests.length = 0;

    await firstRow.click();
    await secondRow.click();
    await thirdRow.click();
    await expect(thirdRow).toHaveClass(/sky-selected-row/, { timeout: 500 });

    const detailZone = page.locator('.sky-workflow-history-detail-zone');
    await expect(detailZone).toHaveAttribute('data-selected-run-id', runIds[2], {
      timeout: 8_000,
    });
    expect(await page.locator('[data-testid="workflow-run-detail-error"]').count()).toBe(0);

    const terminalRow = r5Rows.filter({ hasText: 'COMPLETED' }).first();
    if (await terminalRow.count()) {
      const terminalRunId = await terminalRow.getAttribute('data-workflow-run-id');
      await terminalRow.click();
      await expect(terminalRow).toHaveClass(/sky-selected-row/, { timeout: 500 });
      await expect(detailZone).toHaveAttribute('data-selected-run-id', terminalRunId, {
        timeout: 8_000,
      });
      const normalRequestsAfterSelection = normalDetailRequests.length;
      const telemetryRequestsAfterSelection = telemetryRequests.length;

      await page.waitForTimeout(17_000);
      expect(normalDetailRequests.length).toBeLessThanOrEqual(normalRequestsAfterSelection + 1);
      expect(telemetryRequests.length).toBe(telemetryRequestsAfterSelection);
      expect(diagnosticsRequests.length).toBe(0);

      await terminalRow.getByRole('button', { name: 'Workflow Details', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByTestId('workflow-run-diagnostics-loading')).toBeVisible({
        timeout: 5_000,
      });
      await expect.poll(() => diagnosticsRequests.length, { timeout: 8_000 }).toBeGreaterThan(0);
    }
  });

  test('presents the R5 catalogue and receipt nodes through the shared structured renderer', async ({
    page,
  }) => {
    await page.goto('/workflows/history');

    const rows = page.locator('tr[data-workflow-run-id]');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });

    const r5Rows = rows.filter({ hasText: 'dev_change_finalize' });
    const completedR5Rows = r5Rows.filter({ hasText: 'COMPLETED' });
    test.skip(
      (await completedR5Rows.count()) === 0,
      'R5 structured-output acceptance requires a completed run.',
    );

    const completedRow = completedR5Rows.first();
    const completedRunId = await completedRow.getAttribute('data-workflow-run-id');
    await completedRow.click();
    await expect(completedRow).toHaveClass(/sky-selected-row/, { timeout: 500 });
    await expect(page.locator('.sky-workflow-history-detail-zone')).toHaveAttribute(
      'data-selected-run-id',
      completedRunId,
      { timeout: 8_000 },
    );

    const runtimeNodes = page.locator(
      '[role="list"][aria-label="Sequential workflow visual map"] .sky-workflow-visual-node',
    );
    await expect(runtimeNodes).toHaveCount(12, { timeout: 10_000 });

    await runtimeNodes.nth(8).click();
    await expect(page.getByTestId('structured-output-capability-catalog')).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByTestId('workflow-focused-node-output')).toHaveAttribute(
      'data-structured-output-type',
      'capability_catalog_summary.v1',
    );
    expect(await page.locator('.sky-focused-node-output-table-card').count()).toBe(0);

    await runtimeNodes.nth(11).click();
    await expect(page.getByTestId('structured-output-dev-finalization-receipt')).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByTestId('workflow-focused-node-output')).toHaveAttribute(
      'data-structured-output-type',
      'dev_finalization_summary.v1',
    );
    expect(await page.locator('.sky-focused-node-output-table-card').count()).toBe(0);

    const receiptWarnings = page
      .getByTestId('structured-output-dev-finalization-receipt')
      .locator('.alert-warning');
    await expect(receiptWarnings).toHaveCount(1);
    await expect(receiptWarnings.locator('span')).toHaveCount(2);
    const receiptWarningText = await receiptWarnings.innerText();
    expect(receiptWarningText).toContain('known baseline limitation');
    expect(receiptWarningText).toContain('temporal-worker');
  });
});
