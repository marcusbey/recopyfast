/**
 * @jest-environment node
 */

import {
  extractPage,
  type ExtractedPage,
} from "@/lib/tools/extract/extract-page";
import type { LensContext } from "@/lib/tools/lens";
import { getToolEntry } from "@/lib/tools/catalogue";
import { LENSES } from "../../registry";
import type { Dictionary } from "../../typos/dictionary";
import {
  analyzeOutdated,
  NOT_ENGLISH_MESSAGE,
  OUTDATED_TOOL_SLUG,
  outdatedLens,
} from "../outdated-lens";

const HOME = "https://example.com/";
const CONTEXT: LensContext = {
  now: new Date("2026-10-11T12:00:00Z"),
  finalUrl: HOME,
  hostname: "example.com",
};
const ALL_KNOWN: Dictionary = {
  isKnown: () => true,
  band: () => 10,
};
const NONE_KNOWN: Dictionary = {
  isKnown: () => false,
  band: () => undefined,
};
const ENGLISH =
  "We bake fresh bread every morning with simple flour water and salt for our neighbours.";

function page(
  body: string,
  { url = HOME, lang = "en" }: { url?: string; lang?: string | null } = {},
): ExtractedPage {
  const langAttribute = lang === null ? "" : ` lang=\"${lang}\"`;
  const result = extractPage(
    `<html${langAttribute}><head><title>Acme</title></head><body>${body}</body></html>`,
    { url, headers: {} },
  );
  if (!result.ok) throw new Error("fixture refused");
  return result.page;
}

function run(pages: ExtractedPage[], dictionary = ALL_KNOWN) {
  return analyzeOutdated(pages, CONTEXT, dictionary);
}

function fact(
  result: ReturnType<typeof run>,
  label: string,
): string | undefined {
  return result.summary.facts.find((entry) => entry.label === label)?.value;
}

describe("the outdated lens boundary", () => {
  it("is registered under the catalogue's scanning-tool entry", () => {
    expect(OUTDATED_TOOL_SLUG).toBe("outdated-website-checker");
    expect(getToolEntry(OUTDATED_TOOL_SLUG)).toMatchObject({
      lens: "outdated",
      cta: "fix-on-page",
    });
    expect(LENSES.outdated).toBe(outdatedLens);
    expect(outdatedLens.pages).toEqual({ max: 10, sample: "sitemap" });
  });

  it("skips a declared French page without suppressing its English sibling", () => {
    const result = run([
      page(`<p>${ENGLISH}</p><p>© 2025 Acme</p>`, {
        url: `${HOME}fr`,
        lang: "fr",
      }),
      page(`<p>${ENGLISH}</p><p>© 2025 Acme</p>`, {
        url: `${HOME}en`,
      }),
    ]);

    expect(result.skippedPages).toEqual([
      { url: `${HOME}fr`, reason: NOT_ENGLISH_MESSAGE },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      page: `${HOME}en`,
      kind: "copyright-year",
    });
  });

  it("uses dictionary evidence when lang is absent", () => {
    const result = run(
      [
        page(
          "<p>bonjour monde encore maison petit grand rouge vert bleu jaune rapide lent</p>",
          { lang: null },
        ),
      ],
      NONE_KNOWN,
    );

    expect(result.summary).toMatchObject({
      verdict: "skipped",
      headline: "No English pages were checked",
    });
    expect(result.skippedPages).toEqual([
      { url: HOME, reason: NOT_ENGLISH_MESSAGE },
    ]);
  });

  it("gives short English copy the shared benefit of the doubt", () => {
    const result = run([page("<footer>© 2025 Acme</footer>")], NONE_KNOWN);

    expect(result.summary.verdict).toBe("fail");
    expect(result.findings[0]).toMatchObject({ kind: "copyright-year" });
  });
});

describe("dedupe, facts and verdicts", () => {
  it("collapses the same footer across pages and counts the distinct line", () => {
    const result = run([
      page(`<p>${ENGLISH}</p><footer>© 2025 Acme</footer>`),
      page(`<p>${ENGLISH}</p><footer>© 2025 Acme</footer>`, {
        url: `${HOME}about`,
      }),
    ]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].note).toContain("Also on 1 other page.");
    expect(fact(result, "Copyright years")).toBe("1 stale · 0 January grace");
  });

  it("always returns exactly eight facts with the combined copyright counts", () => {
    const result = run([page(`<p>${ENGLISH}</p><p>© 2025 Acme</p>`)]);

    expect(result.summary.facts).toEqual([
      { label: "Pages checked", value: "1" },
      { label: "Copyright years", value: "1 stale · 0 January grace" },
      { label: "Past dates still presented as upcoming", value: "0" },
      { label: "Dated prices, menus and schedules", value: "0" },
      { label: "Past-year announcements", value: "0" },
      { label: "Past-year seasonal promotions", value: "0" },
      { label: "Out-of-season promotions", value: "0" },
      { label: "Old update labels", value: "0" },
    ]);
  });

  it("uses fail for stale findings and counts only stale lines in its headline", () => {
    const result = run([
      page(
        `<p>${ENGLISH}</p><p>© 2025 Acme</p><p>Summer sale</p><p>Last updated: October 10, 2024</p>`,
      ),
    ]);

    expect(result.summary).toMatchObject({
      verdict: "fail",
      headline: "1 line looks out of date",
    });
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "copyright-year",
      "seasonal-promo-out-of-season",
      "stale-updated",
    ]);
  });

  it("uses warn when only warning and information findings exist", () => {
    const result = run([
      page(
        `<p>${ENGLISH}</p><p>Summer sale</p><p>Last updated: October 10, 2024</p>`,
      ),
    ]);

    expect(result.summary).toMatchObject({
      verdict: "warn",
      headline: "2 lines may need review",
    });
  });

  it("passes a checked page whose eight counts are all zero", () => {
    const result = run([page(`<p>${ENGLISH}</p><p>© 2026 Acme</p>`)]);

    expect(result.summary).toMatchObject({
      verdict: "pass",
      headline: "No clearly out-of-date lines on the 1 page we checked",
    });
    expect(result.findings).toEqual([]);
  });

  it("skips when no page passes the language gate", () => {
    const result = run([page(`<p>${ENGLISH}</p>`, { lang: "fr" })]);

    expect(result.summary).toMatchObject({
      verdict: "skipped",
      headline: "No English pages were checked",
    });
    expect(result.summary.facts).toHaveLength(8);
  });

  it("counts all distinct findings before the forty-finding display limit", () => {
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const blocks = Array.from({ length: 45 }, (_, index) => {
      const month = monthNames[index % monthNames.length];
      const day = (index % 20) + 1;
      return `<p>Register for ${month} ${day}, 2024 — offer code ${index}</p>`;
    }).join("");
    const result = run([page(`<p>${ENGLISH}</p>${blocks}`)]);

    expect(result.findings).toHaveLength(40);
    expect(result.findingsTruncated).toBe(true);
    expect(fact(result, "Past dates still presented as upcoming")).toBe("45");
    expect(result.summary.headline).toBe("45 lines look out of date");
  });

  it("depends only on context.now, even when the fake system clock disagrees", () => {
    jest.useFakeTimers().setSystemTime(new Date("2035-06-01T00:00:00Z"));
    try {
      const result = run([page(`<p>${ENGLISH}</p><p>© 2030 Acme</p>`)]);
      expect(result.summary.verdict).toBe("pass");
    } finally {
      jest.useRealTimers();
    }
  });
});
