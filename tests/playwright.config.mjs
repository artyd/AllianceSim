// Playwright: layout/responsive checks of the AllianceOS phone on real screen sizes (spec 006).
// Runs against the dev stack (API + embedded Postgres + static web) with the system Chrome.
//   cd tests && npx playwright test
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.WEB_PORT || 5055);
const tg = (name, platform, width, height) => ({ name, use: { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, tgPlatform: platform } });
const web = (name, width, height) => ({ name, use: { viewport: { width, height }, tgPlatform: null } });

export default defineConfig({
  testDir: './pw',
  outputDir: './.tmp/pw-results',
  timeout: 60_000,
  workers: 1,               // one shared dev stack / database
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: './.tmp/pw-report', open: 'never' }]],
  globalTeardown: './pw/teardown.mjs',
  use: { channel: 'chrome', baseURL: `http://localhost:${PORT}/`, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'node devstack.mjs',
    env: { STACK: 'dev' },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    tg('tg-iphone-se', 'ios', 375, 667),
    tg('tg-iphone-15', 'ios', 393, 852),
    tg('tg-pixel-7', 'android', 412, 915),
    tg('tg-small-android', 'android', 360, 740),
    web('web-mobile', 390, 844),
    web('web-laptop', 1366, 768),
    web('web-fullhd', 1920, 1080),
  ],
});
