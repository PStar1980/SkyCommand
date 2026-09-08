const { expect } = require('@playwright/test');

function getBrowserTestCredentials() {
  const email = String(process.env.SKYCOMMAND_BROWSER_TEST_EMAIL || '').trim();
  const password = String(process.env.SKYCOMMAND_BROWSER_TEST_PASSWORD || '');

  if (!email || !password) {
    throw new Error(
      'Browser test credentials are not configured. Set SKYCOMMAND_BROWSER_TEST_EMAIL and SKYCOMMAND_BROWSER_TEST_PASSWORD in the local .env file.',
    );
  }

  return { email, password };
}

async function loginToSkyCommand(page) {
  const { email, password } = getBrowserTestCredentials();

  await page.goto('/login');

  const startRuntimeButton = page.getByRole('button', { name: 'Start SkyCommand' });
  if (await startRuntimeButton.isVisible().catch(() => false)) {
    throw new Error(
      'SkyCommand runtime is offline. Start the runtime before executing browser tests.',
    );
  }

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard(?:$|[?#])/);
}

module.exports = {
  getBrowserTestCredentials,
  loginToSkyCommand,
};
