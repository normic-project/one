const { defineConfig, devices } = require('@playwright/test');
const { existsSync } = require('node:fs');
const systemEdge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32' && existsSync(systemEdge) ? systemEdge : undefined);
module.exports = defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 45000,
  globalTeardown: require.resolve('./scripts/e2e-teardown.cjs'),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: executable ? { executablePath: executable } : {} },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: { command: 'node scripts/e2e-server.cjs', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 90000 }
});
