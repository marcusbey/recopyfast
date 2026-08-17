import { expect, test, type Page, type Request } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

/**
 * ADR 004 rule 2 — realtime is provably additive.
 *
 * "With the WebSocket service stopped, editing, saving, staging and publishing
 * must all still work with no user-visible error." That is the reason `s07a`
 * can ship before `s07b`: the service being down, undeployed, or misconfigured
 * must be indistinguishable from its absence, on the customer's own domain,
 * where we have no error surface at all (AGENTS.md non-negotiable 4).
 *
 * The drill runs the same page twice with the realtime service NOT running:
 *
 *   - AC 6, no `data-ws-url` at all — a snippet issued before `s07`. The widget
 *     must take the early return at recopyfast.src.js:2703, and in particular
 *     must not fetch `/embed/socket.io-client.min.js`: that fallback loader is
 *     dead code today and turning realtime on is what wakes it (ADR 004 names
 *     lazy-loading from our origin as *the* rejected option, because our origin
 *     is not the customer's `'self'`).
 *
 *   - AC 5, `data-ws-url` pointing at a port with nothing behind it. The widget
 *     must fail to connect and carry on: no uncaught exception reaching the host
 *     page, no error rendered into the customer's DOM, the authored copy still
 *     on screen, and the HTTP content path still exercised.
 *
 * The mutating half of AC 5 — that a save, a stage and a publish all land — is
 * `share-edit-publish.spec.ts`, which needs a disposable Supabase project and is
 * gated behind RUN_RECOPYFAST_CORE_E2E for that reason. Everything in this file
 * is assertable without a database, so it is not gated: the point of a drill you
 * only run when someone remembers to set an env var is largely lost.
 */

const APP_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const TARGET_PORT = Number(process.env.RECOPYFAST_ADDITIVE_PORT || "4321");
const TARGET_URL = `http://localhost:${TARGET_PORT}`;

/**
 * A port nothing is listening on.
 *
 * Bound and immediately released so the number is real and free, rather than a
 * hard-coded guess that might be someone's dev server. This is what "the
 * realtime service is stopped" means for AC 5 — not "unconfigured", which is
 * AC 6's case, but "configured and refusing connections".
 */
async function reserveClosedPort(): Promise<number> {
  const probe = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected a TCP address"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

test.describe("realtime is additive with the service stopped", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  const siteId = randomUUID();
  const siteToken = `${siteId}.${Math.floor(Date.now() / 1000)}.deadbeef`;

  let targetServer: Server;
  let closedPort: number;

  /**
   * Serve the customer's page ourselves.
   *
   * The widget is only meaningful on a third-party origin — that is the whole
   * shape of the product — and `data-ws-url` is an attribute of the snippet, so
   * the two variants have to be two different documents.
   */
  test.beforeAll(async () => {
    closedPort = await reserveClosedPort();

    targetServer = createServer((request, response) => {
      const withWs = (request.url || "").includes("ws=1");
      const wsAttribute = withWs
        ? `\n      data-ws-url="http://localhost:${closedPort}"`
        : "";

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head>
    <title>ReCopyFast additive drill</title>
    <script
      src="${APP_URL}/embed/recopyfast.js"
      data-site-id="${siteId}"
      data-site-token="${siteToken}"
      data-api-url="${APP_URL}/api"${wsAttribute}
    ></script>
  </head>
  <body>
    <main>
      <h1>Authored headline</h1>
      <p>Authored body copy.</p>
    </main>
  </body>
</html>`);
    });

    await new Promise<void>((resolve, reject) => {
      targetServer.once("error", reject);
      targetServer.listen(TARGET_PORT, () => {
        targetServer.off("error", reject);
        resolve();
      });
    });
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (!targetServer) {
        resolve();
        return;
      }
      targetServer.close(() => resolve());
    });
  });

  /** Everything the page tried to load, plus anything it threw. */
  function observe(page: Page) {
    const requests: string[] = [];
    const pageErrors: string[] = [];
    const socketAttempts: string[] = [];

    page.on("request", (request: Request) => {
      const url = request.url();
      requests.push(url);
      // socket.io opens with an HTTP polling handshake at
      // `<wsUrl>/socket.io/?EIO=4&transport=polling` before it ever upgrades,
      // so this fires even when the endpoint refuses the connection outright —
      // which is exactly the AC 5 case. It is the observable difference between
      // "the widget tried to connect" and "the widget never entered its
      // realtime bootstrap", and asserting on it is what stops the AC 6 case
      // passing vacuously: socket.io is compiled INTO the built artifact, so
      // "no request for socket.io-client.min.js" is true even of a widget that
      // connects on every page load.
      if (url.includes("/socket.io/")) socketAttempts.push(url);
    });
    page.on("websocket", (ws) => socketAttempts.push(ws.url()));
    page.on("pageerror", (error) => pageErrors.push(error.message));

    return { requests, pageErrors, socketAttempts };
  }

  /**
   * The host page must look exactly as its author wrote it.
   *
   * Not "no console noise" — console noise is allowed and sometimes required
   * (ADR 004: a silent degradation is a defect). What is not allowed is an
   * uncaught exception reaching the host page's window, the authored copy being
   * replaced or emptied, or anything of ours rendering an error into their DOM.
   */
  async function expectNoErrorSurface(page: Page, pageErrors: string[]) {
    expect(pageErrors).toEqual([]);
    await expect(page.locator("main h1")).toHaveText("Authored headline");
    await expect(page.locator("main p")).toHaveText("Authored body copy.");
    await expect(page.locator("#rcf-staging-banner")).toHaveCount(0);
    await expect(page.locator(".rcf-error, [data-rcf-error]")).toHaveCount(0);
  }

  test("AC 6 — a snippet with no data-ws-url never reaches for socket.io", async ({
    page,
  }) => {
    const { requests, pageErrors, socketAttempts } = observe(page);

    await page.goto(TARGET_URL, { waitUntil: "networkidle" });

    // The attribute is absent, so the widget's realtime bootstrap is not just
    // unable to connect — it is never entered.
    expect(await page.evaluate(() => window.RECOPYFAST_WS)).toBeFalsy();
    expect(socketAttempts).toEqual([]);

    // The trap ADR 004 names by name. This URL is derived from the embed's own
    // src at recopyfast.src.js:58 and is dead only for as long as the early
    // return holds; a request for it here means the widget started connecting
    // on a site that never asked for realtime.
    expect(
      requests.filter((url) => url.includes("socket.io-client.min.js")),
    ).toEqual([]);

    // The additive path is the one that must have run.
    expect(
      requests.filter((url) => url.includes(`/api/content/${siteId}`)),
    ).not.toEqual([]);

    await expectNoErrorSurface(page, pageErrors);
  });

  test("AC 5 — a snippet pointing at a stopped service still renders and still fetches over HTTP", async ({
    page,
  }) => {
    const { requests, pageErrors, socketAttempts } = observe(page);

    await page.goto(`${TARGET_URL}/?ws=1`, { waitUntil: "networkidle" });

    // Configured, and pointing at nothing — the deploy-is-down case, not the
    // never-deployed one.
    expect(await page.evaluate(() => window.RECOPYFAST_WS)).toBe(
      `http://localhost:${closedPort}`,
    );

    // The counterpart to AC 6's `toEqual([])`. This variant DOES try to
    // connect, which is what makes the pair a real discriminator rather than
    // two documents that happen to behave the same.
    await expect
      .poll(() => socketAttempts.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(
      socketAttempts.every((url) => url.includes(String(closedPort))),
    ).toBe(true);

    expect(
      requests.filter((url) => url.includes(`/api/content/${siteId}`)),
    ).not.toEqual([]);

    await expectNoErrorSurface(page, pageErrors);

    // And it stays that way: a failed connection must not escalate into a
    // rendering change a moment later, which is what an unhandled reconnection
    // rejection would look like from the customer's side.
    await page.waitForTimeout(3000);
    await expectNoErrorSurface(page, pageErrors);
  });
});

declare global {
  interface Window {
    RECOPYFAST_WS?: string;
  }
}
