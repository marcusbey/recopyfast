/**
 * s98: the calculator page's SEO, structured data, claims and static render.
 *
 * The page is a static server component: `useSearchParams` in the client
 * calculator would otherwise turn the whole route dynamic, which Next avoids
 * only when the hook sits under a `Suspense` boundary. The build route table
 * (`○`) is the end-to-end check; the source assertion below keeps the cause
 * from regressing unnoticed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import * as pageModule from "@/app/tools/website-maintenance-cost/page";
import MaintenanceCostPage, {
  metadata,
} from "@/app/tools/website-maintenance-cost/page";
import { FAQS, TOOL_PATH } from "@/lib/tools/maintenance-cost/copy";
import { resolveSiteUrl } from "@/lib/seo/site-url";

jest.mock("server-only", () => ({}));
jest.mock("@/components/layout/Header", () => ({ Header: () => null }));
jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/tools/maintenance-cost/CostCalculator", () => ({
  CostCalculator: ({ siteOrigin }: { siteOrigin: string }) => (
    <div data-testid="calculator" data-origin={siteOrigin} />
  ),
}));

const siteUrl = resolveSiteUrl();
const PAGE_URL = `${siteUrl}/tools/website-maintenance-cost`;

function renderPage() {
  return render(<MaintenanceCostPage />);
}

function jsonLd(container: HTMLElement): Record<string, unknown>[] {
  return Array.from(
    container.querySelectorAll('script[type="application/ld+json"]'),
    (node) => JSON.parse(node.textContent ?? "{}"),
  );
}

describe("metadata", () => {
  it("names its own path as canonical and og:url", () => {
    // The merged, absolute form is pinned in seo-canonicals.test.ts, which
    // resolves it through Next's own metadata merge (node environment).
    expect(metadata.alternates?.canonical).toBe(TOOL_PATH);
    expect((metadata.openGraph as { url?: string }).url).toBe(TOOL_PATH);
    expect(metadata.robots).toBeUndefined();
  });

  it("sets Open Graph and Twitter titles and a description", () => {
    expect(metadata.description).toMatch(/calculated in your browser/);
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      title: expect.stringContaining("What free copy changes cost you"),
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });
});

describe("structured data", () => {
  it("emits WebApplication, BreadcrumbList and FAQPage", () => {
    const { container } = renderPage();
    const types = jsonLd(container).map((block) => block["@type"]);

    expect(types).toEqual(["WebApplication", "BreadcrumbList", "FAQPage"]);
  });

  it("describes a free web utility at the canonical URL", () => {
    const { container } = renderPage();
    const app = jsonLd(container)[0];

    expect(app).toMatchObject({
      "@type": "WebApplication",
      url: PAGE_URL,
      isAccessibleForFree: true,
      offers: { price: 0, priceCurrency: "USD" },
    });
    expect(app).not.toHaveProperty("aggregateRating");
    expect(app).not.toHaveProperty("review");
  });

  it("crumbs Home then the page, with no /tools crumb until that route exists", () => {
    const { container } = renderPage();
    const crumbs = jsonLd(container)[1].itemListElement as {
      position: number;
      item: string;
    }[];

    expect(crumbs.map((crumb) => crumb.item)).toEqual([siteUrl, PAGE_URL]);
  });

  it("states in FAQPage exactly the FAQ the page shows", () => {
    const { container, getByText } = renderPage();
    const faq = jsonLd(container)[2].mainEntity as {
      name: string;
      acceptedAnswer: { text: string };
    }[];

    expect(faq.map((item) => item.name)).toEqual(
      FAQS.map((item) => item.question),
    );
    for (const item of FAQS) {
      expect(getByText(item.question)).toBeInTheDocument();
      expect(getByText(item.answer)).toBeInTheDocument();
    }
    expect(faq.map((item) => item.acceptedAnswer.text)).toEqual(
      FAQS.map((item) => item.answer),
    );
  });
});

describe("page content", () => {
  it("has one h1 and passes the server-resolved origin to the calculator", () => {
    const { container, getByTestId } = renderPage();

    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("What free copy changes cost you");
    expect(getByTestId("calculator")).toHaveAttribute("data-origin", siteUrl);
  });

  it("states the honesty line near the top of the page copy", () => {
    const { container } = renderPage();

    expect(container.textContent).toMatch(
      /everything is calculated|your own numbers/i,
    );
  });

  it("makes none of the claims the launch kit forbids", () => {
    const { container } = renderPage();
    const text = container.textContent ?? "";

    for (const forbidden of [
      /time.?saved/i,
      /save \d+/i,
      /free plan/i,
      /free forever/i,
      /instantly/i,
      /any website/i,
      /testimonial/i,
      /money-back/i,
      /no login/i,
      /works everywhere/i,
      /lightweight/i,
    ]) {
      expect([String(forbidden), forbidden.test(text)]).toEqual([
        String(forbidden),
        false,
      ]);
    }
  });

  it("sends the sign-up CTA through a native anchor with the tools UTMs", () => {
    const { container } = renderPage();
    const signup = container.querySelector('a[href^="/signup"]');

    expect(signup).not.toBeNull();
    expect(signup?.getAttribute("href")).toBe(
      "/signup?utm_source=tools&utm_medium=free_tool&utm_campaign=website-maintenance-cost",
    );
  });

  it("offers the /try CTA as desktop only", () => {
    const { container } = renderPage();
    const tryLink = container.querySelector('a[href^="/try"]');

    expect(tryLink?.getAttribute("href")).toBe(
      "/try?utm_source=tools&utm_medium=free_tool&utm_campaign=website-maintenance-cost#install",
    );
    expect(container.textContent).toMatch(/\(desktop\)/);
  });
});

describe("static rendering", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/tools/website-maintenance-cost/page.tsx"),
    "utf8",
  );

  it("does not opt into dynamic rendering", () => {
    expect((pageModule as Record<string, unknown>).dynamic).toBeUndefined();
    expect(source).not.toMatch(/force-dynamic/);
  });

  it("wraps the calculator, which reads the URL, in Suspense", () => {
    expect(source).toMatch(/<Suspense[\s\S]*<CostCalculator/);
  });

  it("reads the origin on the server, never from window.location", () => {
    expect(source).toMatch(/resolveSiteUrl\(\)/);
    expect(source).not.toMatch(/window\.location/);
  });
});
