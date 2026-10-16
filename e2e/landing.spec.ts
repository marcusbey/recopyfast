/**
 * Suite 3B: Landing Page E2E Tests - E2E-010 to E2E-019
 * Tests homepage rendering, pricing section, and CTAs.
 *
 * The landing page is served by the main Next.js app at the root URL.
 * Pricing section is at #pricing with Monthly/Yearly toggle.
 * The catalogue is DB-driven (see /api/pricing): Starter ($9/mo, $7.5/mo
 * yearly), Pro ($19/mo, $15.75/mo yearly), Agency ($49/mo, $40.83/mo yearly,
 * $490 charged annually), plus Lifetime Pro ($199) and the additional
 * Founding Agency ($299) offer.
 */

import { test, expect, type Page } from "@playwright/test";
import { pricingSection } from "./support/landing-locators";

// Increase timeout for landing page tests (homepage can be slow to hydrate)
test.describe("Landing Page", () => {
  test.setTimeout(90000);

  // E2E-010: Homepage loads with 200
  test("E2E-010: Homepage loads successfully", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "commit" });

    expect(response?.status()).toBe(200);
  });

  // E2E-011: Hero section renders with CTA and keeps each authored headline
  // line inside its own editable box. The first s114 browser pass checked only
  // document-level overflow, which missed the hidden horizontal scroller on
  // each contenteditable line: at narrow desktop widths the page stayed the
  // right size while "website" was clipped inside the headline itself.
  test("E2E-011: Hero section renders with CTA", async ({ page }) => {
    const widths = [320, 390, 901, 1024, 1100, 1440, 1920];
    const settleResponsiveLayout = async (targetPage: Page) => {
      await targetPage.evaluate(
        () =>
          new Promise<void>((resolve) => {
            window.requestAnimationFrame(() =>
              window.requestAnimationFrame(() => resolve()),
            );
          }),
      );
    };
    const assertHeroCopyFits = async (
      targetPage: Page,
      state: "authored" | "animated",
    ) => {
      const lines = targetPage.getByRole("textbox", {
        name: /Headline line|Supporting text line/,
      });
      await expect(lines).toHaveCount(5);
      const geometry = await lines.evaluateAll((elements) =>
        elements.map((element) => ({
          label: element.getAttribute("aria-label"),
          text: element.textContent,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
      );

      for (const line of geometry) {
        expect(
          line.scrollWidth,
          `${state} ${line.label} (${JSON.stringify(line.text)}) must fit its ${line.clientWidth}px editable box`,
        ).toBeLessThanOrEqual(line.clientWidth);
      }
    };

    // Hold the authored words still while every responsive breakpoint is
    // measured. This is the product's actual reduced-motion behavior, rather
    // than a test-only timer override.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: widths[0], height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("editorial-hero")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await settleResponsiveLayout(page);
      await assertHeroCopyFits(page, "authored");
    }

    // The component test above this browser layer proves the real sequence
    // writes site -> website before stuck -> done. Put those same completed
    // words into the rendered spans here so this regression remains a fast,
    // deterministic CSS geometry check instead of depending on 14 seconds of
    // Web Animations scheduling in every Playwright environment.
    const animatedPage = page;
    const firstLine = animatedPage.getByRole("textbox", {
      name: "Headline line 1",
    });
    const secondLine = animatedPage.getByRole("textbox", {
      name: "Headline line 2",
    });
    await firstLine.locator("span").evaluate((word) => {
      word.textContent = "website";
    });
    await secondLine.locator("span").evaluate((word) => {
      word.textContent = "done";
    });
    for (const width of widths) {
      await animatedPage.setViewportSize({ width, height: 900 });
      await settleResponsiveLayout(animatedPage);
      await assertHeroCopyFits(animatedPage, "animated");
    }

    // Authored and animated copy must fit, but a visitor can deliberately
    // type up to 120 characters. Preserve the existing one-line editor for
    // that custom text instead of shrinking it into unreadable type or
    // letting it create a fourth headline line.
    await animatedPage.setViewportSize({ width: 320, height: 900 });
    await settleResponsiveLayout(animatedPage);
    const customGeometry = await firstLine.evaluate((line) => {
      line.textContent = "W".repeat(120);
      const computed = window.getComputedStyle(line);
      return {
        clientWidth: line.clientWidth,
        scrollWidth: line.scrollWidth,
        overflowX: computed.overflowX,
        whiteSpace: computed.whiteSpace,
      };
    });
    expect(customGeometry.scrollWidth).toBeGreaterThan(
      customGeometry.clientWidth,
    );
    expect(customGeometry.overflowX).toBe("auto");
    // Chromium computes plaintext-only contenteditable as `pre` even though
    // the authored rule is `nowrap`; both preserve the intentional one-line
    // editing surface, and the overflow assertion above proves the behavior.
    expect(["nowrap", "pre"]).toContain(customGeometry.whiteSpace);

    await expect(
      page
        .getByTestId("editorial-hero")
        .getByRole("link", { name: "Start your free trial" }),
    ).toBeVisible();
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
    // Not "Claim your spot": the offer card precedes the plans (s47b).
    const starterLink = pricing
      .locator('a[href="/signup"]')
      .filter({ hasNotText: "Claim your spot" })
      .first();
    await expect(starterLink).toBeVisible({ timeout: 15000 });
    expect(await starterLink.getAttribute("href")).toBe("/signup");
  });

  // E2E-017: the founding offer belongs to Pricing. The editorial hero has
  // one stable trial CTA and problem/solution copy in every availability
  // state; offer scarcity and fallback terms appear only where a visitor can
  // inspect the plan.
  test("E2E-017: Pricing owns open, full and unavailable offer states", async ({
    page,
  }) => {
    const main = page.getByRole("main");
    const hero = page.getByTestId("editorial-hero");
    const pricing = pricingSection(page);

    const expectStableHero = async () => {
      await expect(hero).toBeVisible();
      await expect(hero).toContainText("Let clients edit the words.");
      await expect(hero).toContainText("Make time for the work that matters.");
      await expect(
        hero.getByRole("link", { name: "Start your free trial" }),
      ).toHaveAttribute("href", "/signup");
      expect(await hero.textContent()).not.toMatch(
        /spots left|3 months free|14-day free trial|Claim your spot/,
      );
    };

    const expectClosedPricing = async () => {
      await expect(
        pricing.getByText("Founding offer", { exact: true }),
      ).toHaveCount(0);
      await expect(pricing.getByText("Claim your spot")).toHaveCount(0);
      await expect(
        pricing.getByText("14-day free trial", { exact: true }),
      ).toBeVisible();
      expect(await pricing.textContent()).not.toMatch(/of 20 spots left/);
    };

    let offerFixture: {
      status: number;
      json: {
        limit?: number;
        remaining?: number;
        soldOut?: boolean;
        error?: string;
      };
    } = {
      status: 200,
      json: { limit: 20, remaining: 17, soldOut: false },
    };
    await page.route("**/api/offers/founding", async (route) => {
      // React Strict Mode aborts its first client request in local `next dev`.
      // Treat that abort as fixture cleanup so the second request can settle.
      await route
        .fulfill({ status: offerFixture.status, json: offerFixture.json })
        .catch(() => {});
    });

    await page.goto("/", { waitUntil: "load", timeout: 45000 });
    await expectStableHero();
    await expect(pricing).toBeAttached({ timeout: 15000 });
    await expect(
      pricing.getByText("17 of 20 spots left", { exact: true }),
    ).toBeVisible({ timeout: 15000 });

    await pricing.evaluate((el) => el.scrollIntoView({ block: "start" }));
    const claim = pricing.getByRole("link", { name: "Claim your spot" });
    await expect(claim).toBeVisible({ timeout: 15000 });
    expect(await claim.getAttribute("href")).toBe("/signup");
    await expect(
      pricing.getByText("3 months free for the first 20", { exact: true }),
    ).toBeVisible();

    // Full: no scarcity CTA remains, and Pricing truthfully falls back to the
    // ordinary trial while the editorial hero remains unchanged.
    offerFixture = {
      status: 200,
      json: { limit: 20, remaining: 0, soldOut: true },
    };
    await page.goto("/?e2e-offer=full", {
      waitUntil: "load",
      timeout: 45000,
    });
    await expectStableHero();
    await expectClosedPricing();

    // Error: an unknown count stays fail-closed to the same fallback. It does
    // not revive scarcity elsewhere on the page.
    offerFixture = {
      status: 503,
      json: { error: "Founding offer availability is unavailable" },
    };
    await page.goto("/?e2e-offer=error", {
      waitUntil: "load",
      timeout: 45000,
    });
    await expectStableHero();
    await expectClosedPricing();
    expect(await main.textContent()).not.toContain("3 months free");
  });

  // E2E-018: No unsubstantiated social proof (see removal of fabricated claims)
  test("E2E-018: Landing page makes no fabricated social-proof claims", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load", timeout: 45000 });
    await expect(pricingSection(page)).toBeAttached({ timeout: 15000 });
    // The plan cards render after the client-side /api/pricing fetch. Without
    // this wait the body is read before their bullets exist, and the catalogue
    // half of the list below passes on a page that never showed it.
    await expect(
      pricingSection(page)
        .locator("h3")
        .filter({ hasText: /^Starter$/ }),
    ).toBeAttached({ timeout: 15000 });

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

    // s50: claims retired because the product does not back them. Matched
    // case-sensitively on purpose: `body` text includes the inline RSC
    // payload, where Tailwind class names such as `translate-y` live.
    const retired = [
      "money-back",
      "Priority support",
      "onboarding call",
      "future Pro features",
      "A/B",
      "Every string on the site, in another language",
      "Find out which words actually win",
      "Role-based permissions",
      "audit log",
      "Works everywhere",
      "Full version history",
      "unlimited translations",
      "Comprehensive docs",
      "All systems operational",
      "v1.0.0",
      "Five minutes",
      "five minutes",
      "5 minutes",
    ];

    for (const claim of retired) {
      expect(pageText).not.toContain(claim);
    }

    // An href never reaches textContent, and the dead domain lived in one.
    expect((await page.content()).toLowerCase()).not.toContain(
      "recopyfast.com",
    );
    expect(await page.title()).not.toContain("Universal CMS");
  });

  // E2E-019: s114 removed the shader sky entirely. A browser with WebGL
  // disabled must still receive the approved editorial hero artwork and CTA,
  // without loading a hidden canvas or a legacy fallback surface.
  test("E2E-019: the editorial hero needs no WebGL fallback", async ({
    playwright,
    launchOptions,
    baseURL,
  }) => {
    const browser = await playwright.chromium.launch({
      args: [...(launchOptions.args ?? []), "--disable-webgl"],
    });

    try {
      const page = await browser.newPage({ baseURL });
      await page.goto("/", { waitUntil: "load", timeout: 45000 });

      expect(
        await page.evaluate(() =>
          Boolean(document.createElement("canvas").getContext("webgl2")),
        ),
        "E2E-019 must exercise a browser where WebGL is unavailable",
      ).toBe(false);

      const hero = page.getByTestId("editorial-hero");
      await expect(hero).toBeVisible();
      const artwork = hero.getByRole("img", {
        name: "A freelancer interrupted by a looping stream of client requests.",
      });
      await expect(artwork).toBeVisible();
      await expect(artwork).toHaveAttribute("src", /hero-request-loop\.webp/);
      const artworkGeometry = await artwork.evaluate(
        (image: HTMLImageElement) => ({
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          width: image.getBoundingClientRect().width,
          height: image.getBoundingClientRect().height,
        }),
      );
      expect(artworkGeometry.complete).toBe(true);
      expect(artworkGeometry.naturalWidth).toBeGreaterThan(0);
      expect(artworkGeometry.width).toBeGreaterThan(0);
      expect(artworkGeometry.height).toBeGreaterThan(0);
      await expect(page.locator("canvas")).toHaveCount(0);
      await expect(page.locator("[data-sky]")).toHaveCount(0);
    } finally {
      await browser.close();
    }
  });
});
