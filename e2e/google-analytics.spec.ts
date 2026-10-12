import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLocalServiceRoleClient } from "./support/local-supabase";
import {
  createLayoutOwnerFixture,
  deleteLayoutOwner,
  seedLayoutOwner,
  signInAsLayoutOwner,
} from "./support/owner-session";

/**
 * s107 (ADR 063) — Google Analytics 4 on the marketing surface, in a real
 * browser, against the production build.
 *
 * The build runs with a fake measurement id (`NEXT_PUBLIC_GA_MEASUREMENT_ID`
 * in the CI e2e job; `G-E2ETEST000` locally). Nothing here reaches Google:
 * every Google host is answered by `stubGoogle` through route interception,
 * and the gtag.js stub fires one beacon, one fetch and one image hit at
 * Google Analytics' hosts so the CSP's connect-src and img-src are exercised
 * for real (a CSP refusal happens before the route sees the request).
 *
 * The country hint is Vercel's `x-vercel-ip-country`, sent here as an extra
 * header. Without it the init script fails closed (consent required), which
 * is what every other spec in this run sees.
 *
 * CSP: every `script-src*` violation counts, and every violation that names a
 * Google host. As in csp.spec.ts, connect-src refusals of the local Supabase
 * (http://127.0.0.1, refused by the production policy) are the stack's, not
 * this story's.
 */

const GOOGLE_HOST =
  /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com)\//;
const GTAG_URL = /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-/;
const INIT_PATH = "/analytics/gtag-init.js";
const BANNER = { name: "Analytics cookies" } as const;

const GTAG_STUB = `(function () {
  var w = window;
  w.__gtagStub = { loads: ((w.__gtagStub && w.__gtagStub.loads) || 0) + 1 };
  try { navigator.sendBeacon("https://region1.google-analytics.com/g/collect?v=2&tid=stub", ""); } catch (e) {}
  try { fetch("https://region1.analytics.google.com/g/collect?v=2&tid=stub", { method: "POST", mode: "no-cors", keepalive: true }).catch(function () {}); } catch (e) {}
  var img = new Image();
  img.src = "https://www.google-analytics.com/g/collect?v=2&tid=stub";
})();`;

/** Answers every Google host locally and records what was asked. */
async function stubGoogle(context: BrowserContext): Promise<string[]> {
  const requested: string[] = [];
  await context.route(GOOGLE_HOST, async (route) => {
    const url = route.request().url();
    requested.push(url);
    if (GTAG_URL.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: GTAG_STUB,
      });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
  return requested;
}

async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  const fromConsole: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      /Content Security Policy/i.test(text) &&
      (/script-src/.test(text) || /google/.test(text))
    ) {
      fromConsole.push(text);
    }
  });
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations =
      store;
    document.addEventListener("securitypolicyviolation", (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return async () => {
    const fromDocument = await page.evaluate(
      () =>
        (window as unknown as { __cspViolations?: string[] }).__cspViolations ??
        [],
    );
    return [
      ...fromConsole,
      ...fromDocument.filter(
        (entry) => /^script-src/.test(entry) || /google/.test(entry),
      ),
    ];
  };
}

/** The gtag commands queued so far, `arguments` objects as plain arrays. */
async function dataLayer(page: Page): Promise<unknown[][]> {
  return page.evaluate(() =>
    (
      (window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ??
      []
    ).map((entry) =>
      Array.from(entry).map((value) =>
        value instanceof Date ? "<date>" : value,
      ),
    ),
  );
}

function isGtag(request: Request): boolean {
  return GTAG_URL.test(request.url());
}

test.describe("s107 Google Analytics: a visitor outside the EEA", () => {
  test.use({ extraHTTPHeaders: { "x-vercel-ip-country": "US" } });

  test("gets gtag.js under the static CSP, sanitised page views and no banner", async ({
    context,
    page,
  }) => {
    const requested = await stubGoogle(context);
    const violations = await watchViolations(page);

    const gtagLoaded = page.waitForRequest(isGtag);
    const response = await page.goto(
      "/?utm_source=e2e&utm_medium=test&email=jane%40example.com#rcf_edit=v1.secret",
      { waitUntil: "load" },
    );
    const policy = response?.headers()["content-security-policy"] ?? "";
    expect(policy).toContain(
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com;",
    );
    expect(policy).toContain("https://*.google-analytics.com");
    expect(policy).not.toMatch(/'nonce-/);

    await gtagLoaded;
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __gtagStub?: { loads: number } }).__gtagStub
              ?.loads ?? 0,
        ),
      )
      .toBe(1);
    // The stub's three hits reached the route: connect-src and img-src allow
    // Google Analytics' hosts.
    await expect
      .poll(() => requested.filter((url) => url.includes("/g/collect")).length)
      .toBe(3);

    const commands = await dataLayer(page);
    const [regional, visitor] = commands.slice(0, 2);
    expect(regional.slice(0, 2)).toEqual(["consent", "default"]);
    expect(regional[2]).toMatchObject({
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
    });
    expect((regional[2] as { region: string[] }).region).toEqual(
      expect.arrayContaining(["FR", "DE", "GB", "CH", "NO"]),
    );
    expect(visitor).toEqual([
      "consent",
      "default",
      {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "granted",
      },
    ]);
    expect(commands).toContainEqual(["set", "url_passthrough", false]);
    expect(commands).toContainEqual(["set", "ads_data_redaction", true]);
    expect(
      commands.find(([command]) => command === "config")?.[2],
    ).toMatchObject({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });

    const pageViews = commands.filter(
      ([command, name]) => command === "event" && name === "page_view",
    );
    expect(pageViews).toHaveLength(1);
    const { page_location: location } = pageViews[0][2] as {
      page_location: string;
    };
    expect(new URL(location).search).toBe("?utm_source=e2e&utm_medium=test");
    expect(location).not.toContain("email");
    expect(location).not.toContain("rcf_edit");

    await expect(page.getByRole("region", BANNER)).toHaveCount(0);
    expect(await violations()).toEqual([]);
  });

  test("never gets Google Analytics on the auth and editor pages or a free-tool report, even after consenting", async ({
    baseURL,
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: "rcf_analytics_consent",
        value: "granted",
        url: baseURL ?? "http://127.0.0.1:3000",
      },
    ]);
    const requested = await stubGoogle(context);
    const fetched: string[] = [];
    page.on("request", (request) => fetched.push(request.url()));

    // A free-tool report (s96) is a capability URL under the nonce policy:
    // no analytics there, by the architect's decision on the s96 merge (ADR
    // 063). An unknown id answers its per-request not-found, same document.
    for (const path of [
      "/login",
      "/signup",
      "/edit",
      "/tools/website-spell-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c",
    ]) {
      const response = await page.goto(path, { waitUntil: "networkidle" });
      expect(response?.headers()["content-security-policy"]).not.toContain(
        "google",
      );
      await expect(page.getByRole("region", BANNER)).toHaveCount(0);
      expect(
        await page.evaluate(() => "dataLayer" in window || "gtag" in window),
      ).toBe(false);
    }

    expect(requested).toEqual([]);
    expect(fetched.filter((url) => url.includes(INIT_PATH))).toEqual([]);
  });
});

test.describe("s107 Google Analytics: an EEA visitor", () => {
  test.use({ extraHTTPHeaders: { "x-vercel-ip-country": "FR" } });

  test("sees the banner, nothing is requested from Google until Allow, and the choice persists", async ({
    context,
    page,
  }) => {
    const requested = await stubGoogle(context);
    const violations = await watchViolations(page);

    const initLoaded = page.waitForResponse(
      (response) => new URL(response.url()).pathname === INIT_PATH,
    );
    await page.goto("/compare", { waitUntil: "load" });
    const init = await initLoaded;
    expect(init.headers()["cache-control"]).toBe("private, no-store");

    const banner = page.getByRole("region", BANNER);
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button")).toHaveText([
      "Allow analytics",
      "Decline",
    ]);
    expect(requested).toEqual([]);
    const beforeChoice = await dataLayer(page);
    expect(beforeChoice.some(([command]) => command === "config")).toBe(false);
    expect(beforeChoice[1][2]).toMatchObject({ analytics_storage: "denied" });

    const gtagLoaded = page.waitForRequest(isGtag);
    await banner.getByRole("button", { name: "Allow analytics" }).click();
    await gtagLoaded;
    await expect(banner).toHaveCount(0);

    const afterChoice = await dataLayer(page);
    expect(afterChoice).toContainEqual([
      "consent",
      "update",
      { analytics_storage: "granted" },
    ]);
    expect(
      afterChoice.filter(
        ([command, name]) => command === "event" && name === "page_view",
      ),
    ).toHaveLength(1);
    const cookies = await context.cookies();
    const choice = cookies.find(
      (cookie) => cookie.name === "rcf_analytics_consent",
    );
    expect(choice?.value).toBe("granted");
    expect(choice?.sameSite).toBe("Lax");
    const sixMonths = 180 * 24 * 60 * 60;
    expect(
      Math.abs((choice?.expires ?? 0) - Date.now() / 1000 - sixMonths),
    ).toBeLessThan(120);

    const gtagOnReload = page.waitForRequest(isGtag);
    await page.reload({ waitUntil: "load" });
    await gtagOnReload;
    await expect(page.getByRole("region", BANNER)).toHaveCount(0);

    expect(await violations()).toEqual([]);
  });
});

test.describe("s107 Google Analytics: no country hint", () => {
  test("the banner asks; Decline loads nothing and Cookie settings reopens it by keyboard", async ({
    context,
    page,
  }) => {
    const requested = await stubGoogle(context);

    await page.goto("/privacy", { waitUntil: "load" });
    const banner = page.getByRole("region", BANNER);
    await expect(banner).toBeVisible();

    await banner.getByRole("button", { name: "Decline" }).click();
    await expect(banner).toHaveCount(0);
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === "rcf_analytics_consent",
      )?.value,
    ).toBe("denied");

    await page.reload({ waitUntil: "load" });
    await page.waitForResponse(
      (response) => new URL(response.url()).pathname === INIT_PATH,
    );
    await expect(page.getByRole("region", BANNER)).toHaveCount(0);

    const settings = page.getByRole("button", { name: "Cookie settings" });
    await settings.focus();
    await page.keyboard.press("Enter");
    await expect(banner).toBeVisible();
    await expect(
      banner.getByRole("button", { name: "Allow analytics" }),
    ).toBeFocused();
    await expect(
      banner.getByRole("button", { name: "Decline" }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("Escape");
    await expect(banner).toHaveCount(0);
    await expect(settings).toBeFocused();

    expect(requested).toEqual([]);
  });
});

test.describe("s107 Google Analytics: the app surface", () => {
  test.use({ extraHTTPHeaders: { "x-vercel-ip-country": "US" } });

  test.describe("signed in", () => {
    test.describe.configure({ mode: "serial" });

    let supabase: SupabaseClient;
    const owner = createLayoutOwnerFixture();

    test.beforeAll(async () => {
      supabase = createLocalServiceRoleClient("RUN_RECOPYFAST_CORE_E2E");
      await seedLayoutOwner(supabase, owner);
    });

    test.afterAll(async () => {
      if (supabase) await deleteLayoutOwner(supabase, owner);
    });

    test("the dashboard never requests googletagmanager", async ({
      context,
      page,
    }) => {
      const requested = await stubGoogle(context);
      const fetched: string[] = [];
      page.on("request", (request) => fetched.push(request.url()));
      const dashboardPolicies: string[] = [];
      page.on("response", (response) => {
        if (
          response.request().resourceType() === "document" &&
          new URL(response.url()).pathname.startsWith("/dashboard")
        ) {
          dashboardPolicies.push(
            response.headers()["content-security-policy"] ?? "",
          );
        }
      });

      await signInAsLayoutOwner(page, supabase, owner, "/dashboard");
      await page.goto(`/dashboard/sites/${owner.siteId}`, {
        waitUntil: "networkidle",
      });

      expect(dashboardPolicies.length).toBeGreaterThanOrEqual(2);
      for (const policy of dashboardPolicies) {
        expect(policy).not.toContain("google");
      }
      expect(
        await page.evaluate(() => "dataLayer" in window || "gtag" in window),
      ).toBe(false);
      expect(requested).toEqual([]);
      expect(fetched.filter((url) => url.includes(INIT_PATH))).toEqual([]);
    });
  });
});
