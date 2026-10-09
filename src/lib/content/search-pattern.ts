/**
 * The Changes search's LIKE pattern (s70b), applied by
 * `GET /api/content/changes` with `.ilike("search_text", …)`.
 *
 * `%`, `_` and `\` are LIKE syntax, so typed text is escaped before it becomes
 * a pattern: "50%_off" must find "50%_off", not "50 anything off".
 *
 * `*` cannot be escaped, so a search holding one has no pattern (null) and the
 * route refuses it. PostgREST rewrites every `*` in a like/ilike value to `%`
 * before Postgres sees it (so URLs need not percent-encode `%`), and a
 * backslash does not protect it: `\*` arrives as `\%`, a literal percent sign.
 * Measured on PostgREST 14.16 (s70b review m1): `%5*%` matched "Save 50
 * today" and "5% off" as well as "From $5* a month"; `%5\*%` matched only
 * "5% off". Stripping the `*` would turn "5*" into "5", the same every-row
 * match. Refusing it is the one rule that never lies about what matched.
 */
export function likePattern(q: string): string | null {
  if (q.includes("*")) return null;
  return `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
