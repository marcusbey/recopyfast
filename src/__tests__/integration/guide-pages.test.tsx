/**
 * s123 — the owner guides render as answer-first, honest, accessible pages.
 *
 * Rendered through the real route and page modules (only auth is mocked, for
 * the shared Header), so the assertions are about what a visitor and a
 * crawler receive: one H1, headings that never skip a level, the delivery
 * caveat on every guide, sources that open safely, the CTA goals and UTMs,
 * the structured data, and links into the rest of the cluster.
 */

import { render, screen, within } from "@testing-library/react";
import GuideRoute from "@/app/guides/[slug]/page";
import GuidesIndexPage, { metadata as indexMetadata } from "@/app/guides/page";
import Footer from "@/components/layout/Footer";
import { guideCtaLinks } from "@/lib/guides/guide-registry";
import { guideList } from "@/lib/guides/guides";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithMagicLink: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

function headingLevels(container: HTMLElement): number[] {
  return Array.from(
    container.querySelectorAll("main h1, main h2, main h3, main h4"),
  ).map((heading) => Number(heading.tagName.slice(1)));
}

function jsonLd(container: HTMLElement): Record<string, unknown>[] {
  return Array.from(
    container.querySelectorAll('script[type="application/ld+json"]'),
  ).map((script) => JSON.parse(script.textContent ?? "{}"));
}

async function renderGuide(slug: string) {
  return render(await GuideRoute({ params: Promise.resolve({ slug }) }));
}

describe.each(guideList.map((guide) => [guide.slug, guide] as const))(
  "/guides/%s",
  (slug, guide) => {
    it("leads with one H1 and the short answer, and never skips a heading level", async () => {
      const { container } = await renderGuide(slug);

      expect(
        screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent),
      ).toEqual([guide.title]);
      expect(screen.getByText(guide.shortAnswer)).toBeInTheDocument();

      const levels = headingLevels(container);
      expect(levels[0]).toBe(1);
      for (let index = 1; index < levels.length; index += 1) {
        expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
      }
      for (const section of guide.sections) {
        expect(
          screen.getByRole("heading", { level: 2, name: section.heading }),
        ).toBeInTheDocument();
      }
    });

    it("says how ReCopyFast fits, with the after-load and redesign caveats", async () => {
      await renderGuide(slug);

      const fit = screen
        .getByRole("heading", { level: 2, name: "Where ReCopyFast fits" })
        .closest("section") as HTMLElement;
      expect(fit).toHaveTextContent(/applied in the visitor's browser/i);
      expect(fit).toHaveTextContent(/We don't promise any SEO benefit/);
      expect(fit).toHaveTextContent(/we don't warn you about that yet/i);
    });

    it("opens every external link in a new tab with noopener noreferrer", async () => {
      const { container } = await renderGuide(slug);

      const external = Array.from(
        container.querySelectorAll<HTMLAnchorElement>('main a[href^="http"]'),
      );
      expect(external.length).toBeGreaterThanOrEqual(guide.sources.length);
      for (const anchor of external) {
        expect(anchor).toHaveAttribute("target", "_blank");
        expect(anchor.getAttribute("rel")).toMatch(/noopener/);
        expect(anchor.getAttribute("rel")).toMatch(/noreferrer/);
      }
      const sources = within(screen.getByRole("list", { name: "Sources" }));
      for (const source of guide.sources) {
        expect(
          sources.getByRole("link", { name: source.label }),
        ).toHaveAttribute("href", source.href);
      }
    });

    it("ends with the owners, try and trial CTAs as cta_click goals", async () => {
      await renderGuide(slug);
      const links = guideCtaLinks(slug);

      const cta = screen
        .getByRole("heading", {
          level: 2,
          name: "Change your own website words",
        })
        .closest("section") as HTMLElement;
      const expected = [
        ["How it works for business owners", links.owners, "owners"],
        ["Try it on your own site", links.try, "try"],
        ["Start your free trial", links.signup, "signup"],
      ] as const;
      for (const [name, href, target] of expected) {
        const anchor = within(cta).getByRole("link", { name });
        expect(anchor).toHaveAttribute("href", href);
        expect(anchor).toHaveAttribute("data-fast-goal", "cta_click");
        expect(anchor).toHaveAttribute(
          "data-fast-goal-location",
          links.location,
        );
        expect(anchor).toHaveAttribute("data-fast-goal-target", target);
      }
    });

    it("states Article, BreadcrumbList and FAQPage structured data for its own URL", async () => {
      const { container } = await renderGuide(slug);
      const blocks = jsonLd(container);
      const types = blocks.map((block) => block["@type"]);

      expect(types).toEqual(
        expect.arrayContaining(["Article", "BreadcrumbList", "FAQPage"]),
      );
      const article = blocks.find((block) => block["@type"] === "Article");
      expect(article).toMatchObject({
        headline: guide.title,
        url: `http://localhost:3000/guides/${slug}`,
        dateModified: `${guide.reviewedOn}T00:00:00Z`,
        image: ["http://localhost:3000/opengraph-image"],
      });
      const breadcrumbs = blocks.find(
        (block) => block["@type"] === "BreadcrumbList",
      ) as { itemListElement: { item: string }[] };
      expect(breadcrumbs.itemListElement.map((item) => item.item)).toEqual([
        "http://localhost:3000",
        "http://localhost:3000/guides",
        `http://localhost:3000/guides/${slug}`,
      ]);
    });

    it("links its related guides and back to /guides", async () => {
      await renderGuide(slug);

      const related = screen
        .getByRole("heading", { level: 2, name: "Related guides" })
        .closest("section") as HTMLElement;
      const hrefs = within(related)
        .getAllByRole("link")
        .map((anchor) => anchor.getAttribute("href"));
      expect(hrefs).toEqual(guide.related.map((other) => `/guides/${other}`));
      expect(
        within(
          screen.getByRole("navigation", { name: "Breadcrumb" }),
        ).getByRole("link", { name: "Guides for owners" }),
      ).toHaveAttribute("href", "/guides");
    });
  },
);

describe("/guides", () => {
  it("is indexable under its own canonical", () => {
    expect(indexMetadata.alternates?.canonical).toBe("/guides");
    expect(indexMetadata.robots).toBeUndefined();
  });

  it("lists every guide with a link, and one H1", () => {
    render(<GuidesIndexPage />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const guide of guideList) {
      expect(
        screen.getByRole("heading", { level: 2, name: guide.title }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: `Read the guide: ${guide.title}` }),
      ).toHaveAttribute("href", `/guides/${guide.slug}`);
    }
  });

  it("states a Home → Guides BreadcrumbList", () => {
    const { container } = render(<GuidesIndexPage />);
    const breadcrumbs = jsonLd(container).find(
      (block) => block["@type"] === "BreadcrumbList",
    ) as { itemListElement: { name: string; item: string }[] };

    expect(breadcrumbs.itemListElement).toEqual([
      expect.objectContaining({ name: "Home", item: "http://localhost:3000" }),
      expect.objectContaining({
        name: "Guides",
        item: "http://localhost:3000/guides",
      }),
    ]);
  });

  it("tags its CTA block with the guides_index location", () => {
    render(<GuidesIndexPage />);

    const trial = screen.getByRole("link", { name: "Start your free trial" });
    expect(trial).toHaveAttribute("data-fast-goal-location", "guides_index");
    expect(trial.getAttribute("href")).toBe(
      "/signup?utm_source=guides&utm_medium=guide&utm_campaign=owner_guides&utm_content=index",
    );
  });
});

describe("the footer", () => {
  it("links the owner guides", () => {
    render(<Footer />);

    expect(
      screen.getByRole("link", { name: "Guides for owners" }),
    ).toHaveAttribute("href", "/guides");
  });
});
