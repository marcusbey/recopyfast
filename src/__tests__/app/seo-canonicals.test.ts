/**
 * @jest-environment node
 */

/**
 * s88 — every public page names its own URL to search engines.
 *
 * Until s88 the root layout set `alternates.canonical: "/"` and
 * `openGraph.url: "/"`. Next merges metadata per top-level key: a page that
 * does not set `alternates` inherits its parent's, so /blog, every blog post,
 * /privacy, /terms, /demo — and /edit, which also says noindex — each told
 * search engines it was a duplicate of the homepage.
 *
 * These tests resolve every route through Next's own `accumulateMetadata`, the
 * function the App Router runs on the layout → page chain, so they check the
 * merge Next performs and not a re-implementation of it. Asserting on a page's
 * `metadata` export alone would have passed on the bug: the pages that were
 * wrong exported nothing at all.
 */

jest.mock("server-only", () => ({}));

// The homepage body is a client tree (WebGL sky, Lenis, the founding-offer
// fetch); only the server wrapper's metadata is under test here.
jest.mock("@/components/landing/HomePage", () => ({
  __esModule: true,
  default: () => null,
}));

import type { Metadata } from "next";
import type { ResolvedMetadata } from "next/dist/lib/metadata/types/metadata-interface";
import { accumulateMetadata } from "next/dist/lib/metadata/resolve-metadata";
import { metadata as rootMetadata } from "@/app/layout";
import { comparisonList } from "@/lib/compare/comparisons";
import { resolveSiteUrl } from "@/lib/seo/site-url";

type PageModule<P> = {
  metadata?: Metadata;
  generateMetadata?: (
    props: { params: Promise<P> },
    parent: Promise<ResolvedMetadata>,
  ) => Promise<Metadata> | Metadata;
};

type Layer =
  | Metadata
  | null
  | (((parent: Promise<ResolvedMetadata>) => Promise<Metadata> | Metadata) & {
      $$original: unknown;
    });

/**
 * One segment's contribution, the way Next hands it to `accumulateMetadata`:
 * a static export as-is, a `generateMetadata` as a resolver of the parent.
 */
function layerOf<P extends Record<string, string>>(
  mod: PageModule<P> | undefined,
  params: P = {} as P,
): Layer {
  if (mod?.generateMetadata) {
    const generate = mod.generateMetadata;
    const resolver = (parent: Promise<ResolvedMetadata>) =>
      generate({ params: Promise.resolve(params) }, parent);
    return Object.assign(resolver, { $$original: generate });
  }
  return mod?.metadata ?? null;
}

async function resolve(
  pathname: string,
  layers: Layer[],
): Promise<ResolvedMetadata> {
  return accumulateMetadata(
    pathname,
    [[rootMetadata, null], ...layers.map((layer) => [layer, null])] as never,
    Promise.resolve(pathname),
    { trailingSlash: false, isStaticMetadataRouteFile: false },
  );
}

const siteUrl = resolveSiteUrl();
const HOME = siteUrl;

function absolute(pathname: string): string {
  return pathname === "/" ? HOME : `${siteUrl}${pathname}`;
}

function canonicalOf(resolved: ResolvedMetadata): string | null {
  const url = resolved.alternates?.canonical?.url;
  return url ? String(url) : null;
}

function ogUrlOf(resolved: ResolvedMetadata): string | null {
  const url = resolved.openGraph?.url;
  return url ? String(url) : null;
}

type Route = { path: string; layers: () => Promise<Layer[]> };

const comparisonRoutes: Route[] = comparisonList.map((comparison) => ({
  path: `/compare/${comparison.slug}`,
  layers: async () => [
    layerOf(await import(`@/app/compare/${comparison.slug}/page`)),
  ],
}));

/** Every page a search engine should index, with its segment chain. */
const INDEXABLE: Route[] = [
  { path: "/", layers: async () => [layerOf(await import("@/app/page"))] },
  {
    path: "/demo",
    // The page is a client component; its metadata lives in the segment layout.
    layers: async () => [layerOf(await import("@/app/demo/layout")), null],
  },
  {
    path: "/try",
    layers: async () => [layerOf(await import("@/app/try/page"))],
  },
  {
    path: "/compare",
    layers: async () => [layerOf(await import("@/app/compare/page"))],
  },
  ...comparisonRoutes,
  {
    path: "/blog",
    layers: async () => [layerOf(await import("@/app/blog/page"))],
  },
  {
    path: "/blog/client-editing-guide",
    layers: async () => [
      layerOf(await import("@/app/blog/[slug]/page"), {
        slug: "client-editing-guide",
      }),
    ],
  },
  {
    path: "/privacy",
    layers: async () => [layerOf(await import("@/app/privacy/page"))],
  },
  {
    path: "/terms",
    layers: async () => [layerOf(await import("@/app/terms/page"))],
  },
  {
    path: "/docs/install",
    layers: async () => [layerOf(await import("@/app/docs/install/page"))],
  },
];

describe("the root layout", () => {
  it("names no canonical and no og:url for the pages beneath it", () => {
    // The defect itself: anything set here is inherited by every page that
    // does not override it, and most pages do not.
    expect(rootMetadata.alternates).toBeUndefined();
    expect(
      (rootMetadata.openGraph as { url?: unknown } | undefined)?.url,
    ).toBeUndefined();
  });

  it("still gives every page an absolute base for relative URLs", () => {
    expect(String(rootMetadata.metadataBase)).toBe(`${siteUrl}/`);
  });
});

describe("indexable pages", () => {
  it.each(INDEXABLE.map((route) => [route.path, route] as const))(
    "%s resolves a canonical to itself",
    async (path, route) => {
      const resolved = await resolve(path, await route.layers());

      expect(canonicalOf(resolved)).toBe(absolute(path));
      expect(resolved.robots?.basic ?? "").not.toMatch(/noindex/);
    },
  );

  it.each(
    INDEXABLE.filter((route) => route.path !== "/").map(
      (route) => [route.path, route] as const,
    ),
  )("%s never resolves the homepage as its og:url", async (path, route) => {
    const resolved = await resolve(path, await route.layers());

    expect(ogUrlOf(resolved)).not.toBe(HOME);
  });

  it("the homepage keeps its own og:url", async () => {
    const resolved = await resolve("/", [layerOf(await import("@/app/page"))]);

    expect(ogUrlOf(resolved)).toBe(HOME);
  });
});

/**
 * Pages with nothing for a search index: auth forms, the editor's sign-in and
 * the auth error page. They stay crawlable (robots.txt does not block them) so
 * the noindex can be read, and they name no canonical — /edit used to send
 * noindex and a canonical to the homepage at once.
 */
const NOINDEX: Route[] = [
  {
    path: "/login",
    layers: async () => [layerOf(await import("@/app/login/layout")), null],
  },
  {
    path: "/signup",
    layers: async () => [layerOf(await import("@/app/signup/layout")), null],
  },
  {
    path: "/edit",
    layers: async () => [layerOf(await import("@/app/edit/page"))],
  },
  {
    path: "/auth/error",
    layers: async () => [layerOf(await import("@/app/auth/error/page"))],
  },
];

describe("pages that must not be indexed", () => {
  it.each(NOINDEX.map((route) => [route.path, route] as const))(
    "%s resolves noindex and no canonical",
    async (path, route) => {
      const resolved = await resolve(path, await route.layers());

      expect(resolved.robots?.basic).toMatch(/\bnoindex\b/);
      expect(canonicalOf(resolved)).toBeNull();
    },
  );
});
