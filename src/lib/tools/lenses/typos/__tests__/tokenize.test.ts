/**
 * @jest-environment node
 */

import { reduceContraction, tokenizeBlock } from "../tokenize";

function words(text: string): string[] {
  return tokenizeBlock(text).map((token) => token.text);
}

describe("tokenizeBlock", () => {
  it("returns letter runs with their offsets", () => {
    expect(tokenizeBlock("We fix copy.")).toEqual([
      {
        text: "We",
        start: 0,
        end: 2,
        isSentenceStart: true,
        touchesDigit: false,
      },
      {
        text: "fix",
        start: 3,
        end: 6,
        isSentenceStart: false,
        touchesDigit: false,
      },
      {
        text: "copy",
        start: 7,
        end: 11,
        isSentenceStart: false,
        touchesDigit: false,
      },
    ]);
  });

  it("keeps contractions whole, with ' or U+2019", () => {
    expect(words("We’re sure you don't mind the company’s rules")).toEqual([
      "We’re",
      "sure",
      "you",
      "don't",
      "mind",
      "the",
      "company’s",
      "rules",
    ]);
  });

  it("blanks addresses, e-mail, handles, paths and file names", () => {
    expect(
      words(
        "Visit https://exampel.com/pagee or www.exampel.com, write to hello@exampel.com, follow @exampel or #exampel, see exampel.com/x, node.js, e.g. this, my_var and a=b.",
      ),
    ).toEqual([
      "Visit",
      "or",
      "write",
      "to",
      "follow",
      "or",
      "see",
      "this",
      "and",
    ]);
  });

  it("splits hyphenated words into their parts", () => {
    expect(words("state-of-the-art pre-order")).toEqual([
      "state",
      "of",
      "the",
      "art",
      "pre",
      "order",
    ]);
  });

  it("marks a word touching a digit", () => {
    const tokens = tokenizeBlock("abc123 3rd floor");

    expect(tokens.map((token) => [token.text, token.touchesDigit])).toEqual([
      ["abc", true],
      ["rd", true],
      ["floor", false],
    ]);
  });

  it("knows where sentences start", () => {
    const starts = (text: string) =>
      tokenizeBlock(text)
        .filter((token) => token.isSentenceStart)
        .map((token) => token.text);

    expect(
      starts("Hello there. Welcome in! Is it? Yes… Note: Read this • Item"),
    ).toEqual(["Hello", "Welcome", "Is", "Yes", "Note", "Read", "Item"]);
    // The period of a blanked address is not a sentence end.
    expect(starts("Write to support@acme.com. Anna answers")).toEqual([
      "Write",
    ]);
    expect(starts("Bob, Anna and Carl")).toEqual(["Bob"]);
  });
});

describe("reduceContraction", () => {
  it.each([
    ["don't", "do"],
    ["don’t", "do"],
    ["isn't", "is"],
    ["won't", "will"],
    ["can't", "can"],
    ["shan't", "shall"],
    ["we're", "we"],
    ["they've", "they"],
    ["we'll", "we"],
    ["you'd", "you"],
    ["i'm", "i"],
    ["Company’s", "company"],
    ["Plain", "plain"],
  ])("reduces %s to %s", (input, expected) => {
    expect(reduceContraction(input)).toBe(expected);
  });

  it.each(["o'clock", "rock'n'roll", "ain't"])(
    "returns null for %s, which is never flagged",
    (input) => {
      expect(reduceContraction(input)).toBeNull();
    },
  );
});
