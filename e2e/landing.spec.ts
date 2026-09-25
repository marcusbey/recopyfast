/**
 * Suite 3B: Landing Page E2E Tests - E2E-010 to E2E-018
 * Tests homepage rendering, pricing section, and CTAs.
 *
 * The landing page is served by the main Next.js app at the root URL.
 * Pricing section is at #pricing with Monthly/Yearly toggle.
 * The catalogue is DB-driven (see /api/pricing): Starter ($9/mo, $7.5/mo
 * yearly), Pro ($19/mo, $15.75/mo yearly), Agency ($49/mo, $40.83/mo yearly,
 * $490 charged annually), plus Lifetime Pro ($199) and the additional
 * Founding Agency ($299) offer.
 */

import { test, expect } from "@playwright/test";
import { pricingSection } from "./support/landing-locators";

// Increase timeout for landing page tests (homepage can be slow to hydrate)
test.describe("Landing Page", () => {
  test.setTimeout(90000);

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

  // E2E-012: Preserve Lifetime Pro and add the separately highlighted founding offer.
  test("E2E-012: Pricing shows both lifetime offers", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    // Scroll to pricing section
    const pricing = pricingSection(page);
    await expect(pricing).toBeAttached({ timeout: 15000 });
    // Not scrollIntoViewIfNeeded: it waits for the element's bounding box to
    // hold still, and the landing page animates continuously, so it times out
    // on an element that is right there. A plain scrollIntoView has no
    // stability wait.
    await pricing.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(500);

    // Plan names, matched exactly: `has-text('Pro')` also matches the
    // "Lifetime Pro" card and fails strict mode.
    await expect(
      pricing.locator("h3").filter({ hasText: /^Starter$/ }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      pricing.locator("h3").filter({ hasText: /^Pro$/ }),
    ).toBeVisible();
    await expect(
      pricing.locator("h3").filter({ hasText: /^Agency$/ }),
    ).toBeVisible();
    await expect(
      pricing.locator("h3").filter({ hasText: /^Lifetime Pro$/ }),
    ).toBeVisible();
    await expect(
      pricing
        .locator("h3")
        .filter({ hasText: /^Founding Agency \(lifetime\)$/ }),
    ).toBeVisible();

    // Check prices visible
    const pricingText = await pricing.textContent();
    expect(pricingText).toContain("$9");
    expect(pricingText).toContain("$19");
    expect(pricingText).toContain("$49");
    expect(pricingText).toContain("$199");
    expect(pricingText).toContain("$299");
  });

  // E2E-013: Yearly toggle shows discounted prices
  test("E2E-013: Yearly toggle shows discounted prices", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    const pricing = pricingSection(page);
    await expect(pricing).toBeAttached({ timeout: 15000 });

    // Navigate to pricing section via anchor link to ensure scroll
    await page
      .locator('a[href*="pricing"], a:has-text("Pricing")')
      .first()
      .click();
    await page.waitForTimeout(1000);

    // Wait for the pricing button to be visible and interactive
    const yearlyButton = pricing.getByRole("button", { name: "Yearly" });
    await expect(yearlyButton).toBeVisible({ timeout: 15000 });

    // Click yearly toggle
    await yearlyButton.click();
    await page.waitForTimeout(1000);

    // Verify yearly prices and Agency's exact annual charge appear.
    await expect(pricing.getByText("$7.5", { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(pricing.getByText("$15.75", { exact: true })).toBeVisible();
    await expect(pricing.getByText("$40.83", { exact: true })).toBeVisible();
    await expect(
      pricing.getByText("$490 charged annually", { exact: true }),
    ).toBeVisible();
  });

  // E2E-014: Monthly toggle restores original prices
  test("E2E-014: Monthly toggle restores prices", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    const pricing = pricingSection(page);
    await expect(pricing).toBeAttached({ timeout: 15000 });
    // Plain scrollIntoView — see the note on E2E-012.
    await pricing.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(500);

    // Wait for buttons to render
    const yearlyButton = pricing.getByRole("button", { name: "Yearly" });
    await expect(yearlyButton).toBeVisible({ timeout: 15000 });

    // Switch to yearly first
    await yearlyButton.click();
    await page.waitForTimeout(500);

    // Switch back to monthly
    const monthlyButton = pricing.getByRole("button", { name: "Monthly" });
    await monthlyButton.click();
    await page.waitForTimeout(500);

    // Should show monthly prices again
    const pricingText = await pricing.textContent();
    expect(pricingText).toContain("$9");
    expect(pricingText).toContain("$19");
    expect(pricingText).toContain("$49");
  });

  // E2E-015: Pro shows "Most popular" badge
  test("E2E-015: Pro plan shows popular badge", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    const pricing = pricingSection(page);
    await expect(pricing).toBeAttached({ timeout: 15000 });
    // Plain scrollIntoView — see the note on E2E-012.
    await pricing.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(500);

    const popularBadge = pricing.getByText("Most popular", { exact: true });
    // The badge arrives with the client-side /api/pricing fetch.
    await expect(popularBadge.first()).toBeVisible({ timeout: 15000 });
  });

  // E2E-016: Starter CTA links to /signup
  test("E2E-016: Starter CTA links to signup", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });

    const pricing = pricingSection(page);
    await expect(pricing).toBeAttached({ timeout: 15000 });
    // Plain scrollIntoView — see the note on E2E-012.
    await pricing.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(500);

    // Starter card has "Get started" linking to /signup — the cards render
    // after the client-side /api/pricing fetch, so give them time.
    const starterLink = pricing.locator('a[href="/signup"]').first();
    await expect(starterLink).toBeVisible({ timeout: 15000 });
    expect(await starterLink.getAttribute("href")).toBe("/signup");
  });

  // E2E-017: Pricing trust indicators present
  test("E2E-017: Trust indicators are present", async ({ page }) => {
    // Use "load" to ensure React has hydrated
    await page.goto("/", { waitUntil: "load", timeout: 45000 });
    const pricing = pricingSection(page);
    await expect(pricing).toBeAttached({ timeout: 15000 });

    // Scoped to #pricing, not the whole body: asserting on body would pass even
    // if these terms moved out of the pricing section entirely, which is the
    // only place they mean anything.
    //
    // Wait for one indicator with a retrying assertion before reading the
    // whole section's text: under a fully parallel run the single immediate
    // textContent read raced hydration and flaked.
    await expect(pricing.getByText("14-day free trial")).toBeAttached({
      timeout: 15000,
    });
    const pricingText = await pricing.textContent();
    expect(pricingText).toContain("14-day free trial");
    expect(pricingText).toContain("No credit card required");
    expect(pricingText).toContain("Cancel anytime");
    expect(pricingText).toContain("30-day money-back guarantee");
  });

  // E2E-018: No unsubstantiated social proof (see removal of fabricated claims)
  test("E2E-018: Landing page makes no fabricated social-proof claims", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load", timeout: 45000 });
    await expect(pricingSection(page)).toBeAttached({ timeout: 15000 });

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
