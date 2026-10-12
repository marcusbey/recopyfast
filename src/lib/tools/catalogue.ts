/**
 * The free tools, one entry each (s96). This list drives `/tools`, the
 * sitemap, `/llms.txt` and the report route's slug check, so a tool is
 * listed everywhere or nowhere (`src/__tests__/app/tools-discovery.test.ts`).
 *
 * An entry is a LIVE tool: its page exists at `src/app/tools/<slug>/page.tsx`
 * (pinned by the discovery test). A tool that scans names its lens, and the
 * lens registry (`lenses/registry.ts`) has exactly one line for it. A tool that
 * does not scan (a calculator) has `lens: null` and never reaches
 * `POST /api/tools/scan`.
 *
 * The later tool stories add one entry here and one registry line, nothing
 * else in s96's files (plan, "Merge points").
 */

export type ToolCtaVariant = "fix-on-page" | "alt-text";

export interface ToolEntry {
  /** URL segment and `tool_reports.tool`; must match the DB CHECK pattern. */
  slug: string;
  name: string;
  /** One sentence: the meta description and the hub card. */
  description: string;
  /** The registry lens id, or null for a tool that does not scan. */
  lens: string | null;
  /** The fix CTA a scan report shows; null for a tool without reports. */
  cta: ToolCtaVariant | null;
}

/** `tool_reports.tool` CHECK: `^[a-z0-9][a-z0-9-]{0,62}$`. */
export const TOOL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const TOOL_CATALOGUE: readonly ToolEntry[] = [
  {
    slug: "website-spell-checker",
    name: "Website Typo Finder",
    description:
      "Check up to ten pages of your website for likely typos and doubled words, each shown in the sentence it sits in.",
    lens: "typos",
    cta: "fix-on-page",
  },
];

/** Own-property lookup: `constructor` or `__proto__` is not a tool. */
export function getToolEntry(slug: string): ToolEntry | undefined {
  return TOOL_CATALOGUE.find((entry) => entry.slug === slug);
}

/** A catalogue tool that scans pages and stores reports. */
export function isScanTool(slug: string): boolean {
  return getToolEntry(slug)?.lens != null;
}

export function toolPath(slug: string): string {
  return `/tools/${slug}`;
}
