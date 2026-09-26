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
