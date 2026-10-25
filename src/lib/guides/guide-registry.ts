import type { Metadata } from "next";
import {
  dataFastGuideLocation,
  type DataFastCtaLocation,
} from "@/lib/analytics/datafast-goals";
import { resolveSiteUrl } from "@/lib/seo/site-url";
import { SITE_NAME } from "@/lib/seo/site-identity";

/**
 * The owner guides cluster (s123): typed content, one `[slug]` route, the
 * sitemap, llms.txt and the Lighthouse gate all read the same registry
 * (ADR 012). This file holds the types, the module-load validator and the
 * helpers; the copy itself lives in `guides.ts`.
 *
 * WHY THE VALIDATOR IS STRICT. These pages are written for business owners
 * who arrive cold from a search engine, and every claim on them is bounded by
 * the s120 owner-page rules (src/components/landing/owners/OwnersPage.tsx):
 * no "take control", no SEO promise for edited copy, no invented numbers.
 * The checks below turn the mechanical part of those rules into a load-time
 * failure instead of a reviewer's memory:
 * - an external link must be one of the guide's listed sources, so a fact
 *   cannot be cited from somewhere nobody recorded;
 * - an internal link must be a known public route or another guide, so a
 *   rename cannot leave a guide pointing at a 404;
 * - banned phrases ("take control", SEO promises, guarantees) fail the build;
 * - every guide needs its DataFast `cta_click` location declared in the one
 *   taxonomy file (ADR 074), or the registry refuses to load.
 */

export type GuideLink = {
  readonly label: string;
  readonly href: string;
};

/** Plain text, or text with inline links (internal routes or sources). */
export type RichText = string | readonly (string | GuideLink)[];

export type GuideBlock =
  | { readonly kind: "paragraph"; readonly text: RichText }
  | { readonly kind: "steps"; readonly items: readonly RichText[] }
  | { readonly kind: "list"; readonly items: readonly RichText[] }
  | { readonly kind: "checklist"; readonly items: readonly RichText[] }
  | { readonly kind: "note"; readonly text: RichText };

export type GuideSection = {
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly GuideBlock[];
};

export type GuideFaq = {
  readonly question: string;
  readonly answer: string;
};

export type GuideSource = {
  readonly label: string;
  readonly href: string;
};

export type Guide = {
  readonly slug: string;
  /** The H1 and the metadata title. */
  readonly title: string;
  readonly description: string;
  /** One line for the /guides card and llms.txt. */
  readonly hubDescription: string;
  /** The answer, first, before any section. */
  readonly shortAnswer: string;
  /** ISO date the facts were last checked against the sources. */
  readonly reviewedOn: string;
  readonly sections: readonly GuideSection[];
  /** "Where ReCopyFast fits", in this guide's terms. */
  readonly recopyfastFit: readonly RichText[];
  readonly faqs: readonly GuideFaq[];
  readonly sources: readonly GuideSource[];
  /** Slugs of other guides, shown as related reading. */
  readonly related: readonly string[];
};

export const GUIDES_PATH = "/guides";

/**
 * Public routes a guide may link to. Everything here is in the sitemap
 * except `/#pricing` (the homepage section).
 */
export const GUIDE_INTERNAL_LINKS = [
  "/for/owners",
  "/try",
  "/#pricing",
  "/docs/install",
  "/docs/install/wordpress",
  "/docs/install/for-developers",
  "/tools/website-maintenance-cost",
  GUIDES_PATH,
] as const;

/**
 * Phrases no guide may contain. "Take control" reads as domain, hosting and
 * logins to a ghosted owner (research, site-owner angle §5), which we do not
 * give; the rest would be SEO or outcome promises the delivery model cannot
 * keep (edits are applied after load — ADR 032, llms-txt.ts).
 */
const FORBIDDEN_PHRASES = [
  /take control/i,
  /guarantee/i,
  /rank (higher|better|first)/i,
  /(boost|improve)s? (your )?(seo|search ranking|rankings)/i,
  /seo[- ]friendly edits/i,
  /testimonial/i,
] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DESCRIPTION_MAX = 160;

function requireText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
}

function richParts(text: RichText): readonly (string | GuideLink)[] {
  return typeof text === "string" ? [text] : text;
}

function blockTexts(block: GuideBlock): readonly RichText[] {
  return block.kind === "paragraph" || block.kind === "note"
    ? [block.text]
    : block.items;
}

function isExternalHttps(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === ""
    );
  } catch {
    return false;
  }
}

/** Every string a guide renders, for the phrase and uniqueness checks. */
export function guideCopy(guide: Guide): string[] {
  const out: string[] = [
    guide.title,
    guide.description,
    guide.hubDescription,
    guide.shortAnswer,
  ];
  const pushRich = (text: RichText) => {
    for (const part of richParts(text)) {
      out.push(typeof part === "string" ? part : part.label);
    }
  };
  for (const section of guide.sections) {
    out.push(section.heading);
    for (const block of section.blocks) blockTexts(block).forEach(pushRich);
  }
  guide.recopyfastFit.forEach(pushRich);
  for (const faq of guide.faqs) out.push(faq.question, faq.answer);
  return out;
}

/** Every inline link a guide renders. */
export function guideLinks(guide: Guide): GuideLink[] {
  const links: GuideLink[] = [];
  const collect = (text: RichText) => {
    for (const part of richParts(text)) {
      if (typeof part !== "string") links.push(part);
    }
  };
  for (const section of guide.sections) {
    for (const block of section.blocks) blockTexts(block).forEach(collect);
  }
  guide.recopyfastFit.forEach(collect);
  return links;
}

function validateGuide(guide: Guide, slugs: ReadonlySet<string>): void {
  const at = guide.slug;
  for (const [field, value] of Object.entries({
    title: guide.title,
    description: guide.description,
    hubDescription: guide.hubDescription,
    shortAnswer: guide.shortAnswer,
  })) {
    requireText(value, `${at}.${field}`);
  }
  if (guide.description.length > DESCRIPTION_MAX) {
    throw new Error(`${at}.description must be at most ${DESCRIPTION_MAX}`);
  }
  if (!ISO_DATE.test(guide.reviewedOn)) {
    throw new Error(`${at}.reviewedOn must be YYYY-MM-DD`);
  }

  if (guide.sections.length < 3) {
    throw new Error(`${at} must contain at least 3 sections`);
  }
  const sectionIds = new Set<string>();
  for (const section of guide.sections) {
    if (!SLUG.test(section.id) || sectionIds.has(section.id)) {
      throw new Error(`${at} section id "${section.id}" must be a unique slug`);
    }
    sectionIds.add(section.id);
    requireText(section.heading, `${at}.${section.id}.heading`);
    if (section.blocks.length === 0) {
      throw new Error(`${at}.${section.id} must contain a block`);
    }
    for (const block of section.blocks) {
      const texts = blockTexts(block);
      if (texts.length === 0) {
        throw new Error(`${at}.${section.id} has an empty ${block.kind}`);
      }
    }
  }
  if (guide.recopyfastFit.length === 0) {
    throw new Error(`${at}.recopyfastFit must not be empty`);
  }

  const questions = guide.faqs.map((faq, index) => {
    requireText(faq.question, `${at}.faqs[${index}].question`);
    requireText(faq.answer, `${at}.faqs[${index}].answer`);
    return faq.question.trim().toLowerCase();
  });
  if (questions.length < 3 || new Set(questions).size !== questions.length) {
    throw new Error(`${at} must contain at least 3 unique FAQ items`);
  }

  const sourceHrefs = new Set<string>();
  for (const source of guide.sources) {
    requireText(source.label, `${at}.sources label`);
    if (!isExternalHttps(source.href) || sourceHrefs.has(source.href)) {
      throw new Error(`${at} sources must be unique HTTPS URLs`);
    }
    sourceHrefs.add(source.href);
  }
  if (sourceHrefs.size === 0) {
    throw new Error(`${at} must cite at least one source`);
  }

  const internal = new Set<string>(GUIDE_INTERNAL_LINKS);
  for (const link of guideLinks(guide)) {
    requireText(link.label, `${at} link label`);
    if (link.href.startsWith("/")) {
      const guideSlug = link.href.startsWith(`${GUIDES_PATH}/`)
        ? link.href.slice(GUIDES_PATH.length + 1)
        : null;
      const isKnownGuide =
        guideSlug !== null && guideSlug !== at && slugs.has(guideSlug);
      if (!internal.has(link.href) && !isKnownGuide) {
        throw new Error(`${at} links to unknown route ${link.href}`);
      }
    } else if (!sourceHrefs.has(link.href)) {
      throw new Error(`${at} links to ${link.href}, which is not a source`);
    }
  }

  if (
    guide.related.length === 0 ||
    new Set(guide.related).size !== guide.related.length ||
    guide.related.some((slug) => slug === at || !slugs.has(slug))
  ) {
    throw new Error(`${at}.related must name other existing guides`);
  }

  for (const text of guideCopy(guide)) {
    const banned = FORBIDDEN_PHRASES.find((phrase) => phrase.test(text));
    if (banned) {
      throw new Error(`${at} contains a banned phrase (${banned.source})`);
    }
  }

  if (!dataFastGuideLocation(at)) {
    throw new Error(
      `${at} has no cta_click location in datafast-goals.ts (ADR 074)`,
    );
  }
}

/**
 * Runtime validation on top of the types, for the same reason the
 * comparison registry has it (ADR 012): a data-only addition must not be
 * able to satisfy TypeScript while shipping a thin or unsafe page.
 */
export function validateGuideRegistry(
  registry: Readonly<Record<string, Guide>>,
): void {
  const entries = Object.entries(registry);
  if (entries.length === 0) {
    throw new Error("guide registry must not be empty");
  }
  const slugs = new Set<string>();
  for (const [key, guide] of entries) {
    if (guide.slug !== key) {
      throw new Error(`guide slug "${guide.slug}" must match key "${key}"`);
    }
    if (!SLUG.test(guide.slug)) {
      throw new Error(`guide slug "${guide.slug}" is not canonical`);
    }
    slugs.add(guide.slug);
  }

  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const [, guide] of entries) {
    validateGuide(guide, slugs);
    const title = guide.title.trim().toLowerCase();
    const description = guide.description.trim().toLowerCase();
    if (titles.has(title) || descriptions.has(description)) {
      throw new Error("guide titles and descriptions must be unique");
    }
    titles.add(title);
    descriptions.add(description);
  }
}

export function defineGuideRegistry<
  const Registry extends Readonly<Record<string, Guide>>,
>(registry: Registry): Registry {
  validateGuideRegistry(registry);
  return registry;
}

export function getGuideFromRegistry(
  registry: Readonly<Record<string, Guide>>,
  slug: string,
): Guide | null {
  return Object.hasOwn(registry, slug) ? (registry[slug] ?? null) : null;
}

export function guidePath(slug: string): string {
  return `${GUIDES_PATH}/${slug}`;
}

export function guideSiteUrl(path: string): string {
  return `${resolveSiteUrl()}${path}`;
}

/**
 * Campaign tags on every guide CTA (s123). `utm_content` is the guide slug,
 * or `index` on /guides, so DataFast and GA can tell the pages apart.
 * `utm_medium=guide`, not `organic`: GA4's default channel grouping reads
 * `organic` as Organic Search, and these are clicks from our own pages.
 */
export function guideUtmQuery(content: string): string {
  return `utm_source=guides&utm_medium=guide&utm_campaign=owner_guides&utm_content=${encodeURIComponent(content)}`;
}

export type GuideCtaLinks = {
  readonly location: DataFastCtaLocation;
  readonly owners: string;
  readonly try: string;
  readonly signup: string;
};

/** The three CTA destinations and the goal location for one guide. */
export function guideCtaLinks(slug: string): GuideCtaLinks {
  const location = dataFastGuideLocation(slug);
  if (!location) {
    throw new Error(`guide ${slug} has no cta_click location`);
  }
  return ctaLinks(location, slug);
}

export const GUIDES_INDEX_CTA: GuideCtaLinks = ctaLinks(
  "guides_index",
  "index",
);

function ctaLinks(location: DataFastCtaLocation, content: string) {
  const query = guideUtmQuery(content);
  return {
    location,
    owners: `/for/owners?${query}`,
    try: `/try?${query}`,
    signup: `/signup?${query}`,
  };
}

export function createGuideMetadata(guide: Guide): Metadata {
  const canonical = guidePath(guide.slug);
  return {
    title: { absolute: `${guide.title} | ${SITE_NAME}` },
    description: guide.description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      siteName: SITE_NAME,
      title: guide.title,
      description: guide.description,
      locale: "en_US",
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: guide.title,
      description: guide.description,
      images: ["/twitter-image"],
    },
  };
}
