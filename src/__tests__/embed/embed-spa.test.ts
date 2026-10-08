/**
 * s67 — the plain snippet on sites that render in the browser (ADR 049).
 *
 * On openflows.ai the embed scanned before React rendered, attached its only
 * MutationObserver after four network round trips, fetched published copy
 * once per page load, and never applied it to anything found later. These
 * tests boot the real source IIFE (the other embed suites do the same) and
 * drive it the way a client-rendered site does: elements that arrive late,
 * routes that change without a page load, a host that re-renders an edited
 * element, and a DOM that never stops mutating.
 *
 * Author-written `data-rcf-id`s keep most rows readable here. Where a test
 * needs a page-scoped id, it reads the id the embed stamped — never a
 * re-implementation of the hash.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-spa";
const SITE_TOKEN = "site-token";
const API = "https://app.recopyfast.test/api";
const TEST_ID = "33333333-3333-3333-3333-333333333333";
const CONTROL_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const VARIANT_ID = "bbbbbbbb-0000-0000-0000-000000000002";

interface Row {
  element_id: string;
  current_content: string;
  original_content?: string | null;
  metadata?: Record<string, unknown>;
}

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

interface FetchOptions {
  /**
   * Rows by normalized page path; `*` rows are shared and served on every
   * path. A function is called when the GET is answered, so it can key rows by
   * the ids the embed stamped before asking.
   */
  rows?: Record<string, Row[]> | ((pagePath: string | null) => Row[]);
  /** A/B: assign the variant for a test targeting this element id. */
  variantTarget?: string;
}

interface Widget {
  elements: Map<string, { element: Element; path: string | null }>;
  isInitialized: boolean;
  destroy(): void;
}

function widget(): Widget {
  return (window as unknown as { ReCopyFast: Widget }).ReCopyFast;
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function installScriptTag() {
  const script = document.createElement("script");
  script.setAttribute("data-site-id", SITE_ID);
  script.setAttribute("data-site-token", SITE_TOKEN);
  script.setAttribute("data-api-url", API);
  document.head.appendChild(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
}

function installFetch(options: FetchOptions = {}) {
  const recorded: Recorded[] = [];
  const rowsFor = (pagePath: string | null) => {
    const rows = options.rows;
    if (typeof rows === "function") return rows(pagePath);
    return [...(rows?.["*"] ?? []), ...((pagePath && rows?.[pagePath]) || [])];
  };
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method || "GET";
      recorded.push({ url, method, body: init?.body });
      const pagePath = new URL(url).searchParams.get("page_path");

      // Staging first: its URL also contains `/content/<site>?`.
      if (url.includes(`/staging/content/${SITE_ID}`) && method === "GET") {
        return response(200, { content: rowsFor(pagePath) });
      }
      if (url.includes(`/content/${SITE_ID}?`) && method === "GET") {
        return response(200, rowsFor(pagePath));
      }
      if (url.includes("/ab-tests/active/")) {
        if (!options.variantTarget) return response(200, { tests: [] });
        return response(200, {
          tests: [
            {
              id: TEST_ID,
              target_element_id: options.variantTarget,
              variants: [
                {
                  id: CONTROL_ID,
                  traffic_percentage: 50,
                  is_control: true,
                  variant_content: "Control copy",
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
        });
      }
      if (url.includes("/ab-tests/bucket/")) {
        return response(200, { assignments: { [TEST_ID]: VARIANT_ID } });
      }
      return response(200, { success: true });
    },
  );
  return recorded;
}

function contentGets(recorded: Recorded[]) {
  return recorded.filter(
    (request) =>
      request.method === "GET" &&
      /\/content\/site-spa\?/.test(request.url) &&
      !request.url.includes("/staging/"),
  );
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function boot(options: FetchOptions = {}) {
  const recorded = installFetch(options);
  new Function(WIDGET_SOURCE)();
  await settle();
  return recorded;
}

function byId(id: string): HTMLElement {
  return document.querySelector(`[data-rcf-id="${id}"]`) as HTMLElement;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  for (const key of [
    "ReCopyFast",
    "recopyfast",
    "rcf",
    "RECOPYFAST_API",
    "RECOPYFAST_WS",
  ]) {
    delete (window as unknown as Record<string, unknown>)[key];
  }
  installScriptTag();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  const current = (window as unknown as { ReCopyFast?: Widget }).ReCopyFast;
  if (current && typeof current.destroy === "function") current.destroy();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("AC 11 — only edited rows write page text", () => {
  it("writes edited and legacy rows, never an unedited one, and still applies attribute rows", async () => {
    document.body.innerHTML = `
      <h1 data-rcf-id="unedited">Live heading the host keeps current</h1>
      <h2 data-rcf-id="edited">Authored subtitle</h2>
      <p data-rcf-id="legacy">Authored paragraph</p>
      <a class="rcf-editable-link" data-rcf-id="cta" href="/old">Plans</a>`;

    await boot({
      rows: {
        "*": [
          // A discovery row: what one visitor's page said, never edited.
          {
            element_id: "unedited",
            original_content: "Frozen discovery",
            current_content: "Frozen discovery",
          },
          {
            element_id: "edited",
            original_content: "Authored subtitle",
            current_content: "Published subtitle",
          },
          // No original_content at all: counts as edited (legacy rows).
          { element_id: "legacy", current_content: "Published paragraph" },
          {
            element_id: "cta",
            original_content: "Plans",
            current_content: "Plans",
            metadata: { href: "/pricing" },
          },
        ],
      },
    });

    expect(byId("unedited").textContent).toBe(
      "Live heading the host keeps current",
    );
    expect(byId("edited").textContent).toBe("Published subtitle");
    expect(byId("legacy").textContent).toBe("Published paragraph");
    expect(byId("cta").getAttribute("href")).toBe("/pricing");
    expect(byId("cta").textContent).toBe("Plans");
  });
});

describe("AC 2 — late elements get published copy from rows already fetched", () => {
  it("applies a late element's edited row without a second GET, and never overwrites an A/B variant", async () => {
    document.body.innerHTML = `<h1 data-rcf-id="hero">Original copy</h1>`;
    const recorded = await boot({
      rows: {
        "*": [
          {
            element_id: "hero",
            original_content: "Original copy",
            current_content: "Published hero",
          },
          {
            element_id: "late",
            original_content: "Late authored",
            current_content: "Published late",
          },
        ],
      },
      variantTarget: "hero",
    });
    expect(byId("hero").textContent).toBe("Variant copy");
    expect(contentGets(recorded)).toHaveLength(1);

    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
    const late = document.createElement("p");
    late.setAttribute("data-rcf-id", "late");
    late.textContent = "Late authored";
    document.body.appendChild(late);
    await flushMicrotasks();
    jest.advanceTimersByTime(1000);
    await flushMicrotasks();

    expect(byId("late").textContent).toBe("Published late");
    expect(byId("hero").textContent).toBe("Variant copy");
    expect(contentGets(recorded)).toHaveLength(1);
  });
});

/** A content GET the test releases by hand, to act while it is in flight. */
function holdContentGets() {
  const releases: Array<() => void> = [];
  const original = (window as unknown as { fetch: jest.Mock }).fetch;
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    (url: string, init?: { method?: string }) => {
      if (
        url.includes(`/content/${SITE_ID}?`) &&
        (init?.method || "GET") === "GET"
      ) {
        return new Promise((resolve) => {
          releases.push(() => resolve(original(url, init)));
        });
      }
      return original(url, init);
    },
  );
  return () => releases.splice(0).forEach((release) => release());
}

function useFakeTimers() {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
}

async function advance(ms: number, step = 100) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    jest.advanceTimersByTime(step);
    await flushMicrotasks();
  }
}

function hostErrorSpy() {
  const errors: unknown[] = [];
  const listener = (event: ErrorEvent) => errors.push(event.error);
  window.addEventListener("error", listener);
  return { errors, stop: () => window.removeEventListener("error", listener) };
}

describe("AC 1 — content rendered after the script starts is found", () => {
  it("stamps an element rendered while the content GET is still in flight", async () => {
    document.body.innerHTML = `<div id="app"></div>`;
    installFetch();
    const release = holdContentGets();
    new Function(WIDGET_SOURCE)();
    await settle();

    useFakeTimers();
    const rendered = document.createElement("h2");
    rendered.textContent = "Rendered by the app";
    document.getElementById("app")!.appendChild(rendered);
    await flushMicrotasks();
    await advance(1000);

    expect(rendered.getAttribute("data-rcf-id")).toMatch(/^rcf-/);
    release();
  });

  it("finds late text inside an open shadow root", async () => {
    document.body.innerHTML = `<section id="widget-host"></section>`;
    const shadow = document
      .getElementById("widget-host")!
      .attachShadow({ mode: "open" });
    shadow.innerHTML = `<p>Inside the component</p>`;
    await boot();

    useFakeTimers();
    const late = document.createElement("h2");
    late.textContent = "Late component heading";
    shadow.appendChild(late);
    await flushMicrotasks();
    await advance(1000);

    expect(late.getAttribute("data-rcf-id")).toMatch(/^rcf-/);
  });
});

describe("AC 5 — continuous mutation cannot postpone a rescan", () => {
  it("rescans within 1,000 ms under a 100 ms ticker", async () => {
    document.body.innerHTML = `<p id="ticker">tick 0</p><div id="feed"></div>`;
    await boot();

    useFakeTimers();
    let tick = 0;
    const ticker = setInterval(() => {
      document.getElementById("ticker")!.textContent = `tick ${++tick}`;
    }, 100);
    const late = document.createElement("h2");
    late.textContent = "Arrived during the ticker";
    document.getElementById("feed")!.appendChild(late);
    await flushMicrotasks();
    await advance(1000);
    clearInterval(ticker);

    expect(late.getAttribute("data-rcf-id")).toMatch(/^rcf-/);
  });
});

describe("AC 4 — a host re-render cannot put the authored copy back", () => {
  async function bootWithEditedHero() {
    document.body.innerHTML = `<h1 data-rcf-id="hero">Authored hero</h1>`;
    await boot({
      rows: {
        "*": [
          {
            element_id: "hero",
            original_content: "Authored hero",
            current_content: "Published hero",
          },
        ],
      },
    });
    expect(byId("hero").textContent).toBe("Published hero");
  }

  it("re-applies synchronously after textContent, nodeValue and unrelated-text write-backs, and its own writes cause no more", async () => {
    await bootWithEditedHero();
    const hero = byId("hero");
    const records: MutationRecord[] = [];
    const watcher = new MutationObserver((batch) => records.push(...batch));
    watcher.observe(hero, {
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      subtree: true,
    });

    hero.textContent = "Authored hero";
    await flushMicrotasks();
    expect(hero.textContent).toBe("Published hero");

    hero.firstChild!.nodeValue = "Authored hero";
    await flushMicrotasks();
    expect(hero.textContent).toBe("Published hero");

    hero.textContent = "Something the host decided to say";
    await flushMicrotasks();
    expect(hero.textContent).toBe("Published hero");

    // One write per write-back, in place, and nothing after it: the embed's
    // own write matches the row, so the batch it causes writes nothing.
    const seen = records.length;
    await flushMicrotasks();
    await settle();
    expect(records.length).toBe(seen);
    // The embed's writes are the text changes away from the host's copy; the
    // host's own nodeValue write-back is the one whose old value was published.
    const embedWrites = records.filter(
      (record) =>
        record.type === "characterData" && record.oldValue !== "Published hero",
    );
    expect(embedWrites).toHaveLength(3);
    watcher.disconnect();
  });

  it("stops at 10 writes per element per page view, then the host wins", async () => {
    await bootWithEditedHero(); // write 1
    const hero = byId("hero");
    let reapplied = 0;

    for (let writeBack = 1; writeBack <= 11; writeBack++) {
      hero.textContent = `Host copy ${writeBack}`;
      await flushMicrotasks();
      if (hero.textContent === "Published hero") reapplied++;
    }

    expect(1 + reapplied).toBe(10);
    expect(hero.textContent).toBe("Host copy 11");
  });

  it("survives a callback that throws: nothing reaches the host, and the next batch is processed", async () => {
    await bootWithEditedHero();
    const hero = byId("hero");
    const host = hostErrorSpy();
    jest.spyOn(widget().elements, "get").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    hero.textContent = "Authored hero";
    await flushMicrotasks();
    hero.textContent = "Authored hero again";
    await flushMicrotasks();
    host.stop();

    expect(host.errors).toEqual([]);
    expect(hero.textContent).toBe("Published hero");
  });
});

describe("rescans stay cheap and the map stays honest", () => {
  it("does not re-derive mapped elements and prunes detached ones", async () => {
    // 1,000 mapped elements, ten per parent. Not 1,000 siblings: jsdom needs
    // ~60 s for the FIRST scan of 1,000 siblings (the pre-existing O(n²)
    // structural path, research "Large DOMs"), and only the rescan is under
    // test here.
    const tens = Array.from({ length: 10 }, (_, i) => i);
    document.body.innerHTML = tens
      .map(
        (a) =>
          `<section>${tens
            .map(
              (b) =>
                `<ul>${tens.map((c) => `<li>Item ${a}-${b}-${c}</li>`).join("")}</ul>`,
            )
            .join("")}</section>`,
      )
      .join("");
    await boot();
    expect(widget().elements.size).toBe(1000);
    const selector = jest.spyOn(
      widget() as unknown as { generateSelector(element: Element): string },
      "generateSelector",
    );

    useFakeTimers();
    const list = document.querySelector("ul")!;
    for (let i = 0; i < 10; i++) list.removeChild(list.lastElementChild!);
    const fresh = document.createElement("li");
    fresh.textContent = "A new item";
    list.appendChild(fresh);
    await flushMicrotasks();
    await advance(1000);

    expect(selector).toHaveBeenCalledTimes(1);
    expect(fresh.getAttribute("data-rcf-id")).toMatch(/^rcf-/);
    const detached = Array.from(widget().elements.values()).filter(
      (data) => !data.element.isConnected,
    );
    expect(detached).toEqual([]);
    expect(widget().elements.size).toBe(991);
  });
});

describe("one widget per page, and destroy() stops it", () => {
  it("boots once when the snippet runs twice", async () => {
    document.body.innerHTML = `<h1>Heading</h1>`;
    const recorded = await boot();
    const first = widget();

    new Function(WIDGET_SOURCE)();
    await settle();

    expect(widget() === first).toBe(true);
    expect(contentGets(recorded)).toHaveLength(1);
  });

  it("is not blocked by an element clobbering window.ReCopyFast", async () => {
    document.body.innerHTML = `<div id="ReCopyFast"></div><h1>Heading</h1>`;
    const globals = window as unknown as Record<string, unknown>;
    const clobber = document.getElementById("ReCopyFast");
    if (globals.ReCopyFast !== clobber) globals.ReCopyFast = clobber;

    await boot();

    expect(widget().elements instanceof Map).toBe(true);
    expect(widget().isInitialized).toBe(true);
  });

  it("does nothing after destroy(), including a rescan already scheduled", async () => {
    document.body.innerHTML = `<h1 data-rcf-id="hero">Authored hero</h1>`;
    const recorded = await boot({
      rows: {
        "*": [
          {
            element_id: "hero",
            original_content: "Authored hero",
            current_content: "Published hero",
          },
        ],
      },
    });
    const requests = recorded.length;

    useFakeTimers();
    const late = document.createElement("h2");
    late.textContent = "Late heading";
    document.body.appendChild(late);
    await flushMicrotasks();
    widget().destroy();
    byId("hero").textContent = "Authored hero";
    await flushMicrotasks();
    await advance(2000);

    expect(late.hasAttribute("data-rcf-id")).toBe(false);
    expect(byId("hero").textContent).toBe("Authored hero");
    expect(recorded.length).toBe(requests);
  });
});

/** A shell like the SPA fixture's: a persistent tagline, an outlet, a shared footer. */
function spaShell() {
  document.body.innerHTML = `
    <header id="site-header"><p class="tagline">Persistent tagline</p></header>
    <main id="outlet"></main>
    <footer><p data-rcf-id="shared-footer">Shared footer</p></footer>`;
}

function renderPage(title: string) {
  document.getElementById("outlet")!.innerHTML =
    `<h1>${title} headline</h1><p>${title} lead paragraph</p>`;
}

function stampOf(selector: string) {
  return document.querySelector(selector)!.getAttribute("data-rcf-id")!;
}

function pagePaths(recorded: Recorded[]) {
  return contentGets(recorded).map((request) =>
    new URL(request.url).searchParams.get("page_path"),
  );
}

function discoveryBodies(
  recorded: Recorded[],
): Array<Record<string, { page_path: string | null; content: string }>> {
  return recorded
    .filter(
      (request) =>
        request.method === "POST" &&
        request.url.endsWith(`/content/${SITE_ID}`),
    )
    .map((request) => JSON.parse(request.body || "{}"));
}

async function navigate(
  url: string,
  title: string | null,
  method: "pushState" | "replaceState" = "pushState",
) {
  history[method](null, "", url);
  if (title) renderPage(title);
  await flushMicrotasks();
  await settle();
}

describe("AC 3 — a route change is a page load for the embed", () => {
  it("fetches a new path once, a revisit never, and a query or hash change never", async () => {
    spaShell();
    renderPage("Home");
    const recorded = await boot();
    expect(pagePaths(recorded)).toEqual(["/"]);

    await navigate("/about", "About");
    expect(pagePaths(recorded)).toEqual(["/", "/about"]);

    const popped = new Promise((resolve) =>
      window.addEventListener("popstate", resolve, { once: true }),
    );
    history.back();
    await popped;
    renderPage("Home");
    await flushMicrotasks();
    await settle();
    expect(window.location.pathname).toBe("/");

    await navigate("/?q=1", "Home again");
    await navigate("/?q=1#section", "Home once more");
    expect(pagePaths(recorded)).toEqual(["/", "/about"]);
  });

  it("gives a persisting element the id a full load of the new path gives it", async () => {
    spaShell();
    renderPage("Home");
    await boot();
    const homeId = stampOf(".tagline");

    await navigate("/about", "About");
    const navigatedId = stampOf(".tagline");

    widget().destroy();
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    document
      .querySelectorAll('[data-rcf-id]:not([data-rcf-id="shared-footer"])')
      .forEach((element) => element.removeAttribute("data-rcf-id"));
    await boot();

    expect(navigatedId).not.toBe(homeId);
    expect(stampOf(".tagline")).toBe(navigatedId);
  });

  it("restores the authored copy it replaced, drops the old stamp, and leaves shared ids alone", async () => {
    spaShell();
    renderPage("Home");
    await boot({
      rows: (pagePath) => [
        {
          element_id: "shared-footer",
          original_content: "Shared footer",
          current_content: "Published footer",
        },
        ...(pagePath === "/"
          ? [
              {
                element_id: stampOf(".tagline"),
                original_content: "Persistent tagline",
                current_content: "Tagline published for home",
              },
            ]
          : []),
      ],
    });
    const tagline = document.querySelector(".tagline")!;
    const homeId = tagline.getAttribute("data-rcf-id")!;
    expect(tagline.textContent).toBe("Tagline published for home");

    await navigate("/about", "About");

    expect(tagline.textContent).toBe("Persistent tagline");
    expect(tagline.getAttribute("data-rcf-id")).not.toBe(homeId);
    expect(widget().elements.has(homeId)).toBe(false);
    expect(byId("shared-footer").textContent).toBe("Published footer");
  });

  it("hears a Navigation API route change that touched no DOM", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: navigation,
    });
    try {
      spaShell();
      renderPage("Home");
      const recorded = await boot();

      history.pushState(null, "", "/about");
      navigation.dispatchEvent(new Event("currententrychange"));
      await flushMicrotasks();
      await settle();

      expect(pagePaths(recorded)).toEqual(["/", "/about"]);
    } finally {
      delete (window as unknown as Record<string, unknown>).navigation;
    }
  });

  it("re-identifies at an edit click when nothing else noticed the route change", async () => {
    window.history.replaceState(
      null,
      "",
      "/?rcf_staging=1&rcf_token=test_route_click",
    );
    spaShell();
    renderPage("Home");
    await boot();
    expect((widget() as unknown as { editMode: boolean }).editMode).toBe(true);

    history.pushState(null, "", "/about");
    const headline = document.querySelector("#outlet h1")!;
    headline.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(headline.getAttribute("contenteditable")).toBe("true");
    expect(
      widget().elements.get(headline.getAttribute("data-rcf-id")!)!.path,
    ).toBe("/about");
  });

  it("never applies or reports the first page's rows after the app moved during the first fetch", async () => {
    spaShell();
    renderPage("Home");
    installFetch({
      rows: (pagePath) =>
        pagePath === "/"
          ? [
              // Keyed by the id the /about headline carries by the time this
              // answer arrives: if the stale answer were applied, it would land.
              {
                element_id: stampOf("#outlet h1"),
                original_content: "x",
                current_content: "Wrong page copy",
              },
            ]
          : [],
    });
    const release = holdContentGets();
    new Function(WIDGET_SOURCE)();
    await settle();

    await navigate("/about", "About", "replaceState");
    release();
    await settle();
    release();
    await settle();

    expect(document.querySelector("#outlet h1")!.textContent).toBe(
      "About headline",
    );
    const reported = discoveryBodies(
      (window.fetch as jest.Mock).mock.calls.map(([url, init]) => ({
        url: String(url),
        method: (init && init.method) || "GET",
        body: init && init.body,
      })),
    ).flatMap((body) => Object.values(body).map((entry) => entry.page_path));
    expect(reported.length).toBeGreaterThan(0);
    expect(reported.filter((pagePath) => pagePath === "/")).toEqual([]);
  });
});

describe("AC 9 — degrades, never breaks, patches nothing", () => {
  it("leaves history untouched and adds no global beyond its own five", async () => {
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    spaShell();
    renderPage("Home");
    // After the shell: jsdom exposes the page's own ids as window keys.
    const before = new Set(Object.keys(window));
    await boot();
    await navigate("/about", "About");

    expect(history.pushState).toBe(pushState);
    expect(history.replaceState).toBe(replaceState);
    const added = Object.keys(window).filter((key) => !before.has(key));
    const allowed = [
      "ReCopyFast",
      "recopyfast",
      "rcf",
      "RECOPYFAST_API",
      "RECOPYFAST_WS",
    ];
    expect(added.filter((key) => !allowed.includes(key))).toEqual([]);
  });

  it("keeps a throwing navigation path away from the host", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: navigation,
    });
    try {
      spaShell();
      renderPage("Home");
      await boot();
      jest
        .spyOn(widget() as unknown as { checkRoute(): void }, "checkRoute")
        .mockImplementation(() => {
          throw new Error("boom");
        });
      const host = hostErrorSpy();

      history.pushState(null, "", "/about");
      navigation.dispatchEvent(new Event("currententrychange"));
      renderPage("About");
      await flushMicrotasks();
      host.stop();

      expect(host.errors).toEqual([]);
    } finally {
      delete (window as unknown as Record<string, unknown>).navigation;
    }
  });
});

describe("discovery waits for the page's rows and is coalesced", () => {
  it("sends nothing before the current path's rows settle, at init and after a navigation", async () => {
    spaShell();
    renderPage("Home");
    installFetch();
    const release = holdContentGets();
    new Function(WIDGET_SOURCE)();
    await settle();
    useFakeTimers();
    renderPage("Home, rendered again");
    await flushMicrotasks();
    await advance(2000);
    const posts = () =>
      (window.fetch as jest.Mock).mock.calls.filter(
        ([, init]) => init && init.method === "POST",
      );
    expect(posts()).toHaveLength(0);

    release();
    await advance(500);
    const afterInit = posts().length;
    expect(afterInit).toBe(1);

    history.pushState(null, "", "/about");
    renderPage("About");
    await flushMicrotasks();
    await advance(15000);
    expect(posts()).toHaveLength(afterInit);

    release();
    await advance(500);
    expect(posts()).toHaveLength(afterInit + 1);
  });

  it("reports a live feed at once, then at most once per 10 s and 10 times per page view, never twice the same id", async () => {
    document.body.innerHTML = `<h1>Live feed</h1><ul id="feed"></ul>`;
    const recorded = await boot();
    useFakeTimers();
    let item = 0;
    const feed = setInterval(() => {
      const li = document.createElement("li");
      li.textContent = `Feed item ${++item}`;
      document.getElementById("feed")!.appendChild(li);
    }, 300);

    await advance(10_000);
    expect(discoveryBodies(recorded).length).toBeLessThanOrEqual(2);

    await advance(110_000, 500);
    clearInterval(feed);
    const bodies = discoveryBodies(recorded);
    expect(bodies.length).toBe(10);
    const ids = bodies.flatMap((body) => Object.keys(body));
    expect(new Set(ids).size).toBe(ids.length);
  }, 30_000);
});

describe("AC 7 — edit mode across an in-app navigation", () => {
  // The editor-grant-edit-mode harness's shape, with the localhost demo token
  // (initStagingMode): edit mode without a staging validation call.
  async function bootEditor(options: FetchOptions = {}) {
    window.history.replaceState(
      null,
      "",
      "/?rcf_staging=1&rcf_token=test_spa_editor",
    );
    spaShell();
    renderPage("Home");
    const recorded = await boot(options);
    expect((widget() as unknown as { editMode: boolean }).editMode).toBe(true);
    return recorded;
  }

  function stagingPaths(recorded: Recorded[]) {
    return recorded
      .filter(
        (request) =>
          request.method === "GET" &&
          request.url.includes(`/staging/content/${SITE_ID}`),
      )
      .map((request) => new URL(request.url).searchParams.get("page_path"));
  }

  it("keeps the banner and the staging session, and reads the new page's staging rows once", async () => {
    const recorded = await bootEditor();
    const access = (
      window as unknown as { recopyfast: { getStagingAccess(): unknown } }
    ).recopyfast.getStagingAccess();

    await navigate("/about", "About");

    expect(document.querySelector("#rcf-staging-banner")).not.toBeNull();
    expect(
      (
        window as unknown as { recopyfast: { getStagingAccess(): unknown } }
      ).recopyfast.getStagingAccess(),
    ).toBe(access);
    expect(stagingPaths(recorded)).toEqual(["/", "/about"]);
  });

  it("opens the editor on an element the new page rendered", async () => {
    await bootEditor();
    await navigate("/about", "About");

    const headline = document.querySelector("#outlet h1")!;
    headline.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(headline.getAttribute("contenteditable")).toBe("true");
  });

  it("keeps the copy just saved when the host re-renders, not the row from before the save", async () => {
    await bootEditor({
      rows: () => [
        {
          element_id: "shared-footer",
          original_content: "Shared footer",
          current_content: "Published footer",
        },
      ],
    });
    const footer = byId("shared-footer");
    expect(footer.textContent).toBe("Published footer");

    await (
      widget() as unknown as {
        persistContentUpdate(id: string, content: string): Promise<void>;
      }
    ).persistContentUpdate("shared-footer", "Saved footer");
    footer.textContent = "Saved footer";
    await flushMicrotasks();

    footer.textContent = "Shared footer";
    await flushMicrotasks();

    expect(footer.textContent).toBe("Saved footer");
  });

  it("re-applies a realtime update's copy after a later host write-back", async () => {
    spaShell();
    renderPage("Home");
    await boot({
      rows: () => [
        {
          element_id: "shared-footer",
          original_content: "Shared footer",
          current_content: "Published footer",
        },
      ],
    });
    const footer = byId("shared-footer");

    (
      widget() as unknown as {
        handleContentUpdate(data: Record<string, unknown>): void;
      }
    ).handleContentUpdate({
      elementId: "shared-footer",
      content: "Live update",
    });
    expect(footer.textContent).toBe("Live update");

    footer.textContent = "Shared footer";
    await flushMicrotasks();

    expect(footer.textContent).toBe("Live update");
  });
});
