/**
 * s67 — what the embed does with its startup configuration.
 *
 * The widget boots on a customer's page, next to whatever else that page
 * loads. Two things it read at startup were not its own to trust:
 *
 *   - a socket.io client. The unbuilt source used to inject
 *     `socket.io-client.min.js` next to itself when no bundled client was
 *     present. The artifact always prepends socket.io, so that loader only
 *     ever ran for the raw source, and s67 deleted it to fund SPA support;
 *   - `window.RECOPYFAST_API` / `window.RECOPYFAST_WS` (security review M8).
 *
 * These tests boot the real source IIFE, as the other embed suites do.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-config";
const SITE_TOKEN = "site-token";
const SCRIPT_SRC = "https://cdn.rcf.test/embed/recopyfast.js";

interface Widget {
  isInitialized: boolean;
  destroy(): void;
}

function widget(): Widget {
  return (window as unknown as { ReCopyFast: Widget }).ReCopyFast;
}

function installScriptTag(
  attributes: Record<string, string>,
  src = SCRIPT_SRC,
) {
  const script = document.createElement("script");
  if (src) script.src = src;
  script.setAttribute("data-site-id", SITE_ID);
  script.setAttribute("data-site-token", SITE_TOKEN);
  for (const [name, value] of Object.entries(attributes)) {
    script.setAttribute(name, value);
  }
  document.head.appendChild(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
}

function installFetch() {
  const urls: string[] = [];
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => [] };
    },
  );
  return urls;
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

let hostErrors: unknown[] = [];
const onHostError = (event: ErrorEvent) => hostErrors.push(event.error);

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "<h1>Hello world</h1><p>Some copy.</p>";
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  for (const key of [
    "ReCopyFast",
    "recopyfast",
    "rcf",
    "RECOPYFAST_API",
    "RECOPYFAST_WS",
    "__recopyfastSocketIO",
    "io",
  ]) {
    delete (window as unknown as Record<string, unknown>)[key];
  }
  hostErrors = [];
  window.addEventListener("error", onHostError);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  const current = widget();
  if (current && typeof current.destroy === "function") current.destroy();
  window.removeEventListener("error", onHostError);
  jest.restoreAllMocks();
});

describe("realtime without a bundled socket.io client", () => {
  it("injects no socket.io <script> and degrades to HTTP without throwing", async () => {
    installScriptTag({ "data-ws-url": "wss://ws.rcf.test" });
    const urls = installFetch();

    new Function(WIDGET_SOURCE)();
    await settle();

    expect(
      Array.from(document.querySelectorAll("script")).filter((script) =>
        (script.getAttribute("src") || "").includes("socket.io"),
      ),
    ).toEqual([]);
    // Init ran to the end instead of hanging on a script that never loads,
    // and the page's copy still travelled over HTTP.
    expect(widget().isInitialized).toBe(true);
    expect(
      urls.some((url) => url.startsWith("https://cdn.rcf.test/api/content/")),
    ).toBe(true);
    expect(hostErrors).toEqual([]);
  });
});

/**
 * AC 12 — security review M8: the endpoints cannot be clobbered.
 *
 * `window.RECOPYFAST_API` used to win over everything, on truthiness alone. Any
 * markup the customer's page renders — a CMS post, a comment, a profile field —
 * can create `window.RECOPYFAST_API` through named access by giving an element
 * that id (DOM clobbering). An `<a id="RECOPYFAST_API" href="https://evil.test/api">`
 * stringifies to its href, so every widget request, site token in its
 * `Authorization` header, went to the attacker's host.
 *
 * The rule now: a global is honoured only when it is a string whose origin is
 * the origin of the embed script's own `src`. Anything else is ignored and the
 * endpoint comes from `data-api-url` / `data-ws-url`, then (API only) from the
 * script's own origin.
 */
describe("startup endpoints (M8)", () => {
  const CDN_API = "https://cdn.rcf.test/api";

  function expectAllRequestsTo(urls: string[], prefix: string) {
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => !url.startsWith(`${prefix}/`))).toEqual([]);
    expect(urls.filter((url) => url.includes("evil.test"))).toEqual([]);
  }

  /**
   * Named access, as a browser has it. If jsdom does not expose the element on
   * `window` by its id, the test assigns that element object itself — the
   * exact value a browser yields for `window.RECOPYFAST_API` on such a page.
   */
  function clobber(name: string, href: string) {
    const anchor = document.createElement("a");
    anchor.id = name;
    anchor.href = href;
    document.body.appendChild(anchor);
    const globals = window as unknown as Record<string, unknown>;
    if (globals[name] !== anchor) globals[name] = anchor;
    return anchor;
  }

  function installSocketSpy() {
    const io = jest.fn(() => ({
      on: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      connected: false,
    }));
    (
      window as unknown as { __recopyfastSocketIO: unknown }
    ).__recopyfastSocketIO = { io };
    return io;
  }

  it("ignores an element clobbering window.RECOPYFAST_API", async () => {
    installScriptTag({});
    clobber("RECOPYFAST_API", "https://evil.test/api");
    const urls = installFetch();

    new Function(WIDGET_SOURCE)();
    await settle();

    expectAllRequestsTo(urls, CDN_API);
    expect(
      (window as unknown as { RECOPYFAST_API: unknown }).RECOPYFAST_API,
    ).toBe(CDN_API);
  });

  it("ignores a cross-origin string global", async () => {
    installScriptTag({});
    (window as unknown as { RECOPYFAST_API: string }).RECOPYFAST_API =
      "https://evil.test/api";
    const urls = installFetch();

    new Function(WIDGET_SOURCE)();
    await settle();

    expectAllRequestsTo(urls, CDN_API);
  });

  it("honours a string global on the script's own origin", async () => {
    installScriptTag({});
    (window as unknown as { RECOPYFAST_API: string }).RECOPYFAST_API =
      "https://cdn.rcf.test/custom-api";
    const urls = installFetch();

    new Function(WIDGET_SOURCE)();
    await settle();

    expectAllRequestsTo(urls, "https://cdn.rcf.test/custom-api");
  });

  it("still honours data-api-url when the global is ignored", async () => {
    installScriptTag({ "data-api-url": "https://api.rcf.test/api" });
    (window as unknown as { RECOPYFAST_API: string }).RECOPYFAST_API =
      "https://evil.test/api";
    const urls = installFetch();

    new Function(WIDGET_SOURCE)();
    await settle();

    expectAllRequestsTo(urls, "https://api.rcf.test/api");
  });

  it.each([
    ["an element clobbering it", "element"],
    ["a cross-origin string", "string"],
  ])(
    "never hands window.RECOPYFAST_WS to socket.io when it is %s; data-ws-url still reaches it",
    async (_label, form) => {
      installScriptTag({ "data-ws-url": "wss://ws.rcf.test" });
      if (form === "element") clobber("RECOPYFAST_WS", "https://evil.test/ws");
      else
        (window as unknown as { RECOPYFAST_WS: string }).RECOPYFAST_WS =
          "wss://evil.test";
      const io = installSocketSpy();
      installFetch();

      new Function(WIDGET_SOURCE)();
      await settle();

      expect(io).toHaveBeenCalledTimes(1);
      expect((io.mock.calls[0] as unknown[])[0]).toBe("wss://ws.rcf.test");
    },
  );

  it("never connects a clobbered window.RECOPYFAST_WS when no data-ws-url is set", async () => {
    installScriptTag({});
    clobber("RECOPYFAST_WS", "https://evil.test/ws");
    const io = installSocketSpy();
    installFetch();

    new Function(WIDGET_SOURCE)();
    await settle();

    expect(io).not.toHaveBeenCalled();
  });

  it("ignores the globals on a script with no src and uses its attributes", async () => {
    installScriptTag({ "data-api-url": "https://api.rcf.test/api" }, "");
    (window as unknown as { RECOPYFAST_API: string }).RECOPYFAST_API =
      "https://evil.test/api";
    const urls = installFetch();

    new Function(WIDGET_SOURCE)();
    await settle();

    expectAllRequestsTo(urls, "https://api.rcf.test/api");
  });
});
