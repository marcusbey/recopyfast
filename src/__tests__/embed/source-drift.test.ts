/**
 * s119 (ADR 075) — the widget notices a developer's deploy under an override.
 *
 * r/SideProject, 2026-10-21: the page said "5 to 10", the client published
 * "5 to 11", the developer deployed "5 to 9" — and the embed kept writing
 * "5 to 11" with nobody told. The widget already reads each element's live
 * authored text before it writes anything; the content GET now hands it
 * `source_seen` on edited rows. These tests boot the real source IIFE (as the
 * other embed suites do) and prove:
 *
 * - the override still reaches the page (visitors keep the client's words);
 * - the drifted element rides the ordinary discovery POST, once;
 * - a rescan — even after the coalescing window — does not re-report it;
 * - nothing is reported when the live text matches `source_seen`, or when the
 *   row is unedited (no `source_seen`), so ordinary pages stay silent.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-drift";
const SITE_TOKEN = "site-token";
const API = "https://app.recopyfast.test/api";
const ELEMENT_ID = "pricing-range";

interface Row {
  element_id: string;
  current_content: string;
  original_content: string;
  source_seen?: string;
}

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

interface Widget {
  rescan(): void;
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

function installFetch(rows: Row[], options: { failPosts?: boolean } = {}) {
  const recorded: Recorded[] = [];
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method || "GET";
      recorded.push({ url, method, body: init?.body });
      if (url.includes(`/content/${SITE_ID}?`) && method === "GET") {
        return response(200, rows);
      }
      if (url.includes("/ab-tests/active/")) {
        return response(200, { tests: [] });
      }
      if (method === "POST" && options.failPosts) {
        throw new TypeError("Failed to fetch");
      }
      return response(200, { success: true });
    },
  );
  return recorded;
}

function discoveryBodies(
  recorded: Recorded[],
): Array<Record<string, { content: string }>> {
  return recorded
    .filter(
      (request) =>
        request.method === "POST" &&
        request.url.endsWith(`/content/${SITE_ID}`),
    )
    .map((request) => JSON.parse(request.body || "{}"));
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function boot(rows: Row[], options: { failPosts?: boolean } = {}) {
  const recorded = installFetch(rows, options);
  new Function(WIDGET_SOURCE)();
  await settle();
  return recorded;
}

/** Past the 10 s discovery coalescing window, so it cannot mask a re-report. */
function leaveCoalescingWindow() {
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now + 60_000);
}

async function rescan() {
  widget().rescan();
  await settle();
}

function page(deployed: string) {
  document.body.innerHTML = `<main><p data-rcf-id="${ELEMENT_ID}">${deployed}</p></main>`;
  return document.querySelector(`[data-rcf-id="${ELEMENT_ID}"]`)!;
}

const overrideRow = (sourceSeen?: string): Row => ({
  element_id: ELEMENT_ID,
  original_content: "5 to 10",
  current_content: "5 to 11",
  ...(sourceSeen === undefined ? {} : { source_seen: sourceSeen }),
});

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
  jest.restoreAllMocks();
});

describe("source drift under a published override (ADR 075)", () => {
  it("the three-value scenario: the override stays on the page and the deployed text is reported once", async () => {
    const element = page("5 to 9");

    const recorded = await boot([overrideRow("5 to 10")]);

    expect(element.textContent).toBe("5 to 11");
    expect(discoveryBodies(recorded)).toEqual([
      { [ELEMENT_ID]: expect.objectContaining({ content: "5 to 9" }) },
    ]);
  });

  it("does not report the same drift again on a rescan, even after the coalescing window", async () => {
    const element = page("5 to 9");
    const recorded = await boot([overrideRow("5 to 10")]);

    leaveCoalescingWindow();
    await rescan();
    await rescan();

    expect(discoveryBodies(recorded)).toHaveLength(1);
    expect(element.textContent).toBe("5 to 11");
  });

  it("a later visitor on the same deploy reports nothing once the drift is recorded", async () => {
    const element = page("5 to 9");

    const recorded = await boot([overrideRow("5 to 9")]);

    expect(element.textContent).toBe("5 to 11");
    expect(discoveryBodies(recorded)).toEqual([]);
  });

  it("reports nothing when the live source still matches what the override was written against", async () => {
    const element = page("5 to 10");

    const recorded = await boot([overrideRow("5 to 10")]);

    expect(element.textContent).toBe("5 to 11");
    expect(discoveryBodies(recorded)).toEqual([]);
  });

  // Review M1: a site that server-renders the ADR 046 snapshot
  // (docs/architecture/published-snapshot.md) puts the served copy into its
  // HTML, so the text the embed reads first IS the override. That is not a
  // deploy: reporting it flagged every publish on such sites as a conflict.
  it("reports nothing when the page already renders the served copy (snapshot SSR)", async () => {
    const element = page("5 to 11");

    const recorded = await boot([overrideRow("5 to 10")]);
    leaveCoalescingWindow();
    await rescan();

    expect(element.textContent).toBe("5 to 11");
    expect(discoveryBodies(recorded)).toEqual([]);
  });

  it("reports nothing for an unedited row, whose deploy already shows", async () => {
    const element = page("5 to 9");

    const recorded = await boot([
      {
        element_id: ELEMENT_ID,
        original_content: "5 to 10",
        current_content: "5 to 10",
      },
    ]);
    leaveCoalescingWindow();
    await rescan();

    expect(element.textContent).toBe("5 to 9");
    expect(discoveryBodies(recorded)).toEqual([]);
  });

  it("reports nothing for an edited row the server sent no source_seen for", async () => {
    page("5 to 9");

    const recorded = await boot([overrideRow()]);

    expect(discoveryBodies(recorded)).toEqual([]);
  });

  it("retries a drift report whose POST failed, and the page keeps the override", async () => {
    const element = page("5 to 9");
    const recorded = await boot([overrideRow("5 to 10")], { failPosts: true });
    expect(discoveryBodies(recorded)).toHaveLength(1);

    leaveCoalescingWindow();
    await rescan();

    const bodies = discoveryBodies(recorded);
    expect(bodies).toHaveLength(2);
    expect(bodies[1][ELEMENT_ID]).toEqual(
      expect.objectContaining({ content: "5 to 9" }),
    );
    expect(element.textContent).toBe("5 to 11");
  });
});
