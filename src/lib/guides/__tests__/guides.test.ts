/**
 * @jest-environment node
 */

/**
 * s123 — the owner guides registry is valid, honest by construction, and
 * every CTA carries the owner_guides campaign and a declared goal location.
 *
 * The negative cases replace one real guide inside the real registry, so a
 * rejection is caused by the one field under test, not by a thin fixture.
 */

import {
  DATAFAST_CTA_LOCATIONS,
  dataFastGuideLocation,
} from "@/lib/analytics/datafast-goals";
import {
  GUIDE_INTERNAL_LINKS,
  GUIDES_INDEX_CTA,
  createGuideMetadata,
  getGuideFromRegistry,
  guideCopy,
  guideCtaLinks,
  guideLinks,
  validateGuideRegistry,
  type Guide,
} from "../guide-registry";
import { getGuide, guideList, guides } from "../guides";

const HOURS = "update-website-hours-without-a-developer";
const UTM =
  /^utm_source=guides&utm_medium=organic&utm_campaign=owner_guides&utm_content=[a-z0-9-]+$/;

function withGuide(overrides: Partial<Guide>, slug: string = HOURS) {
  return {
    ...guides,
    [slug]: { ...guides[slug as keyof typeof guides], ...overrides },
  };
}

describe("the guide registry", () => {
  it("has four to five guides with unique canonical slugs matching their keys", () => {
    expect(guideList.length).toBeGreaterThanOrEqual(4);
    expect(guideList.length).toBeLessThanOrEqual(5);
    const slugs = guideList.map((guide) => guide.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const [key, guide] of Object.entries(guides)) {
      expect(guide.slug).toBe(key);
      expect(guide.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("includes the four owner-intent guides the owner asked for", () => {
    for (const slug of [
      "update-website-hours-without-a-developer",
      "edit-wordpress-text-without-elementor",
      "change-prices-on-your-website-yourself",
      "edit-a-website-someone-else-built",
    ]) {
      expect(getGuide(slug)?.slug).toBe(slug);
    }
  });

  it("gives every guide its required fields, at least 3 sections and 3 FAQs", () => {
    for (const guide of guideList) {
      expect(guide.title.trim()).not.toBe("");
      expect(guide.shortAnswer.length).toBeGreaterThan(80);
      expect(guide.description.length).toBeLessThanOrEqual(160);
      expect(guide.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(guide.sections.length).toBeGreaterThanOrEqual(3);
      expect(guide.faqs.length).toBeGreaterThanOrEqual(3);
      expect(guide.recopyfastFit.length).toBeGreaterThan(0);
      expect(guide.sources.length).toBeGreaterThan(0);
    }
  });

  it("cites only HTTPS sources, and links out only to a listed source", () => {
    for (const guide of guideList) {
      const sources = new Set(guide.sources.map((source) => source.href));
      for (const source of guide.sources) {
        expect(new URL(source.href).protocol).toBe("https:");
      }
      for (const link of guideLinks(guide)) {
        if (link.href.startsWith("/")) continue;
        expect([guide.slug, link.href, sources.has(link.href)]).toEqual([
          guide.slug,
          link.href,
          true,
        ]);
      }
    }
  });

  it("links internally only to known routes or other guides", () => {
    const allowed = new Set<string>([
      ...GUIDE_INTERNAL_LINKS,
      ...guideList.map((guide) => `/guides/${guide.slug}`),
    ]);
    for (const guide of guideList) {
      for (const link of guideLinks(guide)) {
        if (!link.href.startsWith("/")) continue;
        expect(allowed.has(link.href)).toBe(true);
        expect(link.href).not.toBe(`/guides/${guide.slug}`);
      }
    }
  });

  it("cross-links the guides: every related slug exists and none is itself", () => {
    for (const guide of guideList) {
      expect(guide.related.length).toBeGreaterThan(0);
      for (const slug of guide.related) {
        expect(slug).not.toBe(guide.slug);
        expect(getGuide(slug)).not.toBeNull();
      }
    }
  });

  it("never says 'take control', promises SEO, or claims testimonials", () => {
    for (const guide of guideList) {
      const copy = guideCopy(guide).join("\n");
      expect(copy).not.toMatch(/take control/i);
      expect(copy).not.toMatch(/guarantee/i);
      expect(copy).not.toMatch(/(boost|improve)s? (your )?(seo|rankings?)/i);
      expect(copy).not.toMatch(/testimonial|customers love|trusted by/i);
    }
  });

  it("states the per-change cost only as the research brief's typical range", () => {
    const cost = getGuide("how-much-does-a-small-website-change-cost");
    const copy = cost ? guideCopy(cost).join("\n") : "";
    expect(copy).toMatch(/\$50–150/);
    expect(copy).toMatch(/\$100–250/);
    expect(copy).toMatch(/typical/i);
  });

  it("resolves unknown and prototype-shaped slugs to null", () => {
    for (const slug of ["missing", "__proto__", "constructor", "../guides"]) {
      expect(getGuide(slug)).toBeNull();
      expect(getGuideFromRegistry(guides, slug)).toBeNull();
    }
  });
});

describe("validateGuideRegistry", () => {
  it("accepts the shipped registry", () => {
    expect(() => validateGuideRegistry(guides)).not.toThrow();
  });

  it.each<[string, Partial<Guide>, RegExp]>([
    [
      "a banned phrase",
      {
        shortAnswer:
          "Take control of your website today, with plenty of words here.",
      },
      /banned phrase/,
    ],
    [
      "an SEO promise",
      { title: "Edit text and boost your SEO" },
      /banned phrase/,
    ],
    [
      "an uncited external link",
      {
        recopyfastFit: [
          ["See ", { label: "elsewhere", href: "https://example.com/" }, "."],
        ],
      },
      /not a source/,
    ],
    [
      "an unknown internal route",
      {
        recopyfastFit: [["See ", { label: "nowhere", href: "/nowhere" }, "."]],
      },
      /unknown route/,
    ],
    [
      "a self link",
      {
        recopyfastFit: [
          ["See ", { label: "me", href: `/guides/${HOURS}` }, "."],
        ],
      },
      /unknown route/,
    ],
    ["a long description", { description: "x".repeat(161) }, /description/],
    ["too few FAQs", { faqs: [] }, /FAQ/],
    [
      "a related guide that does not exist",
      { related: ["missing"] },
      /related/,
    ],
    [
      "a non-HTTPS source",
      { sources: [{ label: "Insecure", href: "http://example.com/" }] },
      /HTTPS/,
    ],
    ["a bad review date", { reviewedOn: "October 2026" }, /reviewedOn/],
  ])("rejects %s", (_name, overrides, error) => {
    expect(() => validateGuideRegistry(withGuide(overrides))).toThrow(error);
  });

  it("rejects a guide whose cta_click location is not declared (ADR 074)", () => {
    const guide = {
      ...guides[HOURS],
      slug: "brand-new-guide",
      related: [HOURS],
    };
    expect(() =>
      validateGuideRegistry({ ...guides, "brand-new-guide": guide }),
    ).toThrow(/cta_click location/);
  });

  it("rejects a slug that does not match its key", () => {
    expect(() =>
      validateGuideRegistry({ ...guides, other: guides[HOURS] }),
    ).toThrow(/must match key/);
  });
});

describe("guide CTAs", () => {
  it.each(guideList.map((guide) => [guide.slug] as const))(
    "%s links /for/owners, /try and /signup with the owner_guides UTMs",
    (slug) => {
      const links = guideCtaLinks(slug);
      for (const [path, href] of [
        ["/for/owners", links.owners],
        ["/try", links.try],
        ["/signup", links.signup],
      ] as const) {
        const url = new URL(href, "https://recopyfa.st");
        expect(url.pathname).toBe(path);
        expect(url.search.slice(1)).toMatch(UTM);
        expect(url.searchParams.get("utm_content")).toBe(slug);
      }
    },
  );

  it.each(guideList.map((guide) => [guide.slug] as const))(
    "%s has a declared goal location: guide_<slug>, a lowercase slug of at most 64",
    (slug) => {
      const { location } = guideCtaLinks(slug);
      expect(location).toBe(`guide_${slug.replace(/-/g, "_")}`);
      expect(location).toMatch(/^[a-z0-9_-]{1,64}$/);
      expect(DATAFAST_CTA_LOCATIONS).toContain(location);
      expect(dataFastGuideLocation(slug)).toBe(location);
    },
  );

  it("tags the /guides index CTA with its own location and utm_content", () => {
    expect(GUIDES_INDEX_CTA.location).toBe("guides_index");
    expect(GUIDES_INDEX_CTA.owners).toBe(
      "/for/owners?utm_source=guides&utm_medium=organic&utm_campaign=owner_guides&utm_content=index",
    );
  });

  it("refuses a CTA for an undeclared guide", () => {
    expect(() => guideCtaLinks("missing")).toThrow(/cta_click location/);
  });
});

describe("createGuideMetadata", () => {
  it("names the guide's own canonical, an article og:type and the shared share images", () => {
    const guide = guides[HOURS];
    const metadata = createGuideMetadata(guide);
    expect(metadata.alternates?.canonical).toBe(`/guides/${HOURS}`);
    expect(metadata.description).toBe(guide.description);
    expect(metadata.openGraph).toMatchObject({
      type: "article",
      url: `/guides/${HOURS}`,
      images: ["/opengraph-image"],
    });
  });
});
