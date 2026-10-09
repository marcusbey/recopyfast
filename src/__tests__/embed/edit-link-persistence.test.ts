/**
 * s41: an edit link keeps working as its holder clicks through the site.
 *
 * The owner's "Edit website" link (`rcf_edit_token`) and a Share Preview Link
 * (`rcf_staging=1&rcf_token`) carried their credential in page memory only. The
 * widget stripped it from the address bar on arrival and never wrote it down,
 * so every later full-page load in the tab — an internal link, a reload, Edit
 * Board's own restore reload — booted as a visitor. The feature these links
 * exist for, editing a site rather than one page of it, stopped at the first
 * click. ADR 036 moves the credential into the tab's sessionStorage.
 *
 * Each "page load" below is a fresh `boot(url)`: the document, the widget
 * globals, the script tag and fetch are rebuilt, and the widget source runs
 * again from the top. sessionStorage is cleared only in `beforeEach`, so it
 * survives between boots in one test exactly as it survives between page loads
 * in one tab. That is the level the bug lives at.
 *
 * s76 (ADR 055): the owner's link no longer carries the token. It lands as
 * `#rcf_edit=<code>`; the widget sends the code as its boot check's
 * `editToken`, and the answer carries the session's token, which is what the
 * tab keeps. The stand-in server below answers a code `rcfl1.<t>` with the
 * token `<t>`, so `link("real")` lands a tab holding "real". `?rcf_edit_token=`
 * is not read at all any more: see "the legacy query link".
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-abc";
const SITE_TOKEN = "site-token-xyz";
const ORIGIN = "https://app.recopyfast.test";
const API = `${ORIGIN}/api`;
const EXPIRES_AT = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const EDIT_LINK_KEY = `rcf_edit_link:${SITE_ID}`;

/** The owner's edit link as the dashboard opens it since s76. */
function link(token: string, path = "/") {
  return `${path}#rcf_edit=rcfl1.${token}`;
}

type Reply = { status: number; body: unknown } | "network";

const VALID: Reply = {
  status: 200,
  body: {
    valid: true,
    verified: true,
    email: "owner@example.com",
    permissions: ["view", "edit", "publish"],
    expiresAt: EXPIRES_AT,
  },
};

interface WidgetInstance {
  editMode: boolean;
  stagingMode: boolean;
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

function installFetch(validate: Reply) {
  const impl = jest.fn(async (url: string, options?: { body?: string }) => {
    if (url.includes("editor/validate-grant")) {
      return response(200, {
        valid: true,
        email: "editor@example.com",
        permissions: ["view", "edit"],
        expiresAt: EXPIRES_AT,
        shouldRefresh: false,
      });
    }
    if (url.includes("/staging/validate")) {
      if (validate === "network") throw new Error("network unavailable");
      // The boot check spends an edit-link code (POST /api/staging/validate,
      // s76): a valid answer carries the session's token.
      const sent = JSON.parse(options?.body ?? "{}");
      if (
        validate.status === 200 &&
        typeof sent.editToken === "string" &&
        sent.editToken.startsWith("rcfl1.")
      ) {
        return response(200, {
          ...(validate.body as object),
          editToken: sent.editToken.slice("rcfl1.".length),
        });
      }
      return response(validate.status, validate.body);
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

/** One full-page load in the same tab. Never clears sessionStorage. */
async function boot(url: string, validate: Reply = VALID) {
  // A real navigation discards the previous page's widget; jsdom cannot, and
  // an edit-mode instance keeps a document-level click handler that would
  // answer the next page's clicks first. Lock it, as an unloaded page would be.
  // And stop it (s67): its MutationObserver would otherwise take this page's
  // DOM and URL for an in-app navigation and fetch them with its own token.
  const previous = (window as unknown as Record<string, unknown>).ReCopyFast as
    | { isMutationLocked: boolean; destroy(): void }
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
  installScriptTag();
  const fetch = installFetch(validate);
  new Function(WIDGET_SOURCE)();
  await settle();
  return fetch;
}

type FetchMock = Awaited<ReturnType<typeof boot>>;

/** The JSON bodies this page load POSTed to /staging/validate. */
function validateBodies(fetch: FetchMock): Array<Record<string, unknown>> {
  return fetch.mock.calls
    .filter(([url]) => String(url).includes("/staging/validate"))
    .map((call) => {
      const options = (call as unknown[])[1] as { body?: string } | undefined;
      return JSON.parse(options?.body ?? "{}");
    });
}

/** The URLs this page load read staging content from. */
function stagingReads(fetch: FetchMock): string[] {
  return fetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes("/staging/content/"));
}

function storedEditLink(): unknown {
  const raw = window.sessionStorage.getItem(EDIT_LINK_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function editLinkKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.sessionStorage.length; i++) {
    const key = window.sessionStorage.key(i);
    if (key && key.startsWith("rcf_edit_link:")) keys.push(key);
  }
  return keys;
}

/**
 * Anything that escapes the widget lands in the host page's `window`
 * (non-negotiable #4). A synchronous throw at parse time would already fail
 * `boot` itself; these catch what escapes from callbacks and promises.
 */
function watchHostPage() {
  const escaped: Event[] = [];
  const record = (event: Event) => escaped.push(event);
  window.addEventListener("error", record);
  window.addEventListener("unhandledrejection", record);
  return {
    escaped,
    stop() {
      window.removeEventListener("error", record);
      window.removeEventListener("unhandledrejection", record);
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest.spyOn(window, "alert").mockImplementation(() => {});
  jest.spyOn(window, "open").mockImplementation(() => null);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the retired email-capture step", () => {
  it("never renders an email prompt, even if validate asks for one", async () => {
    const hostErrors: unknown[] = [];
    const onError = (event: Event) => hostErrors.push(event);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);

    try {
      await boot("/pricing?rcf_staging=1&rcf_token=tok", {
        status: 200,
        body: {
          valid: true,
          verified: false,
          requiresEmail: true,
          permissions: [],
        },
      });
    } finally {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
    }

    expect(document.querySelector("#rcf-email-input")).toBeNull();
    expect(document.querySelector("#rcf-email-submit")).toBeNull();
    expect(widget().editMode).toBe(false);
    expect(hostErrors).toHaveLength(0);
  });
});

describe("an edit link survives full-page loads in the same tab", () => {
  it("keeps the owner's edit session in sessionStorage, and nowhere else", async () => {
    await boot(link("real"));

    expect(widget().editMode).toBe(true);
    // The strip still runs first: the code leaves the address bar.
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    // What the tab keeps is the token the boot check answered, not the code.
    expect(storedEditLink()).toEqual([null, "real"]);
    // Never localStorage: an unbound bearer token must not outlive the tab.
    expect(window.localStorage.length).toBe(0);
  });

  it("boots the next page of the site in edit mode with the same credential", async () => {
    const first = await boot(link("real"));
    const second = await boot("/about");

    expect(widget().stagingMode).toBeTruthy();
    expect(widget().editMode).toBe(true);
    expect(validateBodies(second)).toEqual([
      expect.objectContaining({ editToken: "real", siteId: SITE_ID }),
    ]);
    // Exactly as on the first page: the widget's own reads still carry the
    // token to RecopyFast's API (s76 follow-up), and nothing was added to the
    // address bar.
    expect(stagingReads(first)[0]).toContain("rcf_edit_token=real");
    expect(stagingReads(second)[0]).toContain("rcf_edit_token=real");
    expect(window.location.search).toBe("");
  });

  it("keeps a share link in staging mode on the next page", async () => {
    await boot("/?rcf_staging=1&rcf_token=share");
    expect(storedEditLink()).toEqual(["share", null]);

    const second = await boot("/about");

    expect(document.querySelector("#rcf-staging-banner")).not.toBeNull();
    expect(validateBodies(second)).toEqual([
      expect.objectContaining({ token: "share", siteId: SITE_ID }),
    ]);
  });

  it("lets a new link replace the stored session", async () => {
    await boot(link("old"));
    const replaced = await boot(link("new"));

    expect(storedEditLink()).toEqual([null, "new"]);
    expect(validateBodies(replaced)).toEqual([
      expect.objectContaining({ editToken: "rcfl1.new" }),
    ]);

    const next = await boot("/about");
    expect(validateBodies(next)).toEqual([
      expect.objectContaining({ editToken: "new" }),
    ]);
  });

  it("never stores an orphan rcf_token that came without rcf_staging=1", async () => {
    await boot("/?rcf_token=orphan");

    expect(editLinkKeys()).toEqual([]);
    expect(widget().editMode).toBe(false);
  });

  it("ignores a credential stored for another site on this origin", async () => {
    window.sessionStorage.setItem(
      "rcf_edit_link:other-site",
      JSON.stringify([null, "someone-elses"]),
    );

    const fetch = await boot("/about");

    expect(widget().stagingMode).toBeFalsy();
    expect(widget().editMode).toBe(false);
    expect(validateBodies(fetch)).toEqual([]);
  });

  it("writes no edit-link key for an invited editor on a device grant", async () => {
    window.localStorage.setItem(
      `rcf_editor_grant:${SITE_ID}`,
      JSON.stringify({
        grant: "rcfg1.the-device-grant",
        expiresAt: EXPIRES_AT,
        email: "editor@example.com",
        permissions: ["view", "edit"],
        remembered: true,
      }),
    );

    await boot("/about");

    expect(widget().editMode).toBe(true);
    expect(editLinkKeys()).toEqual([]);
  });
});

describe("storage that is blocked, throws or holds garbage", () => {
  const originalSessionStorage = Object.getOwnPropertyDescriptor(
    window,
    "sessionStorage",
  );

  afterEach(() => {
    if (originalSessionStorage) {
      Object.defineProperty(window, "sessionStorage", originalSessionStorage);
    }
  });

  function breakStorage(how: string) {
    if (how === "sessionStorage getter") {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
      return;
    }
    jest
      .spyOn(Storage.prototype, how as "getItem" | "setItem")
      .mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      });
  }

  it.each(["getItem", "setItem", "sessionStorage getter"])(
    "still edits from the URL and degrades to a visitor when %s throws",
    async (how) => {
      breakStorage(how);
      const host = watchHostPage();

      try {
        await boot(link("real"));
        expect(widget().editMode).toBe(true);

        const second = await boot("/about");
        expect(widget().editMode).toBe(false);
        expect(validateBodies(second)).toEqual([]);
      } finally {
        host.stop();
      }

      expect(host.escaped).toHaveLength(0);
    },
  );

  it("keeps a throwing removeItem inside the widget when validate refuses", async () => {
    breakStorage("removeItem");
    const host = watchHostPage();

    try {
      await boot(link("real"));
      await boot("/about", { status: 401, body: { valid: false } });
    } finally {
      host.stop();
    }

    expect(widget().editMode).toBe(false);
    // The refusal is still reported as a refusal. A throw out of the clear
    // would land in initStagingMode's catch and misreport it as an outage.
    expect(document.body.textContent).toContain(
      "Invalid or expired staging link.",
    );
    expect(host.escaped).toHaveLength(0);
  });

  it("keeps a throwing removeItem inside the widget when a save is refused", async () => {
    await boot(link("real"));
    breakStorage("removeItem");
    (window.fetch as jest.Mock).mockImplementation(async () =>
      response(401, { error: "Expired" }),
    );
    const headline = document.querySelector("h1") as HTMLElement;
    const host = watchHostPage();

    try {
      headline.click();
      headline.textContent = "Typed draft";
      (document.querySelector(".rcf-btn-save") as HTMLButtonElement).click();
      await settle();
    } finally {
      host.stop();
    }

    // The terminal lock still lands: the clear sits before it, so a throw
    // there would leave a dead session looking editable.
    expect(headline.hasAttribute("contenteditable")).toBe(false);
    expect(headline.textContent).toBe("Typed draft");
    expect(host.escaped).toHaveLength(0);
  });

  it("treats a value that is not JSON as no credential", async () => {
    window.sessionStorage.setItem(EDIT_LINK_KEY, "not json");
    const host = watchHostPage();

    let fetch: FetchMock;
    try {
      fetch = await boot("/about");
    } finally {
      host.stop();
    }

    expect(widget().stagingMode).toBeFalsy();
    expect(widget().editMode).toBe(false);
    expect(validateBodies(fetch)).toEqual([]);
    expect(host.escaped).toHaveLength(0);
  });

  it.each(["{}", "[1,2]"])(
    "never throws into the host page on a stored %s",
    async (garbage) => {
      window.sessionStorage.setItem(EDIT_LINK_KEY, garbage);
      const host = watchHostPage();

      try {
        await boot("/about");
      } finally {
        host.stop();
      }

      expect(widget().editMode).toBe(false);
      expect(host.escaped).toHaveLength(0);
    },
  );
});

describe("forgetting the edit link when the server refuses it, and only then", () => {
  it.each([401, 403])(
    "forgets it on a %s from validate, says why once, then boots a visitor",
    async (status) => {
      await boot(link("real"));
      expect(storedEditLink()).toEqual([null, "real"]);

      await boot("/about", {
        status,
        body: { valid: false, error: "Invalid or expired staging token" },
      });

      expect(storedEditLink()).toBeNull();
      expect(widget().editMode).toBe(false);
      // The existing modal, unchanged: the editor learns why editing stopped
      // instead of silently becoming a visitor.
      expect(document.body.textContent).toContain(
        "Invalid or expired staging link.",
      );

      const third = await boot("/contact");
      expect(validateBodies(third)).toEqual([]);
      expect(widget().editMode).toBe(false);
      expect(document.body.textContent).not.toContain(
        "Invalid or expired staging link.",
      );
    },
  );

  it.each([
    ["a 500", { status: 500, body: { error: "Internal server error" } }],
    // What the server answers for a database outage since s76.
    [
      "a 503",
      {
        status: 503,
        body: {
          valid: false,
          error: "Editor access could not be checked. Try again.",
        },
      },
    ],
    ["a network failure", "network"],
  ] as const)("keeps it through %s: that is our outage", async (_, reply) => {
    await boot(link("real"));

    await boot("/about", reply as Reply);

    expect(storedEditLink()).toEqual([null, "real"]);

    const recovered = await boot("/contact");
    expect(validateBodies(recovered)).toEqual([
      expect.objectContaining({ editToken: "real" }),
    ]);
    expect(widget().editMode).toBe(true);
  });
});

describe("s76 — the owner's link carries a one-time code in its fragment", () => {
  it("sends the code once, to the boot check, and never anywhere else", async () => {
    const fetch = await boot(link("real", "/pricing"));

    expect(validateBodies(fetch)).toEqual([
      expect.objectContaining({ editToken: "rcfl1.real", siteId: SITE_ID }),
    ]);
    // Every other request of the page load carries the token it was answered,
    // never the code.
    const others = fetch.mock.calls.filter(
      ([url]) => !String(url).includes("/staging/validate"),
    );
    expect(others.length).toBeGreaterThan(0);
    expect(JSON.stringify(others)).not.toContain("rcfl1.");
    expect(stagingReads(fetch)[0]).toContain("rcf_edit_token=real");
  });

  it("strips the code and only the code from the address bar", async () => {
    await boot("/pricing?utm_source=mail#rcf_edit=rcfl1.real");

    expect(window.location.pathname).toBe("/pricing");
    expect(window.location.search).toBe("?utm_source=mail");
    expect(window.location.hash).toBe("");
    expect(widget().editMode).toBe(true);
  });

  it("leaves an ordinary fragment alone", async () => {
    const fetch = await boot("/pricing#plans");

    expect(window.location.hash).toBe("#plans");
    expect(widget().editMode).toBe(false);
    expect(validateBodies(fetch)).toEqual([]);
  });

  it("forgets a refused code and says why once", async () => {
    await boot(link("spent"), {
      status: 401,
      body: { valid: false, error: "Invalid or expired edit link" },
    });

    expect(storedEditLink()).toBeNull();
    expect(widget().editMode).toBe(false);
    expect(document.body.textContent).toContain(
      "Invalid or expired staging link.",
    );

    const next = await boot("/about");
    expect(validateBodies(next)).toEqual([]);
  });
});

describe("s76 — the legacy query link is a visitor load", () => {
  // Downgrade and fixation: `?rcf_edit_token=` put a 2–24 h token in a URL,
  // and a crafted one could push somebody else's session on whoever opened
  // it. The widget no longer reads the parameter at all.
  it("does not edit, validate or store anything from ?rcf_edit_token=", async () => {
    const fetch = await boot("/?rcf_edit_token=real");

    expect(widget().stagingMode).toBeFalsy();
    expect(widget().editMode).toBe(false);
    expect(validateBodies(fetch)).toEqual([]);
    expect(editLinkKeys()).toEqual([]);
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("real");
  });

  it("does not let a legacy link displace the session the tab holds", async () => {
    await boot(link("held"));
    const next = await boot("/?rcf_edit_token=planted");

    expect(storedEditLink()).toEqual([null, "held"]);
    expect(validateBodies(next)).toEqual([
      expect.objectContaining({ editToken: "held" }),
    ]);
  });
});

describe("Preview Live", () => {
  it("opens the visitor view without inheriting the tab's edit session", async () => {
    await boot("/pricing?rcf_staging=1&rcf_token=share");

    (document.querySelector("#rcf-preview-live") as HTMLButtonElement).click();

    // Per the HTML spec, a window.open that keeps its opener copies the
    // opener tab's sessionStorage, so "live" would open in staging mode.
    expect(window.open).toHaveBeenCalledTimes(1);
    const [url, target, features] = (window.open as jest.Mock).mock.calls[0];
    expect(target).toBe("_blank");
    expect(features).toBe("noopener");
    expect(String(url)).not.toMatch(/rcf_/);
  });
});
