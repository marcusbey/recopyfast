---
validated: yes
---
# Plan — Story s77-route-limiters-and-errors

> CTO decision under the owner's 2026-10-09 directive.

Branch: `feature/s77-route-limiters-and-errors` (from `origin/main` `c0c40bf`).
Research: `docs/research/s77-route-limiters-and-errors.md` — read it first; this plan does not
repeat it. Decision: ADR 056. No Design step: no screen changes. Two refusals gain server copy that
existing surfaces already print (the API keys panel's error box, the bulk form's alert).

## CTO decisions

1. **Pre-authorization guard = `IP_GENERAL` (200/min) per IP, one bucket per route family, fail
   closed.** Every guarded route has a fail-closed limiter behind authorization on each success
   path, so a Redis outage refuses legitimate callers there anyway; failing the guard open would
   only hand an unmetered flood the authorizer (s44's reasoning for `v1/content`, ADR 037 step 1).
   Buckets: `ab-tests/bucket:ip`, `ab-tests/active:ip`, `ab-tests/track:ip`, `staging/publish:ip`
   (GET+POST), `staging/content:ip` (GET+PUT), `domains/verify:ip` (all verbs), `sites/share:ip`
   (all verbs). 200/min because the same visitor page view already meets `IP_GENERAL` on the
   content GET, and an office NAT of editors is far below it.
2. **The per-site limiters stay behind authorization** (their reason is unchanged: an anonymous
   caller must not spend a customer's bucket). The two staging GETs, which had none, gain one:
   `staging/publish-preview` and `staging/content-read`, `USER_GENERAL` 100/min per site, fail
   closed (service-role reads, ADR 002 §4) — the publish dialog opens one preview per click.
3. **R1: `requireUuid` at the top of each handler** that takes a `siteId` from the caller
   (`staging/publish` GET/POST, `staging/content` GET/PUT, `edit-board/{history,languages,styles,
   styles/apply,themes}` — 17 handlers), so the canonical lower-case id is what the authorizer,
   the limiter and every query see; a malformed id is 400 `Field "siteId" must be a valid UUID`
   (echoes nothing) before any database work. Upper-case spellings are accepted and share one
   bucket. A missing id keeps its existing message.
4. **R2: `MAX_BULK_UPDATE_OPERATIONS` = 100** in `src/lib/bulk/constants.ts`; more is 400 before
   `getUser`. Why 100: the only caller builds batches by hand, one row per operation; each
   operation is up to two sequential round trips, so 100 bounds one request at ~200 round trips,
   and with the 10/min limiter in front, one address at ~1,000 element writes a minute. Bigger
   changes belong to bulk import (one RPC, ADR 008).
5. **R5 / s68b #3 / R6: ADR 037's order on every verb** — IP guard → `getUser()` → fail-closed
   per-user limiter → permission read → service role. Writes share one bucket per route,
   `API_UPLOAD` 10/min (`domains/verify:write` for POST+DELETE, `sites/share:write` for
   POST+DELETE; the api-keys precedent); reads get `USER_GENERAL` 100/min (`domains/verify:read`,
   `sites/share:read`) — the domain panel fetches on mount and after each action, the share GET has
   no caller. PUT keeps its `USER_DOMAIN_VERIFY` 3/5 min bucket and gains the IP guard.
6. **s42 m3: `MAX_API_KEYS_PER_SITE` = 10 (409) and `MAX_API_KEY_NAME_LENGTH` = 100 characters
   (400)**, in `src/lib/api/api-key-limits.ts` (a route file may only export handlers). The count
   covers every key on the site, active or paused, through the service client after the admin
   check (ADR 037 step 5), and a failed count refuses (500) rather than creating. Why 10: rotation
   needs two at once, one per environment (production, staging, preview, CI) plus rotation stays
   under ten, and 10 × the default 100/min = 1,000/min = `API_KEY_DEFAULT` (ADR 056). Why 100
   characters: a label in a list row that truncates; the column is unbounded `TEXT`. Check-then-
   insert, bounded by the 10/min write limiter (ADR 056 "Considered options").
7. **L4: one helper, `isAuthorizedCronRequest(request)`** in `src/lib/security/cron-auth.ts`,
   built on the existing `timingSafeEqualString` (SHA-256 both sides, `timingSafeEqual` over equal
   lengths). Fail closed when `CRON_SECRET` is unset or empty. `generate-blog-post` still reads the
   secret to forward it.
8. **s44 m2: ADR 056** (docs commit). **s68a m9** is `edit-sessions/create` — s76's file — so it
   goes to s77b with the other excluded gaps (below).
9. **Commits:** the protocol's docs commit, then one story commit. No migration, nothing under
   `server/` or `public/embed/`, no new dependency.

## Tasks (ordered, test-first)

0. [x] **Baseline.** 49 targeted suites green on `c0c40bf` (569 tests).
1. [x] **L4 — constant-time cron secret.**
   - RED `src/__tests__/api/cron/cron-secret.test.ts`: the helper accepts the exact bearer and
     refuses a wrong one of the same length, a shorter and a longer one, a missing header, an
     unset and an empty secret, without throwing; it compares through `crypto.timingSafeEqual`
     over two equal-length buffers. For each of the four routes: a wrong bearer is 401 and the
     decision consulted `crypto.timingSafeEqual`; the right bearer passes the gate.
   - GREEN: `src/lib/security/cron-auth.ts`; the three cron routes and `blog/generate` call it.
2. [x] **L7 — A/B routes meter per IP before authorizing.**
   - RED `src/__tests__/api/ab-tests/ip-guard-before-auth.test.ts`, for bucket, active, track:
     over the IP limit → 429 with `Retry-After`, `authorizeSiteRequest` and the service client never
     reached; the guard's bucket is the IP, `IP_GENERAL`; store down → 503, nothing reached; within
     the limit the per-site limiter still runs on the authorized id.
   - GREEN: the guard as the first statement of each handler (track: before the body read).
3. [x] **L7 + R1 — staging publish and content.**
   - RED `src/__tests__/api/staging/limiter-order.test.ts`, for publish GET/POST and content
     GET/PUT: IP guard refuses before any authorizer call (429; store down 503); an upper-case id
     authorizes, is metered and queried as the lower-case id; a malformed id is 400 before any
     authorizer or limiter; the two GETs are metered per site behind authorization (429 → no
     service-role read; store down → 503).
   - GREEN: guard + `requireUuid` + the two read limiters.
4. [x] **R1 — edit-board ids.**
   - RED `src/__tests__/api/edit-board/canonical-site-id.test.ts`, every handler that takes a
     `siteId` (13): an upper-case id is metered on the lower-case id; a malformed id is 400 with no
     access check and no limiter.
   - GREEN: `requireUuid` where each handler reads `siteId`.
5. [x] **R2 — bulk operations cap.**
   - RED `src/__tests__/api/bulk/update-operations-cap.test.ts`: 101 operations → 400 naming the
     limit, no `getUser`, nothing written; exactly 100 → processed.
   - GREEN: the constant and the check.
6. [x] **R5 + s68b #3 — domains/verify.**
   - RED `src/__tests__/api/domains/verify-limiters.test.ts`, all four verbs: IP guard refuses
     before `getUser` (429; store down 503); POST/DELETE/GET meter the user before any permission
     read or service-role call (429 → none; store down → 503); POST and DELETE share the write
     bucket; GET uses the read bucket.
   - GREEN: guard + per-user limiters.
7. [x] **R6 — share.**
   - RED `src/__tests__/api/sites/share-limiters.test.ts`: same table as task 6 for POST/GET/DELETE
     (no `checkSitePermission`, no service-role call when refused).
   - GREEN: guard + per-user limiters.
8. [x] **s42 m3 — API key cap and name length.**
   - RED `src/__tests__/api/api-keys/key-cap.test.ts`: a site holding 10 keys → 409, nothing
     inserted; 9 → created; the count is per site (not filtered by user); a failed count → 500,
     nothing inserted; a 101-character name → 400 before any permission read; 100 → created.
   - GREEN: `src/lib/api/api-key-limits.ts` and the two checks.
9. [x] **Existing suites.** Reshape fixture ids the canonical-id rule now refuses, and the
   assertions that read "the first limiter call" or "no limiter before `getUser`" — each listed in
   the report and the PR (AGENTS.md § Tests).
10. [x] **Gates and mutations** per the protocol; `docs/stories.md` s69 lines annotated
    "→ closed by s77"; one story commit.

## Implementation notes (recorded at execution)

- Decision 3 is implemented through one exported wrapper, `canonicalSiteId(raw)` in
  `src/lib/api/validation.ts` (`requireUuid({ siteId: raw }, "siteId")`), so the 17 handlers share
  one rule and one comment. It runs where each handler first reads the id: after the existing
  "missing" checks (their messages are unchanged) and, on the four staging handlers, after the IP
  guard.
- Existing suites changed (no assertion weakened; each now targets the bucket it was written for):
  - Fixture ids reshaped to RFC v4 (the rule refuses them): `staging/content-{attributes-projection,
    concurrent-elements,concurrent-write,device-grant,href,put-permissions}`,
    `staging/service-role-rate-limit`, `content/page-scoped-reads`,
    `edit-board/{service-role-rate-limit,staging-token-device,languages-no-auto-translate}`,
    `editor/handoff/redeem/route`.
  - "The first limiter call is the per-site one" → found by endpoint/identifier type, and the
    refusal/outage rows refuse only the per-site bucket: `ab-tests/service-role-rate-limit`,
    `staging/service-role-rate-limit`.
  - "No limiter before …": `ab-tests/track-bounds` (a refused body spends no per-site bucket; the IP
    guard now runs first), `domains/verify-limiter` (the user's bucket is not opened for an
    anonymous caller; refusals target the per-user bucket).
  - Mocks answer the new per-site key count: `api-keys/writes`, `api-keys/secret-projection`.
- Database: `content-attributes-lifecycle` (drives staging PUT/publish and history restore against
  real rows), `column-privileges`, `function-grants`, `rls-policies` pass on a throwaway PostgreSQL
  17 with the bootstrap and every migration. `content-write-privileges` needs PostgREST/GoTrue —
  left to CI's e2e DB step.

## Follow-up — s77b (files owned by other stories while s77 runs)

- `POST /api/staging/validate`: no limiter before authorization (L7).
- `POST /api/edit-sessions/{validate,extend}`: no limiter before authorization (L7);
  `edit-sessions/{active,revoke}`: no limiter.
- `POST /api/edit-sessions/create`: IP guard before `getUser` (s68a review m9). The AGENTS.md
  "Data access" list half of m9 is a rules edit.
- `edit-board/*`: an IP guard before authorization (R1 only is done here).
- Optional: a database-enforced key cap (ADR 056 "Considered options"); the dashboard could quote
  the key and name limits beside the form.

## Rollout

Application only. After deploy, as an operator: `GET /api/ab-tests/active/<real site id>` with the
site token still answers 200; publishing from the widget still works; creating an eleventh key on
a site answers 409 in the API keys panel.
