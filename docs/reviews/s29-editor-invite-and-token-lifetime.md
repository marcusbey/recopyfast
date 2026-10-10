# Review — Story s29-editor-invite-and-token-lifetime (re-review after fix)

Fresh-context `/ks-review` re-review of `git diff origin/main...feature/s29-editor-invite-and-token-lifetime`
(merge base `9f22598`, head `45430af`, draft PR #23), with the fix commit `45430af` read on its
own. The reviewer did not write this code. No source file was modified. Each of the 22 temporary
mutations was restored with `git checkout`, and `git diff --exit-code` over `src server supabase
public scripts` and the story docs was clean before this file was written.

## Verdict in one paragraph

The blocking finding is fixed. The embed source and the artifact are byte-identical to
`origin/main`, the byte gate passes on Node 20 and on Node 24, and CI is green on `45430af`,
Playwright included. All four majors are closed, and the claimed mutation counts reproduce
exactly: the recipient bucket is canonical and shared, the PATCH predicates and the `didActivate`
mapping bite 2 / 1 / 1, a missing RPC fails closed with a logged 503, and ADR 027 records D3.
The A-25 value survives without the widget warning:
- the refusal bodies carry a code;
- a refusal echoes only the registered origin;
- neither verifier has an age cap;
- rotation revokes old tokens over HTTP.

Every one of those is backed by a mutation that turns tests red. Seven minor findings remain,
including the documented live-socket deferral. Nothing blocks the ship.

## Prior findings → status

| # | Prior finding | Status | Evidence |
| --- | --- | --- | --- |
| C1 | Embed over both gzip ceilings; CI red | **Fixed** | `git diff origin/main...HEAD -- public/embed` is empty. The worktree files hash to the same values as `origin/main` (src `7b71d203…`, artifact `6091c6b4…`). `node scripts/build-embed.mjs --check` exits 0 on Node 20.11.0 and on 24.14.0: bundle 46,604 B (max 46,681), widget 33,828 B (max 33,865), transport 13,141 B. CI on `45430af`: Lint/Test/Build, E2E (Playwright), Type-check, realtime audit and Vercel all pass. |
| M2 | Per-recipient limit bypassable; restore unmetered | **Fixed** | `requireUuid` rejects braced and unhyphenated forms (`validation.ts:19`) and lowercases (`:100`). The recipient bucket is keyed on `siteId`, a pipe, then `normalizeEmail`. POST applies it on every call, after the seat check (`route.ts:264-273`), which covers the revoke/restore race. PATCH applies the same endpoint and key to the resolved row (`route.ts:396-405`). Mutations R5–R8 go red. |
| M3 | IDOR / revoked / `didActivate` guards untested | **Fixed** | Mutations R1 = 2 red, R2 = 1, R3 = 1. The predicate-aware mocks are in `invitations.test.ts`. |
| M4 | Deploy before migration breaks enrolment silently | **Fixed** (fail-closed option) | `PGRST202` or `42883` throws `EditorActivationUnavailableError` (`editor-directory.ts:30, 231`). The route logs a fixed operator message and returns 503 `service_unavailable`, with no fallback and no mail (`route.ts:283-295`); R9 goes red. Migration-first is mandatory in ADR 027 § Release and in plan F4. The ordering itself stays manual: see the evidence boundary below. |
| M5 | D3 had no ADR | **Fixed** | `docs/decisions/027-site-token-lifetime-and-key-rotation.md`: context, decision, and the rejected options (keep the cap, a longer cap, a refresh endpoint). It also records the WebSocket boundary and the release order. New minor 4 below: the ADR index was not updated. |
| m6 | Concurrency test did not prove the advisory lock | **Fixed** | A forced overlap: T1 holds an uncommitted activation while the test polls `pg_stat_activity` for T2's wait event (`editor-activation-concurrency.test.ts:177-221`). With a disposable loopback PostgreSQL 14.17 the suite passes 2/2. Without the lock (R4) it goes 1 red: `Expected "advisory"`, `Received "transactionid"`. The suite is still env-gated, so CI never runs it. |
| m7 | Owner-controlled site name in the subject | **Fixed** | C0 and DEL are stripped, whitespace is collapsed and the name is capped at 120. The result is used in the subject, the text and the HTML (`resend.ts:143-151`). R11 and R12 go red. Residual: minor 7. |
| m8 | Rotation does not cut open sockets | **Deferred, documented** | ADR 027 § "WebSocket boundary and follow-up" names the follow-up and its required test. The dialog and success copy no longer claim immediate revocation (`SiteDetailView.tsx:345-347, 489-492`), and the design doc was updated. Still open as minor 1. |
| m9 | Small cleanups | **Fixed** (all six) | 1. Comment: `sites/route.ts:104`. 2. Refusals are typed-only (`content/[siteId]/route.ts:201-217`); an untyped exception now yields a generic 401, which is tested. 3. Per-row accessible name: `SiteEditorRow.tsx:101`. 4. Resend-failure copy: `SiteEditorsCard.tsx:636`. 5. The DB placeholder test is gone; the whole describe skips (`:62`). 6. Queued mocks are reset (`auth-failure-cors.test.ts:156`); the HTTP age-cap mutation now gives 6 red with no cascade. |

## Remaining findings

### Critical

None.

### Major

None.

### Minor

1. **Rotation does not close sockets that are already open.** Deferred from m8, and honestly
   documented in ADR 027 and in the dashboard copy. The WebSocket server checks the key only at
   the handshake (`server/index.js:244-259`). The follow-up is owed, with the integration test
   the ADR specifies.
2. **Stripping a token from the invitation link is untested.** Deleting `url.search = ""`
   (`resend.ts:111`, R13) leaves 0 tests red. Today the link is built server-side as
   `NEXT_PUBLIC_APP_URL + "/edit"` (`route.ts:88`), so no token can reach it. The guard is
   defense-in-depth with no test. Add one case that passes `?token=x#y` and asserts both mail
   parts come out clean.
3. **Dead wrapper.** `upsertSiteEditor` (`src/lib/auth/editor-directory.ts:140`) has no caller
   left in `src/` or `server/`. The route moved to `activateSiteEditor`. Keeping the old DB RPC
   is intentional; the unused TS wrapper is not needed.
4. **The ADR index is stale.** The table in `docs/README.md` stops at 026 (`:86`), and ADR 027 is
   not listed.
5. **A failed resend renders in the success panel.** `NoticePanel` (`SiteEditorsCard.tsx:624-628`)
   always uses the success tone and a `CheckCircle2` icon. The copy correctly says the resend
   failed, but the styling says it succeeded.
6. **The recipient bucket is spent on POSTs that send no mail.** This is deliberate for the
   revoke/restore race (`route.ts:260-263`). The side effect: the fourth re-save of an already
   active editor within an hour gets 429 with "This editor has already received several
   invitations" (`:271`), even though no mail was sent.
7. **The subject sanitiser covers C0 and DEL only.** C1 controls such as U+0085, and bidi
   overrides (U+202A–U+202E, U+2066–U+2069), still reach the subject and the body.
   `.slice(0, 120)` can split a surrogate pair. Risk is low: the site name is set by the inviting
   owner, and Resend is a JSON API.

## Verified with evidence

- **A-25 without the widget warning.** Refusals throw `SiteAuthError` with a stable `code`:
  `site_token_missing`, `site_not_found`, `site_token_invalid`, `site_origin_not_allowed`
  (`site-auth.ts:17-42`). The content route answers GET, POST and PUT refusals through
  `siteAuthFailureResponse`. That helper passes `fallbackToAppOrigin = false`
  (`content/[siteId]/route.ts:201-217`), so a refusal echoes only `permittedOrigin`: the
  canonical `URL.origin`, and only when the request host equals the registered domain
  (`site-auth.ts:193-199`). It never uses `*` or the app URL, and never reflects the raw header.
  Mutations:
  - reflecting any origin: 3 red;
  - falling back to the app origin: 8 red;
  - dropping `code`: 7 red;
  - no CORS on a missing token: 3 red.

  The widget keeps the authored copy through `main`'s generic HTTP warning. That behaviour is
  tested by slicing the shipped source (`src/__tests__/embed/site-token-refusal.test.ts`), and the
  warning string exists at `recopyfast.src.js:3669`.
- **No age cap in either verifier.** `site-auth.ts:124-133` and `server/auth.js:57-63` keep the
  shape, site-id, digit-only, 60 s future-date and timing-safe HMAC checks. They are the only two
  HMAC verifiers in `src/` and `server/`. Re-adding the 90-day cap turns 6 tests red on HTTP
  (R18) and 3 red on the WebSocket side (R19).
- **Rotation revokes old tokens.** `authorizeSiteRequest` reads `api_key` on every request, and
  the content route sets no cache headers. The WebSocket handshake also re-reads the key
  (`server/index.js:244-259`). Mutations:
  - HMAC compare reduced to a length check: 25 red over HTTP, 4 red on the WebSocket side;
  - regenerate writing no `api_key`: 1 red.

  Regenerate stays admin-only, rate-limited before auth, and on a fail-closed owner bucket. It
  now also validates the UUIDs (`regenerate-snippet/route.ts:29-49`).
- **Invitation email.**
  - Every interpolation in the HTML is escaped (`resend.ts:85-92, 164-170`); disabling the
    escape turns 1 test red.
  - There is exactly one `<a>`, and the CTA is origin + path.
  - The subject contains no raw control characters.
  - Enrolment survives a provider or metadata failure.
  - Mail goes only on `didActivate` (`route.ts:304-311`).
  - Rate limits:
    - POST: IP pre-auth, then owner 3 per 5 min, then recipient 3 per hour;
    - PATCH: IP pre-auth, then owner 20 per hour, then the same recipient bucket;
    - every bucket is `onStoreFailure: "deny"`.
- **Regression check on the shared validator (accepted drift).** Lowercasing in `requireUuid`
  also reaches the other seven routes that call it: analytics ×3, webhooks ×2, upload/image and
  ai/translate. Every caller uses the value in a DB query, a limiter key or a comparison against
  a DB-returned id, so canonical lowercase is benign. `requireSiteAdmin` now rejects non-v1–5
  user ids. Supabase issues v4 ids, and `sites.id` defaults to `uuid_generate_v4()`.
- **Migration** is unchanged since the first review: SHA-256 `b657cc5d…191e0`, which matches the
  plan. The forced-overlap harness passes 2/2 on PostgreSQL 14.17. That covers two replays, the
  service-only grants, and refusal of anon and authenticated with 42501.
- **Static gates** (Node 24.14.0):
  - `type-check` and `type-check:build` exit 0.
  - `lint`: 0 errors and 39 warnings. The only warning in touched files is the unused `request`
    at `sites/route.ts:8`, which `main` also has.
  - Prettier is clean on every touched `src/` file.

## Test runs (CI placeholder env from `.github/workflows/ci.yml`; no `.env`; `RESEND_API_KEY` and `REDIS_URL` unset)

- **Full suite, Node 24.14.0:** 218 suites (216 passed, 2 skipped); 2,858 tests (2,820 passed,
  38 skipped, **0 failed**). This matches the plan's claim exactly.
- **Full suite, Node 20.11.0:** 2,819 passed, 1 failed, 38 skipped. The failure is
  `src/lib/images/__tests__/process.test.ts` (`zlib.crc32` is missing before Node 20.15). That
  file is not touched by this story. CI runs the latest 20.x and is green.
- **Targeted s29 suites:** 26 suites, 416 tests (414 passed, 2 skipped by the DB gate). The DB
  suite passes 2/2 separately against a disposable loopback PostgreSQL 14.17, which was then
  stopped and deleted.

| # | Mutation (restored after each) | Red tests |
| --- | --- | --- |
| R1 | Drop `.eq("site_id", siteId)` from PATCH lookup (`route.ts:382`) | 2 |
| R2 | Drop `.is("revoked_at", null)` (`route.ts:383`) | 1 |
| R3 | `didActivate: true` (`editor-directory.ts:251`) | 1 |
| R4 | Remove `pg_advisory_xact_lock` (migration `:34`), loopback PG | 1 |
| R5 | `requireUuid` without `toLowerCase` | 4 |
| R6 | Ignore POST recipient-limit result | 1 |
| R7 | POST recipient key on raw email | 1 |
| R8 | PATCH recipient key back to site + editor id | 3 |
| R9 | Disable the 503 branch | 1 |
| R10 | `escapeHtml` no-op | 1 |
| R11 | No control-character strip in the site name | 1 |
| R12 | No 120-character cap | 1 |
| R13 | No `url.search = ""` in the hub URL | **0** (minor 2) |
| R14 | Refusal echoes any origin | 3 |
| R15 | Refusals fall back to `NEXT_PUBLIC_APP_URL` | 8 |
| R16 | Drop `code` from refusal body | 7 |
| R17 | Missing-token refusal carries no permitted origin | 3 |
| R18 | 90-day cap back in `site-auth.ts` | 6 |
| R19 | 90-day cap back in `server/auth.js` | 3 |
| R20 | HTTP HMAC compare → length check only | 25 |
| R21 | WebSocket HMAC compare → length check only | 4 |
| R22 | Regenerate writes no `api_key` | 1 |

## Evidence boundary — not verified

- **Real email.** Nothing was sent through Resend. Not checked: mail-client rendering,
  deliverability, and how Resend and inboxes treat bidi or emoji in a subject. Human step:
  invite a test inbox from a site named `A <b> & ‮evil 😀`, then read both the HTML and the text
  part.
- **Browser.** The dashboard was rendered only in jsdom. The E2E suite does not exercise invite,
  resend, copy-link or regenerate (no `e2e/` spec calls `/api/editor/editors`). Human step: on a
  staging dashboard, run add → resend → copy link → regenerate, and check the failed-resend tone.
- **Supabase and release order.**
  - The migration ran only on local PostgreSQL 14.17 with a fixture schema, not behind
    PostgREST.
  - The `PGRST202` path is mocked.
  - Migration-first remains a manual operator step.

  Human steps, in order:
  1. Apply `20260924000000_atomic_editor_activation.sql` to a branch database.
  2. Call `/rest/v1/rpc/activate_site_editor` as anon (expect a refusal) and as service_role.
  3. Confirm the PostgREST schema cache sees it.
  4. Only then deploy Next.js and `recopyfast-ws` together.
- **Advisory-lock proof.** The proof exists only when `RCF_S29_DB_URL` points at a loopback
  database. CI skips the suite. Human step: run it once more before merge.
- **Widget and WebSocket after a real rotation.** Not exercised on a real domain or on the Fly
  `recopyfast-ws` service. Human step: rotate on staging, then load a page that still carries the
  old snippet. Expect one generic console warning, the authored copy intact, and a readable 401
  carrying `site_token_invalid`. Then confirm that a socket already open stays connected until it
  reconnects (minor 1).
- **PR text.** The shared API budget allowed only the single `gh pr checks` call, so the PR #23
  body was not re-read. Claims about what the PR says are unverified.
- **Human checkpoints.** The plan's `validated: yes` and ADR 027's `Status: accepted` were written
  in the implementer's commits and cite an operator instruction. The reviewer cannot confirm
  either checkpoint.
- **Spam bound.** Not checked: whether trial plans grant editor seats. That sets the invite
  volume a new account can reach.

Max severity: minor
Ship allowed: yes
