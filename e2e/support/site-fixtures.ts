import type { Page } from "@playwright/test";
import { buildEmbedScript } from "../../src/lib/sites/embed-script";

/**
 * Fixture data for the site pages harness (s66c1), so no real token or
 * address reaches a capture: every token is bullets, every address is
 * @example.com, and the seeded site's domain already ends in `.invalid`.
 *
 * `routeShareList` is the s66a idea from `e2e/app-layout.spec.ts`, copied
 * here so the site pages spec owns its own fixtures.
 */

/** Exactly 60 characters, as s66a AC 2 specifies. */
export const LONG_LINK_LABEL =
  "Client review: homepage hero, pricing tables and footer copy";

/** A real snippet's length, so a fixture reproduces a real one's wrapping. */
export const FIXTURE_TOKEN = "•".repeat(160);

export function fixtureEmbedScript(siteId: string): string {
  return buildEmbedScript({
    siteId,
    siteToken: FIXTURE_TOKEN,
    appUrl: "https://www.recopyfa.st",
    wsUrl: "wss://recopyfast-ws.fly.dev",
  });
}

/** The preview-link list, one row with a 60-character label. */
export async function routeShareList(page: Page): Promise<void> {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  await page.route(
    (url) => url.pathname === "/api/staging/access",
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          accessList: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              type: "invite",
              email: "reviewer.pending@example.com",
              emailVerified: false,
              permissions: ["view", "edit"],
              label: LONG_LINK_LABEL,
              expiresAt: new Date(now + 6 * day).toISOString(),
              isActive: true,
              lastUsedAt: null,
              createdAt: new Date(now - day).toISOString(),
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              type: "invite",
              email: "reviewer.expired@example.com",
              emailVerified: true,
              permissions: ["view"],
              label: null,
              expiresAt: new Date(now - 2 * day).toISOString(),
              isActive: true,
              lastUsedAt: new Date(now - 3 * day).toISOString(),
              createdAt: new Date(now - 9 * day).toISOString(),
            },
          ],
        }),
      });
    },
  );
}

/**
 * Passes `GET /api/sites` through to the real route and replaces each install
 * credential it minted with bullets. The pages under test render the seeded
 * site exactly as the server returns it, except for the one value a capture
 * must never show.
 */
export async function routeSitesWithFixtureCredentials(
  page: Page,
): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/sites",
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as {
        sites?: Array<{ id: string; siteToken?: string }>;
      };
      const sites = (body.sites ?? []).map((site) =>
        site.siteToken
          ? {
              ...site,
              siteToken: FIXTURE_TOKEN,
              embedScript: fixtureEmbedScript(site.id),
            }
          : site,
      );
      await route.fulfill({ response, json: { ...body, sites } });
    },
  );
}

export interface FixtureSite {
  id: string;
  name: string;
  domain: string;
  siteToken: string;
}

/** Answers `GET /api/sites` with these sites only, as an admin of each. */
export async function routeSites(
  page: Page,
  sites: readonly FixtureSite[],
): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/sites",
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sites: sites.map((site) => ({
            id: site.id,
            name: site.name,
            domain: site.domain,
            created_at: "2026-10-01T00:00:00.000Z",
            updated_at: "2026-10-07T00:00:00.000Z",
            status: "live",
            live_at: "2026-10-02T00:00:00.000Z",
            last_reported_at: "2026-10-07T00:00:00.000Z",
            last_mismatch_domain: null,
            last_mismatch_at: null,
            stats: {
              content_elements_count: 0,
              edits_count: 0,
              views: 0,
              last_activity: null,
            },
            permission: "admin",
            siteToken: site.siteToken,
            embedScript: buildEmbedScript({
              siteId: site.id,
              siteToken: site.siteToken,
              appUrl: "https://www.recopyfa.st",
            }),
          })),
        }),
      });
    },
  );
}
