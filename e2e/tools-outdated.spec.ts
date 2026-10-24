import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isHydrated, watchScriptViolations } from "./support/csp-violations";
import { createLocalServiceRoleClient } from "./support/local-supabase";

/**
 * s99 browser proof. The tool page is a static marketing document; the report
 * is seeded directly into disposable local Supabase and opened by nonce URL.
 * No test asks production scan code to contact example.com or any other
 * third-party host.
 */

const SLUG = "outdated-website-checker";
const TOOL_PATH = `/tools/${SLUG}`;
const NONCE_SOURCE = /'nonce-[A-Za-z0-9+/_-]+={0,2}'/;

function report() {
  return {
    v: 1,
    tool: SLUG,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scannedAt: new Date().toISOString(),
    summary: {
      headline: "1 line looks out of date",
      verdict: "fail",
      facts: [
        { label: "Pages checked", value: "1" },
        { label: "Copyright years", value: "1 stale · 0 January grace" },
        { label: "Past dates still presented as upcoming", value: "0" },
        { label: "Dated prices, menus and schedules", value: "0" },
        { label: "Past-year announcements", value: "0" },
        { label: "Past-year seasonal promotions", value: "0" },
        { label: "Out-of-season promotions", value: "0" },
        { label: "Old update labels", value: "0" },
      ],
    },
    findings: [
      {
        page: "https://example.com/",
        kind: "copyright-year",
        match: "2025",
        before: "© ",
        after: " Acme. All rights reserved.",
        note: "The copyright year ends before 2026.",
      },
    ],
    pages: [
      { url: "https://example.com/", status: "checked" },
      {
        url: "https://example.com/fr",
        status: "skipped",
        reason:
          "This page doesn't look like it's written in English, so it wasn't checked.",
      },
    ],
    truncated: false,
  };
}

async function seedReport(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from("tool_reports")
    .insert({
      tool: SLUG,
      cache_key: createHash("sha256").update(randomUUID()).digest("hex"),
      url: "https://example.com/",
      report: report(),
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

test.describe("s99 outdated website checker", () => {
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

  test("the static tool page hydrates with its canonical and no script CSP violation", async ({
    page,
  }) => {
    const scanRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/tools/scan") {
        scanRequests.push(request.url());
      }
    });
    const violations = await watchScriptViolations(page);

    const response = await page.goto(TOOL_PATH, { waitUntil: "load" });

    expect(response?.headers()["content-security-policy"]).not.toMatch(
      NONCE_SOURCE,
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Is your website out of date?",
      }),
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${TOOL_PATH}$`),
    );
    await expect.poll(() => isHydrated(page)).toBe(true);
    expect(scanRequests).toEqual([]);
    expect(await violations()).toEqual([]);
  });

  test("a seeded nonce report renders the copyright finding, skipped page and fix CTA", async ({
    page,
  }) => {
    const id = await seedReport(supabase);
    seeded.push(id);
    const scanRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/tools/scan") {
        scanRequests.push(request.url());
      }
    });
    const policies = reportDocuments(page, id);
    const violations = await watchScriptViolations(page);

    await page.goto(`${TOOL_PATH}/r/${id}`, { waitUntil: "load" });

    await expect(page.getByText("1 line looks out of date")).toBeVisible();
    await expect(page.locator("mark")).toContainText("2025");
    await expect(
      page.getByText("The copyright year ends before 2026."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Pages not checked" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Fix it on your live page" }),
    ).toHaveAttribute("href", /utm_campaign=outdated-website-checker#install$/);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(NONCE_SOURCE);
    expect(policies[0]).toContain("'strict-dynamic'");
    expect(scanRequests).toEqual([]);
    expect(await violations()).toEqual([]);
  });
});
