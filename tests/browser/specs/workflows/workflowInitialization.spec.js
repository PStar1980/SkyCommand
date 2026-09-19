const { test, expect } = require('@playwright/test');
const { loginToSkyCommand } = require('../../helpers/skyCommandAuth');
const { getBrowserTestParameter } = require('../../helpers/browserTestParameters');

const interactiveExecution =
  String(process.env.SKYCOMMAND_BROWSER_EXECUTION_MODE || '').toUpperCase() === 'INTERACTIVE';
const interactiveHoldMs = Math.max(
  0,
  Number(process.env.SKYCOMMAND_BROWSER_INTERACTIVE_HOLD_MS || 4000) || 0,
);

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
    if (interactiveExecution) {
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

    if (interactiveExecution && interactiveHoldMs > 0) {
      // Keep the headed proof visible long enough for a human operator to observe it.
      await page.bringToFront();
      await page.waitForTimeout(interactiveHoldMs);
    }

    // Phase 1 deliberately proves browser/UI behavior without mutating workflow state.
    // Full workflow launch/completion coverage is added after the dedicated Browser Worker
    // and registered Browser Test execution path are in place.
  });

  test('renders the corrected R6 promotion node order for both published variants without starting either workflow', async ({
    page,
  }) => {
    const variants = [
      {
        code: 'skyserver_dev_commit',
        nodeKeys: [
          'promotion_preflight_node',
          'capability_catalog_node',
          'repo_map_node',
          'repo_zip_node',
          'dev_commit_node',
          'github_dev_pr_merge_node',
          'merge_sync_node',
          'local_repo_sync_node',
          'dev_promotion_summary',
        ],
      },
      {
        code: 'skycommand-dev-promo-alt',
        nodeKeys: [
          'promotion_preflight_node',
          'local_dev_pull_node',
          'capability_catalog_node',
          'repo_map_node',
          'repo_zip_node',
          'dev_commit_node',
          'github_dev_pr_merge_node',
          'merge_sync_node',
          'local_repo_sync_node',
          'dev_promotion_summary',
        ],
      },
    ];

    for (const variant of variants) {
      await page.goto(`/workflows/start?workflowCode=${encodeURIComponent(variant.code)}`);
      await expect(page.getByRole('heading', { name: 'Available workflows' })).toBeVisible();
      await page.getByLabel('Search', { exact: true }).fill(variant.code);

      const workflowRow = page.locator('tbody tr').filter({ hasText: variant.code }).first();
      await expect(workflowRow).toBeVisible();
      await workflowRow.getByRole('button', { name: 'Initialize', exact: true }).click();

      const visualKeys = page.locator(
        '[role="list"][aria-label="Sequential workflow visual map"] .sky-workflow-visual-key',
      );
      await expect(visualKeys).toHaveText(variant.nodeKeys, { timeout: 10_000 });
      await expect(page.getByRole('button', { name: 'Start Workflow', exact: true })).toBeVisible();
    }
  });
});
