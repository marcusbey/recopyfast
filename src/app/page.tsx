import type { Metadata } from "next";
import HomePage from "@/components/landing/HomePage";
import { loadCatalogueOffers } from "@/lib/seo/catalogue-offers";
import { buildSoftwareApplicationLd, serializeJsonLd } from "@/lib/seo/json-ld";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_OPEN_GRAPH,
} from "@/lib/seo/site-identity";
import { resolveSiteUrl } from "@/lib/seo/site-url";

/**
 * The homepage names itself. Until s88 the root layout did it for every page at
 * once, which made every page that did not override it a duplicate of this one
 * (see the note on `metadata` in `src/app/layout.tsx`).
 *
 * `openGraph` is restated in full rather than only `url`: a page's `openGraph`
 * replaces its parent's whole object, so a lone `url` would drop the site name,
 * title and description from the homepage's social card.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { ...SITE_OPEN_GRAPH, url: "/" },
};

/**
 * The structured data states catalogue prices, so the page is regenerated on
 * the pricing feed's interval (`/api/pricing` caches for 300 s) and the
 * comparison pages' (ADR 032 §6). The body below is a client tree and is
 * unaffected; only the server-written markup is refreshed.
 */
export const revalidate = 300;

/**
 * A server wrapper (s88) around the landing body, which is a client tree and
 * so can neither export metadata nor read the catalogue. Here the page writes
 * one SoftwareApplication JSON-LD for crawlers — PRD § Technical SEO, deferred
 * from s37 by ADR 032 §5 — with offers from the plan catalogue and nothing it
 * cannot back: no rating, no review, no fallback price.
 */
export default async function Home() {
  const siteUrl = resolveSiteUrl();
  const softwareApplication = buildSoftwareApplicationLd({
    url: siteUrl,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    offers: await loadCatalogueOffers(siteUrl),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(softwareApplication),
        }}
      />
      <HomePage />
    </>
  );
}
