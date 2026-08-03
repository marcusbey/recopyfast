import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServer, type Server } from "node:http";
import { createHmac, randomUUID } from "node:crypto";

const RUN_CORE_E2E = process.env.RUN_RECOPYFAST_CORE_E2E === "1";
const APP_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4001";
const TARGET_PORT = Number(process.env.RECOPYFAST_TARGET_PORT || "4173");
const TARGET_URL = `http://localhost:${TARGET_PORT}`;

test.describe("share edit publish flow", () => {
  test.skip(
    !RUN_CORE_E2E,
    "Set RUN_RECOPYFAST_CORE_E2E=1 with a disposable Supabase project to run the mutating core E2E flow.",
  );
  test.describe.configure({ mode: "serial" });

  // The default 30s is not enough now that each run clears a real device
  // verification before it can edit anything: a code round trip, then the
  // widget re-booting into staging mode, then the edit and publish assertions
  // which each poll the database.
  test.setTimeout(180_000);

  let supabase: SupabaseClient;
  let targetServer: Server;

  /** Stands in for the emailed code. Stored plaintext, compared timing-safely. */
  const STAGING_VERIFICATION_CODE = "424242";

  const siteId = randomUUID();
  /**
   * The site's API key, and the embed token derived from it.
   *
   * These are two different things and the test used to conflate them, putting
   * the raw key in `data-site-token`. A site token is
   * `<siteId>.<issuedAt>.<HMAC-SHA256(siteId.issuedAt, apiKey)>`, so the raw key
   * is rejected as "Invalid site token" — which the visitor content fetch then
   * reported as a 401 and the test reported as stale copy on the page.
   *
   * Built here rather than imported from `@/lib/security/site-auth` so this
   * spec keeps asserting against the wire format rather than against whatever
   * that module currently produces: if the token shape changes, this should
   * fail rather than silently follow.
   */
  const siteApiKey = `e2e_key_${randomUUID()}`;
  const siteToken = (() => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const payload = `${siteId}.${issuedAt}`;
    const signature = createHmac("sha256", siteApiKey)
      .update(payload)
      .digest("hex");
    return `${payload}.${signature}`;
  })();
  const stagingToken = `e2e_staging_${randomUUID()}`;
  const editToken = `e2e_edit_${randomUUID()}`;

  // Discovered from the running widget, never hand-authored. A real customer
  // page has no `data-rcf-id` in its markup, so pre-seeding one here would have
  // hidden the fact that the widget used to mint a brand-new, time-based id on
  // every page load.
  let elementId: string | null = null;

  test.beforeAll(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for core E2E.",
      );
    }

    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    await seedCoreFlowData();
    targetServer = await startTargetServer();
  });

  test.afterAll(async () => {
    if (supabase) {
      await supabase.from("staging_access").delete().eq("site_id", siteId);
      await supabase.from("edit_sessions").delete().eq("site_id", siteId);
      await supabase.from("content_elements").delete().eq("site_id", siteId);
      await supabase.from("sites").delete().eq("id", siteId);
    }

    await new Promise<void>((resolve) => {
      if (!targetServer) {
        resolve();
        return;
      }

      targetServer.close(() => resolve());
    });
  });

  test("staging token edits staging content and publishes live", async ({
    page,
  }) => {
    await exerciseShareFlow(
      page,
      `rcf_staging=1&rcf_token=${encodeURIComponent(stagingToken)}`,
      "Published through staging token",
    );
  });

  test("edit-session token edits staging content and publishes live", async ({
    page,
  }) => {
    await exerciseShareFlow(
      page,
      `rcf_edit_token=${encodeURIComponent(editToken)}`,
      "Published through edit token",
    );
  });

  /**
   * Clear the emailed-code prompt when the widget raises one.
   *
   * A staging link is bound to a device now. `email_verified` alone stopped
   * being sufficient in 9f1aa70, which closed the hole where forwarding an
   * already-verified URL handed the recipient full access — verification is
   * pinned to a User-Agent fingerprint captured at the moment the code is
   * accepted, and pre-existing verified rows deliberately fail closed rather
   * than being grandfathered.
   *
   * This test predated that change and seeded `email_verified: true` with none
   * of the binding columns, so it sat on the code prompt until it timed out and
   * reported the failure as "the staging banner never appeared". The banner was
   * never going to appear: the widget was correctly refusing an unbound device.
   *
   * Driving the real prompt rather than forging `verified_user_agent_hash` is
   * deliberate. Writing the hash would test our ability to reproduce a hashing
   * function, and would keep passing if the widget stopped asking at all —
   * which is precisely the regression worth catching.
   *
   * Conditional because only the staging-token path is device-bound; the
   * edit-session token is a different credential and raises no prompt.
   */
  async function completeDeviceVerificationIfPrompted(page: Page) {
    const codeInput = page.getByPlaceholder("000000");

    // `isVisible()` resolves immediately and ignores a timeout, so using it
    // here silently answered "no prompt" before the widget had rendered one,
    // and the failure surfaced much later as a missing banner. `waitFor` is
    // the call that actually waits.
    const prompted = await codeInput
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!prompted) {
      return;
    }

    await codeInput.fill(STAGING_VERIFICATION_CODE);
    await page.getByRole("button", { name: /verify & continue/i }).click();

    // The prompt must actually go away. Asserting only that the banner appears
    // would let a widget that renders both at once pass.
    await expect(codeInput).toBeHidden({ timeout: 20_000 });

    // Then let the widget finish re-initialising. Clearing verification puts it
    // through a reboot into staging mode, and an edit started before that
    // settles is discarded along with the pre-reboot DOM — which surfaced as
    // typing that appeared to do nothing, with the snapshot at failure showing
    // the page stripped of every piece of widget chrome.
    await page.waitForLoadState("networkidle");
  }

  async function exerciseShareFlow(
    page: Page,
    query: string,
    newText: string,
  ) {
    await page.goto(`${TARGET_URL}/?${query}`, { waitUntil: "domcontentloaded" });

    await completeDeviceVerificationIfPrompted(page);

    await expect(page.locator("#rcf-staging-banner")).toBeVisible({
      timeout: 20_000,
    });

    const heading = page.locator("main h1");
    await expect(heading).toHaveAttribute("data-rcf-id", /.+/, {
      timeout: 20_000,
    });

    const discoveredId = await heading.getAttribute("data-rcf-id");
    if (!discoveredId) {
      throw new Error("The widget did not assign an element id to the heading.");
    }

    if (elementId === null) {
      elementId = discoveredId;
      await seedContentElement("Original live copy");
    } else {
      // The second run is a completely separate page load in a fresh browser
      // context. Getting the same id back is the whole point of BUG-2's fix.
      expect(discoveredId).toBe(elementId);
    }

    await expect(heading).toBeVisible();
    await heading.click();
    await expect(page.locator(".rcf-actions-inline")).toBeVisible();

    // Select the existing line from inside the element that the click above
    // already focused, rather than reaching for a select-all.
    //
    // Four approaches failed here first, each differently, which is why this
    // is spelled out: `Control+A` does not select on macOS, so the replacement
    // was typed in front of the original and both were saved; `ControlOrMeta+A`
    // selected at page scope and the typing never reached the field;
    // `selectText()` shifted focus enough that the widget dropped the edit;
    // and a triple-click re-entered edit mode, losing the caret entirely.
    //
    // End then Shift+Home is the one that stays inside the focused element and
    // means the same thing on every platform.
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.type(newText);

    await page.locator(".rcf-btn-save").click();

    await expect
      .poll(() => getContentColumn("staging_content"), { timeout: 20_000 })
      .toBe(newText);
    await expect.poll(() => getContentColumn("published_content")).not.toBe(newText);

    await page.locator("#rcf-publish-btn").click();
    await page.getByRole("button", { name: /publish now/i }).click();

    await expect
      .poll(() => getContentColumn("published_content"), { timeout: 20_000 })
      .toBe(newText);
    await expect.poll(() => getContentColumn("staging_content")).toBeNull();

    // A plain visitor load: no staging query, no socket broadcast in flight.
    // The published copy has to arrive purely from the widget fetching it on
    // init, and it has to land on an element the widget re-identified from
    // scratch under the exact same id.
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    await expect(heading).toHaveAttribute("data-rcf-id", elementId, {
      timeout: 20_000,
    });
    await expect(heading).toHaveText(newText, { timeout: 20_000 });
  }

  async function getContentColumn(
    column: "published_content" | "staging_content",
  ) {
    if (!elementId) {
      throw new Error("No element id has been discovered from the page yet.");
    }

    const { data, error } = await supabase
      .from("content_elements")
      .select(column)
      .eq("site_id", siteId)
      .eq("element_id", elementId)
      .single();

    if (error) {
      throw error;
    }

    const row = data as Record<typeof column, string | null> | null;
    return row?.[column] ?? null;
  }

  async function seedCoreFlowData() {
    await supabase.from("sites").delete().eq("id", siteId);

    const { error: siteError } = await supabase.from("sites").insert({
      id: siteId,
      domain: `localhost:${TARGET_PORT}`,
      name: "ReCopyFast E2E Target",
      api_key: siteApiKey,
    });

    if (siteError) {
      throw siteError;
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { error: stagingError } = await supabase.from("staging_access").insert({
      site_id: siteId,
      access_type: "link",
      email: "e2e@recopyfast.local",
      // Unverified on purpose. Seeding `true` without the binding columns
      // produces a row the widget refuses, which is the correct behaviour and
      // is what this test used to mistake for a broken banner. The code is
      // stored in plaintext and compared with `timingSafeEqualString`, so a
      // known value here is exactly what a real emailed code would be.
      email_verified: false,
      verification_code: STAGING_VERIFICATION_CODE,
      verification_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      token: stagingToken,
      permissions: ["view", "edit", "publish"],
      label: "Core E2E",
      expires_at: expiresAt,
      is_active: true,
    });

    if (stagingError) {
      throw stagingError;
    }

    const { error: editError } = await supabase.from("edit_sessions").insert({
      site_id: siteId,
      token: editToken,
      permissions: ["view", "edit", "publish"],
      expires_at: expiresAt,
      is_active: true,
    });

    if (editError) {
      throw editError;
    }
  }

  /**
   * Establish the published baseline for the id the widget actually derived.
   *
   * Upsert rather than insert: the widget's own content map reaches the server
   * over the socket at roughly the same moment, and both writes target the same
   * (site_id, element_id, language, variant) key — which is the behaviour that
   * keeps ordinary page views from inserting duplicate rows.
   */
  async function seedContentElement(liveText: string) {
    const { error } = await supabase.from("content_elements").upsert(
      {
        site_id: siteId,
        element_id: elementId,
        selector: `[data-rcf-id="${elementId}"]`,
        original_content: liveText,
        current_content: liveText,
        published_content: liveText,
        staging_content: null,
        language: "en",
        variant: "default",
        metadata: {},
      },
      { onConflict: "site_id,element_id,language,variant" },
    );

    if (error) {
      throw error;
    }
  }

  async function startTargetServer() {
    const server = createServer((_, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head>
    <title>ReCopyFast target</title>
    <script
      src="${APP_URL}/embed/recopyfast.js"
      data-site-id="${siteId}"
      data-site-token="${siteToken}"
      data-api-url="${APP_URL}/api"
      data-ws-url="${WS_URL}"
    ></script>
  </head>
  <body>
    <main>
      <h1>Original live copy</h1>
    </main>
  </body>
</html>`);
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
