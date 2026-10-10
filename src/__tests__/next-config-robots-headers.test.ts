import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../../next.config";

/**
 * s88 — the dashboard tells crawlers not to index it.
 *
 * The auth redirect already keeps crawlers out and robots.txt disallows the
 * path, so this is the third line: a crawler that ignores robots.txt and
 * reaches a dashboard response still reads noindex. Since s88's review the
 * layout's `robots` metadata says the same in the HTML; that the two agree is
 * pinned in `src/__tests__/app/seo-canonicals.test.ts`.
 *
 * Sources are compiled with `getPathMatch`, the helper Next itself uses for
 * `headers()` sources, so `/dashboard/:path*` is checked against the real
 * matcher — including whether it covers the bare `/dashboard`.
 */

type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

async function robotsTagFor(pathname: string): Promise<string[]> {
  const rules = ((await nextConfig.headers?.()) ?? []) as HeaderRule[];

  return rules
    .filter((rule) => getPathMatch(rule.source)(pathname) !== false)
    .flatMap((rule) => rule.headers)
    .filter((header) => header.key.toLowerCase() === "x-robots-tag")
    .map((header) => header.value);
}

describe("X-Robots-Tag", () => {
  it.each(["/dashboard", "/dashboard/sites/6f1c2b9e", "/dashboard/billing"])(
    "marks %s noindex, nofollow",
    async (pathname) => {
      expect(await robotsTagFor(pathname)).toEqual(["noindex, nofollow"]);
    },
  );

  it.each(["/", "/blog", "/blog/a-post", "/docs/install", "/try", "/login"])(
    "leaves %s to its own metadata",
    async (pathname) => {
      expect(await robotsTagFor(pathname)).toEqual([]);
    },
  );

  it("does not reach a route that only shares the prefix", async () => {
    expect(await robotsTagFor("/dashboards-are-not-a-route")).toEqual([]);
  });
});
