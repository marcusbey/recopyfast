/**
 * Suite 3C: Dashboard Flows E2E Tests - E2E-020 to E2E-027
 * Tests dashboard pages (requires auth).
 * Note: These tests verify redirect behavior for unauthenticated access.
 * The app redirects to /login?redirectedFrom=... for protected routes.
 */

import { test, expect } from "@playwright/test";

test.describe("Dashboard Flows (Unauthenticated)", () => {
  // E2E-020: Dashboard home requires auth
  test("E2E-020: Dashboard home redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login**", { timeout: 15000 });

    expect(page.url()).toContain("/login");
  });

  // E2E-025: Billing page requires auth
  test("E2E-025: Billing page redirects to login", async ({ page }) => {
    await page.goto("/dashboard/billing");
    await page.waitForURL("**/login**", { timeout: 15000 });

    expect(page.url()).toContain("/login");
  });

  // E2E-024: Settings requires auth
  test("E2E-024: Settings redirects to login", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.waitForURL("**/login**", { timeout: 15000 });

    expect(page.url()).toContain("/login");
  });

  // E2E-026: Teams page requires auth
  test("E2E-026: Teams page redirects to login", async ({ page }) => {
    await page.goto("/dashboard/teams");
    await page.waitForURL("**/login**", { timeout: 15000 });

    expect(page.url()).toContain("/login");
  });
});

test.describe("Dashboard API Protection", () => {
  // Verify API endpoints return 401 for unauthenticated requests
  test("API /api/billing/subscription returns 401", async ({ request }) => {
    const response = await request.get("/api/billing/subscription");
    expect(response.status()).toBe(401);
  });

  test("API /api/sites returns 401", async ({ request }) => {
    const response = await request.get("/api/sites");
    expect(response.status()).toBe(401);
  });

  test("API /api/teams returns 401", async ({ request }) => {
    const response = await request.get("/api/teams");
    expect(response.status()).toBe(401);
  });
});
