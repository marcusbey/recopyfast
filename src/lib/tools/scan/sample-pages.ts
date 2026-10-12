/**
 * Which pages beyond the homepage a multi-page lens reads (s96, plan decision
 * 10).
 *
 * - `<final origin>/sitemap.xml` — the origin the homepage REDIRECTED to, so
 *   `example.com → www.example.com` samples www's pages, not a dead host's.
 * - At most two sitemap fetches: the file, and one same-host child when the
 *   file is an index. An index inside an index is not followed.
 * - `<loc>` is read by a linear scanner, never an XML parser: there is no DTD
 *   handling and therefore no entity expansion (billion laughs, XXE). An
 *   entity reference stays the literal text `&xxe;`, which is not a URL.
 * - Pages on the FINAL host only, normalised exactly like a submitted URL
 *   (query and fragment dropped, default ports only), non-HTML files dropped,
 *   deduplicated, shallowest first, then shortest, then alphabetical — so the
 *   same site always samples the same pages.
 * - No usable sitemap → the homepage's own same-host links.
 */

import { normalizeScanUrl, type PortRule } from "./normalize-url";

export const MAX_SAMPLED_PAGES = 9;
const MAX_LOCATIONS = 5_000;
const MAX_LOCATION_LENGTH = 2_048;

const NON_HTML_EXTENSIONS =
  /\.(?:pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp[34]|mov|webm|avi|wav|ogg|zip|gz|tgz|rar|7z|xml|json|txt|csv|css|js|mjs|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|odt|rtf|exe|dmg|apk)$/i;

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeLocation(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("<![CDATA[") && value.endsWith("]]>")) {
    value = value.slice(9, -3).trim();
  }
  return value.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (entity) => XML_ENTITIES[entity],
  );
}

export interface SitemapLocations {
  isIndex: boolean;
  locations: string[];
}

/**
 * Every `<loc>…</loc>` value, in order, capped. Each scan position only moves
 * forward, so the cost is linear in the body even when tags never close.
 */
export function readSitemapLocations(body: string): SitemapLocations {
  const locations: string[] = [];

  if (!body.includes("<")) {
    // A plain-text sitemap: one URL per line (sitemaps.org §"Text file").
    for (const line of body.split(/\r?\n/)) {
      if (locations.length >= MAX_LOCATIONS) break;
      const value = line.trim();
      if (value && value.length <= MAX_LOCATION_LENGTH) locations.push(value);
    }
    return { isIndex: false, locations };
  }

  const isIndex = /<sitemapindex[\s>]/i.test(body.slice(0, 4_096));
  let position = 0;
  while (locations.length < MAX_LOCATIONS) {
    const open = body.indexOf("<loc>", position);
    if (open === -1) break;
    const start = open + 5;
    const close = body.indexOf("</loc>", start);
    if (close === -1) break;
    position = close + 6;
    if (close - start > MAX_LOCATION_LENGTH + 32) continue;
    const value = decodeLocation(body.slice(start, close));
    if (value) locations.push(value);
  }
  return { isIndex, locations };
}

function depthOf(pathname: string): number {
  return pathname.split("/").filter(Boolean).length;
}

/**
 * The pages to read, from candidate URLs: same host as `finalUrl`, HTML-like,
 * not the homepage itself, deduplicated and ordered shallow → deep.
 */
export function selectPages(
  candidates: readonly string[],
  finalUrl: string,
  max: number = MAX_SAMPLED_PAGES,
  isAllowedPort?: PortRule,
): string[] {
  const home = normalizeScanUrl(finalUrl, { isAllowedPort });
  if (!home.ok) return [];

  const kept = new Map<string, { depth: number; path: string }>();
  for (const candidate of candidates) {
    const normalized = normalizeScanUrl(candidate, { isAllowedPort });
    if (!normalized.ok) continue;
    const { href, hostname } = normalized.value;
    if (hostname !== home.value.hostname || href === home.value.href) continue;
    const { pathname } = new URL(href);
    if (NON_HTML_EXTENSIONS.test(pathname)) continue;
    kept.set(href, { depth: depthOf(pathname), path: pathname });
  }

  return Array.from(kept.entries())
    .sort(
      ([hrefA, a], [hrefB, b]) =>
        a.depth - b.depth ||
        a.path.length - b.path.length ||
        (hrefA < hrefB ? -1 : hrefA > hrefB ? 1 : 0),
    )
    .slice(0, max)
    .map(([href]) => href);
}

export interface SamplePagesInput {
  /** The homepage's final URL, after redirects. */
  finalUrl: string;
  /** The homepage's same-host links, the fallback. */
  fallbackLinks: readonly string[];
  /** Fetches a sitemap body through the guarded fetcher; null on any failure. */
  fetchSitemap: (url: string) => Promise<string | null>;
  max?: number;
  /** The fetch policy's port rule; production leaves the default (80/443). */
  isAllowedPort?: PortRule;
}

export interface SampledPages {
  source: "sitemap" | "links";
  urls: string[];
}

export async function samplePages({
  finalUrl,
  fallbackLinks,
  fetchSitemap,
  max = MAX_SAMPLED_PAGES,
  isAllowedPort,
}: SamplePagesInput): Promise<SampledPages> {
  const home = normalizeScanUrl(finalUrl, { isAllowedPort });
  if (!home.ok) return { source: "links", urls: [] };

  let locations: string[] = [];
  const root = await fetchSitemap(`${home.value.origin}/sitemap.xml`);
  if (root !== null) {
    const parsed = readSitemapLocations(root);
    if (!parsed.isIndex) {
      locations = parsed.locations;
    } else {
      const child = parsed.locations.find((location) => {
        const normalized = normalizeScanUrl(location, { isAllowedPort });
        return (
          normalized.ok && normalized.value.hostname === home.value.hostname
        );
      });
      const childBody = child ? await fetchSitemap(child) : null;
      if (childBody !== null) {
        const nested = readSitemapLocations(childBody);
        if (!nested.isIndex) locations = nested.locations;
      }
    }
  }

  const fromSitemap = selectPages(
    locations,
    home.value.href,
    max,
    isAllowedPort,
  );
  if (fromSitemap.length > 0) return { source: "sitemap", urls: fromSitemap };
  return {
    source: "links",
    urls: selectPages(fallbackLinks, home.value.href, max, isAllowedPort),
  };
}
