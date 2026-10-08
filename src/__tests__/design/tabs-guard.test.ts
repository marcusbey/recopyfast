/**
 * @jest-environment node
 *
 * s66a, PR #67 review (Devin) — every tab list on the app surface wraps.
 *
 * The design system's Tabs (Controls): "The list wraps when narrow; it never
 * clips behind a hidden scrollbar." The primitive is a wrapping flex row of
 * `whitespace-nowrap` triggers. Four call sites replaced that row with
 * `grid w-full grid-cols-N`: a grid does not wrap, so at 320–375 px Content
 * portability's "Batch Update" ran past its quarter of the card. jsdom
 * computes no layout, so this guard reads the class strings instead: no
 * `<TabsList>` may lay itself out as a grid or forbid wrapping.
 */

import {
  appSurfaceFiles,
  baseUtility,
  readSource,
  stripComments,
} from "./app-surface";

/** Utilities that replace the primitive's wrapping row. */
const NON_WRAPPING = /^(?:(?:inline-)?grid|grid-cols-.+|flex-nowrap)$/;

interface TabsListUsage {
  line: number;
  className: string | null;
}

/** Every `<TabsList …>` opening tag, with its literal className if any. */
function tabsListUsages(source: string): TabsListUsage[] {
  const code = stripComments(source);
  return Array.from(code.matchAll(/<TabsList\b([^<]*?)\/?>/g)).map((match) => ({
    line: code.slice(0, match.index).split("\n").length,
    className: /\bclassName="([^"]*)"/.exec(match[1])?.[1] ?? null,
  }));
}

function nonWrappingUtilities(className: string | null): string[] {
  return (className ?? "")
    .split(/\s+/)
    .filter((token) => NON_WRAPPING.test(baseUtility(token)));
}

describe("tabs guard (design system, Controls)", () => {
  it("lays out no TabsList as a grid or a non-wrapping row", () => {
    const usages = appSurfaceFiles().flatMap((file) =>
      tabsListUsages(readSource(file)).map((usage) => ({ file, ...usage })),
    );
    const offenders = usages.flatMap(({ file, line, className }) =>
      nonWrappingUtilities(className).map(
        (utility) => `${file}:${line} ${utility}`,
      ),
    );

    // Not vacuous: the app surface does render tab lists.
    expect(usages.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("finds a grid override on one line or several, and ignores comments (self-test)", () => {
    expect(
      tabsListUsages('<TabsList className="grid w-full grid-cols-4">'),
    ).toEqual([{ line: 1, className: "grid w-full grid-cols-4" }]);
    expect(
      tabsListUsages('<div>\n  <TabsList\n    className="mt-1 grid"\n  >'),
    ).toEqual([{ line: 2, className: "mt-1 grid" }]);
    expect(tabsListUsages('<TabsList aria-label="Platform">')).toEqual([
      { line: 1, className: null },
    ]);
    expect(
      tabsListUsages('// <TabsList className="grid grid-cols-2">'),
    ).toEqual([]);

    expect(nonWrappingUtilities("grid w-full grid-cols-4")).toEqual([
      "grid",
      "grid-cols-4",
    ]);
    expect(nonWrappingUtilities("sm:inline-grid flex-nowrap")).toEqual([
      "sm:inline-grid",
      "flex-nowrap",
    ]);
    expect(nonWrappingUtilities("mt-1 gap-x-6")).toEqual([]);
    expect(nonWrappingUtilities(null)).toEqual([]);
  });
});
