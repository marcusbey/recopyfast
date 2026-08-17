/**
 * The lapsed handoff link — the one state the widget did not handle.
 *
 * A handoff code is single-use and dead sixty seconds after it is minted. Open
 * the link twice, or open it slowly, and `redeem()` is refused. When this
 * browser also holds no grant (the first visit, which is the common case for
 * the link a client was just sent), `boot()` returned `{ status: 'anonymous' }`
 * and the widget did nothing at all: no banner, no modal, no message. The
 * person was told to click a link, clicked it, and got an ordinary page.
 *
 * This is NOT the revoked case, and the difference matters. Nothing has been
 * verified and nothing is being confirmed or denied about the address — only
 * that the link itself is spent — so the enumeration guarantee is untouched.
 * The revoked case stays deliberately silent; see `nextActionFor`'s "hide".
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
const STORAGE_KEY = `rcf_editor_grant:${SITE_ID}`;
const NEUTRAL_NOTICE =
  "If that address can edit this site, a code is on its way.";

function installFetch(
  routes: Record<string, { status?: number; body: unknown }>,
) {
  const impl = jest.fn(async (url: string) => {
    for (const [fragment, response] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        const status = response.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => response.body,
        };
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

function modal(): HTMLElement | null {
  return document.querySelector(".rcf-modal");
}

describe("a handoff link that has already been spent", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>Hello world</h1>";
    document.body.style.paddingTop = "";
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing?rcf_handoff=SPENT-CODE");
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

  it("says the link needs refreshing instead of saying nothing", async () => {
    installFetch({
      "editor/handoff/redeem": {
        status: 401,
        body: { ok: false, reason: "consumed" },
      },
    });

    new Function(WIDGET_SOURCE)();
    await settle();

    const dialog = modal();
    expect(dialog).not.toBeNull();

    const text = dialog!.textContent || "";
    expect(text).toContain("That link needs refreshing");
    expect(text).toContain("Links like this work once");
    // It says nothing about whether any address is an editor here.
    expect(text).not.toMatch(/revoked|no longer|access ended/i);
  });

  it("offers the same way back in: an email, then a code", async () => {
    installFetch({
      "editor/handoff/redeem": {
        status: 401,
        body: { ok: false, reason: "expired" },
      },
      "editor/request-code": { body: { ok: true, message: NEUTRAL_NOTICE } },
    });

    new Function(WIDGET_SOURCE)();
    await settle();

    const email = document.querySelector(
      "#rcf-editor-email",
    ) as HTMLInputElement;
    expect(email).not.toBeNull();
    email.value = "bob@example.com";

    const send = document.querySelector(
      ".rcf-modal-btn-primary",
    ) as HTMLButtonElement;
    send.click();
    await settle();

    // The server's message is neutral by design and is shown verbatim.
    // Rewriting it into "code sent!" would claim more than the response does,
    // and would rebuild the existence oracle the route was changed to close.
    expect(modal()!.textContent).toContain(NEUTRAL_NOTICE);
    expect(
      (document.querySelector("#rcf-editor-code") as HTMLElement).style.display,
    ).toBe("block");
  });

  it("stays quiet when this browser already holds a working grant", async () => {
    // The ordinary cause of a refused code is a reloaded page or a re-shared
    // URL, and the editor behind it is still signed in. Interrupting them with
    // a modal would be a regression, not a fix.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        grant: "rcfg1.already-held",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        email: "bob@example.com",
        permissions: ["view", "edit"],
        remembered: true,
      }),
    );

    installFetch({
      "editor/handoff/redeem": {
        status: 401,
        body: { ok: false, reason: "consumed" },
      },
      "editor/validate-grant": {
        body: {
          valid: true,
          email: "bob@example.com",
          permissions: ["view", "edit"],
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          shouldRefresh: false,
        },
      },
    });

    new Function(WIDGET_SOURCE)();
    await settle();

    expect(modal()).toBeNull();
    expect(document.querySelector("#rcf-editor-banner")).not.toBeNull();
  });

  it("stays quiet for a visitor who never had a link at all", async () => {
    window.history.replaceState(null, "", "/pricing");
    installFetch({});

    new Function(WIDGET_SOURCE)();
    await settle();

    expect(modal()).toBeNull();
  });
});

describe("off-brand values in the file s14a already had to edit", () => {
  // Not new design work: pre-existing drift the design system already forbids,
  // corrected in the same pass rather than left as a follow-up nobody does.
  // Literal values with the token they came from, per design-system.md — the
  // widget has no token layer and s06 owns closing that.

  it("outlines a hoverable element in the brand accent, not Tailwind blue-500", () => {
    expect(WIDGET_SOURCE).toContain(
      "outline: 2px dashed hsl(174 48% 58% / 0.7) !important;",
    );
    expect(WIDGET_SOURCE).not.toContain(
      "outline: 2px dashed rgba(59, 130, 246, 0.6) !important;",
    );
    // Scoped to the outline the design names. `.rcf-field-panel input:focus`
    // still carries the same blue-500 literal and is deliberately left alone:
    // it is not one of the three corrections this story scoped, and s06 owns
    // the widget's token layer.
  });

  it("fills the verification modal's icon tile flat — no gradient, ever", () => {
    expect(WIDGET_SOURCE).not.toContain("rgba(45, 212, 191, 0.2)");
    expect(WIDGET_SOURCE).toContain("hsl(174 48% 58% / 0.16)");
  });

  it("fills the hover hint flat too", () => {
    expect(WIDGET_SOURCE).not.toContain(
      "linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)",
    );
    expect(WIDGET_SOURCE).toContain("background: hsl(200 18% 10% / 0.95);");
  });
});
