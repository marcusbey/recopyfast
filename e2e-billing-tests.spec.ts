import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

// ============================================================
// TEST SUITE 1: Landing Page — Pricing Section
// ============================================================
test.describe("Pricing Section — Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/#pricing`);
    // Wait for pricing section to be visible
    await page.waitForSelector("#pricing", { timeout: 10000 });
    // Scroll to pricing section
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    // Wait for animations
    await page.waitForTimeout(1500);
  });

  test("1.1 — Three pricing cards render", async ({ page }) => {
    // Look for plan name headings
    const starter = page.locator("text=Starter").first();
    const pro = page.locator("h3:has-text('Pro')").first();
    const enterprise = page.locator("text=Enterprise").first();

    await expect(starter).toBeVisible();
    await expect(pro).toBeVisible();
    await expect(enterprise).toBeVisible();
  });

  test("1.2 — Starter card shows $9/month", async ({ page }) => {
    const pricingSection = page.locator("#pricing");
    await expect(pricingSection.locator("text=$9")).toBeVisible();
    await expect(pricingSection.locator("text=1 website")).toBeVisible();
    await expect(
      pricingSection.locator("text=Instant copy testing").first()
    ).toBeVisible();
    await expect(pricingSection.locator("text=Get started")).toBeVisible();
  });

  test("1.3 — Pro card shows $19/month with Most Popular badge", async ({
    page,
  }) => {
    const pricingSection = page.locator("#pricing");
    await expect(pricingSection.locator("text=$19")).toBeVisible();
    await expect(pricingSection.locator("text=Most popular")).toBeVisible();
    await expect(pricingSection.locator("text=Start free trial")).toBeVisible();
  });

  test("1.4 — Pro card shows +$6/additional website feature", async ({
    page,
  }) => {
    const pricingSection = page.locator("#pricing");
    await expect(
      pricingSection.locator("text=+$6 per additional website")
    ).toBeVisible();
    await expect(
      pricingSection.locator("text=Up to 3 websites")
    ).toBeVisible();
  });

  test("1.5 — Enterprise card shows $39/month", async ({ page }) => {
    const pricingSection = page.locator("#pricing");
    await expect(pricingSection.locator("text=$39")).toBeVisible();
    await expect(
      pricingSection.locator("text=Unlimited websites")
    ).toBeVisible();
    await expect(
      pricingSection.locator("text=Team collaboration")
    ).toBeVisible();
    await expect(pricingSection.locator("text=Contact sales")).toBeVisible();
  });

  test("1.6 — Yearly toggle shows Save 17% badge", async ({ page }) => {
    const pricingSection = page.locator("#pricing");
    await expect(pricingSection.locator("text=Save 17%")).toBeVisible();
  });

  test("1.7 — Toggle to yearly shows discounted prices", async ({ page }) => {
    const pricingSection = page.locator("#pricing");

    // Click yearly button
    await pricingSection.locator("button", { hasText: "Yearly" }).click();
    await page.waitForTimeout(500);

    // Verify yearly prices
    await expect(pricingSection.locator("text=$7.47")).toBeVisible();
    await expect(pricingSection.locator("text=$15.77")).toBeVisible();
    await expect(pricingSection.locator("text=$32.37")).toBeVisible();
  });

  test("1.8 — Toggle back to monthly restores original prices", async ({
    page,
  }) => {
    const pricingSection = page.locator("#pricing");

    // Toggle to yearly first
    await pricingSection.locator("button", { hasText: "Yearly" }).click();
    await page.waitForTimeout(500);

    // Toggle back to monthly
    await pricingSection.locator("button", { hasText: "Monthly" }).click();
    await page.waitForTimeout(500);

    // Verify monthly prices
    await expect(pricingSection.locator("text=$9")).toBeVisible();
    await expect(pricingSection.locator("text=$19")).toBeVisible();
    await expect(pricingSection.locator("text=$39")).toBeVisible();
  });

  test("1.9 — Yearly shows savings text", async ({ page }) => {
    const pricingSection = page.locator("#pricing");

    // Toggle to yearly
    await pricingSection.locator("button", { hasText: "Yearly" }).click();
    await page.waitForTimeout(500);

    // Savings text should appear
    await expect(pricingSection.locator("text=saved yearly")).toBeVisible();
  });

  test("1.10 — Trust indicators present", async ({ page }) => {
    const pricingSection = page.locator("#pricing");
    await expect(
      pricingSection.locator("text=14-day free trial")
    ).toBeVisible();
    await expect(
      pricingSection.locator("text=No credit card required")
    ).toBeVisible();
    await expect(pricingSection.locator("text=Cancel anytime")).toBeVisible();
    await expect(
      pricingSection.locator("text=30-day money-back guarantee")
    ).toBeVisible();
  });

  test("1.11 — Starter CTA links to /signup", async ({ page }) => {
    const pricingSection = page.locator("#pricing");
    const starterLink = pricingSection.locator("a", { hasText: "Get started" });
    await expect(starterLink).toHaveAttribute("href", "/signup");
  });

  test("1.12 — Enterprise CTA links to /contact", async ({ page }) => {
    const pricingSection = page.locator("#pricing");
    const enterpriseLink = pricingSection.locator("a", {
      hasText: "Contact sales",
    });
    await expect(enterpriseLink).toHaveAttribute("href", "/contact");
  });

  test("1.13 — Screenshot: monthly pricing", async ({ page }) => {
    await page.screenshot({
      path: "e2e-screenshots/pricing-monthly.png",
      fullPage: false,
    });
  });

  test("1.14 — Screenshot: yearly pricing", async ({ page }) => {
    const pricingSection = page.locator("#pricing");
    await pricingSection.locator("button", { hasText: "Yearly" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: "e2e-screenshots/pricing-yearly.png",
      fullPage: false,
    });
  });
});

// ============================================================
// TEST SUITE 2: Signup & Login Flow
// ============================================================
test.describe("Signup & Login Flow", () => {
  test("2.1 — Signup page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/signup`);
    await page.waitForTimeout(1000);
    // Check we're on the signup page (not redirected)
    expect(page.url()).toContain("/signup");
  });

  test("2.2 — Login page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.waitForTimeout(1000);
    expect(page.url()).toContain("/login");
  });

  test("2.3 — Dashboard redirects unauthenticated users", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForTimeout(2000);
    // Should redirect to login
    const url = page.url();
    expect(url.includes("/login") || url.includes("/signup")).toBeTruthy();
  });

  test("2.4 — Dashboard billing redirects unauthenticated users", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/dashboard/billing`);
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url.includes("/login") || url.includes("/signup")).toBeTruthy();
  });
});

// ============================================================
// TEST SUITE 3: API Endpoints (unauthenticated — expect 401)
// ============================================================
test.describe("API Endpoints — Auth Required", () => {
  test("3.1 — GET /api/billing/dashboard returns 401", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/billing/dashboard`);
    expect(response.status()).toBe(401);
  });

  test("3.2 — GET /api/billing/subscription returns 401", async ({
    request,
  }) => {
    const response = await request.get(`${BASE_URL}/api/billing/subscription`);
    expect(response.status()).toBe(401);
  });

  test("3.3 — POST /api/billing/subscription returns 401", async ({
    request,
  }) => {
    const response = await request.post(`${BASE_URL}/api/billing/subscription`, {
      data: { planId: "pro" },
    });
    expect(response.status()).toBe(401);
  });

  test("3.4 — PUT /api/billing/subscription returns 401", async ({
    request,
  }) => {
    const response = await request.put(`${BASE_URL}/api/billing/subscription`, {
      data: { planId: "enterprise" },
    });
    expect(response.status()).toBe(401);
  });

  test("3.5 — DELETE /api/billing/subscription returns 401", async ({
    request,
  }) => {
    const response = await request.delete(
      `${BASE_URL}/api/billing/subscription`
    );
    expect(response.status()).toBe(401);
  });

  test("3.6 — POST /api/billing/subscription/reactivate returns 401", async ({
    request,
  }) => {
    const response = await request.post(
      `${BASE_URL}/api/billing/subscription/reactivate`
    );
    expect(response.status()).toBe(401);
  });

  test("3.7 — GET /api/billing/payment-methods returns 401", async ({
    request,
  }) => {
    const response = await request.get(
      `${BASE_URL}/api/billing/payment-methods`
    );
    expect(response.status()).toBe(401);
  });

  test("3.8 — GET /api/billing/tickets returns 401", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/billing/tickets`);
    expect(response.status()).toBe(401);
  });

  test("3.9 — POST /api/billing/tickets returns 401", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/billing/tickets`, {
      data: { quantity: 1 },
    });
    expect(response.status()).toBe(401);
  });
});

// ============================================================
// TEST SUITE 4: Stripe Config Consistency
// ============================================================
test.describe("Stripe Config — Price Verification", () => {
  test("4.1 — Landing page prices match config (monthly)", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/#pricing`);
    await page.waitForSelector("#pricing", { timeout: 10000 });
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);

    const pricingSection = page.locator("#pricing");

    // Make sure monthly is selected
    await pricingSection.locator("button", { hasText: "Monthly" }).click();
    await page.waitForTimeout(300);

    // Starter = $9
    await expect(pricingSection.locator("text=$9")).toBeVisible();
    // Pro = $19
    await expect(pricingSection.locator("text=$19")).toBeVisible();
    // Enterprise = $39
    await expect(pricingSection.locator("text=$39")).toBeVisible();
  });

  test("4.2 — Yearly discount is exactly 17%", async ({ page }) => {
    await page.goto(`${BASE_URL}/#pricing`);
    await page.waitForSelector("#pricing", { timeout: 10000 });
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);

    const pricingSection = page.locator("#pricing");

    // Toggle to yearly
    await pricingSection.locator("button", { hasText: "Yearly" }).click();
    await page.waitForTimeout(500);

    // Verify math: $9 * 0.83 = $7.47
    await expect(pricingSection.locator("text=$7.47")).toBeVisible();
    // $19 * 0.83 = $15.77
    await expect(pricingSection.locator("text=$15.77")).toBeVisible();
    // $39 * 0.83 = $32.37
    await expect(pricingSection.locator("text=$32.37")).toBeVisible();
  });
});

// ============================================================
// TEST SUITE 5: Homepage Structure & Navigation
// ============================================================
test.describe("Homepage — Pricing Navigation", () => {
  test("5.1 — Homepage loads successfully", async ({ page }) => {
    const response = await page.goto(BASE_URL);
    expect(response?.status()).toBe(200);
  });

  test("5.2 — Pricing anchor scroll works", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);

    // Find and click pricing nav link if it exists
    const pricingLink = page.locator('a[href="#pricing"]').first();
    if (await pricingLink.isVisible()) {
      await pricingLink.click();
      await page.waitForTimeout(1000);
    } else {
      await page.goto(`${BASE_URL}/#pricing`);
      await page.waitForTimeout(1000);
    }

    // Pricing section should be in view
    await expect(page.locator("#pricing")).toBeVisible();
  });
});
