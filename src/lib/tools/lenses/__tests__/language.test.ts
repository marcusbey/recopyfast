/**
 * @jest-environment node
 */

import {
  isDeclaredNonEnglish,
  isLikelyEnglish,
  MAX_UNKNOWN_SHARE,
} from "../language";

const ENGLISH = new Set([
  "we",
  "bake",
  "bread",
  "every",
  "morning",
  "with",
  "flour",
  "and",
  "water",
  "salt",
  "the",
  "shop",
]);
const isKnown = (word: string) => ENGLISH.has(word);

describe("isDeclaredNonEnglish", () => {
  it.each(["fr", "de-DE", "es_MX", "pt-br"])(
    "%s is another language",
    (lang) => {
      expect(isDeclaredNonEnglish(lang)).toBe(true);
    },
  );

  it.each([null, "", "en", "EN", "en-GB", "en_US"])(
    "%p is not declared non-English",
    (lang) => {
      expect(isDeclaredNonEnglish(lang)).toBe(false);
    },
  );
});

describe("isLikelyEnglish", () => {
  it("is false when lang names another language, whatever the words", () => {
    expect(isLikelyEnglish({ lang: "fr", words: ["bread"], isKnown })).toBe(
      false,
    );
  });

  it(`is false when more than ${MAX_UNKNOWN_SHARE * 100}% of the words are unknown`, () => {
    const french = [
      "nous",
      "faisons",
      "pain",
      "tous",
      "les",
      "matins",
      "avec",
      "farine",
      "eau",
      "sel",
      "bread",
    ];
    expect(isLikelyEnglish({ lang: null, words: french, isKnown })).toBe(false);
  });

  it("is true at exactly 40% unknown", () => {
    const words = [
      "we",
      "bake",
      "bread",
      "every",
      "morning",
      "with",
      "zzz",
      "yyy",
      "xxx",
      "www",
    ];
    expect(isLikelyEnglish({ lang: "en", words, isKnown })).toBe(true);
  });

  it("gives the benefit of the doubt below ten words", () => {
    expect(
      isLikelyEnglish({ lang: null, words: ["nous", "faisons"], isKnown }),
    ).toBe(true);
  });
});
