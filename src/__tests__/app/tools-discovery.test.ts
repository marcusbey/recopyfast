/**
 * @jest-environment node
 */

/**
 * s96 — one catalogue drives /tools, the sitemap, /llms.txt, the scan route and
 * the report route. These invariants keep a new tool listed everywhere or
 * nowhere, and keep the catalogue and the lens registry in step.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { TOOL_CATALOGUE, TOOL_SLUG_PATTERN } from "@/lib/tools/catalogue";
import { LENSES } from "@/lib/tools/lenses/registry";
import { TYPO_TOOL_SLUG } from "@/lib/tools/lenses/typos/typo-lens";
import { TYPO_SLUG } from "@/lib/tools/pages-copy";

describe("the free-tools catalogue", () => {
  it("lists at least the Website Typo Finder", () => {
    expect(TOOL_CATALOGUE.map((tool) => tool.slug)).toContain(
      "website-spell-checker",
    );
    expect(TYPO_SLUG).toBe(TYPO_TOOL_SLUG);
  });

  it("has unique slugs that satisfy tool_reports.tool's CHECK", () => {
    const slugs = TOOL_CATALOGUE.map((tool) => tool.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(TOOL_SLUG_PATTERN);
    // The same pattern, written in the migration.
    expect(TOOL_SLUG_PATTERN.source).toBe("^[a-z0-9][a-z0-9-]{0,62}$");
  });

  it.each(TOOL_CATALOGUE.map((tool) => [tool.slug]))(
    "%s is live: its page exists",
    (slug) => {
      expect(
        existsSync(path.join(process.cwd(), "src/app/tools", slug, "page.tsx")),
      ).toBe(true);
    },
  );

  it("names exactly the registry's lenses, each serving its own entry", () => {
    const named = TOOL_CATALOGUE.flatMap((tool) =>
      tool.lens ? [tool.lens] : [],
    );

    expect([...named].sort()).toEqual(Object.keys(LENSES).sort());
    for (const tool of TOOL_CATALOGUE) {
      if (!tool.lens) continue;
      expect(LENSES[tool.lens].tool).toBe(tool.slug);
      expect(tool.cta).not.toBeNull();
    }
  });
});
