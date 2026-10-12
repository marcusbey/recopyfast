import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // s06b owns a credential-free built-artifact harness under e2e/ so its
  // fixtures stay beside the rest of the browser tests. Playwright discovers
  // subdirectories recursively: when this exclusion was omitted during the
  // recovery onto s75, the strict main job silently grew from its reviewed
  // inventory to six extra tests. The separate playwright.embed.config.ts and CI job execute
  // these six tests; the main job must keep its exact inventory and disposable
  // Supabase/Next contract.
  testIgnore: ["**/embed-fixture/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        [
          "./e2e/support/strict-reporter.ts",
          {
            expected: 105,
            outputFile: "test-results/playwright-summary.json",
          },
        ],
      ]
    : "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    // The mutating specs put short-lived editor credentials in their URLs.
    // Before s24 CI uploaded traces/videos on failure, which preserved those
    // URLs after the rows were deleted. CI now publishes the strict reporter's
    // credential-free summary instead; local debugging keeps the rich media.
    trace: process.env.CI ? "off" : "on-first-retry",
    screenshot: process.env.CI ? "off" : "only-on-failure",
    video: process.env.CI ? "off" : "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev:next",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
        timeout: 120 * 1000,
      },
});
