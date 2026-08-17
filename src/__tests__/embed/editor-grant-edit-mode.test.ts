/**
 * What an invited editor actually sees on the customer's page.
 *
 * Until s14a the widget told every grant holder, out loud, on the customer's
 * live page: "— in-page editing isn't enabled for this site yet". That sentence
 * was true — the content API did not accept device grants — and it is the exact
 * evidence the research used to show the story's premise was false. These tests
 * pin the state it was replaced by:
 *
 *   - editing turns on from the grant's own permissions, using the same
 *     `edit | publish | admin` test the staging path uses;
 *   - a view-only grant leaves the page inert, with no affordance to click;
 *   - the sentence is gone, and cannot come back unnoticed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.join(
  process.cwd(),
  "public",
  "embed",
  "recopyfast.src.js",
);
const BUILT_WIDGET_PATH = path.join(
  process.cwd(),
  "public",
  "embed",
  "recopyfast.js",
);
const WIDGET_SOURCE = readFileSync(WIDGET_PATH, "utf8");

const SITE_ID = "site-abc";
const SITE_TOKEN = "site-token-xyz";
const ORIGIN = "https://helloworld.com";
const API = `${ORIGIN}/api`;
const GRANT = "rcfg1.the-device-grant";
const EMAIL = "bob@example.com";
const EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const STORAGE_KEY = `rcf_editor_grant:${SITE_ID}`;

function installFetch(routes: Record<string, unknown>) {
  const impl = jest.fn(async (url: string) => {
    for (const [fragment, response] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        return { ok: true, status: 200, json: async () => response };
      }
    }
    return { ok: true, status: 200, json: async () => [] };
  });

  (window as unknown as { fetch: unknown }).fetch = impl;
  return impl;
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

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface WidgetInstance {
  editMode: boolean;
  editorAuth: { email?: string; permissions?: string[] } | null;
}

function widget(): WidgetInstance {
  return (window as unknown as { ReCopyFast: WidgetInstance }).ReCopyFast;
}

async function bootWithGrant(permissions: string[]) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      grant: GRANT,
      expiresAt: EXPIRES_AT,
      email: EMAIL,
      permissions,
      remembered: true,
    }),
  );

  installFetch({
    "editor/validate-grant": {
      valid: true,
      email: EMAIL,
      permissions,
      expiresAt: EXPIRES_AT,
      shouldRefresh: false,
    },
    "staging/content": { content: [] },
  });

  new Function(WIDGET_SOURCE)();
  await settle();
}

/** The affordance only exists once `setupEditMode` has injected its styles. */
function hasEditAffordance(): boolean {
  return Array.from(document.head.querySelectorAll("style")).some((style) =>
    (style.textContent || "").includes(".rcf-hovering"),
  );
}

describe("edit mode, from the grant's own permissions", () => {
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
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("turns editing on for a grant that carries edit rights", async () => {
    await bootWithGrant(["view", "edit"]);

    expect(widget().editMode).toBe(true);
    expect(hasEditAffordance()).toBe(true);
  });

  it("turns editing on for publish and admin too, the same test the staging path uses", async () => {
    await bootWithGrant(["view", "edit", "publish", "admin"]);

    expect(widget().editMode).toBe(true);
  });

  it("leaves the page inert for a view-only grant", async () => {
    await bootWithGrant(["view"]);

    // Recognised, named on the banner — and unable to change anything, with no
    // affordance inviting them to try.
    expect(widget().editorAuth).toMatchObject({ email: EMAIL });
    expect(widget().editMode).toBe(false);
    expect(hasEditAffordance()).toBe(false);
  });

  it("still costs an ordinary visitor nothing", async () => {
    installFetch({});
    new Function(WIDGET_SOURCE)();
    await settle();

    expect(widget().editMode).toBe(false);
    expect(document.querySelector("#rcf-editor-banner")).toBeNull();
  });
});

describe("the editor banner", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>Hello world</h1>";
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
    jest.restoreAllMocks();
  });

  it("says the editor can edit, names them, and offers Done", async () => {
    await bootWithGrant(["view", "edit"]);

    const banner = document.querySelector("#rcf-editor-banner");
    expect(banner).not.toBeNull();

    const text = banner!.textContent || "";
    expect(text).toContain("You can edit this page");
    expect(text).toContain(EMAIL);
    expect(text).toContain("Done");

    // No staging/live vocabulary and no Publish button on this bar: both
    // authenticate with credentials this holder does not have, and the
    // distinction is a "mode" this audience should never have to learn.
    expect(text).not.toContain("Publish");
    expect(text).not.toMatch(/staging/i);
  });

  it("keeps the full address available when it is truncated", async () => {
    await bootWithGrant(["view", "edit"]);

    const email = document.querySelector(
      "#rcf-editor-banner .rcf-editor-banner-email",
    );
    expect(email).not.toBeNull();
    expect(email!.getAttribute("title")).toBe(EMAIL);
  });

  it("dismisses for this page load without signing anyone out", async () => {
    await bootWithGrant(["view", "edit"]);

    const done = document.querySelector(
      "#rcf-editor-banner .rcf-editor-banner-dismiss",
    ) as HTMLButtonElement;
    done.click();

    expect(document.querySelector("#rcf-editor-banner")).toBeNull();
    // Discarding a credential is something the holder should have to mean.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(widget().editMode).toBe(true);
  });

  it("does not claim editing when the grant is view-only", async () => {
    await bootWithGrant(["view"]);

    const text =
      document.querySelector("#rcf-editor-banner")?.textContent || "";
    expect(text).toContain(EMAIL);
    expect(text).not.toContain("You can edit this page");
  });
});

describe("the sentence that said editing was off", () => {
  it("is gone from the source", () => {
    expect(WIDGET_SOURCE).not.toContain("enabled for this site yet");
    expect(WIDGET_SOURCE).not.toContain("accept editor device grants");
  });

  it("is gone from the artifact every customer actually loads", () => {
    // `recopyfast.js` is a permanent public URL baked into every snippet ever
    // issued. A fixed source with a stale artifact fixes nothing.
    //
    // Matched on "enabled for this site yet" rather than on the apostrophe:
    // the build escapes U+2019 to `’`, so an assertion written against the
    // literal sentence passes against the artifact that still contains it.
    const built = readFileSync(BUILT_WIDGET_PATH, "utf8");
    expect(built).not.toContain("enabled for this site yet");
    expect(built).not.toContain("accept editor device grants");
  });
});
