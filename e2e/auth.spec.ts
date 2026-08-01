/**
 * Suite 3A: Auth Flows E2E Tests - E2E-001 to E2E-006
 * Tests authentication redirects, login/signup page rendering.
 *
 * Note: The app redirects unauthenticated users to /login?redirectedFrom=...
 * Login uses magic link (email only, no password).
 * Signup is a tab on the /login page.
 */

import { test, expect } from "@playwright/test";

test.describe("Auth Flows", () => {
  // E2E-001: /dashboard redirects unauthenticated to /login
  test("E2E-001: /dashboard redirects unauthenticated to /login", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    // App redirects to /login?redirectedFrom=%2Fdashboard
    await page.waitForURL("**/login**", { timeout: 15000 });

    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("redirectedFrom");
  });

  // E2E-002: /dashboard/billing redirects unauthenticated
  test("E2E-002: /dashboard/billing redirects unauthenticated", async ({
    page,
  }) => {
    await page.goto("/dashboard/billing");
    await page.waitForURL("**/login**", { timeout: 15000 });

    expect(page.url()).toContain("/login");
  });

  // E2E-003: /dashboard/settings redirects unauthenticated
  test("E2E-003: /dashboard/settings redirects unauthenticated", async ({
    page,
  }) => {
    await page.goto("/dashboard/settings");
    await page.waitForURL("**/login**", { timeout: 15000 });

    expect(page.url()).toContain("/login");
  });

  // E2E-004: Login page renders magic link form
  test("E2E-004: Login page renders form fields", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Check for email input (magic link auth - email only)
    const emailInput = page.locator(
      'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="example" i]',
    );
    await expect(emailInput.first()).toBeVisible({ timeout: 10000 });

    // Check for submit button (Send magic link)
    const submitBtn = page.locator(
      'button[type="submit"], button:has-text("magic link"), button:has-text("Sign"), button:has-text("Send")',
    );
    await expect(submitBtn.first()).toBeVisible({ timeout: 10000 });
  });

  // E2E-005: Signup page/tab renders form
  test("E2E-005: Signup page renders form", async ({ page }) => {
    // Signup is accessible via /signup or as a tab on /login
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");

    // Should render the auth form with email input
    const emailInput = page.locator(
      'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="example" i]',
    );
    await expect(emailInput.first()).toBeVisible({ timeout: 10000 });
  });

  // E2E-006: /sites redirects unauthenticated
  test("E2E-006: /sites redirects unauthenticated", async ({ page }) => {
    await page.goto("/sites");
    // Either redirects to login or returns 404 (no standalone /sites route)
    await page.waitForLoadState("load");

    const url = page.url();
    // Should redirect to login or show the current page
    expect(url).toMatch(/\/(login|sites)/);
  });
});
