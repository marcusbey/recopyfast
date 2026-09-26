# Review — s44-v1-rate-limiter

Reviewer: fresh-context `reviewer` subagent, 2026-09-26, judged implementation commit `6e873e4`
(merge `e5224e1` ignored). Returned as text (its policy forbids report files); recorded here by the
orchestrator.

## Gates (reviewer, CI placeholder env)
`npm run type-check` 0. Lint 0 errors (38 pre-existing warnings, none in touched files). Prettier
clean. Targeted Jest 6 suites 68/68. Full Jest: 270 suites passed, 2 skipped; 3,494 passed, 39 skipped.

## Verified
1. Every verb: IP guard → `validateAPIKey` → per-key limit → content (GET `route.ts:99→103→113→151`,
   POST `:206→210→220→266`, DELETE `:355→359→369→412`, PUT = POST). Ceiling = `rate_limit_per_minute`
   (`:88`); bucket `identifier: apiKey.id` (`:90`). Both limiters `deny`, each justified (`:38-51`,
   `:62-77`) under ADR 002 §4.
2. `validateAPIKey`: `API_KEY_AUTH_COLUMNS` all exist in migration 20250817000000 (+ `site_id`);
   `rate_limit` no longer read; `key_hash` filter-only; s42 admin re-check (`:112-133`) unchanged.
3. `maxRequests`: only caller `route.ts:88`; none of the other 33 `enforceRateLimit` call sites
   passes it; absent → preset unchanged; not request-controllable (no authenticated writes on
   `api_keys`; api-keys POST takes only `siteId`, `name`).
4. Deleted `rate-limiter-fail-closed.test.ts`: 4/6 cases pinned the removed class; "logs loudly"
   → `content-route.test.ts:336`; "no content read in outage" → `:322-337`, `:290-306` (503, declared);
   "serves while the store answers" → `:163-173`.
5. The schema-strict double rejects unknown columns (42703 / PGRST204 / 42P01), `seed` throws on
   unknown columns, unsupported methods throw; columns read from `supabase/migrations` and checked
   against production's lists.

## Mutations (each restored, `git diff --exit-code` = 0)
select `rate_limit` 9/35 red · per-key limit after content read 2 · per-key fails open 1 · IP guard
fails open 1 · both fail open 2 · IP guard dropped (all / GET / DELETE) 2/2/2 · key ceiling not
passed 4 · `maxRequests` guard loosened 4 · per-key dropped on DELETE 1 · `select("*")` 1 · admin
re-check neutralized 1 · **per-key bucket keyed on `site_id`: 0**.

## Findings (all minor)
- m1 — separate per-key buckets not pinned (`content-route.test.ts:235-244`: other key at 100).
- m2 — per-key where ADR 002 §4 / AGENTS.md say per-site; justified in research, not in an ADR.
  N keys → N × ceiling; no cap on keys per site (s42 m3). Follow-up ADR amendment.
- m3 — `IP_GENERAL` 200/min caps any key set above 200 from one IP. Latent (default 100, no writer).
- m4 — the migration reader ignores `DROP TABLE` / `ALTER TABLE … RENAME TO` (none exist today).

## Fix mode — m1 (2026-09-26, orchestrator)
Both keys seeded at 1/min. Proven: correct code 12/12; limiter keyed on `site_id` → 1 red; restored.

## Not verified
Real Redis (memory store only) — live check after deploy: fresh key's first GET 200, 101st in a
minute 429 with `X-RateLimit-Limit: 100`. Redis-down in production (spy only). `X-Forwarded-For`
source on Vercel for the IP guard.

Max severity: minor
Ship allowed: yes
