import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

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

  let supabase: SupabaseClient;
  let targetServer: Server;

  const siteId = randomUUID();
  const siteToken = `e2e_site_${randomUUID()}`;
  const stagingToken = `e2e_staging_${randomUUID()}`;
  const editToken = `e2e_edit_${randomUUID()}`;
  const elementId = "hero-title";

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

    await seedCoreFlowData("Original live copy");
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

  async function exerciseShareFlow(
    page: Page,
    query: string,
    newText: string,
  ) {
    await page.goto(`${TARGET_URL}/?${query}`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#rcf-staging-banner")).toBeVisible({
      timeout: 20_000,
    });

    const heading = page.locator(`[data-rcf-id="${elementId}"]`);
    await expect(heading).toBeVisible();
    await heading.click();
    await expect(page.locator(".rcf-actions-inline")).toBeVisible();

    await page.keyboard.press("Control+A");
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

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    await expect(heading).toHaveText(newText, { timeout: 20_000 });
  }

  async function getContentColumn(
    column: "published_content" | "staging_content",
  ) {
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

  async function seedCoreFlowData(liveText: string) {
    await supabase.from("sites").delete().eq("id", siteId);

    const { error: siteError } = await supabase.from("sites").insert({
      id: siteId,
      domain: `localhost:${TARGET_PORT}`,
      name: "ReCopyFast E2E Target",
      api_key: siteToken,
    });

    if (siteError) {
      throw siteError;
    }

    const { error: contentError } = await supabase.from("content_elements").insert({
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
    });

    if (contentError) {
      throw contentError;
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { error: stagingError } = await supabase.from("staging_access").insert({
      site_id: siteId,
      access_type: "link",
      email: "e2e@recopyfast.local",
      email_verified: true,
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
      <h1 data-rcf-id="${elementId}">Original live copy</h1>
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
