import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServer, type Server } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { hashVerificationCode } from "../src/lib/auth/editor-crypto";
import {
  createLocalServiceRoleClient,
  deleteCapturedSiteFixture,
} from "./support/local-supabase";
import { withCoreSetupDiagnostic } from "./support/core-setup-diagnostics";

const APP_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://127.0.0.1:4001";
const TARGET_PORT = Number(process.env.RECOPYFAST_TARGET_PORT || "4173");
const TARGET_URL = `http://localhost:${TARGET_PORT}`;

type ShareCredentialKind = "invited-editor" | "edit-session";

const SHARE_CHROME: Record<
  ShareCredentialKind,
  { banner: string; wrongBanner: string; publish: string }
> = {
  "invited-editor": {
    banner: "#rcf-editor-banner",
    wrongBanner: "#rcf-staging-banner",
    publish: '.rcf-editor-banner-publish[aria-label="Publish"]',
  },
  "edit-session": {
    banner: "#rcf-staging-banner",
    wrongBanner: "#rcf-editor-banner",
    publish: "#rcf-publish-btn",
  },
};

test.describe("share edit publish flow", () => {
  test.describe.configure({ mode: "serial" });

  // The default 30s is not enough now that each run clears a real device
  // verification before it can edit anything: a code round trip, then the
  // widget re-booting into staging mode, then the edit and publish assertions
  // which each poll the database.
  test.setTimeout(180_000);

  let supabase: SupabaseClient | null = null;
  let targetServer: Server | null = null;

  const siteId = randomUUID();
  const siteEditorId = randomUUID();
  const verificationCodeId = randomUUID();
  const editorEmail = `e2e-${siteId}@recopyfast.local`;
  /** Stands in for the emailed code; only its keyed digest is persisted. */
  const editorVerificationCode = "424242";
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
  const editToken = `e2e_edit_${randomUUID()}`;

  // Discovered from the running widget, never hand-authored. A real customer
  // page has no `data-rcf-id` in its markup, so pre-seeding one here would have
  // hidden the fact that the widget used to mint a brand-new, time-based id on
  // every page load.
  let elementId: string | null = null;

  test.beforeAll(async () => {
    supabase = await withCoreSetupDiagnostic("create local client", () =>
      createLocalServiceRoleClient("RUN_RECOPYFAST_CORE_E2E"),
    );
    await withCoreSetupDiagnostic("delete captured fixture", () =>
      deleteCoreFixture(),
    );

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await withCoreSetupDiagnostic("seed site", () => seedSite());
    await withCoreSetupDiagnostic("seed invited editor", () =>
      seedInvitedEditor(),
    );
    await withCoreSetupDiagnostic("seed verification code", () =>
      seedHubVerificationCode(),
    );
    await withCoreSetupDiagnostic("seed edit session", () =>
      seedEditSession(expiresAt),
    );
    targetServer = await withCoreSetupDiagnostic("start target server", () =>
      startTargetServer(),
    );
  });

  test.afterAll(async () => {
    try {
      if (supabase) {
        try {
          await restoreCapturedContent();
        } finally {
          await deleteCoreFixture();
        }
      }
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

  test("invited-editor grant edits staging content and publishes live", async ({
    page,
  }) => {
    const redirectUrl = await createInvitedEditorHandoff(page);
    await exerciseShareFlow(
      page,
      redirectUrl,
      "invited-editor",
      "Published through invited editor grant",
    );
  });

  test("edit-session token edits staging content and publishes live", async ({
    page,
  }) => {
    await exerciseShareFlow(
      page,
      `${TARGET_URL}/?rcf_edit_token=${encodeURIComponent(editToken)}`,
      "edit-session",
      "Published through edit token",
    );
  });

  /**
   * Exercise the secure editor entry path without sending external mail.
   *
   * The old fixture inserted `staging_access.access_type='link'`, the exact
   * first-opener self-authorisation path the database now rejects. This fixture
   * instead persists a keyed stand-in for the emailed code, spends it through
   * the real hub endpoint, carries the returned httpOnly session into the real
   * handoff endpoint, then lets the widget redeem the one-shot handoff into an
   * origin-bound device grant. The plaintext code and handoff never reach a log
   * or artifact.
   */
  async function createInvitedEditorHandoff(page: Page): Promise<string> {
    const verificationResponse = await page.request.post(
      `${APP_URL}/api/editor/submit-code`,
      {
        data: {
          email: editorEmail,
          code: editorVerificationCode,
        },
      },
    );
    expect(verificationResponse.ok()).toBe(true);

    const verificationBody = (await verificationResponse.json()) as {
      mode?: string;
      sites?: Array<{ siteId?: string; permissions?: string[] }>;
    };
    const verifiedSite = verificationBody.sites?.find(
      (site) => site.siteId === siteId,
    );
    expect(verificationBody.mode === "hub").toBe(true);
    expect(Boolean(verifiedSite)).toBe(true);
    expect(verifiedSite?.permissions).toEqual(["view", "edit", "publish"]);

    const setCookie = verificationResponse.headers()["set-cookie"] ?? "";
    const hubCookie = setCookie.split(";", 1)[0];
    expect(hubCookie.startsWith("rcf_editor_hub=")).toBe(true);

    const handoffResponse = await page.request.post(
      `${APP_URL}/api/editor/handoff/create`,
      {
        headers: { cookie: hubCookie },
        data: { siteId, rememberDevice: false },
      },
    );
    expect(handoffResponse.ok()).toBe(true);

    const handoffBody = (await handoffResponse.json()) as {
      redirectUrl?: string;
    };
    const redirectUrl = handoffBody.redirectUrl ?? "";
    expect(Boolean(redirectUrl)).toBe(true);

    const parsed = new URL(redirectUrl);
    expect(parsed.origin === TARGET_URL).toBe(true);
    expect(Boolean(parsed.searchParams.get("rcf_handoff"))).toBe(true);
    return redirectUrl;
  }

  async function exerciseShareFlow(
    page: Page,
    url: string,
    credentialKind: ShareCredentialKind,
    newText: string,
  ) {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
    });

    const chrome = SHARE_CHROME[credentialKind];
    await expect(page.locator(chrome.banner)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(chrome.wrongBanner)).toHaveCount(0);

    const heading = page.locator("main h1");
    await expect(heading).toHaveAttribute("data-rcf-id", /.+/, {
      timeout: 20_000,
    });

    const discoveredId = await heading.getAttribute("data-rcf-id");
    if (!discoveredId) {
      throw new Error(
        "The widget did not assign an element id to the heading.",
      );
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
    await expect
      .poll(() => getContentColumn("published_content"))
      .not.toBe(newText);

    await page.locator(chrome.publish).click();
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

    if (!supabase) throw new Error("Core E2E Supabase client is not ready.");

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

  async function seedSite() {
    if (!supabase) throw new Error("Core E2E Supabase client is not ready.");

    const { error: siteError } = await supabase.from("sites").insert({
      id: siteId,
      domain: TARGET_URL,
      name: "ReCopyFast E2E Target",
      api_key: siteApiKey,
    });

    if (siteError) {
      throw siteError;
    }
  }

  async function seedInvitedEditor() {
    if (!supabase) throw new Error("Core E2E Supabase client is not ready.");

    const { error } = await supabase.from("site_editors").insert({
      id: siteEditorId,
      site_id: siteId,
      email: editorEmail,
      permissions: ["view", "edit", "publish"],
      revoked_at: null,
    });

    if (error) throw error;
  }

  async function seedHubVerificationCode() {
    if (!supabase) throw new Error("Core E2E Supabase client is not ready.");

    const { error } = await supabase.from("editor_verification_codes").insert({
      id: verificationCodeId,
      email: editorEmail,
      site_id: null,
      code_hash: hashVerificationCode(editorEmail, editorVerificationCode),
      attempts: 0,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      consumed_at: null,
    });

    if (error) throw error;
  }

  async function seedEditSession(expiresAt: string) {
    if (!supabase) throw new Error("Core E2E Supabase client is not ready.");

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
    if (!supabase) throw new Error("Core E2E Supabase client is not ready.");

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

  async function restoreCapturedContent() {
    if (!supabase || !elementId) return;

    const { error } = await supabase
      .from("content_elements")
      .update({
        current_content: "Original live copy",
        published_content: "Original live copy",
        staging_content: null,
      })
      .eq("site_id", siteId)
      .eq("element_id", elementId);
    if (error) throw error;
  }

  async function deleteCoreFixture() {
    if (!supabase) return;

    // Hub-scoped codes deliberately have no site_id, so the final site cascade
    // cannot reach them. Delete this run's captured code id explicitly, then
    // delete the exact site id; that cascade owns its site_editor, handoff and
    // device-grant children without a broad email/domain sweep.
    const { error } = await supabase
      .from("editor_verification_codes")
      .delete()
      .eq("id", verificationCodeId);
    if (error) throw error;

    await deleteCapturedSiteFixture(supabase, siteId);
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
