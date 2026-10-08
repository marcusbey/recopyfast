---
validated: yes
---
# Plan — Story s68b-api-abuse-bounds

Branch: `feature/s68b-api-abuse-bounds`
Research: `docs/research/s68b-api-abuse-bounds.md` — read it first; this plan does not repeat it.
Decision: [ADR 048](../decisions/048-bulk-find-replace-is-literal-only.md) (drafted on the s68
planning branch; it travels with this story).

## Owner decisions (2026-10-08)

Plan validated by the owner, with the recommended defaults:

- A/B: one conversion per visitor per test, counted only after that visitor viewed the test.
- Regex find/replace is removed entirely (ADR 048); nothing in the product uses it.
- The staging-invite email keeps the admin-chosen label, HTML-escaped and capped at 80
  characters.

## Target story

`docs/stories.md` → s68b. Outbound fetches never follow redirects (M1, M10); bulk find/replace is
literal only (M2); editor codes are bucketed by canonical site id and charged atomically (M3);
public-token per-site limiters key on the authorized site id (M4); A/B telemetry is bounded and
validated (M5); emails escape the admin-chosen label (M6); domain verification is rate limited
(M10). No migration, no embed bytes, no `server/` change.

## Tasks (ordered)

1. [x] **M1 — webhooks never follow redirects.** RED in `src/__tests__/webhooks/manager.test.ts`:
   delivery and `testWebhook` call `fetch` with `redirect: "manual"`; a `302` with a `Location`
   is a failed attempt whose stored `response_body` is null and whose `error_message` is
   "Endpoint redirected (302). Webhooks do not follow redirects."; retry state follows ADR 010
   unchanged. New `src/__tests__/webhooks/redirect-not-followed.test.ts` (`@jest-environment node`):
   two loopback HTTP servers, A answers `302 Location: <B>`, `assertSafeWebhookUrl` mocked to
   accept; one delivery to A → B received **zero** requests. GREEN in `manager.ts:447-455` and
   `:791-801` with a tombstone comment (SSRF by redirect: the guard checks the first hop only).
2. [x] **M10 — domain file verification.** RED in `src/__tests__/security/domain-verification.test.ts`:
   `verifyDomainFile` passes `redirect: "manual"`; a `301` fails with "Verification file must be
   served without a redirect." and no upstream `statusText`; the address check refuses an address
   the hand-written denylist misses (e.g. `192.0.0.8`, `198.18.0.1`) — by calling
   `assertSafeWebhookUrl` on the built URL in place of `assertNoInternalResolution`. New
   `src/__tests__/api/domains/verify-limiter.test.ts`: `PUT /api/domains/verify` answers 429 from
   a per-user limiter (`identifierType: "user"`, `onStoreFailure: "deny"`, after `getUser`, before
   the row read) and performs no DNS lookup or fetch when refused. GREEN in
   `src/lib/security/domain-verification.ts:296-330` and `src/app/api/domains/verify/route.ts`.
   Keep `assertNoInternalResolution` exported only if another caller exists (grep); else delete it
   with a tombstone.
3. [x] **M2 — literal only (ADR 048).** RED: new `src/__tests__/api/bulk/update-literal-only.test.ts`
   (route handler, mocked clients as in `update-limiter.test.ts`): an operation with
   `useRegex: true, find: "((a+))+$"` against `"a".repeat(30) + "!"` is reported failed with
   "Regex find/replace is not supported; use literal find/replace.", the request finishes in
   < 100 ms, no write is issued for it, and a `RegExp` spy never receives request input; a literal
   operation in the same batch still applies. GREEN: delete `isDangerousRegex`, `MAX_REGEX_LENGTH`
   and the regex branch (`route.ts:176-205`, `:276-300`); tombstone naming the payload and ADR 048;
   drop `useRegex` from `BulkUpdatePayload` in `src/types/index.ts:657` (or mark it `never`-typed
   and documented as refused — whichever keeps `type-check` honest).
4. [x] **M3a — canonical site id on editor code routes.** RED in
   `src/__tests__/api/editor/request-code/route.test.ts` and `submit-code/route.test.ts`: an
   upper-case `siteId` reaches `enforceRateLimit` as `identifier: "<email>|<lower-case id>"` and the
   code lookup with the lower-case id; a non-UUID `siteId` answers 400 `invalid_request` before any
   limiter or database call; hub mode (no `siteId`) unchanged. GREEN: `requireUuid` in both routes
   before `limitCodeRequests` / `limitCodeAttempts`.
5. [x] **M3b — attempts charged atomically before comparing.** RED: new
   `src/lib/auth/__tests__/editor-verification-attempts.test.ts` with a fake store honouring
   conditional updates: 20 concurrent wrong guesses against one code → at most `MAX_CODE_ATTEMPTS`
   hash comparisons (spy on `timingSafeEqualString`) and the code ends consumed; a guess that loses
   the compare-and-set returns `{ ok: false, reason: "mismatch" }` without comparing; the correct
   code on the first try still returns ok and is consumed exactly once. Real Postgres: new
   `src/__tests__/db/editor-code-attempts.test.ts` (supabase-js service client against the local
   PostgREST, gated like `published-snapshot-freshness.test.ts`): 20 concurrent wrong
   `consumeVerificationCode` calls → row `attempts = 5`, `consumed_at` set; a following correct
   guess → `no_code`. Add it to the `RCF_REQUIRE_TEST_DB=1` PostgREST step in `.github/workflows/ci.yml`
   (`:278-288`). GREEN in `editor-verification.ts:130-155`: `UPDATE … SET attempts = k + 1
   [, consumed_at if k + 1 ≥ MAX] WHERE id = ? AND attempts = k AND consumed_at IS NULL` via
   `.eq("attempts", k).is("consumed_at", null).select("id")`; zero rows → reject as mismatch;
   only then compare; on a match, the existing conditional consume (`:157-181`) stays the
   serialization point.
6. [x] **M4 — per-site buckets on the authorized id.** RED: for `content/[siteId]` POST discovery,
   `ab-tests/bucket/[siteId]`, `ab-tests/active/[siteId]` and `ab-tests/track`, a request whose
   site id is the upper-case spelling of a real site, carrying that site's genuine token, calls
   `enforceRateLimit` with `identifier` equal to the lower-case `site.id` (extend
   `src/__tests__/api/content/rate-limit.test.ts` and the three `src/__tests__/api/ab-tests/*`
   suites, or one new `src/__tests__/api/public-site-bucket-canonical.test.ts` covering all four).
   GREEN: keep `authorizeSiteRequest`'s return value and use `site.id` for the limiter (and for
   the ownership query in `track`). No refusal of non-canonical spellings (non-negotiables 2, 4).
7. [x] **M5 — A/B telemetry bounds.** RED: new `src/__tests__/api/ab-tests/track-bounds.test.ts`.
   Accepted (embed-shaped, copied from `recopyfast.src.js:3437-3495`): a 3-event view batch, a
   click, a conversion with `value: 1` and `metadata: { event_name: "signup" }`, `rcf-<ms>-<9>`
   and UUID visitor ids, `geo_*: null`. Refused 400 with **zero** database calls: > 50 events; body
   > 64 KB; non-UUID `test_id`/`variant_id`/`site_id`; `event_type` outside view/click/conversion;
   `value` non-number, non-finite, < 0 or > 1,000,000; `metadata` not a plain object, deeper than 2,
   larger than 1 KB serialized, or carrying `__proto__`/`constructor`/`prototype`; `visitor_id` /
   `session_id` empty, > 64 chars or with control characters; `geo_*` > 64 chars. Counting: a second
   conversion for the same (visitor, test) is not inserted; a conversion from a visitor with no
   recorded view of that test is not inserted; the response reports them as `deduplicated`
   (pending open question 2 — if the owner declines, keep only the bounds). GREEN in
   `track/route.ts` using `src/lib/api/validation.ts` helpers (extend them; no zod, ADR 003);
   redact control characters before any value is echoed (AGENTS.md "Validation").
8. [x] **M6 — email label.** RED: new `src/lib/email/__tests__/resend-codes.test.ts`:
   `sendStagingVerificationEmail` and `sendEditorAccessCode` with label
   `<a href="https://evil.test">Reset password</a>` send HTML containing
   `&lt;a href=&quot;https://evil.test&quot;` and no raw `<a href="https://evil.test"`; text body
   unchanged. `src/__tests__/api/staging/access.test.ts`: `label` that is not a string, > 80
   characters, or contains control characters → 400 and `createStagingAccess` not called; a normal
   label is stored and emailed escaped. GREEN: `escapeHtml(siteLabel)` at `resend.ts:183`/`:213`
   and the label rule in `staging/access/route.ts` before `createStagingAccess`.
9. [x] **Gates and commit.** `npm run precommit`, `npm run prepush`,
   `node scripts/run-db-invariants.mjs`, `npm run build:embed -- --check` green in the worktree;
   ADR 048 final; one story commit. Tick the boxes as tasks land.

## Rollout

Application-only: merging to `main` is the Vercel production deploy. No migration, no Fly deploy.
After the deploy, the operator: (1) points a test webhook at a URL that answers `302` and presses
"Send test" — the dashboard shows the redirect refusal; (2) runs domain verification five times in
a minute on a test site — the fourth or fifth answers 429; (3) watches Sentry/Vercel logs for
`ab-tests/track` 400s for 24 h — any from real embed traffic means a validator is too tight and is
a bug, not an attack.

## Run interdicts

- `git diff main...HEAD -- supabase/ public/embed/ server/ src/app/api/published/` is empty.
- `package.json` / `package-lock.json` unchanged (ADR 048 rejects a regex dependency).
- `src/lib/security/webhook-url-safety.ts` semantics unchanged — reuse only.
- No public-token route starts refusing non-canonical site ids (M4 keys the bucket instead).
- Webhook retry/backoff (ADR 010) unchanged except that a 3xx is a failed attempt.
- No `--no-verify`, no production SQL, no deploy.

## The point everything turns on

Every tightening lands on a live surface whose real clients are not ours to update (the embed on
customer domains, integrators' webhook endpoints). Where this could be wrong:
1. **M5 validators rejecting real embed events** — compare each rule with what
   `public/embed/recopyfast.src.js:3437-3520` actually sends (the accepted fixtures in task 7 are
   copied from it) and with production logs after deploy.
2. **M3b's compare-and-set under PostgREST** — `.eq("attempts", k)` on an UPDATE must report zero
   rows to the loser; prove it on real Postgres (task 5), not only with the fake.
3. **M1 integrators whose endpoint legitimately redirects** (http→https, trailing slash) start
   failing. That is the intended trade (the stored error says why); compare with the s16 docs that
   tell owners to configure the final URL.

## Files touched

Modified: `src/lib/webhooks/manager.ts`, `src/lib/security/domain-verification.ts`,
`src/app/api/domains/verify/route.ts`, `src/app/api/bulk/update/route.ts`, `src/types/index.ts`,
`src/app/api/editor/request-code/route.ts`, `src/app/api/editor/submit-code/route.ts`,
`src/lib/auth/editor-verification.ts`, `src/app/api/content/[siteId]/route.ts` (limiter identifier
only), `src/app/api/ab-tests/{bucket/[siteId],active/[siteId],track}/route.ts`,
`src/lib/api/validation.ts`, `src/lib/email/resend.ts`, `src/app/api/staging/access/route.ts`,
`.github/workflows/ci.yml`, existing suites named in research. New: the test files named above,
ADR 048.

## Test strategy

Route-handler tests with mocked clients for every refusal (each asserts zero database calls where
the story says "before the database"), two real-I/O proofs where mocks cannot be trusted (loopback
HTTP redirect for M1, real Postgres for M3b), and embed-shaped fixtures as the guard against
over-tightening M5.

## Definition of Done

Repo DoD, plus every s68b AC checked with its named test; ADR 048 merged; post-deploy operator
checks recorded in the PR.
