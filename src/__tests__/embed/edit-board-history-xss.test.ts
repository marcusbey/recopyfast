/**
 * s72 — a version's author is shown as text, never run on the customer's site.
 *
 * The Edit Board's History tab built each card's "by <author>" line with
 * `innerHTML` from `content_versions.created_by` (s70a review, F1). That
 * author is a staging invite's address, which a site admin chose with no
 * format check and could verify without its mailbox, so an address shaped
 * like `<img src=x onerror=…>` ran on the customer's origin the moment a
 * staging-invite editor opened History — in the tab that holds the edit
 * link's bearer tokens. The restore panel in the same tab rendered the
 * server's refusal through `innerHTML` too, and printed the RPC's boolean as
 * "Restored true elements" on success.
 *
 * These tests boot the real source IIFE the way embed-ui-not-content.test.ts
 * does: a visitor's page, a stubbed `fetch`, a verified staging grant, a click
 * on the editor bar's "Edit Board", then on the "History" tab. They assert on
 * the elements created, not on a handler firing: jsdom loads no image, so an
 * `onerror` never fires here. The sentinel global is belt and braces.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-history";
const SITE_TOKEN = "site-token";
const API = "https://app.recopyfast.test/api";
const VERSION_ID = "version-1";
const CREATED_AT = "2026-10-08T09:00:00.000Z";
const EXPIRES_AT = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const PAYLOAD_AUTHOR = '<img src=x onerror="window.__rcfPwned=1">';

interface Version {
  id: string;
  version_number: number;
  description?: string;
  created_at: string;
  created_by?: string;
}

interface Reply {
  status: number;
  body: unknown;
}

interface Widget {
  stagingAccess: unknown;
  showStagingBanner(): void;
  destroy(): void;
}

function widget(): Widget {
  return (window as unknown as { ReCopyFast: Widget }).ReCopyFast;
}

function pwned(): unknown {
  return (window as unknown as { __rcfPwned?: unknown }).__rcfPwned;
}

function response({ status, body }: Reply) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function version(overrides: Partial<Version> = {}): Version {
  return {
    id: VERSION_ID,
    version_number: 1,
    description: "Manual snapshot",
    created_at: CREATED_AT,
    created_by: "editor@example.com",
    ...overrides,
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

function installFetch(listed: Version, restoreReply: Reply) {
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init?: { method?: string }) => {
      const method = init?.method || "GET";

      if (url.includes("/edit-board/history?") && method === "GET") {
        return response({ status: 200, body: { versions: [listed] } });
      }
      if (url.endsWith(`/edit-board/history/${VERSION_ID}`)) {
        return response(restoreReply);
      }
      if (url.includes("/staging/")) {
        return response({ status: 200, body: { content: [] } });
      }
      if (url.includes(`/content/${SITE_ID}?`) && method === "GET") {
        return response({ status: 200, body: [] });
      }
      return response({ status: 200, body: { success: true } });
    },
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

/**
 * A staging-invite editor opens Edit Board → History. Fake timers from the
 * boot on, never advanced: a restore's 1.5 s `location.reload` never runs.
 */
async function openHistory(
  listed: Version,
  restoreReply: Reply = { status: 200, body: { success: true } },
): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="host"><h1>Simple pricing</h1></main>';
  installFetch(listed, restoreReply);
  new Function(WIDGET_SOURCE)();
  await settle();
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });

  widget().stagingAccess = {
    kind: "staging",
    verified: true,
    email: "editor@example.com",
    permissions: ["view", "edit"],
    expiresAt: EXPIRES_AT,
  };
  widget().showStagingBanner();
  await flushMicrotasks();

  document.getElementById("rcf-edit-board-btn")!.click();
  await flushMicrotasks();

  const panel = document.getElementById("rcf-edit-board-panel")!;
  const historyTab = Array.from(panel.querySelectorAll("button")).find(
    (tab) => tab.textContent === "History",
  );
  historyTab!.click();
  await flushMicrotasks();

  // GUARD: the History tab loaded the stubbed version, so every absence
  // asserted below is the rendering, not an empty or failed tab.
  expect(panel.querySelector(".rcf-eb-card-title")?.textContent).toBe(
    "Version 1",
  );
  return panel;
}

async function restore(panel: HTMLElement) {
  const restoreButton = Array.from(panel.querySelectorAll("button")).find(
    (button) => button.textContent === "Restore",
  );
  expect(restoreButton).toBeDefined();
  restoreButton!.click();
  await flushMicrotasks();
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.body.style.paddingTop = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  for (const key of [
    "ReCopyFast",
    "recopyfast",
    "rcf",
    "RECOPYFAST_API",
    "RECOPYFAST_WS",
    "__rcfPwned",
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

describe("Edit Board → History renders a version's author as text", () => {
  it("an author shaped like markup creates no element and keeps the row's two items", async () => {
    const panel = await openHistory(version({ created_by: PAYLOAD_AUTHOR }));

    expect(panel.querySelectorAll("img")).toHaveLength(0);
    expect(pwned()).toBeUndefined();

    // The meta row is a flex container: a bare text run (the date) and one
    // span ("by …") are its two items, as the two spans were before.
    const meta = panel.querySelector(".rcf-eb-card-meta")!;
    const nodes = Array.from(meta.childNodes);
    expect(nodes.map((node) => node.nodeName)).toEqual(["#text", "SPAN"]);
    expect(nodes[0].textContent).toBe(
      new Date(CREATED_AT).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    expect(nodes[1].textContent).toBe("by " + PAYLOAD_AUTHOR);
  });

  it("a version with no author reads 'by Unknown' (pin)", async () => {
    const panel = await openHistory(version({ created_by: undefined }));

    const meta = panel.querySelector(".rcf-eb-card-meta")!;
    expect(meta.lastElementChild?.nodeName).toBe("SPAN");
    expect(meta.lastElementChild?.textContent).toBe("by Unknown");
  });

  it("a description shaped like markup stays text (pin of the existing textContent)", async () => {
    const panel = await openHistory(version({ description: "<img src=x>" }));

    expect(panel.querySelector(".rcf-eb-card-desc")?.textContent).toBe(
      "<img src=x>",
    );
    expect(panel.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("Edit Board → History → Restore renders the server's answer as text", () => {
  it("a refusal shaped like markup is shown as its literal text", async () => {
    const refusal = '<b id="rcf-err">Plan ended</b>';
    const panel = await openHistory(version(), {
      status: 402,
      body: { error: refusal },
    });

    await restore(panel);

    expect(document.getElementById("rcf-err")).toBeNull();
    expect(panel.querySelector(".rcf-eb-empty")?.textContent).toBe(refusal);
  });

  it("a successful restore reads 'Version restored', never the RPC's boolean", async () => {
    const panel = await openHistory(version(), {
      status: 200,
      body: { success: true, elementsRestored: true },
    });

    await restore(panel);

    expect(panel.querySelector(".rcf-eb-empty")?.textContent).toBe(
      "Version restored",
    );
    expect(panel.textContent).not.toContain("true");
  });
});
