/**
 * s55: the embed sets no visitor cookie unless an A/B test is running.
 *
 * `init` called `initVisitorId` on every visitor page load, one line before it
 * asked the API whether the site had a test at all. So every page of every
 * customer site that carried the snippet read `document.cookie`, minted a
 * random id and wrote it back as `rcf_vid` with a one-year lifetime — whether
 * or not the owner had ever opened the A/B screen. A persistent identifier
 * that serves nothing the visitor asked for is what cookie-consent rules ask a
 * site to justify or put behind a banner, so every customer inherited a consent
 * exposure they had not chosen and could not see. The id is only ever read by
 * /ab-tests/bucket and /ab-tests/track, and both are reached only once a test
 * is active; that is now the only place it is minted.
 *
 * These tests boot the real source widget for one page load. The cookie jar is
 * an own-property accessor on `document`, so a read and a write are each
 * observable on their own: "reads no cookie" is part of the promise, not only
 * "writes none". `handleABTestUpdate` is called directly for the second caller
 * — no socket is in the harness, and no server emits that event.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-cookie";
const SITE_TOKEN = "site-token";
const API = "https://app.recopyfast.test/api";
const TEST_ID = "33333333-3333-3333-3333-333333333333";
const CONTROL_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const VARIANT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const COOKIE_WRITE =
  /^rcf_vid=([^;]+); path=\/; max-age=31536000; SameSite=Lax$/;

type ActiveReply = { status: number; body: unknown } | "network";

interface TrackEvent {
  event_type: string;
  visitor_id: string;
}

interface WidgetInstance {
  visitorId: string | null;
  handleABTestUpdate(data: { status: string; test_id: string }): void;
}

function widget(): WidgetInstance {
  return (window as unknown as { ReCopyFast: WidgetInstance }).ReCopyFast;
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function headline() {
  return document.querySelector("h1")!;
}

function activeTests(): ActiveReply {
  return {
    status: 200,
    body: {
      tests: [
        {
          id: TEST_ID,
          target_element_id: headline().getAttribute("data-rcf-id"),
          variants: [
            {
              id: CONTROL_ID,
              traffic_percentage: 50,
              is_control: true,
              variant_content: "Original copy",
            },
            {
              id: VARIANT_ID,
              traffic_percentage: 50,
              is_control: false,
              variant_content: "Variant copy",
            },
          ],
        },
      ],
    },
  };
}

const NO_TESTS: ActiveReply = { status: 200, body: { tests: [] } };

function installCookieJar(initial: string) {
  const get = jest.fn(() => initial);
  const set = jest.fn<void, [string]>();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get,
    set,
  });
  return { get, set };
}

function installFetch(active: () => ActiveReply) {
  const urls: string[] = [];
  const tracked: TrackEvent[] = [];
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string, options?: { method?: string; body?: string }) => {
      const method = options?.method || "GET";
      urls.push(url);

      if (url.includes("/ab-tests/track")) {
        tracked.push(...(JSON.parse(options?.body || "[]") as TrackEvent[]));
        return response(200, { success: true });
      }
      if (url.includes(`/content/${SITE_ID}?`) && method === "GET") {
        return response(200, [
          {
            element_id: headline().getAttribute("data-rcf-id"),
            current_content: "Published copy",
          },
        ]);
      }
      if (url.includes("/ab-tests/active/")) {
        const reply = active();
        if (reply === "network") throw new Error("network unavailable");
        return response(reply.status, reply.body);
      }
      if (url.includes("/ab-tests/bucket/")) {
        return response(200, { assignments: { [TEST_ID]: VARIANT_ID } });
      }
      return response(200, []);
    },
  );
  return { urls, tracked };
}

async function boot(active: () => ActiveReply) {
  const requests = installFetch(active);
  new Function(WIDGET_SOURCE)();
  await settle();
  return requests;
}

function bucketUrl(urls: string[]) {
  return urls.find((url) => url.includes("/ab-tests/bucket/"));
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "<h1>Original copy</h1><p>Another element</p>";
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  delete (window as unknown as Record<string, unknown>).ReCopyFast;
  delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
  delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
  const script = document.createElement("script");
  script.setAttribute("data-site-id", SITE_ID);
  script.setAttribute("data-site-token", SITE_TOKEN);
  script.setAttribute("data-api-url", API);
  document.head.appendChild(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // The own property shadows Document.prototype's accessor; deleting it
  // restores jsdom's real cookie jar for the next suite.
  delete (document as unknown as Record<string, unknown>).cookie;
  jest.restoreAllMocks();
});

function expectNoVisitorIdentity(
  jar: ReturnType<typeof installCookieJar>,
  urls: string[],
) {
  expect(jar.get).not.toHaveBeenCalled();
  expect(jar.set).not.toHaveBeenCalled();
  expect(widget().visitorId).toBeNull();
  // The pipeline did run — the question was asked and answered "none".
  expect(urls.some((url) => url.includes("/ab-tests/active/"))).toBe(true);
  expect(bucketUrl(urls)).toBeUndefined();
  expect(urls.some((url) => url.includes("/ab-tests/track"))).toBe(false);
  expect(headline().textContent).toBe("Published copy");
}

describe("a page load with no active A/B test", () => {
  it("reads no cookie, writes none and mints no visitor id; published copy still applies", async () => {
    const jar = installCookieJar("");

    const { urls } = await boot(() => NO_TESTS);

    expectNoVisitorIdentity(jar, urls);
  });

  it.each<[string, ActiveReply]>([
    ["answers 500", { status: 500, body: { error: "Internal error" } }],
    ["throws a network error", "network"],
  ])(
    "touches no cookie when the active-test lookup %s",
    async (_label, reply) => {
      const jar = installCookieJar("");

      const { urls } = await boot(() => reply);

      expectNoVisitorIdentity(jar, urls);
    },
  );
});

describe("a page load with an active A/B test", () => {
  it("mints rcf_vid once and carries it to bucketing and tracking", async () => {
    const jar = installCookieJar("");

    const { urls, tracked } = await boot(activeTests);

    expect(jar.set).toHaveBeenCalledTimes(1);
    const written = jar.set.mock.calls[0][0];
    expect(written).toMatch(COOKIE_WRITE);
    const id = COOKIE_WRITE.exec(written)![1];
    expect(widget().visitorId).toBe(id);
    expect(bucketUrl(urls)).toContain(`visitor_id=${encodeURIComponent(id)}`);
    expect(headline().textContent).toBe("Variant copy");
    const view = tracked.find((event) => event.event_type === "view");
    expect(view).toBeDefined();
    expect(view!.visitor_id).toBe(id);
  });

  it("reuses a returning visitor's rcf_vid without rewriting it", async () => {
    const jar = installCookieJar("other=1; rcf_vid=returning-visitor");

    const { urls } = await boot(activeTests);

    expect(jar.set).not.toHaveBeenCalled();
    expect(bucketUrl(urls)).toContain("visitor_id=returning-visitor");
  });
});

describe("a test that goes active after a load with none (handleABTestUpdate)", () => {
  it("mints the id then, once, and keeps it on a repeated update", async () => {
    const jar = installCookieJar("");
    let reply: ActiveReply = NO_TESTS;
    const { urls } = await boot(() => reply);
    expect(jar.set).not.toHaveBeenCalled();

    reply = activeTests();
    widget().handleABTestUpdate({ status: "active", test_id: TEST_ID });
    await settle();

    expect(jar.set).toHaveBeenCalledTimes(1);
    const id = widget().visitorId;
    expect(typeof id).toBe("string");
    expect(bucketUrl(urls)).toContain(`visitor_id=${encodeURIComponent(id!)}`);

    widget().handleABTestUpdate({ status: "active", test_id: TEST_ID });
    await settle();

    expect(jar.set).toHaveBeenCalledTimes(1);
    expect(widget().visitorId).toBe(id);
  });
});
