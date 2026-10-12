/**
 * @jest-environment node
 */

/**
 * s96 — the Typo Finder's dictionary: five English dialects, SCOWL bands 10–70,
 * plus the supplement of web and business words.
 */

import { getDictionary, MAX_SUGGESTION_BAND } from "../dictionary";
import { SUPPLEMENT_WORDS } from "../supplement";

describe("the dictionary", () => {
  it("loads once per isolate, quickly enough for a cold scan", () => {
    const started = performance.now();
    const first = getDictionary();
    const elapsed = performance.now() - started;

    expect(getDictionary()).toBe(first);
    // Measured ≈ 60 ms on Node 24.14; the bound leaves room for a loaded CI box.
    expect(elapsed).toBeLessThan(2_000);
  });

  it.each([
    "colour",
    "color",
    "organised",
    "organized",
    "favourite",
    "centre",
    "center",
    "travelling",
    "traveling",
  ])("knows %s (every dialect counts)", (word) => {
    expect(getDictionary().isKnown(word)).toBe(true);
  });

  it.each([
    "recieve",
    "seperate",
    "accomodation",
    "definately",
    "becuase",
    "teh",
  ])("does not know the misspelling %s", (word) => {
    expect(getDictionary().isKnown(word)).toBe(false);
  });

  it("ranks words by SCOWL band, most common lowest", () => {
    const dictionary = getDictionary();

    expect(dictionary.band("the")).toBe(10);
    expect(dictionary.band("calendar")).toBeLessThanOrEqual(
      MAX_SUGGESTION_BAND,
    );
    expect(dictionary.band("recieve")).toBeUndefined();
    expect(MAX_SUGGESTION_BAND).toBe(50);
  });

  it("knows plurals and common prefixes of known words", () => {
    const dictionary = getDictionary();

    expect(dictionary.isKnown("faqs")).toBe(true);
    expect(dictionary.isKnown("reimagined")).toBe(true);
    expect(dictionary.isKnown("nonprofits")).toBe(true);
    expect(dictionary.isKnown("recieves")).toBe(false);
  });
});

describe("SUPPLEMENT_WORDS", () => {
  it("is lower case, sorted, unique and at most 300 words", () => {
    expect(SUPPLEMENT_WORDS.length).toBeLessThanOrEqual(300);
    expect(SUPPLEMENT_WORDS.every((word) => /^[a-z]+$/.test(word))).toBe(true);
    expect([...SUPPLEMENT_WORDS].sort()).toEqual(SUPPLEMENT_WORDS);
    expect(new Set(SUPPLEMENT_WORDS).size).toBe(SUPPLEMENT_WORDS.length);
  });

  it.each([
    "app",
    "seo",
    "saas",
    "faq",
    "signup",
    "onboarding",
    "ecommerce",
    "pre",
  ])("covers %s, which would otherwise be flagged", (word) => {
    expect(getDictionary().isKnown(word)).toBe(true);
  });
});
