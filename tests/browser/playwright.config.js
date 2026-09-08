const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');
const dotenv = require('dotenv');

dotenv.config({ path: process.env.SKYCOMMAND_BROWSER_ENV_FILE || path.resolve(__dirname, '../../.env') });

const baseURL = process.env.SKYCOMMAND_BROWSER_BASE_URL || 'http://127.0.0.1:15171';

module.exports = defineConfig({
  testDir: path.join(__dirname, 'specs'),
  outputDir: path.resolve(__dirname, '../../artifacts/browser/tests/results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder: path.resolve(__dirname, '../../artifacts/browser/tests/report'),
      },
    ],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
