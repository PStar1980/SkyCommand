const { test, expect } = require('@playwright/test');
const { loginToSkyCommand } = require('../../helpers/skyCommandAuth');
const { getBrowserTestParameter } = require('../../helpers/browserTestParameters');

const workflowCode =
  String(
    getBrowserTestParameter(
      'workflowCode',
      process.env.SKYCOMMAND_BROWSER_TEST_WORKFLOW_CODE || 'repo-map-zip',
    ),
  ).trim() || 'repo-map-zip';

test.describe('Workflow Initialization browser smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginToSkyCommand(page);
    if (String(process.env.SKYCOMMAND_BROWSER_EXECUTION_MODE || '').toUpperCase() === 'INTERACTIVE') {
      await page.bringToFront();
    }
  });

  test('@smoke Initialize reveals workflow launch controls without starting the workflow', async ({
    page,
  }, testInfo) => {
    await page.goto('/workflows/start');

    await expect(page.getByRole('heading', { name: 'Available workflows' })).toBeVisible();
    await expect(page.locator('section.sky-workflow-start-config-card')).toHaveCount(0);

    await page.getByLabel('Search', { exact: true }).fill(workflowCode);

    const workflowRow = page.locator('tbody tr').filter({ hasText: workflowCode }).first();
    await expect(workflowRow).toBeVisible();

    await workflowRow.getByRole('button', { name: 'Initialize', exact: true }).click();

    const initializationCard = page.locator('section.sky-workflow-start-config-card');
    await expect(initializationCard).toBeVisible();
    await expect(initializationCard.getByText('Workflow initialization', { exact: true })).toBeVisible();
    await expect(initializationCard.getByText(workflowCode, { exact: true })).toBeVisible();
    await expect(
      initializationCard.getByRole('button', { name: 'Start Workflow', exact: true }),
    ).toBeVisible();

    const evidencePath = testInfo.outputPath('workflow-initialization-open.png');
    await page.screenshot({ path: evidencePath, fullPage: true });
    await testInfo.attach('Workflow Initialization Open', {
      path: evidencePath,
      contentType: 'image/png',
    });

    if (String(process.env.SKYCOMMAND_BROWSER_EXECUTION_MODE || '').toUpperCase() === 'INTERACTIVE') {
      // Keep the headed proof visible long enough for a human operator to observe it.
      await page.waitForTimeout(1500);
    }

    // Phase 1 deliberately proves browser/UI behavior without mutating workflow state.
    // Full workflow launch/completion coverage is added after the dedicated Browser Worker
    // and registered Browser Test execution path are in place.
  });
});
