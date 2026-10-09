/**
 * The Changes search's pattern (s70b), applied by `GET /api/content/changes`
 * with `.filter("search_text", "imatch", …)`: PostgREST's `imatch`, which is
 * Postgres's case-insensitive regex match `~*`.
 *
 * Every POSIX ERE metacharacter is escaped, so typed text is a literal:
 * "5*" finds "From $5* a month", "a.b" does not find "axb". `%` and `_` mean
 * nothing to a regex and are left as typed. Postgres's class and constraint
 * escapes are a backslash and a letter (`\d`, `\m`, …), and only punctuation
 * gets a backslash here, so none of them can be produced; nor can a `***=`
 * director or a `(?x)` option, whose `*` and `(` are escaped too.
 *
 * Tombstones (s70b review m1, then its re-review N1): the search was an
 * `ilike`, and PostgREST rewrites every `*` in a like/ilike value to `%`
 * before Postgres sees it, with no escape for it (measured on PostgREST
 * 14.16: `%5\*%` matched "5% off", `%5*%` matched "Save 50 today"). So "5*"
 * listed every row containing a 5. The first fix refused `*` with a 400, and
 * the page showed that as "could not be loaded", its Try again repeating the
 * 400. PostgREST applies the `*` rewrite to like/ilike only
 * (Query/SqlFragment.hs, `OpLike`/`OpILike`, v14.16 and v16.2); an `imatch`
 * value is bound as typed. Do not move this back to `.ilike()`.
 */
const REGEX_METACHARACTERS = /[\\.[\]{}()*+?^$|]/g;

export function escapeRegex(text: string): string {
  return text.replace(REGEX_METACHARACTERS, (character) => `\\${character}`);
}
