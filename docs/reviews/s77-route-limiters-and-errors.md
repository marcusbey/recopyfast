# Review — s77-route-limiters-and-errors

Reviewer: fresh-context `reviewer` subagent, 2026-10-09. Diff: `git diff origin/main...984fad2` (rebased since onto
fc5968b as de30a66 docs, c0cc4b8 story).

## Verdict summary

Tasks 0–10 all present, nothing beyond the plan (the `canonicalSiteId` wrapper is in the implementation notes); no
migration, nothing under `server/` or `public/embed/`, no new dependency. 17 canonical-id handlers (staging/publish 2,
staging/content 2, history 2, languages 4, styles 2, styles/apply 1, themes 4); `history/[versionId]` rightly left out
(keys on `version.site_id`).

Gates: jest 389 suites / 5,116 (38 DB tests skipped); type-check (both) 0; lint 0 errors (touched files clean);
format:check clean; build:embed 45828; Playwright `--list` 80.

Anti-hallucination: every symbol opened — `enforceRateLimit` (`src/lib/api/rate-limit.ts`), presets (IP_GENERAL
200/min, USER_GENERAL 100/min, API_UPLOAD 10/min), Redis key = type + identifier + endpoint, `requireUuid` /
`UUID_PATTERN` (v1–v5, RFC variant, any case), `timingSafeEqualString` (lazy key, no throw at import),
`withPublicCors`, `support/postgrest-chain.ts`.

Security:

1. Order on every route: IP guard → (getUser → per-user limiter) → permission check → service role. A/B routes' IP
   guard fails closed; their per-site limiter already did, and the widget falls back to authored copy in both A/B paths
   (`recopyfast.src.js` `fetchActiveTests`, `bucketVisitor`). Bends "public reads fail open", explained per route —
   acceptable. In an outage the two staging GETs and the domains GET now 503 (their features were already down).
2. 200/min per IP per endpoint matches `content/read` on the same page view; `track` fills first (impression + clicks)
   and drops beacons silently behind large shared addresses — accepted, watched via the `ab-tests/track:ip` warn.
3. `canonicalSiteId`: lower-case ids unchanged; upper-case served and share one bucket; malformed → 400 echoing
   nothing. No non-RFC UUID literal in supabase/, public/embed, src/, e2e, scripts.
4. Cron compare: both sides SHA-256'd to 32 bytes before `timingSafeEqual`; unset/empty secret refused.
5. API key cap is check-then-insert: bounded overshoot (≤ 9 per admin burst), recorded in ADR 056.
6. Changed tests: fixture ids → RFC v4 UUIDs; bucket assertions now stricter. None weakened; all listed in the plan.

Mutations: 25 (cron-auth ×3, A/B IP guards ×3, publish/staging limiters ×4, canonicalSiteId ×3, bulk cap, key cap ×4,
name cap, domains limiters ×4, share limiters ×3) — every one red.

## Findings

- minor m1 — research premise wrong ("the widget only PUTs"): the widget GETs `/api/staging/content/<id>` on every
  page load in staging mode or with a stored editor grant and polls it every 5 s in the socket-failure fallback; the
  comment at `staging/content/[siteId]/route.ts:121-125` repeated it.
- minor m2 — merge coordination: (a) s89's cron route must use `isAuthorizedCronRequest` and the `blog/generate` rows
  of `cron-secret.test.ts` must go when s89 lands; (b) s76's `staging-outage.test.ts` uses `"site-123"` → 400 after
  this merges, needs an RFC v4 UUID; (c) `docs/stories.md` append conflicts.
- minor m3 — `ab-tests/active` `withCors` stamped `public, max-age=60, stale-while-revalidate=300` on 429/503
  refusals.
- minor m4 — "ADR 037 order on every verb" overstated: share POST created the service-role client before `getUser`
  (pre-existing, no request made).

## Fix pass (9ca62e4) — verified by the orchestrator

- m1: both comments in `staging/content/[siteId]/route.ts`, research §L7 and plan decision 2 rewritten with the real
  call sites. Arithmetic: per site 100/min = 8 polling tabs (8 × 12 = 96) plus page views; per IP 200/min shared by
  GET, PUT and every site = 16 polling tabs (192). A refusal skips one 5 s tick or shows one page as authored — never a
  write. CTO decision: limits unchanged.
- m3: `withCors` keeps the public cache only on `response.ok`; every non-2xx (429, 503, 401, 500) is `no-store` (CTO
  decision: one rule, not a list). New `active-refusals-not-cached.test.ts` — 5 of 6 red before the fix.
- m4: share POST now creates the service-role client after `checkSitePermission` and the site lookup; tests assert
  getUser → per-user limiter → permission → service client on all three verbs and no client on 401/403 — 5 of 24 red
  before the fix. AC wording kept (now true).
- m2: recorded in the plan's "Merge coordination" section; s89 and s76 apply them on rebase.
- Mutations: original cache (5 red), `no-store` on 429 only (3 red), never cache (1 red), client before getUser
  (5 red), client between limiter and permission (2 red).
- Gates: jest 390 suites / 5,140 (38 skipped); type-check (both) 0; lint 0 errors; format:check clean; build:embed
  45828; Playwright `--list` 80.

## CI fix pass (`ff06915`) — E2E timeouts on PR #82, verified by the orchestrator

CI run 37960549645: `realtime-additive` AC 6 and `realtime-parity` "a snippet with no data-ws-url…" timed out on every
retry (75 passed, 2 failed, 3 skipped). Root cause — not the limiters, `canonicalSiteId` or Redis (Redis logged under 50
limiter checks for the whole run): the m3 fix made every refusal from `GET /api/ab-tests/active` `no-store`; the
widget's `fetchActiveTests` returns on `!response.ok` without reading the body, and Chromium never finishes a request
whose unread body its HTTP cache may not store, so `waitUntil: "networkidle"` never came. Reproduced on `next build` +
`next start` (AC 6 failed at 90 s; the only pending request was the 401 A/B lookup) and in a bare page:

| Refusal header                                                | Body              | Network idle |
| ------------------------------------------------------------- | ----------------- | ------------ |
| `no-store`                                                    | unread            | never        |
| `public, max-age=60, stale-while-revalidate=300` (before s77) | unread            | ~0.6 s       |
| `no-cache` / `private, no-cache`                              | unread            | ~0.6 s       |
| `no-store`                                                    | read or cancelled | ~0.5 s       |

Fix: every non-2xx carries `Cache-Control: private, no-cache` — never reused without asking the server, never kept by a
shared cache — and the route comment records why `no-store` must not come back. CTO decision: fixed in the header, not
the widget (every installed snippet has the same early return; the embed has 0 bytes of headroom). Existing test changed
(declared): `active-refusals-not-cached.test.ts` refusal rows expect `private, no-cache` (5 of 6 red against `no-store`,
`no-cache`, and the old public cache). `realtime-additive` 2/2 locally (AC 6 in 5.2 s). Rebased on main 122ad2e (s74,
s75): contract 81, no new DB suite. Jest 394 suites / 5,183; type-check (both) 0; lint 0 errors; format:check clean;
build:embed 45828 / 33062; Playwright `--list` 81. Follow-up (embed bytes needed): `sendContentMap`'s discovery POST,
`hydrateStoredContent` and `bucketVisitor` also leave unread bodies.

## Devin Review on PR #82 — fixed (orchestrator)

🟡 **Stored key names exceed length cap** (valid): the 100-character bound was measured on the typed name, but
`validateAndSanitizeInput` HTML-encodes it, so 100 `<` were stored as 400 characters. `POST /api/api-keys` now refuses
when either the typed or the stored (encoded) name exceeds `MAX_API_KEY_NAME_LENGTH`, still before any read. Test (red
first: "Expected 400, Received 200"): 100 `<` → 400, no permission read, no insert. api-keys suites 44/44.

Flag **Concurrent creates exceed site key cap** (investigate): the check-then-insert overshoot is bounded (≤ 9 per
admin burst at 10 writes/min) and recorded in ADR 056; an atomic cap needs a database constraint — follow-up with the
s80 grant-hygiene migration lane.

## Not verified

DB suites (`content-write-privileges`) and core e2e under the new 200/min guards → CI. Real Redis on a preview: 201
requests to `GET /api/ab-tests/active/<site>` → 429 + `Retry-After`; Redis down → A/B 503, content GET 200. Edge
topology: `getClientIp` trusts the first `x-forwarded-for` (correct only with Vercel as the edge). Flows: edit mode
across three pages + publish; 11th API key → 409; 101 bulk rows → alert; domain panel. Production crons return 200 on
their next run.

Max severity: minor
Ship allowed: yes
