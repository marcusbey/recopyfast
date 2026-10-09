import nextConfig from "../../next.config";

describe("the /pricing redirect", () => {
  it("sends /pricing permanently to the landing's pricing section", async () => {
    const rules = (await nextConfig.redirects?.()) ?? [];
    const pricingRules = rules.filter((rule) => rule.source === "/pricing");

    expect(pricingRules).toEqual([
      { source: "/pricing", destination: "/#pricing", permanent: true },
    ]);
  });
});

/**
 * s70b: the Content page became Changes. `/dashboard/content` is in
 * bookmarks and in the old sidebar's history, so it answers 308 to the new
 * URL instead of a 404. Config redirects run before middleware, so the
 * session gate then applies to `/dashboard/changes` as to any dashboard page.
 */
describe("the /dashboard/content redirect", () => {
  it("sends /dashboard/content permanently to /dashboard/changes", async () => {
    const rules = (await nextConfig.redirects?.()) ?? [];
    const contentRules = rules.filter(
      (rule) => rule.source === "/dashboard/content",
    );

    expect(contentRules).toEqual([
      {
        source: "/dashboard/content",
        destination: "/dashboard/changes",
        permanent: true,
      },
    ]);
  });
});
