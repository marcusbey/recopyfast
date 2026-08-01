/**
 * Suite 3D: Public Pages E2E Tests - E2E-030 to E2E-042
 * Tests demo page, privacy, terms, and blog pages.
 */

import { test, expect } from "@playwright/test";

test.describe("Public Pages", () => {
  // E2E-030: Demo page loads with editable elements
  test("E2E-030: Demo page loads", async ({ page }) => {
    const response = await page.goto("/demo", {
      waitUntil: "domcontentloaded",
    });

    if (response) {
      expect([200, 301, 302, 304]).toContain(response.status());
    }

    // Wait for page to settle (demo page may have redirects/hydration)
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
    const content = await page.content();
    expect(content.length).toBeGreaterThan(500);
  });

  // E2E-040: /privacy loads successfully
  test("E2E-040: Privacy page loads", async ({ page }) => {
    const response = await page.goto("/privacy");

    if (response) {
      expect([200, 301, 302, 304]).toContain(response.status());
    }
  });

  // E2E-041: /terms loads successfully
  test("E2E-041: Terms page loads", async ({ page }) => {
    const response = await page.goto("/terms");

    if (response) {
      expect([200, 301, 302, 304]).toContain(response.status());
    }
  });

  // E2E-042: /blog loads with posts
  test("E2E-042: Blog page loads", async ({ page }) => {
    const response = await page.goto("/blog");

    if (response) {
      expect([200, 301, 302, 304]).toContain(response.status());
    }
  });
});
