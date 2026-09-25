/**
 * How the widget presents a device grant — driven through the whole widget.
 *
 * One rule, asserted from several angles: the grant travels in
 * `X-RCF-Editor-Grant` and nowhere else. Not a query parameter, not a path
 * segment, not a fragment, not a request body. A credential in a URL is a
 * credential in browser history, in the `Referer` sent to every third-party
 * asset on the customer's page, and in every access log between here and there
 * — and this one authorises writes to that page.
 *
 * Driven through `recopyfast.src.js` itself rather than an extracted helper: a
 * helper test would prove the helper builds the right request while a call site
 * that forgot to use it went on shipping the old one. That is the same reason
 * the server-side assertions run through the route.
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
const GRANT = "rcfg1.the-device-grant";
const EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const STORAGE_KEY = `rcf_editor_grant:${SITE_ID}`;
const GRANT_HEADER = "X-RCF-Editor-Grant";

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function installFetch(routes: Record<string, unknown>) {
  const recorded: Recorded[] = [];

  const impl = jest.fn(
    async (
      url: string,
      options?: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      },
    ) => {
      recorded.push({
        url,
        method: options?.method ?? "GET",
        headers: options?.headers ?? {},
        body: options?.body ? JSON.parse(options.body) : null,
      });

      for (const [fragment, response] of Object.entries(routes)) {
        if (url.includes(fragment)) {
          return { ok: true, status: 200, json: async () => response };
        }
      }

      return { ok: true, status: 200, json: async () => [] };
    },
  );

  (window as unknown as { fetch: unknown }).fetch = impl;
  return { recorded, impl };
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

function runWidget() {
  new Function(WIDGET_SOURCE)();
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface WidgetInstance {
  editMode: boolean;
  editorAuth: { grant?: string; permissions?: string[] } | null;
  persistContentUpdate(
    elementId: string,
    content: string,
    extra?: Record<string, unknown>,
  ): Promise<unknown>;
  startPolling(): void;
  showPublishConfirmation(): Promise<void>;
}

function widget(): WidgetInstance {
  return (window as unknown as { ReCopyFast: WidgetInstance }).ReCopyFast;
}

/** Boots the widget with a grant already in this browser's storage. */
async function bootSignedIn(
  permissions: string[] = ["view", "edit"],
  publishResult: Record<string, unknown> = {
    success: true,
    pendingChanges: 1,
    currentPageChanges: 1,
    otherPageChanges: 0,
    published: 1,
  },
) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      grant: GRANT,
      expiresAt: EXPIRES_AT,
      email: "bob@example.com",
      permissions,
      remembered: true,
    }),
  );

  const fetched = installFetch({
    "editor/validate-grant": {
      valid: true,
      email: "bob@example.com",
      permissions,
      expiresAt: EXPIRES_AT,
      shouldRefresh: false,
    },
    "staging/content": { content: [] },
    "staging/publish": publishResult,
  });

  runWidget();
  await settle();

  return fetched;
}

function callsTo(recorded: Recorded[], fragment: string) {
  return recorded.filter((call) => call.url.includes(fragment));
}

describe("the widget presents a device grant in a header, never a URL", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML =
      '<h1 id="headline">Hello world</h1><p>Some copy to edit.</p>';
    document.body.style.paddingTop = "";
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing");
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
    installScriptTag();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("reads staging content with the grant header and a clean URL", async () => {
    const { recorded } = await bootSignedIn();

    const hydrate = callsTo(recorded, "/staging/content/")[0];

    expect(hydrate).toBeDefined();
    expect(hydrate.headers[GRANT_HEADER]).toBe(GRANT);
    // The page scope is not a credential; no staging token or grant enters the URL.
    expect(hydrate.url).toBe(
      `${API}/staging/content/${SITE_ID}?page_path=%2Fpricing`,
    );
  });

  it("saves an edit with the grant header, and puts nothing in the URL or the body", async () => {
    const { recorded } = await bootSignedIn();

    await widget().persistContentUpdate("rcf-headline", "New copy");

    const save = callsTo(recorded, "/staging/content/").find(
      (call) => call.method === "PUT",
    );

    expect(save).toBeDefined();
    expect(save!.headers[GRANT_HEADER]).toBe(GRANT);
    expect(save!.url).toBe(`${API}/staging/content/${SITE_ID}`);
    expect(save!.body).toEqual({
      elementId: "rcf-headline",
      content: "New copy",
    });
    expect(JSON.stringify(save!.body)).not.toContain(GRANT);
    expect(callsTo(recorded, "/staging/publish")).toHaveLength(0);
  });

  it("polls with the grant header and a clean URL", async () => {
    const { recorded } = await bootSignedIn();
    const before = recorded.length;

    jest.useFakeTimers();
    widget().startPolling();
    jest.advanceTimersByTime(5000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    jest.useRealTimers();

    const poll = recorded
      .slice(before)
      .find((call) => call.url.includes("/staging/content/"));

    expect(poll).toBeDefined();
    expect(poll!.headers[GRANT_HEADER]).toBe(GRANT);
    expect(poll!.url).toBe(
      `${API}/staging/content/${SITE_ID}?page_path=%2Fpricing`,
    );
  });

  it("uses the page only for preview counts and publishes every site draft", async () => {
    window.history.replaceState(null, "", "/team/%7Emarcus/index.html");
    const { recorded } = await bootSignedIn(["view", "edit", "publish"], {
      success: true,
      pendingChanges: 8,
      currentPageChanges: 3,
      otherPageChanges: 5,
      published: 8,
    });

    await widget().showPublishConfirmation();
    await settle();

    const preview = callsTo(recorded, "/staging/publish").find(
      (call) => call.method === "GET",
    );
    expect(preview?.headers[GRANT_HEADER]).toBe(GRANT);
    expect(preview?.url).toBe(
      `${API}/staging/publish?siteId=${SITE_ID}&page_path=%2Fteam%2F~marcus`,
    );
    expect(preview?.body).toBeNull();
    expect(
      document.querySelector("#rcf-publish-status")?.textContent,
    ).toContain("3 changes on this page, 5 on other pages");

    const confirm = document.querySelector(
      ".rcf-modal-btn-success",
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    expect(confirm!.parentElement?.style.display).toBe("flex");
    expect(confirm!.classList).toContain("rcf-modal-btn-success");
    expect(
      confirm!.parentElement?.querySelector(".rcf-modal-btn-ghost"),
    ).not.toBeNull();
    confirm!.click();
    await settle();

    const publish = callsTo(recorded, "/staging/publish").find(
      (call) => call.method === "POST",
    );

    expect(publish).toBeDefined();
    expect(publish!.headers[GRANT_HEADER]).toBe(GRANT);
    expect(publish!.url).toBe(`${API}/staging/publish`);
    expect(publish!.body).toEqual({ siteId: SITE_ID });
    expect(JSON.stringify(publish!.body)).not.toContain(GRANT);
  });

  it("allows site-wide Publish when only other pages have drafts", async () => {
    const { recorded } = await bootSignedIn(["view", "edit", "publish"], {
      success: true,
      pendingChanges: 5,
      currentPageChanges: 0,
      otherPageChanges: 5,
      published: 5,
    });

    await widget().showPublishConfirmation();
    await settle();

    const confirm = document.querySelector(
      ".rcf-modal-btn-success",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(
      document.querySelector("#rcf-publish-status")?.textContent,
    ).toContain("0 changes on this page, 5 on other pages");

    confirm.click();
    await settle();

    const publish = callsTo(recorded, "/staging/publish").find(
      (call) => call.method === "POST",
    );
    expect(publish?.body).toEqual({ siteId: SITE_ID });
  });

  it("falls back to the site-wide total during a mixed-version rollout", async () => {
    await bootSignedIn(["view", "edit", "publish"], {
      success: true,
      pendingChanges: 4,
      published: 4,
    });

    await widget().showPublishConfirmation();
    await settle();

    expect(
      document.querySelector("#rcf-publish-status")?.textContent,
    ).toContain("4 site changes");
    expect(
      (document.querySelector(".rcf-modal-btn-success") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("never sends an orphan rcf_token on a public content read", async () => {
    window.history.replaceState(null, "", "/pricing?rcf_token=orphan-token");
    const { recorded } = installFetch({});

    runWidget();
    await settle();

    const publicRead = callsTo(recorded, `/content/${SITE_ID}`).find(
      (call) => call.method === "GET",
    );
    expect(publicRead?.url).toBe(
      `${API}/content/${SITE_ID}?page_path=%2Fpricing`,
    );
    expect(publicRead?.url).not.toContain("rcf_token");
  });

  it("never puts the grant in any URL it builds, on any request of the page load", async () => {
    const { recorded } = await bootSignedIn(["view", "edit", "publish"]);

    await widget().persistContentUpdate("rcf-headline", "New copy");
    await widget().showPublishConfirmation();
    await settle();
    (
      document.querySelector(".rcf-modal-btn-success") as HTMLButtonElement
    ).click();
    await settle();

    // The blanket assertion. `/editor/*` legitimately carries the grant in a
    // JSON body to routes built for it; no URL anywhere may.
    for (const call of recorded) {
      expect(call.url).not.toContain(GRANT);
      expect(call.url).not.toContain("rcf_grant");
    }

    expect(window.location.href).not.toContain(GRANT);
  });

  it("leaves the staging credential path exactly as it was", async () => {
    // A staging link carries no grant, and its token must keep travelling the
    // way it always has — this change may not quietly move it into a header or
    // drop it.
    window.history.replaceState(
      null,
      "",
      "/pricing?rcf_staging=1&rcf_token=staging-tok",
    );

    const { recorded } = installFetch({
      "staging/validate": {
        valid: true,
        email: "owner@example.com",
        permissions: ["view", "edit"],
        expiresAt: EXPIRES_AT,
      },
      "staging/content": { content: [] },
    });

    runWidget();
    await settle();

    const hydrate = callsTo(recorded, "/staging/content/")[0];

    expect(hydrate).toBeDefined();
    expect(hydrate.url).toContain("rcf_token=staging-tok");
    expect(hydrate.headers[GRANT_HEADER]).toBeUndefined();
  });
});
