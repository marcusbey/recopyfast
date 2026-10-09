import { escapeRegex } from "../search-pattern";

/**
 * s70b — the Changes search's pattern (review m1, then re-review N1).
 *
 * Typed text is a literal, never pattern syntax. The search was an `ilike`,
 * and PostgREST rewrites every `*` in a like value to `%` with no escape for
 * it (measured on PostgREST 14.16: `%5\*%` arrived as `%5\%%`), so "5*"
 * listed every row containing a 5 and the fix refused `*` with a 400 the page
 * showed as a failure. The search is now `imatch` (`~*`), which PostgREST
 * passes through as a bound value, untouched: escaping every POSIX ERE
 * metacharacter makes the typed text match itself and nothing else.
 */
describe("escapeRegex", () => {
  it("leaves plain text as it is", () => {
    expect(escapeRegex("pricing")).toBe("pricing");
  });

  it.each([
    ["\\"],
    ["."],
    ["["],
    ["]"],
    ["{"],
    ["}"],
    ["("],
    [")"],
    ["*"],
    ["+"],
    ["?"],
    ["^"],
    ["$"],
    ["|"],
  ])("escapes %p with one backslash", (character) => {
    expect(escapeRegex(`a${character}b`)).toBe(`a\\${character}b`);
  });

  it("turns 5* into 5\\*, a literal star", () => {
    expect(escapeRegex("5*")).toBe("5\\*");
  });

  it("keeps % and _ as they are: neither is regex syntax", () => {
    expect(escapeRegex("50%_off")).toBe("50%_off");
  });

  it("doubles a backslash, so a Windows path matches itself", () => {
    expect(escapeRegex("C:\\new")).toBe("C:\\\\new");
  });

  it("escapes every metacharacter in one string, in place", () => {
    expect(escapeRegex("From $5* a month (or less?)")).toBe(
      "From \\$5\\* a month \\(or less\\?\\)",
    );
  });

  it.each([
    ["5*", "From $5* a month", "Save 50 today"],
    ["a.b", "see a.b here", "see axb here"],
    ["x+", "x+", "xxx"],
    ["[ab]", "pick [ab]", "pick a"],
    ["a|b", "a|b", "a"],
    ["^start", "the ^start", "start here"],
    ["50%_off", "50%_off", "50 xoff"],
  ])(
    "as a regex, %p matches its literal text and not a lookalike",
    (typed, literal, lookalike) => {
      const pattern = new RegExp(escapeRegex(typed), "i");

      expect(pattern.test(literal)).toBe(true);
      expect(pattern.test(lookalike)).toBe(false);
    },
  );
});
