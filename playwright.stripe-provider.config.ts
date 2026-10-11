import { defineConfig, devices } from "@playwright/test";
import processHelpers from "./scripts/stripe-provider-process.cjs";

if (process.env.STRIPE_PROVIDER_HUMAN_CHECKOUT !== "1") {
  throw new Error(
    "Dedicated Stripe provider Playwright requires runner-owned human checkout mode.",
  );
}
processHelpers.assertRunnerOwnedProviderInvocation(process.env);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "stripe-test-entitlement.provider.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  outputDir:
    process.env.STRIPE_PROVIDER_OUTPUT_DIR ??
    "test-results/stripe-provider-output",
  preserveOutput: "never",
  reporter: [
    [
      "./e2e/support/strict-reporter.ts",
      {
        expected: 1,
        outputFile:
          process.env.STRIPE_PROVIDER_SUMMARY_FILE ??
          "test-results/stripe-provider-summary.json",
      },
    ],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    headless: false,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
