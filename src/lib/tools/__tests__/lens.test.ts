/**
 * @jest-environment node
 */

/**
 * s96 — the generic finding every lens produces, and the bound every report
 * keeps. The report page renders these with no per-tool code, so the caps here
 * are the caps on what a stranger's page can put in front of a reader.
 */

import {
  boundFindings,
  createFinding,
  FINDING_LIMITS,
  MAX_FINDINGS,
  type Finding,
} from "../lens";

const PAGE_A = "https://example.com/";
const PAGE_B = "https://example.com/about";
const PAGE_C = "https://example.com/contact";

function finding(page: string, match: string, kind = "typo"): Finding {
  return createFinding({ page, kind, match, before: "x ", after: " y" });
}

describe("createFinding", () => {
  it("caps every text field and keeps the edges next to the match", () => {
    const made = createFinding({
      page: PAGE_A,
      kind: "typo",
      match: "m".repeat(200),
      before: `${"b".repeat(300)}END`,
      after: `START${"a".repeat(300)}`,
      note: "n".repeat(400),
      suggestion: "s".repeat(100),
      code: "c".repeat(2_000),
    });

    expect(made.match).toHaveLength(FINDING_LIMITS.match);
    expect(made.before).toHaveLength(FINDING_LIMITS.context);
    expect(made.before.endsWith("END")).toBe(true);
    expect(made.after).toHaveLength(FINDING_LIMITS.context);
    expect(made.after.startsWith("START")).toBe(true);
    expect(made.note).toHaveLength(FINDING_LIMITS.note);
    expect(made.suggestion).toHaveLength(FINDING_LIMITS.suggestion);
    expect(made.code).toHaveLength(FINDING_LIMITS.code);
    expect(FINDING_LIMITS).toEqual({
      match: 80,
      context: 120,
      note: 300,
      suggestion: 80,
      code: 1_000,
      imageSrc: 2_048,
    });
  });

  it("keeps an image source only when it is https", () => {
    expect(
      createFinding({
        page: PAGE_A,
        kind: "k",
        match: "m",
        before: "",
        after: "",
        imageSrc: "https://cdn.test/a.png",
      }).imageSrc,
    ).toBe("https://cdn.test/a.png");
    for (const imageSrc of [
      "http://cdn.test/a.png",
      "data:image/png",
      "javascript:alert(1)",
    ]) {
      expect(
        createFinding({
          page: PAGE_A,
          kind: "k",
          match: "m",
          before: "",
          after: "",
          imageSrc,
        }),
      ).not.toHaveProperty("imageSrc");
    }
  });

  it("strips invisible characters that could reorder a sentence on screen", () => {
    expect(
      createFinding({
        page: PAGE_A,
        kind: "k",
        match: "ab\u202ecd",
        before: "x\u200b",
        after: "",
      }).match,
    ).toBe("abcd");
  });
});

describe("boundFindings", () => {
  it("collapses a finding repeated across pages into the first, saying where else it is", () => {
    const bounded = boundFindings(
      [
        finding(PAGE_A, "Copywrite"),
        finding(PAGE_B, "copywrite"),
        finding(PAGE_C, "Copywrite"),
        finding(PAGE_B, "teh"),
      ],
      { dedupeKey: (item) => `${item.kind}:${item.match.toLowerCase()}` },
    );

    expect(bounded).toHaveLength(2);
    expect(bounded[0]).toMatchObject({
      page: PAGE_A,
      match: "Copywrite",
      note: "Also on 2 other pages.",
    });
    expect(bounded[1]).toMatchObject({ page: PAGE_B, match: "teh" });
    expect(bounded[1]).not.toHaveProperty("note");
  });

  it("says 'page' for one other page, and keeps an existing note", () => {
    const first = createFinding({
      page: PAGE_A,
      kind: "typo",
      match: "x",
      before: "",
      after: "",
      note: "Possible typo.",
    });
    const bounded = boundFindings([first, finding(PAGE_B, "x")], {
      dedupeKey: (item) => item.match,
    });

    expect(bounded[0].note).toBe("Possible typo. Also on 1 other page.");
  });

  it(`keeps at most ${MAX_FINDINGS}`, () => {
    const many = Array.from({ length: 100 }, (_, index) =>
      finding(PAGE_A, `w${index}`),
    );

    expect(
      boundFindings(many, { dedupeKey: (item) => item.match }),
    ).toHaveLength(MAX_FINDINGS);
    expect(MAX_FINDINGS).toBe(40);
  });
});
