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

/**
 * Done, by its accessible name. It used to be found as "the" element with the
 * `rcf-editor-banner-dismiss` class — true until s39 gave "All sites" the same
 * class (for the same host-hardened button styling). The first match is now
 * All sites, which navigates away instead of dismissing.
 */
const DONE_BUTTON =
  '#rcf-editor-banner button[aria-label="Dismiss the ReCopyFast editor bar"]';
const ALL_SITES_BUTTON =
  '#rcf-editor-banner button[aria-label="Back to all your sites"]';

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

async function bootWithGrant(permissions?: string[]) {
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

    // Save is still a draft write, but the storage model remains an
    // implementation detail rather than vocabulary this audience has to learn.
    expect(text).not.toContain("Publish");
    expect(text).not.toMatch(/staging/i);
  });

  it.each([["publish"], ["admin"]])(
    "renders one accessible Publish control for a %s grant and opens the existing confirmation",
    async (permission) => {
      await bootWithGrant(["view", "edit", permission]);

      const publish = document.querySelectorAll(
        '#rcf-editor-banner button[aria-label="Publish"]',
      );
      expect(publish).toHaveLength(1);
      expect(
        document.querySelector("#rcf-editor-banner [data-rcf-id]"),
      ).toBeNull();

      (publish[0] as HTMLButtonElement).click();
      await settle();

      expect(document.querySelector(".rcf-modal-btn-success")).not.toBeNull();
      expect(document.body.textContent).toContain("Publish Changes");
      expect(
        document.querySelector("#rcf-editor-banner [contenteditable]"),
      ).toBeNull();
    },
  );

  it.each([["view"], ["view", "edit"]])(
    "renders no Publish control for permissions %j",
    async (...permissions) => {
      await bootWithGrant(permissions);

      expect(
        document.querySelector(
          '#rcf-editor-banner button[aria-label="Publish"]',
        ),
      ).toBeNull();
    },
  );

  it("keeps the full address available when it is truncated", async () => {
    await bootWithGrant(["view", "edit"]);

    const email = document.querySelector(
      "#rcf-editor-banner .rcf-editor-banner-email",
    );
    expect(email).not.toBeNull();
    expect(email!.getAttribute("title")).toBe(EMAIL);
  });

  it("offers no Publish action when permissions are omitted", async () => {
    await bootWithGrant();
    expect(document.querySelector('button[aria-label="Publish"]')).toBeNull();
    expect(widget().editMode).toBe(false);
  });

  it("dismisses for this page load without signing anyone out", async () => {
    await bootWithGrant(["view", "edit"]);

    const done = document.querySelector(DONE_BUTTON) as HTMLButtonElement;
    done.click();

    expect(document.querySelector("#rcf-editor-banner")).toBeNull();
    // Discarding a credential is something the holder should have to mean.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(widget().editMode).toBe(true);
  });

  it("overrides host stylesheet important padding, then removes only its inline reservation", async () => {
    const hostStyle = document.createElement("style");
    hostStyle.textContent = "body { padding-top: 8px !important; }";
    document.head.appendChild(hostStyle);
    jest
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.id === "rcf-editor-banner" ? 42 : 0;
      });

    await bootWithGrant(["view", "edit"]);

    expect(document.body.style.paddingTop).toBe("50px");
    expect(document.body.style.getPropertyPriority("padding-top")).toBe(
      "important",
    );
    expect(window.getComputedStyle(document.body).paddingTop).toBe("50px");

    const done = document.querySelector(DONE_BUTTON) as HTMLButtonElement;
    done.click();

    expect(document.body.style.paddingTop).toBe("");
    expect(document.body.style.getPropertyPriority("padding-top")).toBe("");
    expect(window.getComputedStyle(document.body).paddingTop).toBe("8px");
  });

  it("restores the host's exact inline padding value and priority on Done", async () => {
    document.body.style.setProperty("padding-top", "12px", "important");
    jest
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.id === "rcf-editor-banner" ? 42 : 0;
      });

    await bootWithGrant(["view", "edit"]);

    expect(document.body.style.paddingTop).toBe("54px");
    expect(document.body.style.getPropertyPriority("padding-top")).toBe(
      "important",
    );

    const done = document.querySelector(DONE_BUTTON) as HTMLButtonElement;
    done.click();

    expect(document.body.style.paddingTop).toBe("12px");
    expect(document.body.style.getPropertyPriority("padding-top")).toBe(
      "important",
    );
  });

  // Found live after s39 shipped: at 360px the claim wrapped onto four lines
  // and squeezed the address down to "r…", the one thing that says whose
  // session this is. On a phone the claim and its divider give way.
  it("hides the claim and its divider on a phone so the address gets the room", async () => {
    await bootWithGrant(["view", "edit"]);

    const claim = Array.from(
      document.querySelectorAll("#rcf-editor-banner span"),
    ).find((span) => span.textContent === "You can edit this page");
    expect(claim?.classList.contains("rcf-editor-banner-claim")).toBe(true);

    const sheet = (
      document.querySelector("#rcf-editor-banner-styles") as HTMLStyleElement
    ).sheet as CSSStyleSheet;
    const phone = Array.from(sheet.cssRules).find(
      (rule): rule is CSSMediaRule =>
        rule instanceof CSSMediaRule &&
        rule.media.mediaText.replace(/\s/g, "") === "(max-width:480px)",
    );
    expect(phone).toBeDefined();
    const hidden = Array.from(phone!.cssRules).filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.style.display === "none",
    );
    const selectors = hidden.map((rule) => rule.selectorText).join(",");
    expect(selectors).toContain("#rcf-editor-banner .rcf-editor-banner-claim");
    expect(selectors).toContain(
      "#rcf-editor-banner .rcf-editor-banner-divider",
    );
  });

  it("does not claim editing when the grant is view-only", async () => {
    await bootWithGrant(["view"]);

    const text =
      document.querySelector("#rcf-editor-banner")?.textContent || "";
    expect(text).toContain(EMAIL);
    expect(text).not.toContain("You can edit this page");
  });
});

describe("the way back to all sites", () => {
  /**
   * s39. An invited editor who can edit several sites, done with this one, had
   * no way back to the list: the bar offered Done, which only hides it. The
   * hub at `/edit` now resumes a live session, so the bar links to it.
   *
   * Grant editors only, and structurally so: this bar is `showEditorBanner`,
   * which only runs when a device grant has been verified. Owners and
   * edit-session holders get a different toolbar and never see it.
   */
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

  it.each([[["view", "edit"]], [["view", "edit", "publish"]], [["view"]]])(
    "offers one All sites control, before Publish and Done, for permissions %j",
    async (permissions) => {
      await bootWithGrant(permissions);

      const controls = document.querySelectorAll(ALL_SITES_BUTTON);
      expect(controls).toHaveLength(1);

      const allSites = controls[0] as HTMLButtonElement;
      expect(allSites.textContent).toBe("All sites");
      expect(allSites.type).toBe("button");
      // Reuses the bar's host-hardened button styling rather than adding CSS.
      expect(allSites.className).toBe("rcf-editor-banner-dismiss");

      const buttons = Array.from(
        document.querySelectorAll("#rcf-editor-banner button"),
      );
      const done = document.querySelector(DONE_BUTTON);
      const publish = document.querySelector(
        '#rcf-editor-banner button[aria-label="Publish"]',
      );
      expect(buttons.indexOf(allSites)).toBeLessThan(buttons.indexOf(done!));
      if (publish) {
        expect(buttons.indexOf(allSites)).toBeLessThan(
          buttons.indexOf(publish),
        );
      }
    },
  );

  it("goes to /edit on the ReCopyFast origin the widget talks to", async () => {
    // jsdom implements only same-document (fragment) navigation; any other
    // assignment to `location.href` is logged as "not implemented" and the URL
    // stays put. So for this one test the API sits on the page's own origin
    // (jsdom's `http://localhost`, not the `helloworld.com` of the others), and
    // the page is parked one fragment away from the expected destination: the
    // URL can only change if the control navigated to exactly `<api>/edit` —
    // any other path, query or origin leaves it where it is.
    const api = `${window.location.origin}/api`;
    (window as unknown as { RECOPYFAST_API: string }).RECOPYFAST_API = api;
    await bootWithGrant(["view", "edit"]);
    window.history.replaceState(null, "", "/edit#before-all-sites");

    (document.querySelector(ALL_SITES_BUTTON) as HTMLButtonElement).click();

    expect(window.location.href).toBe(`${window.location.origin}/edit`);
    expect(window.location.href).toBe(new URL("/edit", api).toString());
  });

  it("never throws into the host page, even when the URL cannot be built", async () => {
    await bootWithGrant(["view", "edit"]);
    const uncaught = jest.fn();
    window.addEventListener("error", uncaught);
    const RealURL = window.URL;

    try {
      (window as unknown as { URL: unknown }).URL = function BrokenURL() {
        throw new TypeError("Invalid URL");
      };
      (document.querySelector(ALL_SITES_BUTTON) as HTMLButtonElement).click();
    } finally {
      window.URL = RealURL;
      window.removeEventListener("error", uncaught);
    }

    expect(uncaught).not.toHaveBeenCalled();
    expect(document.querySelector("#rcf-editor-banner")).not.toBeNull();
  });

  it("does not exist without a verified grant — there is no bar to put it on", async () => {
    installFetch({});
    new Function(WIDGET_SOURCE)();
    await settle();

    expect(document.querySelector("#rcf-editor-banner")).toBeNull();
    expect(document.querySelector(ALL_SITES_BUTTON)).toBeNull();
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
