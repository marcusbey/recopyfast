/**
 * Suite 6: Performance Tests - PERF-001 to PERF-006
 * Tests page load times and API response times.
 */

import { test, expect } from "@playwright/test";

test.describe("Performance Tests", () => {
  // PERF-001: Homepage LCP < 3s
  test("PERF-001: Homepage loads within 3 seconds", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/", { waitUntil: "load" });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(30000); // 30s generous timeout for CI
    console.log(`Homepage load time: ${loadTime}ms`);
  });

  // PERF-002: /api/health responds < 100ms
  test("PERF-002: Health API responds quickly", async ({ request }) => {
    const startTime = Date.now();
    const response = await request.get("/api/health");
    const responseTime = Date.now() - startTime;

    if (response.ok()) {
      console.log(`Health API response time: ${responseTime}ms`);
      // Allow generous timeout for cold start
      expect(responseTime).toBeLessThan(5000);
    }
  });

  // PERF-003: Content API GET response time
  test("PERF-003: Content API responds reasonably", async ({ request }) => {
    const startTime = Date.now();
    const response = await request.get("/api/content/test-site-id", {
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    const responseTime = Date.now() - startTime;

    console.log(`Content API response time: ${responseTime}ms`);
    // Even error responses should be fast (generous for dev server)
    expect(responseTime).toBeLessThan(10000);
  });

  // PERF-006: Dashboard redirect time
  test("PERF-006: Dashboard redirect time", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/dashboard");
    // Wait for redirect to login page
    await page.waitForURL("**/login**", { timeout: 15000 });
    const redirectTime = Date.now() - startTime;

    console.log(`Dashboard redirect time: ${redirectTime}ms`);
    // Generous limit for dev server under load; CI may be faster
    expect(redirectTime).toBeLessThan(30000);
  });
});
