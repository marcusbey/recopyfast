/**
 * Bounds on `api_keys` rows (s77: s42 review m3, s44 review m2, ADR 056).
 *
 * Constants live here, not in `src/app/api/api-keys/route.ts`: a route module
 * may only export its handlers.
 */

/**
 * The most keys one site may hold, active or paused, across all of its admins.
 *
 * `/api/v1/content` meters per key (ADR 056), so the number of keys is the
 * multiplier on a site's ceiling: with no cap, N keys gave a site N times the
 * per-key limit. Ten keeps rotation (two at once) and one key per environment
 * (production, staging, preview, CI) well inside it, and 10 × the default 100
 * requests a minute = 1,000 a minute — the ceiling every widget per-site
 * limiter already uses (`API_KEY_DEFAULT`).
 */
export const MAX_API_KEYS_PER_SITE = 10;

/**
 * The longest key name, in characters. The column is unbounded `TEXT`; the
 * name is a label in a list row that truncates, so 100 is far above any real
 * one.
 */
export const MAX_API_KEY_NAME_LENGTH = 100;
