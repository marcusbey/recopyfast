/**
 * Suite 3B: Landing Page E2E Tests - E2E-010 to E2E-018
 * Tests homepage rendering, pricing section, and CTAs.
 *
 * The landing page is served by the main Next.js app at the root URL.
 * Pricing section is at #pricing with Monthly/Yearly toggle.
 * Plans: Starter ($9), Pro ($19), Enterprise ($39) monthly.
 * Yearly: Starter ($7.47), Pro ($15.77), Enterprise ($32.37).
 */

import { test, expect } from "@playwright/test";

// Increase timeout for landing page tests (homepage can be slow to hydrate)
test.describe("Landing Page", () => {
  test.setTimeout(60000);

  // E2E-010: Homepage loads with 200
  test("E2E-010: Homepage loads successfully", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "commit" });

    expect(response?.status()).toBe(200);
  });

  // E2E-011: Hero section renders with CTA
  test("E2E-011: Hero section renders with CTA", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // The hero has "Start editing for free" CTA and "Watch it work" link
    const ctaButton = page.locator(
      'a[href*="signup"], a:has-text("Start editing"), a:has-text("Start"), button:has-text("Start")',
    );

    await expect(ctaButton.first()).toBeVisible({ timeout: 15000 });
  });

  // E2E-012: Pricing shows 3 plans: $9, $19, $39
  test("E2E-012: Pricing shows 3 plans with correct prices", async ({
    page,
  }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    // Scroll to pricing section
    const pricing = page.locator("#pricing");
    await expect(pricing).toBeAttached({ timeout: 15000 });
    await pricing.scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(500);

    // Check plan names exist
    await expect(
      page.locator("#pricing h3:has-text('Starter')"),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#pricing h3:has-text('Pro')")).toBeVisible();
    await expect(
      page.locator("#pricing h3:has-text('Enterprise')"),
    ).toBeVisible();

    // Check prices visible
    const pricingText = await pricing.textContent();
    expect(pricingText).toContain("$9");
    expect(pricingText).toContain("$19");
    expect(pricingText).toContain("$39");
  });

  // E2E-013: Yearly toggle shows discounted prices
  test("E2E-013: Yearly toggle shows discounted prices", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    // Navigate to pricing section via anchor link to ensure scroll
    await page.locator('a[href*="pricing"], a:has-text("Pricing")').first().click();
    await page.waitForTimeout(1000);

    // Wait for the pricing button to be visible and interactive
    const yearlyButton = page.locator('#pricing button:has-text("Yearly")');
    await expect(yearlyButton).toBeVisible({ timeout: 15000 });

    // Click yearly toggle
    await yearlyButton.click();
    await page.waitForTimeout(1000);

    // Verify yearly prices appear
    await expect(page.locator('#pricing :text("$7.47")')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('#pricing :text("$15.77")')).toBeVisible();
    await expect(page.locator('#pricing :text("$32.37")')).toBeVisible();
  });

  // E2E-014: Monthly toggle restores original prices
  test("E2E-014: Monthly toggle restores prices", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    const pricing = page.locator("#pricing");
    await expect(pricing).toBeAttached({ timeout: 15000 });
    await pricing.scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(500);

    // Wait for buttons to render
    const yearlyButton = page.locator('#pricing button:has-text("Yearly")');
    await expect(yearlyButton).toBeVisible({ timeout: 15000 });

    // Switch to yearly first
    await yearlyButton.click();
    await page.waitForTimeout(500);

    // Switch back to monthly
    const monthlyButton = page.locator('#pricing button:has-text("Monthly")');
    await monthlyButton.click();
    await page.waitForTimeout(500);

    // Should show monthly prices again
    const pricingText = await pricing.textContent();
    expect(pricingText).toContain("$9");
    expect(pricingText).toContain("$19");
    expect(pricingText).toContain("$39");
  });

  // E2E-015: Pro shows "Most popular" badge
  test("E2E-015: Pro plan shows popular badge", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    const pricing = page.locator("#pricing");
    await expect(pricing).toBeAttached({ timeout: 15000 });
    await pricing.scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(500);

    const popularBadge = page.locator(
      '#pricing :text("Most popular"), #pricing :text("MOST POPULAR")',
    );
    await expect(popularBadge.first()).toBeVisible({ timeout: 5000 });
  });

  // E2E-016: Starter CTA links to /signup
  test("E2E-016: Starter CTA links to signup", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    const pricing = page.locator("#pricing");
    await expect(pricing).toBeAttached({ timeout: 15000 });
    await pricing.scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(500);

    // Starter card has "Get started" linking to /signup
    const starterLink = pricing.locator('a[href="/signup"]').first();
    await expect(starterLink).toBeVisible();
    expect(await starterLink.getAttribute("href")).toBe("/signup");
  });

  // E2E-017: Pricing trust indicators present
  test("E2E-017: Trust indicators are present", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });
    await expect(page.locator("#pricing")).toBeAttached({ timeout: 15000 });

    // These are pricing/plan terms, rendered regardless of scroll position.
    const pageText = await page.textContent("body");
    expect(pageText).toContain("14-day free trial");
    expect(pageText).toContain("No credit card required");
    expect(pageText).toContain("Cancel anytime");
    expect(pageText).toContain("30-day money-back guarantee");
  });

  // E2E-018: No unsubstantiated social proof (see removal of fabricated claims)
  test("E2E-018: Landing page makes no fabricated social-proof claims", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load", timeout: 45000 });
    await expect(page.locator("#pricing")).toBeAttached({ timeout: 15000 });

    const pageText = await page.textContent("body");

    // Invented user counts, ratings, review counts, customer logo rows, and
    // compliance claims were removed. None of them may come back.
    const fabricated = [
      "10,000+",
      "Trusted by teams at",
      "Used by innovative teams at",
      "4.9/5",
      "500+ reviews",
      "+2,847",
      "Fortune 500",
      "SOC 2",
      "Websites powered",
      "Edits made",
    ];

    for (const claim of fabricated) {
      expect(pageText).not.toContain(claim);
    }
  });
});
