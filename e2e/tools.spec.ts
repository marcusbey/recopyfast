import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isHydrated, watchScriptViolations } from "./support/csp-violations";
import { createLocalServiceRoleClient } from "./support/local-supabase";

/**
 * s96 (ADR 062) — the free tools in a real browser, against the production
 * build and the disposable local Supabase stack.
 *
 * 1. /tools → the Website Typo Finder: static marketing pages that hydrate
 *    with no script CSP violation and name their own canonical.
 * 2. A scan lands on a report as a NEW DOCUMENT served under the nonce CSP,
 *    with the typo in a <mark> inside its sentence and the CTA's UTMs. The
 *    scan itself is answered by `page.route`: a real scan fetches a third-party
 *    site, which no test may do, and production code has no environment
 *    switch that could point it at a loopback fixture. The real-socket proof of
 *    the fetcher is src/lib/tools/fetch/__tests__/safe-fetch.test.ts.
 * 3. A report seeded with hostile page text renders it as inert text: no
 *    dialog, no violation.
 *
 * Reports are seeded with the local service-role client (the only principal
 * that can write `tool_reports`) and deleted by id afterwards.
 */

const SLUG = "website-spell-checker";
const TOOL_PATH = `/tools/${SLUG}`;
const NONCE_SOURCE = /'nonce-[A-Za-z0-9+/_-]+={0,2}'/;

function report(findings: Record<string, string>[]) {
  return {
    v: 1,
    tool: SLUG,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scannedAt: new Date().toISOString(),
    summary: {
      headline: `${findings.length} possible typo${findings.length === 1 ? "" : "s"} on 1 page of 1`,
      verdict: "warn",
      facts: [{ label: "Pages checked", value: "1" }],
    },
    findings,
    pages: [{ url: "https://example.com/", status: "checked" }],
    truncated: false,
  };
}

async function seedReport(
  supabase: SupabaseClient,
  body: ReturnType<typeof report>,
): Promise<string> {
  const { data, error } = await supabase
    .from("tool_reports")
    .insert({
      tool: SLUG,
      cache_key: createHash("sha256").update(randomUUID()).digest("hex"),
      url: "https://example.com/",
      report: body,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("seed failed");
  return (data as { id: string }).id;
}

function reportDocuments(page: Page, id: string): string[] {
  const policies: string[] = [];
  page.on("response", (response) => {
    if (
      response.request().resourceType() === "document" &&
      new URL(response.url()).pathname === `${TOOL_PATH}/r/${id}`
    ) {
      policies.push(response.headers()["content-security-policy"] ?? "");
    }
  });
  return policies;
}

test.describe("s96 free tools", () => {
  test.describe.configure({ mode: "serial" });

  let supabase: SupabaseClient;
  const seeded: string[] = [];

  test.beforeAll(() => {
    supabase = createLocalServiceRoleClient("RUN_RECOPYFAST_CORE_E2E");
  });

  test.afterAll(async () => {
    if (seeded.length === 0) return;
    const { error } = await supabase
      .from("tool_reports")
      .delete()
      .in("id", seeded);
    if (error) throw error;
  });

  test("the hub and the Website Typo Finder render static, hydrated and CSP-clean", async ({
    page,
  }) => {
    const violations = await watchScriptViolations(page);

    const hub = await page.goto("/tools", { waitUntil: "load" });
    expect(hub?.headers()["content-security-policy"]).not.toMatch(NONCE_SOURCE);
    await expect.poll(() => isHydrated(page)).toBe(true);
    await expect(
      page.getByRole("heading", { name: "About our scanner" }),
    ).toBeVisible();

    await page
      .getByRole("link", { name: "Open the Website Typo Finder" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${TOOL_PATH}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Website Typo Finder" }),
    ).toBeVisible();
    await expect.poll(() => isHydrated(page)).toBe(true);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${TOOL_PATH}$`),
    );

    expect(await violations()).toEqual([]);
  });

  test("a scan lands on its report as a new nonce document, the typo marked in its sentence", async ({
    page,
  }) => {
    const id = await seedReport(
      supabase,
      report([
        {
          page: "https://example.com/",
          kind: "typo",
          match: "recieve",
          before: "We ",
          after: " orders every morning.",
          suggestion: "receive",
        },
      ]),
    );
    seeded.push(id);
    const reportPath = `${TOOL_PATH}/r/${id}`;
    await page.route("**/api/tools/scan", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reportId: id,
          reportUrl: reportPath,
          cached: true,
        }),
      }),
    );
    const documents = reportDocuments(page, id);
    const violations = await watchScriptViolations(page);

    await page.goto(TOOL_PATH, { waitUntil: "load" });
    await expect.poll(() => isHydrated(page)).toBe(true);
    await page.getByLabel("Website address").fill("example.com");
    await page.getByRole("button", { name: "Check for typos" }).click();

    await expect(page).toHaveURL(new RegExp(`${reportPath}$`));
    await expect(page.locator("mark")).toContainText("recieve");
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatch(NONCE_SOURCE);
    expect(documents[0]).toContain("'strict-dynamic'");
    await expect(
      page.locator("p", { has: page.locator("mark") }),
    ).toContainText("We");
    await expect(
      page.locator("p", { has: page.locator("mark") }),
    ).toContainText("orders every morning.");
    const cta = page.getByRole("link", { name: "Fix it on your live page" });
    await expect(cta).toHaveAttribute("href", /^\/try\?utm_source=tools/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect.poll(() => isHydrated(page)).toBe(true);
    expect(await violations()).toEqual([]);
  });

  test("a report seeded with hostile page text renders it inert", async ({
    page,
  }) => {
    const image = "<img src=x onerror=alert(1)>";
    const script = "<script>alert(document.domain)</script>";
    const id = await seedReport(
      supabase,
      report([
        {
          page: "https://example.com/",
          kind: "typo",
          match: script,
          before: `${image} before `,
          after: ` after ${image}`,
          suggestion: script,
        },
      ]),
    );
    seeded.push(id);
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const violations = await watchScriptViolations(page);

    const response = await page.goto(`${TOOL_PATH}/r/${id}`, {
      waitUntil: "load",
    });

    expect(response?.headers()["content-security-policy"]).toMatch(
      NONCE_SOURCE,
    );
    await expect(page.locator("mark")).toContainText(script);
    await expect(page.getByText(image, { exact: false }).first()).toBeVisible();
    await expect.poll(() => isHydrated(page)).toBe(true);
    expect(await page.locator("main img").count()).toBe(0);
    expect(dialogs).toEqual([]);
    expect(await violations()).toEqual([]);
  });
});
