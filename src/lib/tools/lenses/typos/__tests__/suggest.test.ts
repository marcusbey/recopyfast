/**
 * @jest-environment node
 */

import { getDictionary, type Dictionary } from "../dictionary";
import { suggestCorrection } from "../suggest";

describe("suggestCorrection", () => {
  it.each([
    ["recieve", "receive"],
    ["seperate", "separate"],
    ["accomodation", "accommodation"],
    ["definately", "definitely"],
    ["becuase", "because"],
    ["teh", "the"],
    ["wich", "which"],
    ["thier", "their"],
    ["adress", "address"],
    ["goverment", "government"],
    ["alot", "a lot"],
  ])("suggests %s → %s", (typo, expected) => {
    expect(suggestCorrection(typo, getDictionary())).toBe(expected);
  });

  it("returns null when no common word is one edit away", () => {
    expect(suggestCorrection("xqzvbnk", getDictionary())).toBeNull();
    expect(suggestCorrection("shopify", getDictionary())).toBeNull();
  });

  it("never suggests a rare word (SCOWL band above 50)", () => {
    const rareOnly: Dictionary = {
      isKnown: () => false,
      band: (word) => (word === "cat" ? 60 : undefined),
    };

    expect(suggestCorrection("caat", rareOnly)).toBeNull();
  });

  it("prefers the more common band, then a missing letter over a wrong one", () => {
    const fake: Dictionary = {
      isKnown: () => false,
      band: (word) => ({ cart: 20, cast: 10, chart: 10 })[word as "cart"],
    };

    // "cast" (band 10, wrong letter) beats "cart" (band 20); at band 10,
    // "chart" (missing letter) would beat "cast" for "chrt"-like input.
    expect(suggestCorrection("caxt", fake)).toBe("cast");
    expect(
      suggestCorrection("cart", {
        ...fake,
        band: (word) => ({ chart: 10, cast: 10 })[word as "cast"],
      }),
    ).toBe("chart");
  });
});
