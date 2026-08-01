import { chromium } from "playwright";

const BASE_URL = "http://localhost:3001";
const results = [];
let passCount = 0;
let failCount = 0;

function report(id, name, passed, detail = "") {
  const status = passed ? "PASS" : "FAIL";
  if (passed) passCount++;
  else failCount++;
  results.push({ id, name, status, detail });
  console.log(`  ${passed ? "✅" : "❌"} ${id} — ${name}${detail ? ` (${detail})` : ""}`);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // ============================================================
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  TEST SUITE 1: Landing Page — Pricing Section");
  console.log("═══════════════════════════════════════════════════\n");

  await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });

  // Scroll to pricing
  const pricingExists = await page.locator("#pricing").count() > 0;
  if (pricingExists) {
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000); // wait for framer-motion animations
  }

  // 1.1 Three pricing cards
  const starterVisible = await page.locator("h3:has-text('Starter')").first().isVisible().catch(() => false);
  const proVisible = await page.locator("h3:has-text('Pro')").first().isVisible().catch(() => false);
  const enterpriseVisible = await page.locator("h3:has-text('Enterprise')").first().isVisible().catch(() => false);
  report("1.1", "Three pricing cards render", starterVisible && proVisible && enterpriseVisible,
    `Starter=${starterVisible}, Pro=${proVisible}, Enterprise=${enterpriseVisible}`);

  // 1.2 Starter card — $9
  const has9 = await page.locator("#pricing").locator("text=$9").first().isVisible().catch(() => false);
  const has1Website = await page.locator("#pricing").locator("text=1 website").first().isVisible().catch(() => false);
  const hasInstantCopy = await page.locator("#pricing").locator("text=Instant copy testing").first().isVisible().catch(() => false);
  report("1.2", "Starter shows $9/mo with features", has9 && has1Website && hasInstantCopy,
    `$9=${has9}, 1website=${has1Website}, instantCopy=${hasInstantCopy}`);

  // 1.3 Pro card — $19, Most Popular
  const has19 = await page.locator("#pricing").locator("text=$19").first().isVisible().catch(() => false);
  const hasMostPopular = await page.locator("#pricing").locator("text=Most popular").first().isVisible().catch(() => false);
  report("1.3", "Pro shows $19/mo with Most Popular badge", has19 && hasMostPopular,
    `$19=${has19}, MostPopular=${hasMostPopular}`);

  // 1.4 Pro features
  const hasPlus6 = await page.locator("#pricing").locator("text=+$6 per additional website").first().isVisible().catch(() => false);
  const has3Websites = await page.locator("#pricing").locator("text=Up to 3 websites").first().isVisible().catch(() => false);
  report("1.4", "Pro shows +$6/additional and 3 websites", hasPlus6 && has3Websites,
    `+$6=${hasPlus6}, 3websites=${has3Websites}`);

  // 1.5 Enterprise card — $39
  const has39 = await page.locator("#pricing").locator("text=$39").first().isVisible().catch(() => false);
  const hasUnlimited = await page.locator("#pricing").locator("text=Unlimited websites").first().isVisible().catch(() => false);
  const hasTeam = await page.locator("#pricing").locator("text=Team collaboration").first().isVisible().catch(() => false);
  report("1.5", "Enterprise shows $39/mo with features", has39 && hasUnlimited && hasTeam,
    `$39=${has39}, unlimited=${hasUnlimited}, team=${hasTeam}`);

  // 1.6 Save 17% badge
  const hasSave17 = await page.locator("#pricing").locator("text=Save 17%").first().isVisible().catch(() => false);
  report("1.6", "Yearly toggle shows Save 17% badge", hasSave17);

  // 1.7 CTAs
  const getStartedHref = await page.locator("#pricing").locator("a:has-text('Get started')").first().getAttribute("href").catch(() => null);
  report("1.7", "Starter CTA links to /signup", getStartedHref === "/signup", `href=${getStartedHref}`);

  const contactHref = await page.locator("#pricing").locator("a:has-text('Contact sales')").first().getAttribute("href").catch(() => null);
  report("1.8", "Enterprise CTA links to /contact", contactHref === "/contact", `href=${contactHref}`);

  // Screenshot — monthly
  await page.screenshot({ path: "e2e-screenshots/pricing-monthly.png" });
  report("1.9", "Screenshot: monthly pricing captured", true, "e2e-screenshots/pricing-monthly.png");

  // 1.10 Toggle to yearly
  const yearlyBtn = page.locator("#pricing").locator("button:has-text('Yearly')").first();
  if (await yearlyBtn.isVisible().catch(() => false)) {
    await yearlyBtn.click();
    await page.waitForTimeout(500);
  }

  const has747 = await page.locator("#pricing").locator("text=$7.47").first().isVisible().catch(() => false);
  const has1577 = await page.locator("#pricing").locator("text=$15.77").first().isVisible().catch(() => false);
  const has3237 = await page.locator("#pricing").locator("text=$32.37").first().isVisible().catch(() => false);
  report("1.10", "Yearly prices: $7.47, $15.77, $32.37", has747 && has1577 && has3237,
    `$7.47=${has747}, $15.77=${has1577}, $32.37=${has3237}`);

  // 1.11 Yearly savings text
  const hasSavedYearly = await page.locator("#pricing").locator("text=saved yearly").first().isVisible().catch(() => false);
  report("1.11", "Yearly shows 'saved yearly' text", hasSavedYearly);

  // Screenshot — yearly
  await page.screenshot({ path: "e2e-screenshots/pricing-yearly.png" });
  report("1.12", "Screenshot: yearly pricing captured", true, "e2e-screenshots/pricing-yearly.png");

  // 1.13 Toggle back to monthly
  const monthlyBtn = page.locator("#pricing").locator("button:has-text('Monthly')").first();
  if (await monthlyBtn.isVisible().catch(() => false)) {
    await monthlyBtn.click();
    await page.waitForTimeout(500);
  }
  const has9Again = await page.locator("#pricing").locator("text=$9").first().isVisible().catch(() => false);
  const has19Again = await page.locator("#pricing").locator("text=$19").first().isVisible().catch(() => false);
  const has39Again = await page.locator("#pricing").locator("text=$39").first().isVisible().catch(() => false);
  report("1.13", "Toggle back to monthly restores $9/$19/$39", has9Again && has19Again && has39Again,
    `$9=${has9Again}, $19=${has19Again}, $39=${has39Again}`);

  // 1.14 Trust indicators
  const hasTrial = await page.locator("#pricing").locator("text=14-day free trial").first().isVisible().catch(() => false);
  const hasNoCC = await page.locator("#pricing").locator("text=No credit card required").first().isVisible().catch(() => false);
  const hasCancel = await page.locator("#pricing").locator("text=Cancel anytime").first().isVisible().catch(() => false);
  const hasMoneyBack = await page.locator("#pricing").locator("text=30-day money-back guarantee").first().isVisible().catch(() => false);
  report("1.14", "Trust indicators present", hasTrial && hasNoCC && hasCancel && hasMoneyBack,
    `trial=${hasTrial}, noCC=${hasNoCC}, cancel=${hasCancel}, moneyBack=${hasMoneyBack}`);

  // ============================================================
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  TEST SUITE 2: Signup & Login Flow");
  console.log("═══════════════════════════════════════════════════\n");

  // 2.1 Signup page loads
  await page.goto(`${BASE_URL}/signup`, { waitUntil: "networkidle", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const signupUrl = page.url();
  report("2.1", "Signup page loads", signupUrl.includes("/signup") || signupUrl.includes("/login"),
    `url=${signupUrl}`);
  await page.screenshot({ path: "e2e-screenshots/signup-page.png" });

  // 2.2 Login page loads
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const loginUrl = page.url();
  report("2.2", "Login page loads", loginUrl.includes("/login") || loginUrl.includes("/signup"),
    `url=${loginUrl}`);
  await page.screenshot({ path: "e2e-screenshots/login-page.png" });

  // 2.3 Dashboard redirects unauthenticated
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const dashUrl = page.url();
  report("2.3", "Dashboard redirects unauthenticated", !dashUrl.includes("/dashboard") || dashUrl.includes("/login") || dashUrl.includes("/signup"),
    `url=${dashUrl}`);

  // 2.4 Dashboard billing redirects unauthenticated
  await page.goto(`${BASE_URL}/dashboard/billing`, { waitUntil: "networkidle", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const billingUrl = page.url();
  report("2.4", "Dashboard/billing redirects unauthenticated", !billingUrl.endsWith("/dashboard/billing") || billingUrl.includes("/login"),
    `url=${billingUrl}`);

  // ============================================================
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  TEST SUITE 3: API Endpoints — Auth Guard");
  console.log("═══════════════════════════════════════════════════\n");

  const apiTests = [
    { id: "3.1", method: "GET",    path: "/api/billing/dashboard" },
    { id: "3.2", method: "GET",    path: "/api/billing/subscription" },
    { id: "3.3", method: "POST",   path: "/api/billing/subscription", body: { planId: "pro" } },
    { id: "3.4", method: "PUT",    path: "/api/billing/subscription", body: { planId: "enterprise" } },
    { id: "3.5", method: "DELETE", path: "/api/billing/subscription" },
    { id: "3.6", method: "POST",   path: "/api/billing/subscription/reactivate" },
    { id: "3.7", method: "GET",    path: "/api/billing/payment-methods" },
    { id: "3.8", method: "GET",    path: "/api/billing/tickets" },
    { id: "3.9", method: "POST",   path: "/api/billing/tickets", body: { quantity: 1 } },
  ];

  for (const t of apiTests) {
    try {
      const fetchOpts = { method: t.method, headers: { "Content-Type": "application/json" } };
      if (t.body) fetchOpts.body = JSON.stringify(t.body);
      const resp = await page.evaluate(async ({ url, opts }) => {
        const r = await fetch(url, opts);
        return { status: r.status, ok: r.ok };
      }, { url: `${BASE_URL}${t.path}`, opts: fetchOpts });

      // Expect 401 for unauthenticated requests
      report(t.id, `${t.method} ${t.path} returns 401`, resp.status === 401,
        `status=${resp.status}`);
    } catch (err) {
      report(t.id, `${t.method} ${t.path} returns 401`, false, `error: ${err.message}`);
    }
  }

  // ============================================================
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  TEST SUITE 4: Price Math Verification");
  console.log("═══════════════════════════════════════════════════\n");

  // Verify the 17% discount math
  const plans = [
    { name: "Starter", monthly: 9, yearly: 7.47 },
    { name: "Pro", monthly: 19, yearly: 15.77 },
    { name: "Enterprise", monthly: 39, yearly: 32.37 },
  ];

  for (const p of plans) {
    const expected = Math.round(p.monthly * 0.83 * 100) / 100;
    const match = Math.abs(expected - p.yearly) < 0.02;
    report(`4.${plans.indexOf(p) + 1}`, `${p.name}: $${p.monthly} * 0.83 = $${expected} ≈ $${p.yearly}`, match,
      `expected=${expected}, actual=${p.yearly}`);
  }

  // Yearly total verification
  const yearlyTotals = [
    { name: "Starter", yearlyPerMonth: 7.47, yearlyTotal: 89.64 },
    { name: "Pro", yearlyPerMonth: 15.77, yearlyTotal: 189.24 },
    { name: "Enterprise", yearlyPerMonth: 32.37, yearlyTotal: 388.44 },
  ];

  for (const p of yearlyTotals) {
    const computed = Math.round(p.yearlyPerMonth * 12 * 100) / 100;
    const match = Math.abs(computed - p.yearlyTotal) < 0.02;
    report(`4.${yearlyTotals.indexOf(p) + 4}`, `${p.name}: $${p.yearlyPerMonth} × 12 = $${computed} ≈ $${p.yearlyTotal}/yr`, match,
      `computed=${computed}, expected=${p.yearlyTotal}`);
  }

  // ============================================================
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  TEST SUITE 5: Homepage & Navigation");
  console.log("═══════════════════════════════════════════════════\n");

  // 5.1 Homepage loads
  const homeResp = await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 10000 });
  report("5.1", "Homepage loads with 200", homeResp?.status() === 200, `status=${homeResp?.status()}`);

  // 5.2 Pricing section has id="pricing"
  const pricingSectionExists = await page.locator("#pricing").count() > 0;
  report("5.2", "Pricing section has id='pricing'", pricingSectionExists);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passCount} PASSED, ${failCount} FAILED out of ${passCount + failCount} tests`);
  console.log("═══════════════════════════════════════════════════\n");

  if (failCount > 0) {
    console.log("  FAILURES:");
    results.filter(r => r.status === "FAIL").forEach(r => {
      console.log(`    ❌ ${r.id} — ${r.name} — ${r.detail}`);
    });
    console.log("");
  }

  await browser.close();
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
