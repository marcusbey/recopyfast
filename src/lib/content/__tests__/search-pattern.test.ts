import { likePattern } from "../search-pattern";

/**
 * s70b — the Changes search's LIKE pattern (review m1).
 *
 * Typed text is a literal, never pattern syntax: `%`, `_` and `\` are escaped
 * for Postgres. `*` cannot be: PostgREST rewrites every `*` in a like/ilike
 * value to `%` before Postgres sees it, and `\*` only becomes `\%`, a literal
 * percent sign (measured on PostgREST 14.16: `%5*%` matched "Save 50 today",
 * `%5\*%` matched "5% off", neither matched only "From $5* a month"). So "5*"
 * would have listed every row containing a 5. A search holding `*` has no
 * pattern at all and the route refuses it.
 */
describe("likePattern", () => {
  it("wraps plain text for a substring match", () => {
    expect(likePattern("pricing")).toBe("%pricing%");
  });

  it("escapes %, _ and \\ so they match themselves", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });

  it.each([["5*"], ["*"], ["From $5* a month"], ["\\*"]])(
    "gives no pattern for %p: PostgREST would turn its * into a wildcard",
    (q) => {
      expect(likePattern(q)).toBeNull();
    },
  );
});
