/**
 * The widget runs on somebody else's page, beside their own scripts — and a
 * classic script's top-level `let` / `const` / `class` is visible to every
 * other script on the page, ours included. A page that declares
 * `let open = false` (a menu flag), `const history = []` (an undo stack) or
 * `let addEventListener = …` makes a BARE `open(…)` in the widget reach the
 * page's binding, not the browser's, and the TypeError lands in the host
 * page's window: non-negotiable #4.
 *
 * TOMBSTONE — s76 review fix pass 2. The first fix pass dropped `window.` from
 * `open`, `history`, `addEventListener`, `removeEventListener`,
 * `localStorage` and `sessionStorage` to save bytes, on the reasoning that
 * those globals "always exist". They always exist on `window`; a bare name is
 * resolved through the page's global lexical scope first. `window.` itself
 * cannot be shadowed: it is an unforgeable, non-configurable property, so a
 * top-level `let window` is a SyntaxError.
 *
 * `location` stays bare in the widget for the same reason: it is
 * [LegacyUnforgeable] on Window, so a top-level `let`/`const`/`class location`
 * is a SyntaxError, `function location(){}` throws, and `var location` does
 * not create a new binding — measured in Chromium 145 and WebKit 26 (the s76
 * plan, review fix pass 2). jsdom does NOT model this (its `let location`
 * succeeds), which is why this suite never declares it: it would test jsdom,
 * not a browser.
 *
 * jest's jsdom environment runs inline scripts, so the page's declarations are
 * made exactly as a page makes them: a <script> element in the document. They
 * live for the whole file, as they would for the whole page.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-host-globals";
const SITE_TOKEN = "site-token";
const ORIGIN = "https://app.recopyfast.test";
const API = `${ORIGIN}/api`;
const GRANT = "rcfg1.host-globals-grant";
const EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();
const GRANT_KEY = `rcf_editor_grant:${SITE_ID}`;
const EDIT_LINK_KEY = `rcf_edit_link:${SITE_ID}`;

/** The page's own top-level declarations: all legal in every browser. */
const PAGE_SCRIPT =
  "let open = false; let history = 1; let addEventListener = 0; " +
  "let removeEventListener = 0; let localStorage = null; let sessionStorage = null;";

interface WidgetInstance {
  stagingMode: boolean;
  isMutationLocked: boolean;
  destroy(): void;
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

const VALID = {
  valid: true,
  verified: true,
  email: "owner@example.com",
  permissions: ["view", "edit", "publish"],
  expiresAt: EXPIRES_AT,
};

interface Replies {
  validate?: number;
  put?: number;
}

function installFetch({ validate = 200, put = 200 }: Replies) {
  const impl = jest.fn(async (url: string, options?: { method?: string }) => {
    if (url.includes("editor/validate-grant")) {
      return response(200, {
        valid: true,
        email: "editor@example.com",
        permissions: ["view", "edit", "publish"],
        expiresAt: EXPIRES_AT,
        shouldRefresh: false,
      });
    }
    if (url.includes("editor/handoff/redeem")) {
      return response(401, { error: "Invalid code", reason: "invalid" });
    }
    if (url.includes("/staging/validate")) {
      return validate === 200
        ? response(200, VALID)
        : response(validate, { valid: false, error: "Invalid" });
    }
    if (url.includes("/staging/content/") && options?.method === "PUT") {
      return response(put, put === 200 ? { success: true } : { error: "No" });
    }
    if (url.includes("/staging/content/"))
      return response(200, { content: [] });
    if (url.includes("/content-map")) return response(200, { success: true });
    return response(200, []);
  });
  (window as unknown as { fetch: unknown }).fetch = impl;
  return impl;
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** One full-page load in the same tab; sessionStorage survives it. */
async function boot(url: string, replies: Replies = {}) {
  const previous = (window as unknown as Record<string, unknown>).ReCopyFast as
    | WidgetInstance
    | undefined;
  if (previous) {
    previous.isMutationLocked = true;
    previous.destroy();
  }
  document.head.innerHTML = "";
  document.body.innerHTML =
    '<h1 id="headline">Original copy</h1><p>Another element</p>';
  document.body.style.paddingTop = "";
  delete (window as unknown as Record<string, unknown>).ReCopyFast;
  delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
  delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
  window.history.replaceState(null, "", url);

  const script = document.createElement("script");
  script.setAttribute("data-site-id", SITE_ID);
  script.setAttribute("data-site-token", SITE_TOKEN);
  script.setAttribute("data-api-url", API);
  document.head.appendChild(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });

  const fetch = installFetch(replies);
  new Function(WIDGET_SOURCE)();
  await settle();
  return fetch;
}

function storeGrant(store: Storage, remembered: boolean) {
  store.setItem(
    GRANT_KEY,
    JSON.stringify({
      grant: GRANT,
      expiresAt: EXPIRES_AT,
      email: "editor@example.com",
      permissions: ["view", "edit", "publish"],
      remembered,
    }),
  );
}

function headline(): HTMLElement {
  return document.querySelector("h1") as HTMLElement;
}

/** Opens the inline editor on the headline and types into it. */
function editHeadline(text: string) {
  headline().click();
  headline().textContent = text;
  headline().dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function navigationIsGuarded(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** What escaped into the host page's window (non-negotiable #4). */
const escaped: unknown[] = [];
const recordEscape = (event: Event) =>
  escaped.push((event as ErrorEvent).error ?? event);

beforeAll(() => {
  const page = document.createElement("script");
  page.textContent = PAGE_SCRIPT;
  document.head.appendChild(page);
});

beforeEach(() => {
  escaped.length = 0;
  window.addEventListener("error", recordEscape);
  window.addEventListener("unhandledrejection", recordEscape);
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest.spyOn(window, "alert").mockImplementation(() => {});
  jest.spyOn(window, "open").mockImplementation(() => null);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener("error", recordEscape);
  window.removeEventListener("unhandledrejection", recordEscape);
  jest.restoreAllMocks();
});

describe("a host page's own top-level bindings", () => {
  it("are what a bare name reaches in this page (the fixture bites)", () => {
    expect(
      new Function(
        "return [open, history, addEventListener, removeEventListener, localStorage, sessionStorage]",
      )(),
    ).toEqual([false, 1, 0, 0, null, null]);
  });
});

describe("the widget never reaches the page's bindings", () => {
  it("a share link leaves the address bar and the tab keeps it", async () => {
    await boot("/pricing?rcf_staging=1&rcf_token=share&page=2#plans");

    expect(window.location.search).toBe("?page=2");
    expect(window.location.hash).toBe("#plans");
    expect(JSON.parse(window.sessionStorage.getItem(EDIT_LINK_KEY)!)).toEqual([
      "share",
      null,
    ]);
    expect(widget().stagingMode).toBe(true);
    expect(escaped).toEqual([]);
  });

  it("the next page load restores the link, and a refusal forgets it", async () => {
    await boot("/pricing?rcf_staging=1&rcf_token=share");
    await boot("/about");
    expect(widget().stagingMode).toBe(true);

    await boot("/contact", { validate: 401 });
    expect(window.sessionStorage.getItem(EDIT_LINK_KEY)).toBeNull();
    expect(escaped).toEqual([]);
  });

  it("an editor handoff code leaves the address bar", async () => {
    await boot("/pricing?rcf_handoff=one-time-code&page=2");

    expect(window.location.search).toBe("?page=2");
    expect(escaped).toEqual([]);
  });

  it.each([
    ["a remembered grant in localStorage", () => window.localStorage, true],
    ["a session grant in sessionStorage", () => window.sessionStorage, false],
  ] as const)("%s boots the editor", async (_label, store, remembered) => {
    storeGrant(store(), remembered);

    const fetch = await boot("/pricing");

    const grantChecks = fetch.mock.calls
      .filter(([url]) => String(url).includes("editor/validate-grant"))
      .map((call) => {
        const options = (call as unknown[])[1] as { body?: string };
        return JSON.parse(options.body ?? "{}");
      });
    expect(grantChecks).toEqual([{ grant: GRANT, siteId: SITE_ID }]);
    expect(escaped).toEqual([]);
  });

  it("the inline editor guards navigation on the real window, and stops when it closes", async () => {
    storeGrant(window.localStorage, true);
    await boot("/pricing");

    editHeadline("A draft worth keeping");
    expect(headline().getAttribute("contenteditable")).toBe("true");
    expect(navigationIsGuarded()).toBe(true);

    (document.querySelector(".rcf-btn-cancel") as HTMLButtonElement).click();
    expect(headline().hasAttribute("contenteditable")).toBe(false);
    expect(navigationIsGuarded()).toBe(false);
    expect(escaped).toEqual([]);
  });

  it("Re-authenticate keeps the draft and opens editor sign-in in a new tab", async () => {
    storeGrant(window.localStorage, true);
    await boot("/pricing", { put: 401 });

    editHeadline("Typed draft survives");
    (document.querySelector(".rcf-btn-save") as HTMLButtonElement).click();
    await settle();

    const elementId = headline().getAttribute("data-rcf-id");
    expect(
      window.sessionStorage.getItem(
        `rcf_unsaved_draft:${SITE_ID}:${elementId}`,
      ),
    ).toBe("Typed draft survives");
    (
      document.querySelector(
        'button[aria-label="Re-authenticate"]',
      ) as HTMLButtonElement
    ).click();
    expect(window.open).toHaveBeenCalledWith(
      `${ORIGIN}/edit`,
      "_blank",
      "noopener",
    );
    expect(escaped).toEqual([]);
  });

  it("Preview Live opens this page in a new tab", async () => {
    await boot("/pricing?rcf_staging=1&rcf_token=share");

    (document.querySelector("#rcf-preview-live") as HTMLButtonElement).click();

    expect(window.open).toHaveBeenCalledWith(
      window.location.href,
      "_blank",
      "noopener",
    );
    expect(escaped).toEqual([]);
  });
});

describe("the widget source", () => {
  /**
   * The census behind the tests above: no bare use of a name a page can
   * shadow. A byte-saving pass removed `window.` once already; this is the
   * line it would have to delete to do it again. Comments are removed first;
   * object keys (`history: …`), method definitions (`open() {`) and names
   * inside strings, class names and paths are not uses.
   */
  it("names every shadowable global through window", () => {
    const code = WIDGET_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /(^|[^:'"])\/\/.*$/gm,
      "$1",
    );
    const bare =
      /(?<![\w$.'"/-])(open|history|addEventListener|removeEventListener|localStorage|sessionStorage)\b(?!\s*:)(?!\s*\(\)\s*\{)/;
    const uses = code
      .split("\n")
      .filter((line) => bare.test(line))
      .map((line) => line.trim());
    expect(uses).toEqual([]);
  });
});
