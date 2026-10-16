import { render, screen } from "@testing-library/react";
import { buildComparisonStaticParams } from "@/app/compare/[competitor]/page";
import { CompareIndexContent } from "@/app/compare/page";
import { buildStaticSitemapRoutes } from "@/app/sitemap";
import {
  comparisons,
  defineComparisonRegistry,
  type Comparison,
} from "@/lib/compare/comparisons";
import { buildComparisonLighthouseUrls } from "@/lib/compare/lighthouse";
import { buildLlmsTxt } from "@/lib/seo/llms-txt";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithMagicLink: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

function fixtureComparison(): Comparison {
  return {
    ...comparisons.contentful,
    slug: "fixture-cms",
    competitor: "Fixture CMS",
    title: "ReCopyFast vs Fixture CMS",
    description: "A unique Fixture CMS comparison for extension testing.",
    hubDescription:
      "For proving that a valid registry entry reaches every discovery surface.",
  };
}

describe("comparison engine data-only extension", () => {
  it("flows one valid entry through routes, hub, sitemap, llms.txt, and Lighthouse", () => {
    const registry = defineComparisonRegistry({
      ...comparisons,
      "fixture-cms": fixtureComparison(),
    });
    const entries = Object.values(registry);
    const path = "/compare/fixture-cms";

    expect(buildComparisonStaticParams(entries)).toContainEqual({
      competitor: "fixture-cms",
    });

    render(<CompareIndexContent comparisons={entries} />);
    expect(
      screen.getByRole("link", { name: /compare fixture cms/i }),
    ).toHaveAttribute("href", path);

    expect(
      buildStaticSitemapRoutes(entries).map((route) => route.path),
    ).toContain(path);
    expect(
      buildStaticSitemapRoutes(entries).map((route) => route.path),
    ).toContain("/product");
    expect(buildLlmsTxt("https://recopyfa.st", entries)).toContain(
      `[ReCopyFast vs Fixture CMS](https://recopyfa.st${path})`,
    );
    expect(
      buildComparisonLighthouseUrls("http://127.0.0.1:3000", entries),
    ).toContain(`http://127.0.0.1:3000${path}`);
  });

  it("contains no duplicate alternatives cluster in any generated target", () => {
    const generated = [
      ...buildStaticSitemapRoutes().map((route) => route.path),
      buildLlmsTxt("https://recopyfa.st"),
      ...buildComparisonLighthouseUrls("http://127.0.0.1:3000"),
    ].join("\n");

    expect(generated).not.toContain("/alternatives");
  });
});
