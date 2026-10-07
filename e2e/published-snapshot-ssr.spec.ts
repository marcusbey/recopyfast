import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServer, type Server } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import {
  createLocalServiceRoleClient,
  deleteCapturedSiteFixture,
} from "./support/local-supabase";
import { withCoreSetupDiagnostic } from "./support/core-setup-diagnostics";

/**
 * s65a — published copy rendered by the host shows no flash (ADR 046).
 *
 * The embed alone cannot be flash-free: the browser paints the authored HTML
 * before any script can fetch published copy (production content GET median
 * 497–589 ms). The snapshot route exists so a host can put published copy
 * into its own HTML. This spec is that integration, end to end, in a real
 * browser against the real app and a disposable local Supabase:
 *
 *   1. a host server fetches `GET /api/published/<site>?page=…` server-side
 *      and renders the row's `current_content` into an `<h1 data-rcf-id>`;
 *   2. the real embed boots on that page, hydrates from the content GET and
 *      settles (`window.ReCopyFast.isInitialized`);
 *   3. a MutationObserver installed before any page script recorded no text
 *      change on the anchored element, and the stored row — `original_content`
 *      included — is byte-for-byte what was seeded: the embed did not record
 *      published copy as authored copy.
 *
 * The same test first loads an authored-copy page under the same observer
 * and requires it to record the swap. Without that control, "zero changes"
 * would also pass against an observer that never fired or an embed that never
 * hydrated.
 *
 * Realtime is left off (no `data-ws-url`): it is opt-in and unset on real
 * installs, and the no-flash property must not depend on it.
 */

const APP_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const TARGET_PORT = Number(
  process.env.RECOPYFAST_SNAPSHOT_TARGET_PORT || "4175",
);
const TARGET_URL = `http://localhost:${TARGET_PORT}`;

const ELEMENT_ID = "s65a-hero";
const ANCHOR = `[data-rcf-id="${ELEMENT_ID}"]`;
const AUTHORED_TEXT = "Authored hero copy";
const PUBLISHED_TEXT = "Published hero copy, rendered by the host";

interface SeededRow {
  original_content: string | null;
  published_content: string | null;
  current_content: string | null;
  staging_content: string | null;
  page_path: string | null;
}

const SEEDED_ROW: SeededRow = {
  original_content: AUTHORED_TEXT,
  published_content: PUBLISHED_TEXT,
  current_content: PUBLISHED_TEXT,
  staging_content: null,
  // An author-declared `data-rcf-id` is a shared id: discovery stores it with
  // no page path, and every page read includes it.
  page_path: null,
};

interface TextChange {
  type: string;
  text: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

test.describe("published snapshot rendered by the host", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  let supabase: SupabaseClient | null = null;
  let targetServer: Server | null = null;

  const siteId = randomUUID();
  const siteApiKey = `e2e_key_${randomUUID()}`;
  // `<siteId>.<issuedAt>.<HMAC-SHA256(siteId.issuedAt, apiKey)>`, built here
  // rather than imported so the spec pins the wire format (see
  // share-edit-publish.spec.ts).
  const siteToken = (() => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const payload = `${siteId}.${issuedAt}`;
    const signature = createHmac("sha256", siteApiKey)
      .update(payload)
      .digest("hex");
    return `${payload}.${signature}`;
  })();
  const snapshotPath = `${APP_URL}/api/published/${siteId}`;
  // `page=%2F&language=en&variant=default`: the one spelling the route keys on.
  const snapshotUrl = `${snapshotPath}?${new URLSearchParams([
    ["page", "/"],
    ["language", "en"],
    ["variant", "default"],
  ]).toString()}`;

  /**
   * Abuse AC as amended on 2026-10-07 (ADR 046), checked on the running app
   * rather than on the parser: the route test hands the parser the raw query,
   * which a deployed Next server never does. Next re-serializes the query
   * before the handler runs, so the two lists below are what an outside caller
   * actually gets.
   *
   * Refused (400, `no-store`, never edge-cached): another parameter set or
   * order. These survive Next's re-serialization and must still cost nothing.
   */
  const REFUSED_QUERIES: Record<string, string> = {
    reordered: "language=en&page=%2F&variant=default",
    extra: "page=%2F&language=en&variant=default&cb=1",
    duplicated: "page=%2F&page=%2F&language=en&variant=default",
    missing: "page=%2F&language=en",
  };

  /**
   * Served as the canonical key (same bytes, same ETag): percent-encoding
   * spellings of the same values. Next hands the handler the canonical query,
   * and the owner decided not to refuse them (canonicalization saves CDN
   * entries; the IP limiter is the abuse bound). If this starts answering 400,
   * someone has changed that decision without amending the AC and ADR 046.
   */
  const CANONICAL_EQUIVALENT_QUERIES: Record<string, string> = {
    "lowercase %2f": "page=%2f&language=en&variant=default",
    "literal /": "page=/&language=en&variant=default",
  };

  test.beforeAll(async () => {
    supabase = await withCoreSetupDiagnostic("create local client", () =>
      createLocalServiceRoleClient("RUN_RECOPYFAST_CORE_E2E"),
    );
    await withCoreSetupDiagnostic("seed site", () => seedSite());
    targetServer = await withCoreSetupDiagnostic("start target server", () =>
      startHostServer(),
    );
  });

  test.afterAll(async () => {
    try {
      if (supabase) await deleteCapturedSiteFixture(supabase, siteId);
    } finally {
      await new Promise<void>((resolve) => {
        if (!targetServer) {
          resolve();
          return;
        }
        targetServer.close(() => resolve());
      });
    }
  });

  test("server-rendered published copy is not changed by the embed and is never stored as authored", async ({
    page,
    request,
  }) => {
    // The snapshot itself, as any host fetches it: no token, no Origin.
    const snapshot = await request.get(snapshotUrl);
    expect(snapshot.status()).toBe(200);
    expect(snapshot.headers()["set-cookie"]).toBeUndefined();
    const canonicalText = await snapshot.text();
    const canonicalEtag = snapshot.headers()["etag"];
    expect(canonicalEtag).toMatch(/^"[0-9a-f]{64}"$/);
    const body = JSON.parse(canonicalText) as {
      rows: Array<{ element_id: string; current_content: string }>;
    };
    expect(
      body.rows.find((row) => row.element_id === ELEMENT_ID)?.current_content,
    ).toBe(PUBLISHED_TEXT);

    for (const [form, query] of Object.entries(REFUSED_QUERIES)) {
      const refused = await request.get(`${snapshotPath}?${query}`);
      expect(refused.status(), `${form} query`).toBe(400);
      expect(refused.headers()["cache-control"], `${form} query`).toBe(
        "no-store",
      );
      expect(
        refused.headers()["vercel-cdn-cache-control"],
        `${form} query`,
      ).toBeUndefined();
    }

    for (const [form, query] of Object.entries(CANONICAL_EQUIVALENT_QUERIES)) {
      const equivalent = await request.get(`${snapshotPath}?${query}`);
      expect(equivalent.status(), `${form} spelling`).toBe(200);
      expect(equivalent.headers()["etag"], `${form} spelling`).toBe(
        canonicalEtag,
      );
      expect(await equivalent.text(), `${form} spelling`).toBe(canonicalText);
    }

    await installTextObserver(page);

    // Control: authored copy in the HTML. The embed must swap it, and the
    // observer must see the swap.
    const authoredChanges = await loadAndSettle(page, `${TARGET_URL}/authored`);
    expect(authoredChanges.length).toBeGreaterThan(0);
    await expect(page.locator(ANCHOR)).toHaveText(PUBLISHED_TEXT);

    // The integration: published copy already in the HTML.
    const ssrChanges = await loadAndSettle(page, `${TARGET_URL}/`);
    expect(ssrChanges).toEqual([]);
    await expect(page.locator(ANCHOR)).toHaveText(PUBLISHED_TEXT);

    expect(await storedRows()).toEqual([
      { element_id: ELEMENT_ID, ...SEEDED_ROW },
    ]);
  });

  /**
   * Records every text change on the anchored element from the first byte of
   * the document. Parser insertions only ever add nodes; a swap removes the old
   * text node (`textContent =`) or rewrites it (characterData). Additions after
   * the document is parsed count too.
   */
  async function installTextObserver(target: Page) {
    await target.addInitScript((anchorSelector: string) => {
      const changes: Array<{ type: string; text: string | null }> = [];
      (window as unknown as { __rcfTextChanges: unknown }).__rcfTextChanges =
        changes;
      let isParsed = false;
      document.addEventListener("DOMContentLoaded", () => {
        isParsed = true;
      });
      new MutationObserver((records) => {
        const anchor = document.querySelector(anchorSelector);
        if (!anchor) return;
        for (const record of records) {
          if (record.target !== anchor && !anchor.contains(record.target)) {
            continue;
          }
          const isTextChange =
            record.type === "characterData" ||
            (record.type === "childList" &&
              (record.removedNodes.length > 0 ||
                (isParsed && record.addedNodes.length > 0)));
          if (isTextChange) {
            changes.push({ type: record.type, text: anchor.textContent });
          }
        }
      }).observe(document, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }, ANCHOR);
  }

  async function loadAndSettle(
    target: Page,
    url: string,
  ): Promise<TextChange[]> {
    const hydrated = target.waitForResponse(
      (response) =>
        response.url().startsWith(`${APP_URL}/api/content/${siteId}?`) &&
        response.request().method() === "GET",
    );
    await target.goto(url);
    const contentResponse = await hydrated;
    expect(contentResponse.status()).toBe(200);
    await target.waitForFunction(
      () =>
        (window as unknown as { ReCopyFast?: { isInitialized?: boolean } })
          .ReCopyFast?.isInitialized === true,
    );
    return target.evaluate(
      () =>
        (window as unknown as { __rcfTextChanges: TextChange[] })
          .__rcfTextChanges,
    );
  }

  async function storedRows() {
    if (!supabase)
      throw new Error("Snapshot E2E Supabase client is not ready.");
    const { data, error } = await supabase
      .from("content_elements")
      .select(
        "element_id, original_content, published_content, current_content, staging_content, page_path",
      )
      .eq("site_id", siteId);
    if (error) throw error;
    return data;
  }

  async function seedSite() {
    if (!supabase)
      throw new Error("Snapshot E2E Supabase client is not ready.");

    const { error: siteError } = await supabase.from("sites").insert({
      id: siteId,
      domain: TARGET_URL,
      name: "ReCopyFast snapshot E2E host",
      api_key: siteApiKey,
    });
    if (siteError) throw siteError;

    const { error: rowError } = await supabase.from("content_elements").insert({
      site_id: siteId,
      element_id: ELEMENT_ID,
      selector: ANCHOR,
      language: "en",
      variant: "default",
      metadata: {},
      ...SEEDED_ROW,
    });
    if (rowError) throw rowError;
  }

  function hostHtml(heading: string): string {
    return `<!doctype html>
<html>
  <head>
    <title>ReCopyFast snapshot host</title>
    <script
      src="${APP_URL}/embed/recopyfast.js"
      data-site-id="${siteId}"
      data-site-token="${siteToken}"
      data-api-url="${APP_URL}/api"
    ></script>
  </head>
  <body>
    <main>
      <h1 data-rcf-id="${ELEMENT_ID}">${escapeHtml(heading)}</h1>
    </main>
  </body>
</html>`;
  }

  /**
   * The host. `/` renders published copy fetched from the snapshot at request
   * time — what an integrator's server, edge function or build does. Any
   * failure falls back to authored copy, never to an error page.
   */
  async function startHostServer() {
    const server = createServer((incoming, response) => {
      const respond = (heading: string) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(hostHtml(heading));
      };

      if (incoming.url === "/authored") {
        respond(AUTHORED_TEXT);
        return;
      }

      fetch(snapshotUrl)
        .then(async (snapshotResponse) => {
          if (!snapshotResponse.ok) return AUTHORED_TEXT;
          const snapshotBody = (await snapshotResponse.json()) as {
            rows: Array<{ element_id: string; current_content: string }>;
          };
          return (
            snapshotBody.rows.find((row) => row.element_id === ELEMENT_ID)
              ?.current_content || AUTHORED_TEXT
          );
        })
        .catch(() => AUTHORED_TEXT)
        .then(respond);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(TARGET_PORT, () => {
        server.off("error", reject);
        resolve();
      });
    });

    return server;
  }
});
