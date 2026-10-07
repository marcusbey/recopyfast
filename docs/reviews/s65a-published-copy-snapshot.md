# Re-review — s65a-published-copy-snapshot (after fix round 2)

Reviewer: fresh-context `reviewer` subagent, 2026-10-07.
Diff reviewed: `git diff main...feature/s65a-published-copy-snapshot` at `a3e6498`, draft PR #64.
Focus: round-2 delta `4966659..a3e6498`, with a sanity check of the whole diff.
Checklist: `templates/review-checklist.md` is absent, so the review-antihallu checklist was used.

History of this file:
- Round 0 review (at `32688a9`): major. Ship allowed yes.
- Round 1 re-review (at `4966659`): minor, n1–n5. Ship allowed yes.
- This report supersedes both.

## Verdict

G1–G5 resolve n1–n5 and introduce nothing wrong. Round 2 changed only comments, docs and two E2E table entries; no production code changed. The flagged question about the "single exception" wording: it is false (minor, should be fixed before merge). There is one new informational minor and one test nit. No critical, no major.

## Step 1 — tests (run by the reviewer, CI placeholder env)

| Check | Result |
|---|---|
| `npx jest --ci` | 320 suites passed, 2 skipped; 4192 tests passed, 38 skipped; exit 0. Matches CI. |
| lint / type-check / type-check:build / format:check | exit 0. 35 lint warnings, none in story files. |
| `build:embed --check` | up to date |
| `node --test` (measure script) | 8/8 |

Prettier run directly on AGENTS.md and the plan flags both. This is not a finding: AGENTS.md already fails on main, the plan already failed at `4966659`, and `format:check` covers only `src/**`.

Hosted evidence was read from the job logs of run 37653250056:
- **Commit under test.** `headSha` is `a3e6498`. CI checked out `52a490f` ("Merge a3e6498 into 426f459"). `426f459` is both main and the merge-base, so that tree is the branch tree. All three jobs passed.
- **Freshness test.** `PASS src/__tests__/db/published-snapshot-freshness.test.ts` (log line 1133). It ran with `RCF_REQUIRE_TEST_DB: 1`; that step reports 25 tests.
- **Playwright.** It ran against `NODE_ENV=production npm run start`. The s65a test passed (line 1704). Strict summary: "45 passed, 0 failed, 0 skipped, 0 flaky, 45 total (expected 45)" (line 1719).
- **G3 cases.** They are entries in `REFUSED_QUERIES`, which that test loops over. Each asserts 400, `no-store` and no CDN header.

## Step 2 — references

Every symbol the story uses exists with the signature used:
- `enforceRateLimit` (`rate-limit.ts:98`)
- `fetchPageScopedRows` (`paged-elements.ts:84`)
- `PUBLIC_CONTENT_COLUMNS` / `toPublicRows` (`public-rows.ts`)
- `createServiceRoleClient` (`service.ts:12`)
- `normalizePagePath`
- `withPublicCors` / `publicOptions`
- `isSessionlessPath` (`middleware.ts:103`)

The G5 numbers match the code:
- `IP_GENERAL` is 200 requests per 60 s (`rate-limiter.ts:436`).
- Windows are fixed on the wall clock (`Math.floor(now / windowMs)`, lines 98 and 298).
- `Retry-After` is the number of whole seconds left in the window (`rate-limit.ts:81-87`).
- The endpoint is `published/read`.

The G2 comments were checked against Next 16.3.8's own `parseReqUrl` + `formatUrl` / `normalizeCdnUrl`:
- `/`, `%2f`, `%65n`, a trailing `&` and `%20` all come out canonical.
- Reordered and duplicated parameters survive and are refused.
- The trailing-slash page and the 65-character language survive, so they reach the value checks.

## Step 3 — plan compliance (G1–G5 against n1–n5)

| Task | Finding | What changed | Status |
|---|---|---|---|
| G1 | n1 | F2 ticked, citing run 37633742095 | Resolved |
| G2 | n2 | A note above the "literal slash" and "lowercase percent hex" cases in `route.test.ts`; the parser-test header lists exactly the query-shape cases; no assertion changed | Resolved |
| G3 | n3 | Two refused queries added inside the same test (count stays 45). `normalizePagePath` does no folding, so only `published-snapshot-key.ts:114` refuses `/pricing/`; the 65-character language hits the 64 bound at line 97. Proven in CI. | Resolved |
| G4 | n4 | The AGENTS.md CORS line points to ADR 046; the ADR's "Amends" line says so | Resolved |
| G5 | n5 | "Request budget" section in the integrator doc, with pacing and retry advice; facts match the code | Resolved |

Nothing in the diff goes beyond the plan.

Interdicts — no changes to:
- the content GET route
- `public/embed/`
- `package*.json`, `server/package*.json`
- `.env*`
- `next.config.ts`
- `jest.setup.js`

The only migration added is the s62 file: blob `d982bb2`, sha256 `6ee41347…6c62c5b`.

## Step 4 — mutations

Run against the full Jest suite. Each was restored and checked with `git diff --exit-code`; HEAD stayed at `a3e6498`.

| Neutralized in `published-snapshot-key.ts` | Red |
|---|---|
| M1 — trailing-slash refusal (line 114) → `return true` | 3 |
| M2 — length bound dropped (line 97) | 3 |
| M3 — limit 64 → 65 (off by one) | 3 |

Every mutation turns both the parser test and the route test red. The E2E layer was not mutation-run (no local Docker), but its G3 cases target the same guards and passed against the real server.

## Step 5 — rules, ADRs, regressions, and the "single exception" question

**The "single exception" wording is false.** The false statements:
- `route.ts:27-29`: "Every other service-role read in this app runs an `authorize*` call first … This route is the single named exception"
- `route.ts:138-139`: "ADR 046 is the single exception to that rule"
- ADR 046 lines 39-40: "It is the single exception to '`authorize*` before service role'"

Counterexamples:
- **`POST /api/editor/request-code`**, on main since b572777 (2026-08-02):
  - It takes no credential, only an email, and uses `withPublicCors`.
  - It does service-role reads with no `authorize*` call: `findActiveSiteEditor` / `listSitesForEditor` (`editor-directory.ts:66,96`).
  - It does a service-role write: `issueVerificationCode` inside `after()` (`editor-verification.ts:50-54`).
- **ADR 037**: signed-in admin writes through the service role, gated by `getUser()`, recorded as an exception.
- **`/api/editor/sites`**: gated by a hub session, then reads through the service role.

ADR 046 lines 7-9 ("adds one named exception … and nothing else") and its title describe its own scope and are true. The round-2 AGENTS.md and `public-cors.ts` wording no longer claims uniqueness.

This is minor: prose only, no control weakened, and "do not copy; the next one needs its own ADR" remains correct. But it is a false statement about a security invariant that a future auditor would rely on, and ADR 046 can still be edited on this branch.

Other rules:
- The limiter runs before the database and fails open, with a justification comment, as AGENTS.md requires for public reads.
- No rejected value is echoed back.
- The ADR 002 body is untouched.
- ADR 041: the route does no plan lookup.

Regressions: none possible this round, since no executable code changed.

## Findings

No critical. No major.

### Minor
- **p1 — "single exception" is false** (Step 5).
  - Where: `route.ts:27-29` and `:138-139`, ADR 046 lines 39-40.
  - Fix: say "a named exception" and drop "every other service-role read runs `authorize*`", or name `request-code` as an existing service-role path that takes no credential and returns no site data.
- **p2 — the 429 test doesn't check `Retry-After`.**
  - G5 now promises `Retry-After` to integrators.
  - The route's 429 test (`route.test.ts:615`) doesn't assert it; only the shared helper's test does (`enforce-rate-limit-override.test.ts:71`).
  - Fix: add one assertion to the route test.
- **p3 — some "extra parameters" are served, not refused (informational).**
  - Next strips `nxtP*`, `nxtI*` and `nextInternalLocale` query keys before the handler runs (`server-utils.js` `filterInternalQuery`).
  - So `…&variant=default&nxtPfoo=1` returns 200 with the canonical snapshot and becomes a separate CDN entry.
  - ADR 046 lines 95-96 and the integrator doc say any extra parameter gets 400.
  - Same cost class the owner accepted, and the limiter bounds it. A doc clause is enough.
  - Verified by calling Next's functions directly, not on a running server.
- **m6 (accepted by coordinator)** — framing edits to `docs/stories.md` on the feature branch.

### Outside the diff (already on main; a follow-up, not s65a's job to fix)
- `request-code` is an unrecorded departure from ADR 002 rule 3.
- The `public-cors.ts` header line "each one independently verifies that token" is false for `request-code` and `submit-code`.
- AGENTS.md "The one other principal that may reach the service role" is likewise inaccurate.

### Bookkeeping
- This file was untracked at review time. AGENTS.md lines 42 and 51 expect it committed, and the PR body calls it "the gate".
- The PR body doesn't mention round 2 yet.

## Pending by design — correctly left open

- Every s65a acceptance criterion in `docs/stories.md` is still unchecked.
- Still open in both the PR and the ADR Watch section:
  - production speed and freshness measurement
  - CDN behaviour on the preview (it sits behind Vercel SSO)
  - the remote migration ledger

## Not verified / what a human should do

- **Not run locally:** Playwright and the DB suites (Docker disk full). CI logs were read instead, and the E2E assertions were not mutation-run.
- **Next's query re-serialization:** for `%65n`, a trailing `&`, `%20` and `nxtP*`, this was verified with Next's functions, not on a server. Only `/` and `%2f` are proven on `next start`.
- **Vercel runtime:** whether it re-serializes the query the same way (minimal mode) is unverified. With a protection-bypass token, or after deploy:
  - `curl -sI` the canonical URL twice: expect MISS, then HIT.
  - Repeat with an `sb-` cookie: expect no `set-cookie`.
  - Request `page=/`, `page=%2f` and `…&nxtPfoo=1`, and compare status, `etag` and `x-vercel-cache`.
- **Speed and freshness:** in production, run `scripts/measure-published-snapshot.mjs`, including `--freshness`.
- **Migration ledger:** run `supabase migration list --linked`, and check `20261005000000` against sha256 `6ee41347…`.
- **Owner's 2026-10-07 amendment:** the consent itself can't be checked from the repo.

---

# Delta review — fix round 3 (`a3e6498..58682db`)

Reviewer: fresh-context `reviewer` subagent, 2026-10-07. This verdict covers the whole story diff at
`58682db`. It carries forward the round-2 conclusions above for the parts that did not change.

## Result

H1–H3 resolve p1–p3. No executable code changed: printed through the TypeScript printer with
`removeComments: true`, `route.ts` and `published-snapshot-key.ts` are identical at `a3e6498` and at
`58682db`. The only `src/` code change is three assertions in the route's 429 test. No critical or
major issue.

## Evidence

- **Local gates** (CI env, HEAD `58682db`): `npx jest --ci` gives 320 suites passed / 2 skipped and
  4192 tests passed / 38 skipped. lint (0 errors), type-check and format:check all exit 0.
- **Hosted CI run 37656565498.** `headSha` is `58682db`. It checked out `030e735`, the merge of
  `58682db` into `426f459`; since `426f459` is main and also the merge-base, that is the branch tree.
  - All 3 jobs green.
  - `PASS src/__tests__/db/published-snapshot-freshness.test.ts` under `RCF_REQUIRE_TEST_DB: 1`
    (25/25 in that step).
  - Playwright ran on `next start`: "45 passed, 0 failed, 0 skipped, 0 flaky, 45 total (expected 45)".
- **H1.** The new wording about `POST /api/editor/request-code` was checked against that route's code:
  - it takes an email plus an optional `siteId`, neither of which is a credential;
  - it makes service-role reads (`editor-directory.ts:70,99`);
  - it returns no site data (`NEUTRAL_RESPONSE` or a generic 4xx/5xx);
  - its limiter runs before the lookup.

  No uniqueness claim remains in the code, ADR 046, AGENTS.md, `public-cors.ts` or the integrator doc.
- **H2.** The `Retry-After` assertions are real:
  - dropping the header turns the 429 test red (1 failure in the full suite);
  - setting it to 60 breaks the upper bound;
  - both mutations were restored, and `git diff --exit-code` came back clean.
- **H3.** The clause matches Next 16.3.8 `server-utils.js:47-58` (`filterInternalQuery`), which
  `route-module.js` calls unconditionally in `prepare()` (≈ :505–513). For App Router routes
  `combinedParamKeys` is empty. A `next start` probe on the HEAD build gave:
  - `nxtPfoo`, `nxtIfoo` and `nextInternalLocale` pass the key check;
  - bare `nxtP`/`nxtI`, `cb=1` and reordered queries get 400.

  The extra parenthetical added to `published-snapshot-key.ts` is accurate and comment-only.
- **Interdicts on `git diff main...58682db`.** No changes to:
  - the content GET route
  - `public/embed/`
  - the package files (`package*.json`, `server/package*.json`)
  - `.env*`
  - `next.config.ts`
  - `jest.setup.js`

  The only migration is the s62 file (sha256 `6ee41347…6c62c5b`).

## Findings

**Minor**
- **q1 (optional).** "single exception" survives in two completed task descriptions in the plan
  (:59, :178). H1 records the correction, and a "(superseded by H1)" note was added at ship time.
- **q2 (no action).** H1 says the route "takes an email address alone" and omits the optional,
  non-credential `siteId`. It is still accurate about credentials.

**Carried forward**
- m6: framing edits to `docs/stories.md` on the feature branch, accepted by the coordinator.
- Outside the diff, already on main:
  - `request-code` is an unrecorded departure from ADR 002;
  - the `public-cors.ts` line "each one independently verifies that token" is false for
    request-code and submit-code;
  - the AGENTS.md line "The one other principal…" is inaccurate.

## Not verified (pending by design or for a human)

- **Vercel, unlike `next start`, may treat `nxtP<param>` as a route-param candidate.**
  `…&nxtPsiteId=<other uuid>` might then serve the other site's copy under that non-canonical URL.
  - Exposure looks nil: that copy is already public at its own canonical URL, and the extra key is
    part of the CDN key, so the canonical entry can't be poisoned.
  - The ADR says a key named after `siteId` was not examined.
  - To check after deploy, or with a bypass token: compare `etag` and `x-vercel-cache` for the
    canonical URL, `…&nxtPfoo=1` and `…&nxtPsiteId=<another id>`.
- **Production speed, freshness and CDN MISS→HIT.** Run `scripts/measure-published-snapshot.mjs`
  (with `--freshness`), and `curl -sI` twice with and without an `sb-` cookie.
- **Remote migration ledger.** Run `supabase migration list --linked` and confirm `20261005000000`
  matches sha256 `6ee41347…`.
- **No local Playwright or DB suites.** The Docker disk is full, so the CI logs were used instead.

---

# Delta review — fix round 4, Devin Review findings (`25d21cc..632db72`)

Reviewed by a fresh-context `reviewer` subagent on 2026-10-07. The verdict covers the whole story
diff at `632db72` and carries forward the earlier conclusions for every part this round did not
touch.

## D1 — language/variant length cap removed (correct)

Checked independently: neither the writers nor the database bound these fields.

| Path | What it does with `language` / `variant` |
|---|---|
| `content_elements` columns | plain `TEXT`; no CHECK, no `varchar(n)` (`20250817000000_complete_database_setup.sql:33-34`) |
| v1 POST/PUT | `|| "en"` / `|| "default"` only, no length check (`v1/content/route.ts:236-321`) |
| bulk import | same pattern (`:456-457, 531-532`) |
| translate | language capped at 20 characters, variant always `"default"` |
| discovery | `en` / `default` only |
| bulk update | writes neither field |
| staging RPC | only UPDATEs rows already matched; never inserts |

The authenticated GET reads both fields without a limit, so Devin's premise holds.

What is still refused, all before any database query: empty values, control characters, and
non-canonical queries. The route test asserts that the service client and the limiter are never
called on control-character cases.

Removed or replaced tests are declared:
- **Parser:** the "over 64 characters" cases became accepted 65- and 500-character variants.
- **Route:** "oversized language" became "control character in the language" (added coverage).
- **E2E:** the 65-character case became `en%0A`. The total stays 45.

ADR 046, the integrator doc and `REJECTION_MESSAGES` all say "not empty, no control characters,
any length".

## D2/D3 — the measure script trusts only HTTP 200 plus a valid envelope

A response counts only if `readSnapshot` sees status 200, `format === "rcf-published-v1"` and a
`rows` array.
- **Freshness mode:** anything else is counted in `failedPolls` and polling continues.
- **Speed mode:** a first threshold covers the warm-up plus every sample.
- **Exit code:** non-zero whenever the condition or a threshold is not met.

Disabling each check turned tests red:
- **Measure-script tests:** pre-fix `readSnapshot` → 7 red; status check → 1; format check → 1;
  status threshold → 4; warm-up passing → 1; `failedPolls` increment → 3. Two harmless controls
  → 0.
- **Parser/route tests:** restoring a `<= 64` cap → 4 red (exactly the new tests); removing the
  control-character check → 13; removing the empty check → 2.

Every mutation was restored, and `git diff --exit-code` came back clean each time.

## Evidence

- **Local:** Jest 4194 passed / 38 skipped; lint 0 errors; type-check and format:check clean;
  measure-script tests 14/14.
- **CI run 37665493175 (all green):**
  - `PASS src/__tests__/db/published-snapshot-freshness.test.ts`
  - Playwright strict summary: 45 passed, 0 failed, 0 skipped, 0 flaky (expected 45). The
    `en%0A` refusal sits in the s65a test's `REFUSED_QUERIES` loop.
- **Interdicts on `main...632db72`:** no changes to the content GET route, `public/embed/`, the
  package files, `next.config.ts` or `.env*`. The only migration is the s62 file (sha256
  `6ee41347…6c62c5b`).

## Findings (minor only)

- **Duplicated format string.** `"rcf-published-v1"` is written separately in the measure script
  (:330) and the route (:69). A bump fails safe, since every run fails, but the two can drift.
- **Uneven test coverage.**
  - The long-length acceptance tests use only *variant*; one shared check covers *language* today.
  - The status-only part of the check is pinned by a single freshness test.
- **Real ceiling and network errors.**
  - The ADR's "the platform's URL limit is the only ceiling" is optimistic: the PostgREST gateway
    URL limit is likely lower. This matches the authenticated GET and fails safe as an uncached 500.
  - A network error during freshness polling exits 1 instead of counting a failed poll. It never
    produces a false MET, and this behaviour predates the round.

## Not verified

- Local Playwright and Docker (disk full); the CI logs were used instead.
- The script against the real Vercel edge. After deploy:
  - a mistyped site id must fail the status threshold;
  - a deletion probe must end MET on an HTTP 200.
- A 65+ character variant end to end through v1 and the snapshot on a real server.
- The actual Vercel and PostgREST URL ceilings.
- Whether D2/D3 were written test-first; they landed in a single commit.

Max severity: minor
Ship allowed: yes
