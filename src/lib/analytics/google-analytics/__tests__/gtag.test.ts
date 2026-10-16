/**
 * s107 — what the page sends Google, and when it sends nothing.
 *
 * `track()` is the only door events go through. It is a no-op until the
 * component says analytics is active (GA configured, an allowlisted route,
 * consent granted), and its params are slugs or nothing: an email address, a
 * URL or a query string cannot be a value, whatever a caller passes. Every
 * page view and event carries the sanitised `page_location`, never the raw
 * `location.href`.
 *
 * Each test gets a fresh module (the runtime keeps per-document state) and a
 * fresh `window.gtag` queue that records what would reach gtag.js.
 */

type Gtag = jest.Mock<void, unknown[]>;
type Runtime = typeof import("@/lib/analytics/google-analytics/gtag");

const ID = "G-TEST123456";
const DISABLE_FLAG = `ga-disable-${ID}`;

let runtime: Runtime;
let gtag: Gtag;

function win(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

function calls(): unknown[][] {
  return gtag.mock.calls;
}

function events(name?: string): unknown[][] {
  return calls().filter(
    ([command, eventName]) =>
      command === "event" && (name === undefined || eventName === name),
  );
}

function at(path: string): void {
  window.history.replaceState(null, "", path);
}

function clearCookies(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

beforeEach(async () => {
  await jest.isolateModulesAsync(async () => {
    runtime = await import("@/lib/analytics/google-analytics/gtag");
  });
  gtag = jest.fn();
  win().gtag = gtag;
  delete win()[DISABLE_FLAG];
  at("/");
  clearCookies();
});

afterAll(() => {
  delete win().gtag;
});

describe("track", () => {
  it("is a no-op until analytics is active, and says so", () => {
    expect(runtime.track("generate_lead", { cta_location: "hero" })).toBe(
      false,
    );

    expect(calls()).toEqual([]);
  });

  it("is a no-op when gtag is missing, even if active", () => {
    delete win().gtag;
    runtime.setAnalyticsActive(ID, true);

    expect(runtime.track("try_started", {})).toBe(false);
  });

  // PR #94 review (Devin): a caller that sends once per page view must know
  // whether the event left, or an early call made before consent burns it.
  it("returns true once the event is handed to gtag", () => {
    runtime.setAnalyticsActive(ID, true);

    expect(runtime.track("try_started", {})).toBe(true);
  });

  it("sends the event with its slug params and the sanitised page_location", () => {
    at("/pricing?email=jane%40example.com&utm_source=x#rcf_edit=v1.code");
    runtime.setAnalyticsActive(ID, true);

    runtime.track("generate_lead", { cta_location: "hero" });

    expect(events("generate_lead")).toEqual([
      [
        "event",
        "generate_lead",
        {
          cta_location: "hero",
          page_location: "http://localhost/pricing",
        },
      ],
    ]);
  });

  it("drops a param whose value is not a slug: an email, a URL, a query string", () => {
    runtime.setAnalyticsActive(ID, true);

    runtime.track("generate_lead", { cta_location: "jane@example.com" });
    runtime.track("begin_checkout", {
      cta_location: "https://evil.example/?a=b",
    });
    runtime.track("tool_scan_completed", { tool_slug: "/tools?x=1" });

    for (const [, , params] of events()) {
      expect(Object.keys(params as object)).toEqual(["page_location"]);
    }
    expect(events()).toHaveLength(3);
  });

  it("normalises a slug's case and surrounding space, and caps nothing it accepts", () => {
    runtime.setAnalyticsActive(ID, true);

    runtime.track("tool_scan_completed", {
      tool_slug: "  Website-Maintenance-Cost ",
    });

    expect(events()[0][2]).toMatchObject({
      tool_slug: "website-maintenance-cost",
    });
  });

  it("never forwards a key the event does not declare", () => {
    runtime.setAnalyticsActive(ID, true);

    runtime.track("try_started", {
      email: "jane@example.com",
    } as unknown as Record<string, never>);

    expect(events()[0][2]).toEqual({ page_location: "http://localhost/" });
  });

  it("stops when analytics is made inactive again", () => {
    runtime.setAnalyticsActive(ID, true);
    runtime.setAnalyticsActive(ID, false);

    runtime.track("try_started", {});

    expect(events()).toEqual([]);
  });
});

describe("setAnalyticsActive", () => {
  it("raises Google's opt-out flag when inactive and clears it when active", () => {
    runtime.setAnalyticsActive(ID, false);
    expect(win()[DISABLE_FLAG]).toBe(true);

    runtime.setAnalyticsActive(ID, true);
    expect(win()[DISABLE_FLAG]).toBe(false);
    expect(runtime.isAnalyticsActive()).toBe(true);
  });
});

describe("startGoogleAnalytics", () => {
  it("configures gtag once: signals and ad personalisation off, no automatic page view, 13-month cookies", () => {
    runtime.startGoogleAnalytics(ID, { choice: null });
    runtime.startGoogleAnalytics(ID, { choice: null });

    const configs = calls().filter(([command]) => command === "config");
    expect(configs).toEqual([
      [
        "config",
        ID,
        {
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          cookie_expires: 395 * 24 * 60 * 60,
        },
      ],
    ]);
    expect(calls().filter(([command]) => command === "js")).toHaveLength(1);
  });

  it("applies a stored 'granted' choice before the config, analytics only", () => {
    runtime.startGoogleAnalytics(ID, { choice: "granted" });

    expect(calls()[0]).toEqual([
      "consent",
      "update",
      { analytics_storage: "granted" },
    ]);
    expect(calls()[0][2]).not.toHaveProperty("ad_storage");
    expect(calls().findIndex(([command]) => command === "config")).toBe(2);
  });

  it("does nothing without the gtag queue", () => {
    delete win().gtag;

    expect(() =>
      runtime.startGoogleAnalytics(ID, { choice: "granted" }),
    ).not.toThrow();
  });
});

describe("trackPageView", () => {
  it("sends nothing while inactive", () => {
    runtime.trackPageView();

    expect(calls()).toEqual([]);
  });

  it("keeps campaign parameters on the landing view only", () => {
    runtime.setAnalyticsActive(ID, true);

    at("/blog/post?utm_source=newsletter&ref=abc");
    runtime.trackPageView();
    at("/try?utm_source=tools#install");
    runtime.trackPageView();

    const locations = events("page_view").map(
      ([, , params]) => (params as { page_location: string }).page_location,
    );
    expect(locations).toEqual([
      "http://localhost/blog/post?utm_source=newsletter",
      "http://localhost/try",
    ]);
  });

  it("sets the same page_location for later events, and the previous page as referrer", () => {
    runtime.setAnalyticsActive(ID, true);

    at("/compare");
    runtime.trackPageView();
    at("/compare/webflow-editor?x=1");
    runtime.trackPageView();

    const sets = calls().filter(([command]) => command === "set");
    expect(sets.at(-1)).toEqual([
      "set",
      {
        page_location: "http://localhost/compare/webflow-editor",
        page_referrer: "http://localhost/compare",
      },
    ]);
    expect(events("page_view").at(-1)?.[2]).toEqual({
      page_location: "http://localhost/compare/webflow-editor",
      page_referrer: "http://localhost/compare",
    });
  });

  /**
   * Independent review F2 (M18). Under `Referrer-Policy:
   * strict-origin-when-cross-origin` a same-origin referrer keeps its whole
   * query: a checkout session id, an edit token, an auth code. The landing
   * view's `page_referrer` goes through the same sanitiser as any location.
   */
  describe("the landing view's referrer", () => {
    function referredBy(referrer: string): void {
      Object.defineProperty(document, "referrer", {
        value: referrer,
        configurable: true,
      });
    }

    afterEach(() => {
      delete (document as unknown as { referrer?: string }).referrer;
    });

    it.each([
      [
        "http://localhost/edit?rcf_edit_token=v1.secret&utm_source=x#rcf_edit=v1.secret",
        "http://localhost/edit",
      ],
      [
        "http://localhost/dashboard/sites/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c/billing?session_id=cs_test_a1b2",
        "http://localhost/dashboard/sites/[id]/billing",
      ],
      [
        "http://localhost/auth/confirm?token_hash=abc&type=email&email=jane%40example.com",
        "http://localhost/auth/confirm",
      ],
      [
        "https://news.example.com/story?id=42&utm_campaign=launch",
        "https://news.example.com/story",
      ],
    ])("sends %s as %s", (referrer, expected) => {
      referredBy(referrer);
      runtime.setAnalyticsActive(ID, true);

      at("/pricing");
      runtime.trackPageView();

      expect(events("page_view")[0][2]).toEqual({
        page_location: "http://localhost/pricing",
        page_referrer: expected,
      });
    });

    it("sends no referrer for one that is not an http(s) URL", () => {
      referredBy("android-app://com.example/");
      runtime.setAnalyticsActive(ID, true);

      runtime.trackPageView();

      expect(events("page_view")[0][2]).toEqual({
        page_location: "http://localhost/",
      });
    });
  });
});

describe("applyConsentChoice", () => {
  it("records the choice in the first-party cookie and updates consent", () => {
    runtime.applyConsentChoice(ID, "granted");

    expect(document.cookie).toContain("rcf_analytics_consent=granted");
    expect(calls()).toContainEqual([
      "consent",
      "update",
      { analytics_storage: "granted" },
    ]);
  });

  it("on decline: denies, stops sending, raises the opt-out flag and deletes GA's cookies", () => {
    document.cookie = "_ga=GA1.1.1.1; Path=/";
    document.cookie = "_ga_TEST123456=GS1.1.1; Path=/";
    document.cookie = "unrelated=keep; Path=/";
    runtime.setAnalyticsActive(ID, true);

    runtime.applyConsentChoice(ID, "denied");
    runtime.track("try_started", {});

    expect(calls()).toContainEqual([
      "consent",
      "update",
      { analytics_storage: "denied" },
    ]);
    expect(events()).toEqual([]);
    expect(win()[DISABLE_FLAG]).toBe(true);
    expect(document.cookie).not.toMatch(/(^|; )_ga(_|=)/);
    expect(document.cookie).toContain("unrelated=keep");
    expect(document.cookie).toContain("rcf_analytics_consent=denied");
  });
});

/**
 * Independent review F4: jsdom only proves host-only deletion. gtag.js writes
 * `_ga` with `cookie_domain: 'auto'`, i.e. on the registrable domain
 * (`.recopyfa.st` from `recopyfa.st` or `www.recopyfa.st`); a deletion
 * without that exact Domain attribute leaves it in place.
 */
describe("googleAnalyticsCookieDeletions", () => {
  const COOKIES =
    "_ga=GA1.1.1.1; _ga_TEST123456=GS1.1.1; _gid=GA1.2.3; _gat_UA-1=1; rcf_analytics_consent=granted; unrelated=keep; sb-access-token=x";

  it("deletes each GA cookie host-only and on the registrable domain", () => {
    expect(
      runtime.googleAnalyticsCookieDeletions(
        "_ga=GA1.1.1.1; _ga_TEST123456=GS1.1.1",
        "recopyfa.st",
      ),
    ).toEqual([
      "_ga=; Max-Age=0; Path=/",
      "_ga=; Max-Age=0; Path=/; Domain=.recopyfa.st",
      "_ga_TEST123456=; Max-Age=0; Path=/",
      "_ga_TEST123456=; Max-Age=0; Path=/; Domain=.recopyfa.st",
    ]);
  });

  it("from a subdomain, tries the subdomain and every parent but the bare suffix", () => {
    expect(
      runtime.googleAnalyticsCookieDeletions(
        "_ga=GA1.1.1.1",
        "www.recopyfa.st",
      ),
    ).toEqual([
      "_ga=; Max-Age=0; Path=/",
      "_ga=; Max-Age=0; Path=/; Domain=.www.recopyfa.st",
      "_ga=; Max-Age=0; Path=/; Domain=.recopyfa.st",
    ]);
  });

  it("touches only GA's cookies: never the consent choice, the session or anything else", () => {
    const deleted = runtime
      .googleAnalyticsCookieDeletions(COOKIES, "recopyfa.st")
      .map((assignment) => assignment.split("=")[0]);

    expect([...new Set(deleted)]).toEqual([
      "_ga",
      "_ga_TEST123456",
      "_gid",
      "_gat_UA-1",
    ]);
  });

  it("on a host without a dot (localhost), deletes host-only", () => {
    expect(
      runtime.googleAnalyticsCookieDeletions("_ga=GA1.1.1.1", "localhost"),
    ).toEqual(["_ga=; Max-Age=0; Path=/"]);
  });

  it("is empty when there is nothing of GA's", () => {
    expect(
      runtime.googleAnalyticsCookieDeletions("unrelated=keep", "recopyfa.st"),
    ).toEqual([]);
  });
});

describe("analyticsEventForClick", () => {
  const ORIGIN = "http://localhost";

  function anchor(html: string): Element {
    document.body.innerHTML = html;
    const target = document.querySelector("[data-target]");
    if (!target) throw new Error("fixture has no [data-target]");
    return target;
  }

  it("a same-origin link to /signup is a lead, located by data-cta-location", () => {
    const target = anchor(
      '<section id="pricing"><a href="/signup?utm_source=x" data-cta-location="pricing_plan"><span data-target>Start</span></a></section>',
    );

    expect(runtime.analyticsEventForClick(target, ORIGIN)).toEqual({
      event: "generate_lead",
      params: { cta_location: "pricing_plan" },
    });
  });

  it("a link into checkout from a marketing page is begin_checkout", () => {
    const target = anchor(
      '<a href="/dashboard/billing" data-cta-location="pricing_lifetime_pro" data-target>Buy</a>',
    );

    expect(runtime.analyticsEventForClick(target, ORIGIN)).toEqual({
      event: "begin_checkout",
      params: { cta_location: "pricing_lifetime_pro" },
    });
  });

  it.each([
    [
      '<header><a href="/signup" data-target>Get started</a></header>',
      "header",
    ],
    ['<footer><a href="/signup" data-target>Sign up</a></footer>', "footer"],
    [
      '<section id="final-cta"><a href="/signup" data-target>Go</a></section>',
      "final-cta",
    ],
    ['<div><a href="/signup" data-target>Go</a></div>', "page"],
  ])("falls back to the page region: %s", (html, location) => {
    expect(runtime.analyticsEventForClick(anchor(html), ORIGIN)).toEqual({
      event: "generate_lead",
      params: { cta_location: location },
    });
  });

  it.each([
    '<a href="https://elsewhere.example/signup" data-target>x</a>',
    '<a href="/signupx" data-target>x</a>',
    '<a href="/login" data-target>x</a>',
    '<a href="/dashboard" data-target>x</a>',
    "<button data-target>no link</button>",
  ])("is null for %s", (html) => {
    expect(runtime.analyticsEventForClick(anchor(html), ORIGIN)).toBeNull();
  });

  it("is null for a non-element target", () => {
    expect(runtime.analyticsEventForClick(null, ORIGIN)).toBeNull();
    expect(runtime.analyticsEventForClick(window, ORIGIN)).toBeNull();
  });
});
