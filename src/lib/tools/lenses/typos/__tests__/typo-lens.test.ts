/**
 * @jest-environment node
 */

/**
 * s96 — the Typo Finder, precision first. Every fixture is synthetic HTML run
 * through the real extractor and the real dictionary: the corpus finds exactly
 * the typos planted in it, and each never-flag rule has its own row.
 */

import {
  extractPage,
  type ExtractedPage,
} from "@/lib/tools/extract/extract-page";
import { NEXT_STREAMED_PAGE } from "@/lib/tools/extract/__tests__/next-streamed-page";
import type { LensContext } from "@/lib/tools/lens";
import {
  analyzeTypos,
  MAX_SUGGESTION_WORDS,
  NO_TEXT_MESSAGE,
  NOT_ENGLISH_MESSAGE,
  typoLens,
} from "../typo-lens";

const HOME = "https://acme-bakery.example/";
const CONTEXT: LensContext = {
  now: new Date("2026-10-11T12:00:00Z"),
  finalUrl: HOME,
  hostname: "acme-bakery.example",
};

/** Plain, correctly spelled filler so every fixture clears the word and language gates. */
const FILLER =
  "We bake fresh bread every morning with simple flour, water and salt. Our small team opens the shop at seven and closes when the last loaf is sold.";

function page(
  body: string,
  { url = HOME, title = "Home", lang = "en" } = {},
): ExtractedPage {
  const result = extractPage(
    `<html lang="${lang}"><head><title>${title}</title></head><body>${body}</body></html>`,
    { url, headers: {} },
  );
  if (!result.ok) throw new Error("fixture refused");
  return result.page;
}

function run(pages: ExtractedPage[]) {
  return analyzeTypos(pages, CONTEXT);
}

function flagged(pages: ExtractedPage[]): string[] {
  return run(pages).findings.map((finding) => finding.match);
}

describe("the corpus", () => {
  it("finds exactly the planted typos, each in its sentence with a suggestion", () => {
    const result = run([
      page(
        `<p>${FILLER}</p><p>We recieve orders daily and seperate them by hand. Our accomodation is definately cosy becuase we care.</p>`,
      ),
    ]);

    expect(
      result.findings.map(({ match, suggestion }) => [match, suggestion]),
    ).toEqual([
      ["recieve", "receive"],
      ["seperate", "separate"],
      ["accomodation", "accommodation"],
      ["definately", "definitely"],
      ["becuase", "because"],
    ]);
    expect(result.findings[0]).toMatchObject({
      page: HOME,
      kind: "typo",
      before: "We ",
      after:
        " orders daily and seperate them by hand. Our accomodation is definately cosy becuase we care.",
    });
    expect(result.summary).toMatchObject({
      verdict: "warn",
      headline: "5 possible typos on 1 page of 1",
    });
    expect(result.summary.facts).toEqual(
      expect.arrayContaining([
        { label: "Pages checked", value: "1" },
        { label: "Possible typos", value: "5" },
        { label: "Repeated words", value: "0" },
      ]),
    );
  });

  it("passes a clean page", () => {
    const result = run([page(`<p>${FILLER}</p>`)]);

    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({
      verdict: "pass",
      headline: "No likely typos on the 1 page we checked",
    });
  });

  it("leaves a Capitalised word alone even at the start of a sentence (a first name, a brand)", () => {
    // Measured on 20 live homepages: "Fred and Brian met on Reddit…",
    // "Claude power users…". The same rule hides "Recieve a free loaf." — the
    // price of precision.
    expect(
      flagged([
        page(`<p>${FILLER} Fred and Brian met here. Recieve a free loaf.</p>`),
      ]),
    ).toEqual([]);
  });
});

describe("never flagged", () => {
  it.each([
    [
      "a Capitalised word mid-sentence (a name)",
      "We partnered with Tery and Brandix this year.",
    ],
    [
      "CamelCase and inner capitals",
      "Order on your iPhoen or with BrendX today.",
    ],
    ["ALL CAPS", "FREE SHIPING on every order today."],
    ["a word touching a digit", "Ask for recieve2 or 3rd recieve4 options."],
    [
      "an address, e-mail, handle or file name",
      "Mail recieve@acme.com, see seperate.com, follow @seperate or open teh.pdf now.",
    ],
    [
      "a contraction or possessive of a known word",
      "We’re sure you don’t mind the company’s rules, isn't it?",
    ],
    [
      "hyphen parts that are words",
      "A state-of-the-art pre-order and e-commerce co-op.",
    ],
    ["a non-ASCII word", "Try our crème brûlée and the jalapeño naan."],
    ["a word shorter than three letters", "Add an xo to it."],
    // Rules added after the 20-homepage measurement (see typo-lens.ts).
    [
      "a word that only a first-letter change would fix (a name, written lower case)",
      "Ask jason or laura about the bread today.",
    ],
    [
      "a sentence that opens on a full name",
      "Blaker Watson bakes the bread every day.",
    ],
    [
      "an abbreviation with no vowel",
      "We ship rvs and hlth kits all year round.",
    ],
    [
      "a tripled letter, which is emphasis",
      "It is sooo good and the bread is yummmy.",
    ],
    ["a short word ending in a period", "Ask the sales dept. about the bread."],
    ["an elision", "We are havin' a good time at the shop."],
    ["code-like text", "Use cos() and sin() for .ing files today."],
    ["a short hyphen part", "A boba-tea bar sits beside the shop."],
  ])("%s", (_rule, sentence) => {
    expect(flagged([page(`<p>${FILLER}</p><p>${sentence}</p>`)])).toEqual([]);
  });

  it("a word from the page title, the site name or the host name", () => {
    const body = `<p>${FILLER}</p><p>Welcome to tastee, by glowr, at acme bakery.</p>`;
    const withIdentity = extractPage(
      `<html lang="en"><head><title>Tastee Breads</title><meta property="og:site_name" content="Glowr"></head><body>${body}</body></html>`,
      { url: HOME, headers: {} },
    );
    if (!withIdentity.ok) throw new Error("fixture refused");

    expect(run([withIdentity.page]).findings).toEqual([]);
  });

  it("anything in a block of fewer than four words (menus, name cards, buttons)", () => {
    expect(
      flagged([
        page(
          `<p>${FILLER}</p><ul><li>recieve</li><li>Jason Fried</li><li>teh shop</li><li>seperate menu item</li></ul>`,
        ),
      ]),
    ).toEqual([]);
  });

  it("a word used three or more times across the pages", () => {
    const pages = [
      page(`<p>${FILLER} Try the brioch today.</p>`),
      page(`<p>${FILLER} Our brioch sells out.</p>`, { url: `${HOME}menu` }),
      page(`<p>${FILLER} A brioch costs four.</p>`, { url: `${HOME}prices` }),
    ];

    expect(run(pages).findings).toEqual([]);
  });

  it("a sentence-initial word the site writes Capitalised mid-sentence elsewhere", () => {
    expect(
      flagged([page(`<p>${FILLER} Tery bakes. Ask Tery anything.</p>`)]),
    ).toEqual([]);
  });
});

describe("repeated words", () => {
  it("reports a doubled word across whitespace, with the single word as the fix", () => {
    const result = run([
      page(`<p>${FILLER} Pick up the the bread at noon.</p>`),
    ]);

    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: "repeated",
        match: "the the",
        suggestion: "the",
      }),
    ]);
    expect(result.summary.facts).toEqual(
      expect.arrayContaining([{ label: "Repeated words", value: "1" }]),
    );
  });

  it.each([
    ["an allowlisted idiom", "We had had enough of that that day."],
    ["two sentences", "Is it fresh? Fresh. Fresh bread is best."],
    ["a capitalised name", "We flew to Bora Bora and Walla Walla."],
    ["across punctuation", "Fresh, fresh, fresh."],
    [
      "three in a row, which is deliberate",
      "They sang the the the chorus all night.",
    ],
  ])("ignores %s", (_case, sentence) => {
    expect(flagged([page(`<p>${FILLER} ${sentence}</p>`)])).toEqual([]);
  });
});

it("ignores a doubled word in a block too short to be prose (a widget artefact)", () => {
  expect(
    flagged([
      page(
        `<p>${FILLER}</p><div>undefined undefined</div><li>units units</li>`,
      ),
    ]),
  ).toEqual([]);
});

describe("pages that are not checked", () => {
  it("a page whose lang is another language", () => {
    const result = run([page(`<p>${FILLER} Recieve it.</p>`, { lang: "fr" })]);

    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({
      verdict: "skipped",
      headline: NOT_ENGLISH_MESSAGE,
    });
    expect(result.skippedPages).toEqual([
      { url: HOME, reason: NOT_ENGLISH_MESSAGE },
    ]);
  });

  it("a page whose words are mostly unknown, even when lang says English", () => {
    const french =
      "<p>Nous faisons notre pain chaque matin avec une farine simple, de l'eau et du sel. Notre petite équipe ouvre la boutique à sept heures et ferme quand la dernière miche est vendue.</p>";

    const result = run([page(french)]);

    expect(result.findings).toEqual([]);
    expect(result.summary.verdict).toBe("skipped");
    expect(result.skippedPages?.[0].reason).toBe(NOT_ENGLISH_MESSAGE);
  });

  it("a block in another language inside a page that says it is English", () => {
    // gov.uk/cymraeg: html lang="en", Welsh content (seen on a real scan).
    expect(
      flagged([
        page(
          `<p>${FILLER}</p><p>Dinasyddiaeth a byw yn y DU</p><p>Cliciwch ar yr ardal mae gennych ddiddordeb mewn archwilio.</p>`,
        ),
      ]),
    ).toEqual([]);
  });

  it("a page with almost no text in its HTML", () => {
    const result = run([page(`<div id="root"></div><p>Loading…</p>`)]);

    expect(result.summary).toMatchObject({
      verdict: "skipped",
      headline: NO_TEXT_MESSAGE,
    });
  });

  it("checks the English pages and lists the others", () => {
    const result = run([
      page(`<p>${FILLER} We recieve it.</p>`),
      page(`<p>${FILLER}</p>`, { url: `${HOME}fr`, lang: "fr" }),
    ]);

    expect(result.findings.map((finding) => finding.match)).toEqual([
      "recieve",
    ]);
    expect(result.skippedPages).toEqual([
      { url: `${HOME}fr`, reason: NOT_ENGLISH_MESSAGE },
    ]);
    expect(result.summary.facts).toEqual(
      expect.arrayContaining([{ label: "Pages not checked", value: "1" }]),
    );
  });
});

/** 41 misspellings this lens flags, each on its own (checked one by one). */
const FORTY_ONE_TYPOS = [
  "recieve",
  "seperate",
  "definately",
  "occured",
  "wierd",
  "accomodate",
  "acheive",
  "adress",
  "beleive",
  "commited",
  "concious",
  "existance",
  "foriegn",
  "goverment",
  "grammer",
  "harrass",
  "independant",
  "knowlege",
  "liason",
  "millenium",
  "neccessary",
  "noticable",
  "occassion",
  "persistant",
  "posession",
  "prefered",
  "refered",
  "relevent",
  "religous",
  "rythm",
  "sieze",
  "suprise",
  "truely",
  "writting",
  "begining",
  "beautifull",
  "buisness",
  "collegue",
  "comming",
  "completly",
  "embarass",
];

function typoPage(words: readonly string[]): ExtractedPage {
  return page(
    words.map((word) => `<p>${FILLER} We ${word} it daily.</p>`).join(""),
  );
}

describe("bounds", () => {
  /**
   * Devin review of 0c5c5e4: `boundFindings` keeps 40 distinct findings, and
   * the report said nothing about the rest — "41 possible typos" over a list
   * of 40, with no limited-findings notice. The lens now says so.
   */
  it("says the findings were truncated when more than 40 distinct ones were found", () => {
    const result = run([typoPage(FORTY_ONE_TYPOS)]);

    expect(result.summary.headline).toBe("41 possible typos on 1 page of 1");
    expect(result.findings).toHaveLength(40);
    expect(result.findingsTruncated).toBe(true);
  });

  it("does not, at exactly 40", () => {
    const result = run([typoPage(FORTY_ONE_TYPOS.slice(0, 40))]);

    expect(result.findings).toHaveLength(40);
    expect(result.findingsTruncated).toBe(false);
  });

  it("collapses a typo repeated on two pages into the first, saying where else it is", () => {
    const result = run([
      page(
        `<p>${FILLER}</p><footer>Copywrite teh bakery, all rights reserved</footer>`,
      ),
      page(
        `<p>${FILLER}</p><footer>Copywrite teh bakery, all rights reserved</footer>`,
        {
          url: `${HOME}about`,
        },
      ),
    ]);

    const teh = result.findings.find((finding) => finding.match === "teh");
    expect(teh).toMatchObject({ page: HOME, note: "Also on 1 other page." });
    expect(
      result.findings.filter((finding) => finding.match === "teh"),
    ).toHaveLength(1);
  });

  it("counts unknown words with no close match, without listing them", () => {
    const result = run([
      page(`<p>${FILLER} We stock zorbaxil and plorbnix today.</p>`),
    ]);

    expect(result.findings).toEqual([]);
    expect(result.summary.facts).toEqual(
      expect.arrayContaining([
        {
          label: "Unrecognised words with no close match (not listed)",
          value: "2",
        },
      ]),
    );
  });

  it(`gives suggestion work to at most ${MAX_SUGGESTION_WORDS} distinct unknown words`, () => {
    // 600 distinct made-up words (base-26 letters, so no two collide), each
    // used once and drowned in known words so the page still reads as English.
    const letters = (value: number): string => {
      let out = "";
      let rest = value;
      do {
        out = String.fromCharCode(97 + (rest % 26)) + out;
        rest = Math.floor(rest / 26);
      } while (rest > 0);
      return out;
    };
    const unknownWords = Array.from(
      { length: 600 },
      (_, index) => `zqa${letters(index)}xov`,
    );
    const text = unknownWords.map((word) => `${word} ${FILLER}`).join(" ");
    const extracted = extractPage(
      `<html lang="en"><body><p>${text}</p></body></html>`,
      {
        url: HOME,
        headers: {},
      },
    );
    if (!extracted.ok) throw new Error("fixture refused");
    const longPage: ExtractedPage = {
      ...extracted.page,
      blocks: (text.match(/.{1,1900}(?:\s|$)/g) ?? []).map((chunk) => ({
        tag: "p",
        text: chunk.trim(),
      })),
    };
    const result = analyzeTypos([longPage], CONTEXT);

    expect(result.summary.facts).toEqual(
      expect.arrayContaining([
        {
          label: "Unrecognised words with no close match (not listed)",
          value: "500",
        },
        { label: "Unrecognised words over the checking limit", value: "100" },
      ]),
    );
  });
});

describe("the lens", () => {
  it("serves the Website Typo Finder, reading the homepage plus up to nine sitemap pages", () => {
    expect(typoLens).toMatchObject({
      id: "typos",
      tool: "website-spell-checker",
      pages: { max: 10, sample: "sitemap" },
    });
  });
});

/**
 * s96c — in production, https://www.recopyfa.st/terms was reported as "almost
 * no text in its HTML": a Next.js page streamed through a Suspense boundary
 * keeps its real content in `<div hidden id="S:0">`, and the only visible text
 * was the loading fallback. The fixture is that page, trimmed, with one typo
 * planted.
 */
describe("a Next.js page streamed through a Suspense boundary (s96c)", () => {
  const TERMS_URL = "https://www.recopyfa.st/terms";

  it("is checked, and its typo is found", () => {
    const streamed = extractPage(NEXT_STREAMED_PAGE, {
      url: TERMS_URL,
      headers: {},
    });
    if (!streamed.ok) throw new Error("fixture refused");

    const result = analyzeTypos([streamed.page], {
      now: CONTEXT.now,
      finalUrl: TERMS_URL,
      hostname: "www.recopyfa.st",
    });

    expect(result.summary.headline).not.toBe(NO_TEXT_MESSAGE);
    expect(result.skippedPages).toEqual([]);
    expect(
      result.findings.map(({ page, match, suggestion }) => [
        page,
        match,
        suggestion,
      ]),
    ).toEqual([[TERMS_URL, "recieve", "receive"]]);
  });

  it("still says 'almost no text' when the only text is a loading fallback", () => {
    // The fallback is loading UI, not the page's copy: it never counts.
    const shell = page(
      `<!--$?--><template id="B:0"></template><div role="status"><p>${FILLER}</p></div><!--/$-->`,
    );

    expect(run([shell]).summary).toMatchObject({
      verdict: "skipped",
      headline: NO_TEXT_MESSAGE,
    });
  });
});
