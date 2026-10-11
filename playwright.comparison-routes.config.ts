import { defineConfig } from "@playwright/test";

/**
 * Focused request-only proof for the built comparison route contract. It owns
 * no server or global setup: callers must point it at the exact immutable build
 * they intend to qualify.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "comparison-routes.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
  },
});
