/**
 * Phase 6 reference Playwright Automation.
 *
 * Execution integration lands in the Playwright Automation runtime/UI phases. The source contract
 * is intentionally small: a future runner supplies an authenticated Playwright Page and runtime
 * context, and this module returns structured business output rather than test assertions.
 */
async function execute({ page, automationCode = 'command-center-status-snapshot', environment = 'LOCAL', helpers = {} } = {}) {
  if (!page) throw new Error('Playwright Automation requires an authenticated Playwright page.');

  const startedAt = Date.now();
  if (typeof helpers.authenticateSkyCommand === 'function') {
    await helpers.authenticateSkyCommand();
  }
  await page.goto('/dashboard');
  await page.getByRole('heading', { name: 'Command Center', exact: true }).waitFor();

  const services = await page.locator('.sky-server-status-card').evaluateAll((cards) =>
    cards.map((card) => ({
      label: card.querySelector('.sky-page-kicker')?.textContent?.trim() || '',
      value: card.querySelector('.sky-server-status-value')?.textContent?.trim() || '',
      detail: card.querySelector('.sky-muted')?.textContent?.trim() || '',
    })),
  );

  const screenshot = typeof helpers.captureScreenshot === 'function'
    ? await helpers.captureScreenshot('Command Center Status Snapshot')
    : null;

  return {
    contract: 'browser_automation_summary.v1',
    status: 'SUCCESS',
    automationCode,
    browser: 'chromium',
    environment,
    durationMs: Math.max(0, Date.now() - startedAt),
    result: {
      page: 'Command Center',
      serviceCount: services.length,
      services,
    },
    artifacts: screenshot ? [screenshot] : [],
  };
}

module.exports = {
  execute,
};
