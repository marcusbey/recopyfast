import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/embed-fixture",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Both origins use fixed, env-overridable ports. One worker keeps their
  // ownership deterministic and makes a collision fail at server startup.
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  outputDir: "test-results/embed-fixture",
  use: {
    ...devices["Desktop Chrome"],
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
