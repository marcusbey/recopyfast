/**
 * The handoff round trip, driven through the whole widget.
 *
 * `editor-auth.test.ts` exercises the client in isolation, which proves the
 * protocol but not that anything calls it. This loads
 * `public/embed/recopyfast.src.js` into a DOM exactly as a customer's page
 * does — script tag attributes, a URL carrying `?rcf_handoff=…`, no other
 * credential of any kind — and asserts the widget really does spend the code,
 * clean the address bar, keep the grant, and come back signed in on the next
 * load.
 *
 * This is the defect P0-1 recorded: the widget had zero references to
 * `rcf_handoff`, so every hub sign-in landed the user as an anonymous visitor.
 * A test that only covered the extracted client would have stayed green through
 * exactly that.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-abc";
const SITE_TOKEN = "site-token-xyz";
const ORIGIN = "https://helloworld.com";
const API = `${ORIGIN}/api`;

const GRANT = "rcfg1.minted-by-handoff";
const EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

interface Recorded {
  url: string;
  body: Record<string, unknown> | null;
}

/**
 * Routes by URL rather than by a queue: the widget makes a handful of unrelated
 * calls at boot (stored content, A/B tests, impressions) whose ordering is not
 * this test's business, and a queue would make it assert their sequence by
 * accident.
 */
function installFetch(editorResponses: Record<string, unknown>) {
  const recorded: Recorded[] = [];

  const impl = jest.fn(async (url: string, options?: { body?: string }) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    recorded.push({ url, body });

    for (const [fragment, response] of Object.entries(editorResponses)) {
      if (url.includes(fragment)) {
        return {
          ok: true,
          status: 200,
          json: async () => response,
        };
      }
    }

    // Everything else the widget touches at boot. Empty, valid, uninteresting.
    return { ok: true, status: 200, json: async () => [] };
  });

  (window as unknown as { fetch: unknown }).fetch = impl;
  return { recorded, impl };
}

function installScriptTag() {
  const script = document.createElement("script");
  script.setAttribute("data-site-id", SITE_ID);
  script.setAttribute("data-site-token", SITE_TOKEN);
  script.setAttribute("data-api-url", API);
  script.setAttribute("data-ws-url", ORIGIN);
  Object.defineProperty(script, "src", {
    value: `${ORIGIN}/embed/recopyfast.js`,
  });
  document.head.appendChild(script);

  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
}

/** socket.io, stubbed. The transport is not what this test is about. */
function installSocketIo() {
  (window as unknown as Record<string, unknown>).__recopyfastSocketIO = {
    io: () => ({
      on: () => {},
      emit: () => {},
      disconnect: () => {},
      connected: false,
    }),
  };
}

function runWidget() {
  // The file is an IIFE; evaluating it is what a <script> tag does.
  new Function(WIDGET_SOURCE)();
}

/** The widget's init is async and fired from its constructor. */
async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface WidgetInstance {
  editorAuth: {
    email?: string;
    permissions?: string[];
    grant?: string;
  } | null;
  editMode: boolean;
  stagingMode: boolean;
}

function widget(): WidgetInstance {
  return (window as unknown as { ReCopyFast: WidgetInstance }).ReCopyFast;
}

const STORAGE_KEY = `rcf_editor_grant:${SITE_ID}`;

describe("widget handoff round trip", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>Hello world</h1><p>Some copy to edit.</p>";
    document.body.style.paddingTop = "";
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing");
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
    installScriptTag();
    installSocketIo();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("spends the code, cleans the URL, and comes back signed in on the next load", async () => {
    window.history.replaceState(
      null,
      "",
      "/pricing?utm_source=hub&rcf_handoff=ONE-SHOT-CODE",
    );

    const first = installFetch({
      "editor/handoff/redeem": {
        ok: true,
        grant: GRANT,
        expiresAt: EXPIRES_AT,
        email: "bob@example.com",
        permissions: ["view", "edit"],
      },
    });

    runWidget();
    await settle();

    const redeem = first.recorded.find((call) =>
      call.url.includes("editor/handoff/redeem"),
    );

    // 1. The widget actually called the route. Before this change it called
    //    none of the six, which is the whole of P0-1.
    expect(redeem).toBeDefined();
    expect(redeem!.url).toBe(`${API}/editor/handoff/redeem`);
    expect(redeem!.body).toEqual({
      code: "ONE-SHOT-CODE",
      siteId: SITE_ID,
    });

    // 2. The spent code is out of the address bar; the rest of the query is not.
    expect(window.location.search).toBe("?utm_source=hub");
    expect(window.location.pathname).toBe("/pricing");

    // 3. The editor is recognised, by name.
    expect(widget().editorAuth).toMatchObject({
      email: "bob@example.com",
      permissions: ["view", "edit"],
      grant: GRANT,
    });

    // 4. And says so on the page.
    const banner = document.querySelector("#rcf-editor-banner");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("bob@example.com");

    // 5. The grant is persisted on the customer's own origin.
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toMatchObject(
      {
        grant: GRANT,
        email: "bob@example.com",
      },
    );

    // ---- Second load, tomorrow. No handoff code anywhere. ----
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>Hello world</h1>";
    document.body.style.paddingTop = "";
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
    installScriptTag();
    window.history.replaceState(null, "", "/pricing");

    const second = installFetch({
      "editor/validate-grant": {
        valid: true,
        email: "bob@example.com",
        permissions: ["view", "edit"],
        expiresAt: EXPIRES_AT,
        shouldRefresh: false,
      },
    });

    runWidget();
    await settle();

    const validated = second.recorded.find((call) =>
      call.url.includes("editor/validate-grant"),
    );

    expect(validated).toBeDefined();
    expect(validated!.body).toEqual({ grant: GRANT, siteId: SITE_ID });
    expect(widget().editorAuth).toMatchObject({ email: "bob@example.com" });

    // No handoff was needed and none was attempted.
    expect(second.recorded.some((call) => call.url.includes("handoff"))).toBe(
      false,
    );
  });

  it("costs an ordinary visitor no editor request at all", async () => {
    const { recorded } = installFetch({});

    runWidget();
    await settle();

    expect(recorded.some((call) => call.url.includes("/editor/"))).toBe(false);
    expect(widget().editorAuth).toBeNull();
    expect(document.querySelector("#rcf-editor-banner")).toBeNull();
  });

  it("leaves the staging path alone", async () => {
    window.history.replaceState(
      null,
      "",
      "/pricing?rcf_staging=1&rcf_token=staging-tok",
    );

    const { recorded } = installFetch({
      "staging/validate": {
        valid: true,
        kind: "staging",
        email: "carol@example.com",
        permissions: ["view", "edit"],
        expiresAt: EXPIRES_AT,
      },
    });

    runWidget();
    await settle();

    // The staging link still drives edit mode, exactly as before, and the
    // magic-code client stays out of its way. `stagingMode` is the token itself
    // rather than a boolean — `EDITOR_MODE` is `(STAGING_MODE && STAGING_TOKEN)`
    // — so this asserts what the widget has always meant by it, truthiness.
    expect(widget().stagingMode).toBeTruthy();
    expect(widget().editMode).toBe(true);
    expect(widget().editorAuth).toBeNull();
    expect(recorded.some((call) => call.url.includes("/editor/"))).toBe(false);
    expect(window.location.search).toBe("");
  });
});
