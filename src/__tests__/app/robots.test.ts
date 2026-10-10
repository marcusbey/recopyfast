/**
 * @jest-environment node
 */

/**
 * s88 — robots.txt agrees with the sitemap and with the noindex pages.
 *
 * Robots rules are prefix matches on the path. Until s88 the dashboard rule was
 * `/dashboard/`, which does not match `/dashboard` itself. And a disallowed page
 * is never fetched, so a `noindex` on it is never read: the noindex pages
 * (/login, /signup, /edit) must stay crawlable, and nothing the sitemap submits
 * may be blocked.
 */

jest.mock("@/lib/supabase/anon", () => ({
  createAnonClient: jest.fn(() => {
    throw new Error("no database in this suite");
  }),
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { resolveSiteUrl } from "@/lib/seo/site-url";

type Rule = { userAgent?: string | string[]; disallow?: string | string[] };

function disallowed(): string[] {
  const rules = ([] as Rule[]).concat(robots().rules as Rule | Rule[]);
  const forEveryone = rules.filter((rule) =>
    ([] as string[]).concat(rule.userAgent ?? []).includes("*"),
  );
  return forEveryone.flatMap((rule) =>
    ([] as string[]).concat(rule.disallow ?? []),
  );
}

function isBlocked(pathname: string): boolean {
  return disallowed().some((prefix) => pathname.startsWith(prefix));
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("robots.txt", () => {
  it.each([
    "/api/pricing",
    "/dashboard",
    "/dashboard/sites/6f1c2b9e",
    "/auth/confirm",
    "/auth/callback",
  ])("blocks %s", (pathname) => {
    expect(isBlocked(pathname)).toBe(true);
  });

  it.each(["/login", "/signup", "/edit"])(
    "leaves %s crawlable so its noindex can be read",
    (pathname) => {
      expect(isBlocked(pathname)).toBe(false);
    },
  );

  it("blocks nothing the sitemap submits", async () => {
    const submitted = (await sitemap()).map(
      (entry) => new URL(entry.url).pathname,
    );

    expect(submitted.length).toBeGreaterThan(0);
    expect(submitted.filter(isBlocked)).toEqual([]);
  });

  it("names the sitemap on the configured origin", () => {
    expect(robots().sitemap).toBe(`${resolveSiteUrl()}/sitemap.xml`);
  });
});
