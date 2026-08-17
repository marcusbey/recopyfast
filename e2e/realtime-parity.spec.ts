import {
  chromium,
  expect,
  test,
  type Page,
  type Request,
} from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServer, type Server } from "node:http";
import { createHmac, randomUUID } from "node:crypto";

/**
 * s07b AC 4 (the parity demo) and AC 6 carried to production (legacy snippets),
 * both driven against a fixture page on a **non-RecopyFast domain** — which is
 * the only place either claim means anything, since that is where the widget
 * actually lives.
 *
 * ## AC 4 — editors, not visitors
 *
 * Settled by [ADR 022](../docs/decisions/022-realtime-parity-is-editors-only.md):
 * parity is demonstrated between **two editors in an editing session on the same
 * page**, not between an editor and a passive viewer. Read literally AC 4 says
 * "viewing", but edits broadcast only to `site:{id}:staging` (server/index.js:462)
 * and a plain viewer sits in `site:{id}`, so the literal reading needs a new
 * broadcast path — one that `s08` AC 3 ("no editing session open ⇒ zero
 * WebSocket connections") would immediately require us to delete. No such path
 * is built here.
 *
 * ADR 022's **Watch** clause is why this asserts on *two distinct connections*
 * rather than merely on the second page's DOM: if staging rooms were ever scoped
 * per user instead of per site, a DOM-only assertion would keep passing on a
 * single client while proving nothing at all. So the listener is attached to
 * page B's own `socket` object and its `socket.id` is compared against A's.
 *
 * ## The measurement
 *
 * Timestamps are taken **inside the two pages**, not in the test process: the
 * budget is one second and a Playwright round trip is not part of what AC 4 is
 * measuring. `startedAt` is captured immediately before the editor's save — so
 * the interval covers the authoritative HTTP write *and* the fan-out, which is
 * what "an edit in A appears in B" means to the person watching.
 *
 * ## What a human still has to do — two of the three tests here
 *
 * **Only the legacy-snippet test is ungated and reaches CI.** Both of the others
 * — the HTTP-save regression and the parity measurement itself — are behind
 * `RUN_RECOPYFAST_PARITY=1`, because both need a Supabase project that the
 * **deployed** realtime service also reads (the service holds its own
 * service-role key), plus the deployed origins. Those are credentials, not code,
 * so they cannot run unattended in CI — see server/README.md for the one command
 * and the exact variables.
 *
 * Worth stating plainly, because the HTTP-save case below is written as a
 * regression guard and reads like one: it only guards for whoever sets the
 * variable. A gated test catches nothing on a branch nobody runs it on.
 */

const APP_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4001";
const FIXTURE_PORT = Number(process.env.RECOPYFAST_PARITY_PORT || "4176");
const FIXTURE_HOST = `localhost:${FIXTURE_PORT}`;
const FIXTURE_URL = `http://${FIXTURE_HOST}`;

/**
 * The seeded site's domain, and the only marker its rows carry.
 *
 * `.invalid` is reserved by RFC 2606 precisely so that it can never resolve, and
 * the run is stamped into the label. Two reasons, both about the day this goes
 * wrong rather than the day it works:
 *
 *  - **Recognisability.** The parity case seeds into the same project the
 *    deployed service reads, which in this deployment is production. If a crash
 *    leaves a row behind, whoever finds it must be able to tell at a glance that
 *    it is test debris and not a customer. `e2e-parity-…invalid` cannot be
 *    mistaken for either, and cannot be routed to by anything.
 *  - **Idempotence.** `sites.domain` is UNIQUE, so a fixed value turns leftover
 *    debris into a duplicate-key failure on the next run. `purgeParityDebris`
 *    sweeps the whole `e2e-parity-%.invalid` family before seeding, which makes
 *    the suite self-healing after a kill rather than permanently wedged.
 *
 * The host is made resolvable only inside this test's own browser, by
 * `--host-resolver-rules` (see `launchResolvingBrowser`) — not in `/etc/hosts`,
 * not anywhere that outlives the process. The realtime service pins the
 * handshake to the site's registered domain via `new URL(...).hostname`, which
 * drops the port, so serving on :4176 under this hostname satisfies the pin.
 */
const PARITY_DOMAIN = `e2e-parity-${Math.floor(Date.now() / 1000)}.invalid`;
const PARITY_DOMAIN_PATTERN = "e2e-parity-%.invalid";

/** The measured budget AC 4 states, in milliseconds. */
const PARITY_BUDGET_MS = 1000;

const RUN_PARITY = process.env.RUN_RECOPYFAST_PARITY === "1";

test.describe("realtime parity on a non-RecopyFast fixture", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  const siteId = randomUUID();
  const siteApiKey = `parity_key_${randomUUID()}`;
  /**
   * `<siteId>.<issuedAt>.<HMAC-SHA256(siteId.issuedAt, apiKey)>`.
   *
   * Built here from the wire format rather than imported from
   * `@/lib/security/site-auth`, so a change to the token shape fails this
   * instead of being silently followed — the deployed service verifies with its
   * own copy of the rule (server/index.js), and the two have to agree.
   */
  const siteToken = (() => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const payload = `${siteId}.${issuedAt}`;
    return `${payload}.${createHmac("sha256", siteApiKey).update(payload).digest("hex")}`;
  })();
  /**
   * An edit-session token, not a staging link.
   *
   * Both reach the staging room. The staging link is device-bound and raises an
   * emailed-code prompt (9f1aa70), which two independent browser contexts would
   * each have to clear — noise that has nothing to do with what AC 4 measures.
   * `rcf_edit_token` alone sets `EDITOR_MODE` (recopyfast.src.js:87), so both
   * contexts enter an editing session directly.
   */
  const editToken = `parity_edit_${randomUUID()}`;

  let supabase: SupabaseClient | null = null;
  let fixtureServer: Server;

  test.beforeAll(async () => {
    fixtureServer = await startFixtureServer();

    if (!RUN_PARITY) return;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "RUN_RECOPYFAST_PARITY=1 requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — " +
          "and they must name the project the DEPLOYED realtime service reads, or the two editors " +
          "will authenticate against different databases.",
      );
    }

    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    // Before seeding, not only after: `afterAll` does not run when the process
    // is killed, and a parity test that hangs is exactly the one someone kills.
    await purgeParityDebris(supabase);
    await seedParityData(supabase);
  });

  test.afterAll(async () => {
    if (supabase) {
      await purgeParityDebris(supabase);
    }

    await new Promise<void>((resolve) => {
      if (!fixtureServer) {
        resolve();
        return;
      }
      fixtureServer.close(() => resolve());
    });
  });

  /**
   * AC 6, carried to production.
   *
   * Ungated on purpose: it needs no database and no editing session, and it is
   * the check that turning realtime ON did not quietly make every snippet issued
   * before this story second-class. `/embed/recopyfast.js` is a permanent public
   * URL baked into every install that already exists (AGENTS.md non-negotiable 2),
   * so "the old ones behave exactly as they did" is a promise about live customer
   * sites, not a nicety.
   *
   * Point `PLAYWRIGHT_BASE_URL` at the deployed app to run it against production;
   * unset it and this runs against the local dev server.
   */
  test("a snippet with no data-ws-url is untouched by realtime being on", async ({
    page,
  }) => {
    const observed = observe(page);

    await page.goto(`${FIXTURE_URL}/legacy`, { waitUntil: "networkidle" });

    // The attribute is absent, so `window.RECOPYFAST_WS` is never set and the
    // widget takes its early return before any realtime bootstrap runs.
    expect(await page.evaluate(() => window.RECOPYFAST_WS)).toBeFalsy();
    expect(observed.socketAttempts).toEqual([]);

    // ADR 004 names lazy-loading socket.io from our origin as *the* rejected
    // option: our origin is not the customer's `'self'`, so it fails on exactly
    // the sites running `script-src 'self'` while passing every local test. The
    // loader at recopyfast.src.js:2948 is dead only for as long as the early
    // return holds, and this story is what makes it reachable at all.
    expect(
      observed.requests.filter((url) =>
        url.includes("socket.io-client.min.js"),
      ),
    ).toEqual([]);

    // The widget still goes to HTTP for its content, on a page that has no
    // socket. What is asserted is exactly that: the REQUEST was issued. The site
    // id is a random uuid and the token is fabricated, so the API rejects it and
    // nothing here claims a response came back — that would need a seeded site,
    // which is what the gated tests below have and this one deliberately does
    // not. The regression this catches is the widget skipping the HTTP path
    // altogether once realtime is on.
    expect(
      observed.requests.filter((url) => url.includes(`/api/content/${siteId}`)),
    ).not.toEqual([]);

    await expectNoErrorSurface(page, observed.pageErrors);
  });

  /**
   * ADR 004 rule 2, against the deployed system: realtime is *provably* additive.
   *
   * The claim is that with realtime off — switched off, undeployed, or simply
   * broken — an editor can still save, and the save is still authoritative. That
   * is what makes `NEXT_PUBLIC_WS_URL` a usable kill switch rather than a
   * hypothesis, and it is the difference between "an enhancement degraded" and
   * "the product broke".
   *
   * Deliberately served the **legacy** document, with no `data-ws-url` at all, so
   * this asserts the same thing whether or not realtime happens to be configured
   * when it runs — no kill-switch drill required to make it meaningful.
   *
   * Be precise about which rule it guards. There is **no socket on this page at
   * all** (`socketAttempts` is asserted empty at the end), so it cannot catch the
   * socket becoming a *second writer* — that is rule 1, and it would need a page
   * that has a connection. What it catches is the mirror image, rule 2: the day
   * the save comes to *depend* on the socket — an ack, an ordering, a broadcast
   * the write path waits on — the poll below finds no `staging_content` and this
   * goes red on a page where no socket can exist.
   *
   * `s07a`'s `realtime-additive.spec.ts` proves the non-mutating half of this
   * without a database. This is the mutating half, which needs one.
   */
  test("an editor still saves over HTTP with realtime off", async () => {
    test.skip(
      !RUN_PARITY,
      "Set RUN_RECOPYFAST_PARITY=1 with the Supabase project the deployed app writes to. " +
        "See server/README.md.",
    );

    // Served under the registered `.invalid` domain rather than `localhost`, so
    // the HTTP API's own origin pin is genuinely satisfied. `site-auth.ts`
    // exempts localhost as a local-demo convenience; leaning on that exemption
    // would make this test pass for a reason that has nothing to do with what it
    // claims to check.
    const browser = await launchResolvingBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      const observed = observe(page);
      await page.goto(
        `http://${PARITY_DOMAIN}:${FIXTURE_PORT}/legacy?rcf_edit_token=${encodeURIComponent(editToken)}`,
        { waitUntil: "domcontentloaded" },
      );

      // No realtime bootstrap at all — the precondition for the whole test.
      expect(await page.evaluate(() => window.RECOPYFAST_WS)).toBeFalsy();

      const heading = page.locator("main h1");
      await expect(heading).toHaveAttribute("data-rcf-id", /.+/, {
        timeout: 30_000,
      });
      const elementId = await heading.getAttribute("data-rcf-id");
      if (!elementId || !supabase) {
        throw new Error("The widget did not identify the heading.");
      }
      await seedContentElement(supabase, elementId);

      const newText = `Saved with realtime off ${Date.now()}`;
      await page.evaluate(
        async ({ id, text }: { id: string; text: string }) =>
          window.ReCopyFast.persistContentUpdate(id, text),
        { id: elementId, text: newText },
      );

      // The authoritative record, read from the database rather than from the
      // DOM: the point is that the write LANDED, not that the page looks right.
      await expect
        .poll(
          async () => {
            const { data } = await supabase!
              .from("content_elements")
              .select("staging_content")
              .eq("site_id", siteId)
              .eq("element_id", elementId)
              .single();
            return (data as { staging_content: string | null } | null)
              ?.staging_content;
          },
          { timeout: 30_000 },
        )
        .toBe(newText);

      expect(observed.socketAttempts).toEqual([]);
      expect(observed.pageErrors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });

  /**
   * AC 4. Two editing sessions, two browser contexts, two connections.
   */
  test("an edit in browser A reaches browser B in under a second", async () => {
    test.skip(
      !RUN_PARITY,
      "Set RUN_RECOPYFAST_PARITY=1 with NEXT_PUBLIC_WS_URL, PLAYWRIGHT_BASE_URL and the " +
        "Supabase project the deployed realtime service reads. See server/README.md.",
    );

    // Its own browser, not the shared `browser` fixture: the resolver rule that
    // makes `.invalid` reachable is a launch argument, and it must not leak into
    // any other spec.
    const browser = await launchResolvingBrowser();
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      const editorUrl = `http://${PARITY_DOMAIN}:${FIXTURE_PORT}/?rcf_edit_token=${encodeURIComponent(editToken)}`;
      await Promise.all([
        pageA.goto(editorUrl, { waitUntil: "domcontentloaded" }),
        pageB.goto(editorUrl, { waitUntil: "domcontentloaded" }),
      ]);

      // Both sockets must be joined before the edit goes out. socket.io excludes
      // the sender from `socket.to(room)`, so a B still mid-handshake would miss
      // the broadcast entirely and the failure would read as "realtime is slow"
      // rather than "the test raced the join".
      const socketIdA = await waitForSocketId(pageA);
      const socketIdB = await waitForSocketId(pageB);

      // ADR 022's Watch clause, asserted rather than assumed.
      expect(socketIdA).not.toBe(socketIdB);

      const heading = pageA.locator("main h1");
      await expect(heading).toHaveAttribute("data-rcf-id", /.+/, {
        timeout: 30_000,
      });
      const elementId = await heading.getAttribute("data-rcf-id");
      if (!elementId || !supabase) {
        throw new Error("No element id was discovered from the fixture page.");
      }
      await seedContentElement(supabase, elementId);

      const newText = `Parity ${Date.now()}`;

      // Listen on B's OWN socket. This is the difference between "the event
      // reached a second connection" and "something changed the DOM".
      await pageB.evaluate(() => {
        window.__rcfParity = { receivedAt: null, elementId: null };
        window.ReCopyFast.socket.on("content-update", (data: unknown) => {
          if (window.__rcfParity!.receivedAt !== null) return;
          window.__rcfParity!.receivedAt = Date.now();
          const payload = data as { elementId?: string } | null;
          window.__rcfParity!.elementId = payload?.elementId ?? null;
        });
      });

      const startedAt = await pageA.evaluate(
        async ({ id, text }: { id: string; text: string }) => {
          const t = Date.now();
          // The real editor save path: authoritative HTTP write first
          // (recopyfast.src.js:2803), then the fan-out. Not a hand-rolled emit —
          // an emit alone would measure socket.io rather than the product.
          await window.ReCopyFast.persistContentUpdate(id, text);
          return t;
        },
        { id: elementId, text: newText },
      );

      await expect
        .poll(
          () => pageB.evaluate(() => window.__rcfParity?.receivedAt ?? null),
          { timeout: 30_000 },
        )
        .not.toBeNull();

      const parity = await pageB.evaluate(() => window.__rcfParity!);
      const elapsedMs = parity.receivedAt! - startedAt;

      // Recorded, not just asserted: AC 4 asks for a measured interval and the
      // hostname it was measured on, and a number nobody can read is a number
      // nobody can put in the PR.
      console.log(
        `[s07b AC 4] fixture=${PARITY_DOMAIN}:${FIXTURE_PORT} ws=${WS_URL} app=${APP_URL} ` +
          `elapsed=${elapsedMs}ms budget=${PARITY_BUDGET_MS}ms ` +
          `socketA=${socketIdA} socketB=${socketIdB} site=${siteId}`,
      );

      expect(parity.elementId).toBe(elementId);
      expect(elapsedMs).toBeGreaterThanOrEqual(0);
      expect(elapsedMs).toBeLessThan(PARITY_BUDGET_MS);

      // And the widget in B actually applied it — the connection carrying the
      // event is necessary but not sufficient for "the edit appears".
      await expect(pageB.locator("main h1")).toHaveText(newText, {
        timeout: 10_000,
      });
    } finally {
      await contextA.close();
      await contextB.close();
      await browser.close();
    }
  });

  /**
   * A Chromium that resolves the fixture's `.invalid` hostname to loopback.
   *
   * `--host-resolver-rules` is scoped to this browser process and dies with it,
   * which is the point: the alternative is an `/etc/hosts` entry that outlives
   * the run on whoever's machine executed it. The port is preserved by the MAP
   * rule, so the fixture is genuinely served by the local HTTP server while the
   * browser — and therefore the `Origin` header the realtime service pins
   * against — sees the registered domain.
   */
  function launchResolvingBrowser() {
    return chromium.launch({
      args: [`--host-resolver-rules=MAP ${PARITY_DOMAIN} 127.0.0.1`],
    });
  }

  async function waitForSocketId(page: Page): Promise<string> {
    await expect
      .poll(
        () =>
          page.evaluate(() => window.ReCopyFast?.socket?.connected === true),
        { timeout: 30_000 },
      )
      .toBe(true);

    const id = await page.evaluate(() => window.ReCopyFast.socket.id);
    if (!id) {
      throw new Error("The widget connected but exposed no socket id.");
    }
    return id;
  }

  /**
   * Remove every row this suite has ever created, by marker rather than by id.
   *
   * Deleting `.eq("id", siteId)` would only ever clean up the run that is still
   * holding that id in memory — which is the run that did not crash. The marker
   * is the only handle a later run has on an earlier run's debris.
   *
   * `content_elements.site_id` and `edit_sessions.site_id` are both
   * `REFERENCES sites(id) ON DELETE CASCADE` (checked in the migrations, not
   * assumed), so deleting the site is sufficient. The children are deleted first
   * anyway: if a future migration ever drops the cascade, this keeps working
   * instead of silently leaving orphans behind.
   */
  async function purgeParityDebris(client: SupabaseClient) {
    const { data, error } = await client
      .from("sites")
      .select("id")
      .like("domain", PARITY_DOMAIN_PATTERN);
    if (error) throw error;

    const ids = (data ?? []).map((row: { id: string }) => row.id);
    if (ids.length === 0) return;

    console.log(
      `[s07b AC 4] purging ${ids.length} parity site(s): ${ids.join(", ")}`,
    );
    await client.from("edit_sessions").delete().in("site_id", ids);
    await client.from("content_elements").delete().in("site_id", ids);
    const { error: siteError } = await client
      .from("sites")
      .delete()
      .in("id", ids);
    if (siteError) throw siteError;
  }

  async function seedParityData(client: SupabaseClient) {
    const { error: siteError } = await client.from("sites").insert({
      id: siteId,
      // The deployed service pins the handshake to the site's registered domain
      // (server/auth.js `isOriginAllowed`) — the fixture's host has to normalise
      // to this exact value or every connection is refused, which presents as
      // "realtime never connected" rather than as an origin failure.
      domain: PARITY_DOMAIN,
      name: "ReCopyFast E2E parity fixture — safe to delete",
      api_key: siteApiKey,
    });
    if (siteError) throw siteError;

    console.log(
      `[s07b AC 4] seeded site ${siteId} domain=${PARITY_DOMAIN} (delete on sight)`,
    );

    const { error: editError } = await client.from("edit_sessions").insert({
      site_id: siteId,
      token: editToken,
      permissions: ["view", "edit", "publish"],
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      is_active: true,
    });
    if (editError) throw editError;
  }

  async function seedContentElement(client: SupabaseClient, elementId: string) {
    const { error } = await client.from("content_elements").upsert(
      {
        site_id: siteId,
        element_id: elementId,
        selector: `[data-rcf-id="${elementId}"]`,
        original_content: "Parity baseline",
        current_content: "Parity baseline",
        published_content: "Parity baseline",
        staging_content: null,
        language: "en",
        variant: "default",
        metadata: {},
      },
      { onConflict: "site_id,element_id,language,variant" },
    );
    if (error) throw error;
  }

  /**
   * One fixture host, two documents.
   *
   * `data-ws-url` is an attribute of the snippet, so "a snippet issued before
   * this story" and "a snippet issued after it" cannot be the same page. Serving
   * both from the same origin keeps everything else — host, CORS, CSP — equal
   * between them, which is what makes the pair a discriminator.
   */
  async function startFixtureServer(): Promise<Server> {
    const server = createServer((request, response) => {
      const isLegacy = (request.url || "").startsWith("/legacy");
      const wsAttribute = isLegacy ? "" : `\n      data-ws-url="${WS_URL}"`;

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head>
    <title>ReCopyFast parity fixture</title>
    <script
      src="${APP_URL}/embed/recopyfast.js"
      data-site-id="${siteId}"
      data-site-token="${siteToken}"
      data-api-url="${APP_URL}/api"${wsAttribute}
    ></script>
  </head>
  <body>
    <main>
      <h1>Parity baseline</h1>
    </main>
  </body>
</html>`);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(FIXTURE_PORT, () => {
        server.off("error", reject);
        resolve();
      });
    });

    return server;
  }
});

/** Everything the page tried to load, plus anything it threw. */
function observe(page: Page) {
  const requests: string[] = [];
  const pageErrors: string[] = [];
  const socketAttempts: string[] = [];

  page.on("request", (request: Request) => {
    const url = request.url();
    requests.push(url);
    if (url.includes("/socket.io/")) socketAttempts.push(url);
  });
  page.on("websocket", (ws) => socketAttempts.push(ws.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));

  return { requests, pageErrors, socketAttempts };
}

/**
 * The host page must look exactly as its author wrote it.
 *
 * Not "no console noise" — noise is allowed and sometimes required (ADR 004: a
 * silent degradation is a defect). What is forbidden is an uncaught exception
 * reaching the host page's window, the authored copy being replaced, or anything
 * of ours rendering an error into the customer's DOM.
 */
async function expectNoErrorSurface(page: Page, pageErrors: string[]) {
  expect(pageErrors).toEqual([]);
  await expect(page.locator("main h1")).toHaveText("Parity baseline");
  await expect(page.locator("#rcf-staging-banner")).toHaveCount(0);
  await expect(page.locator(".rcf-error, [data-rcf-error]")).toHaveCount(0);
}

declare global {
  interface Window {
    RECOPYFAST_WS?: string;
    ReCopyFast: {
      socket: {
        id?: string;
        connected?: boolean;
        on: (event: string, handler: (data: unknown) => void) => void;
      };
      persistContentUpdate: (
        elementId: string,
        content: string,
      ) => Promise<unknown>;
    };
    __rcfParity?: { receivedAt: number | null; elementId: string | null };
  }
}
