# Review: story s51-edit-needs-a-plan

Reviewer: fresh-context `reviewer` subagent, 2026-09-28.

The diff does what the plan asks. It gates every API write route and issuance route the plan
lists. The gate is keyed to the site owner, runs after authorization, fails closed with an honest
503, and refuses with 402, which the widget does not treat as terminal. Public reads never read a
plan. The artifact is byte-identical at 45,883 B gzipped. All gates pass, and ten of the eleven
mutations I made went red.

One real hole remains. It is not in any route. A signed-in site member with `edit` or `admin` can
write `content_elements.published_content` directly through PostgREST, using the public anon key
and their own session. I proved this live on the local stack with a planless owner. That makes
AC1 and ADR 041's "every content write" untrue. The hole predates s51, and closing it needs a
migration, which the plan's interdicts forbid. So I rate it **major**, not critical: shipping s51
opens nothing new and closes the API paths. It does need its own story before launch, and ADR 041
should say so.

- **Diff reviewed:** `git diff main...feature/s51-edit-needs-a-plan`. One commit, `f2b60d4`, on
  `7c21d00` (includes s48 and s50). 64 files, +4,529/-64.
- **Not part of the reviewed commit:** during this review, the s51 implementer added uncommitted
  edits to the worktree. It was acting on a duplicate, delayed instruction, and the lead has
  since stopped it:
  - `docs/plans/s51-edit-needs-a-plan.md`: +15 lines, an execution-log entry about mutants and the
    rebase;
  - `src/__tests__/api/owner-plan-gate.test.ts`: +48 lines, a collaborator-row test addition with
    two collaborator-caller rows per write route.

  Neither is in `f2b60d4`, and this review judges `f2b60d4` only. The lead will decide separately
  whether to fold them in. If they are, a delta re-check is needed. Finding 3 records what the
  collaborator rows would change.
- **Where I ran things:** to avoid colliding with that concurrent editor, I ran all tests and
  mutations in an isolated detached checkout of `f2b60d4`, with `node_modules` as an APFS clone.
  Environment:
  - the CI placeholder env;
  - `RCF_TEST_SUPABASE_CONFIG` pointed at the implementer's `recopyfast-s51` stack (ports 56xxx).
    It was already running, with every migration applied, including s50's `20260928130000`.
- **State I left behind:**
  - The live probe's rows and user are deleted; I checked 0 remaining.
  - Every mutation was restored, and `git diff --exit-code` was clean after each one.
  - The isolated checkout is removed.
  - The `recopyfast-s51` stack is **still running**. I did not start it: it predates this review
    and the worktree is in active use.
  - One slip, which I fixed: a `cp` through a symlink briefly created
    `.omx/worktrees/s51-edit-needs-a-plan/node_modules/node_modules`, a copy of `node_modules`
    inside itself. That path is gitignored. I deleted it within a minute, and the directory count
    is back to 700.

## Plan compliance
- [x] **The code does what the plan specifies, and nothing more.** I checked it task by task:
  - **T1.** `owner-can-edit.ts` exists with the planned surface. `resolveSiteOwnerId` gains
    `.order("created_at", { ascending: true }).order("id")` before `.limit(1)`, and its comment is
    rewritten. Both stubs gained `order`.
  - **T2.** `owner-plan-gate.test.ts` uses the real helper and the real handlers. It has 10 write
    rows (9 handlers plus v1 PUT) and 8 read rows, plus the regain tests and the WebSocket source
    pin.
  - **T3.** The gate is in place on staging PUT, publish, restore and styles/apply. All nine
    listed fixtures state "the fixture's owner holds a plan (s51)".
  - **T4.** The gate is in place on bulk import and update, v1 POST (PUT delegates), translate and
    suggest. In suggest, the charge uses the helper's `ownerId`, and `no_owner` keeps the
    `NO_PAYER_MESSAGE` 403. The fixtures are updated.
  - **T5.** The gate is in place on `edit-sessions/create` and `staging/access`, which read access
    first. It is also in `extend`, in `submit-code` (site mode, after the code is spent and the
    editor found), in `handoff/create` and in `refresh-grant` (validate, then gate).
    `handoff/redeem` is deliberately ungated: that is a recorded CTO decision, carried as a
    comment and in ADR 041. The new suites, the embed pins and `EditorSignIn` are present.
  - **T6.** The checkout refuses `credits` without a `plan` before any Stripe call. The
    BillingDashboard copy and its tests are in, and `checkout-concurrency` is mocked.
  - **T7.** The comment rewrites are in: `permissions.ts`, `effective-plan.ts` and the middleware
    (comments only). So are `architecture.md`, `prd.md:390`, ADR 041, the runbook and the
    README row.
  - **T8.** Both e2e specs gain the paying-owner fixture. No test was added.
  - **Out of plan:** nothing. The story text in `docs/stories.md` is not in the diff because it
    was already committed on `main` (`4ec7799`), which is correct.
- [x] **Run interdicts respected.** I checked each one:
  - `git diff main...f2b60d4 -- public/embed scripts/build-embed.mjs server/ supabase/migrations/`
    is empty. So is the diff on the public-read files (`content/[siteId]`, `bulk/export`, the
    three validate routes, `editor/request-code`) and on `playwright-ci-contract.test.ts`.
  - `git diff -U0 -- src/middleware.ts` changes only `//` and ` *` lines.
  - No plan refusal is a 401 or 403 on a widget route.
    - The helper answers 402 or 503.
    - `refresh-grant` answers 402 or 503.
    - `ai/suggest` keeps its pre-existing 403 for `no_owner` only, as the plan asked. The widget
      shows `data.error` on AI and has no terminal branch there (`recopyfast.src.js` around
      :5406).
  - Nothing is revoked. The only added `revoked_at`/`is_active` strings are in the runbook's
    `plan_entitlements` filter, the plan text and test assertions.
  - No `.only`, `.skip` or `xit` is added. `test.failing` in `create-token-leak` is untouched.
  - Gate placement: I read every insertion. Each sits after authorization. Where the route has a
    per-site limiter (staging PUT, publish, styles/apply, translate), the gate sits after it too.
    Restore meters before auth by design, and gates after the grade.

## Anti-hallucination
- [x] **No invented API.** I opened every target:
  - `resolveEntitlement(supabase, userId)` at `effective-plan.ts:511`;
  - `resolveSiteOwnerId` in `permissions.ts`;
  - `createServiceRoleClient`;
  - `getEffectivePlan(userId)` at `entitlements.ts:56`;
  - `authorizeFirstPartyEditorAccess(siteId, level)` at `editor-access.ts:138`. It reads the
    caller's own `site_permissions` row under the RLS client, exactly as `createEditSession` does;
  - `validateDeviceGrant({ grant, siteId, device })` at `editor-grants.ts:226`. It is read-only
    apart from a best-effort `last_used_at` touch; it never revokes;
  - the local `withCors(res, origin)` helpers in `history/[versionId]` and `styles/apply`;
  - `cors`/`fail` in `ai/suggest`;
  - `withPublicCors`.
- [x] **No plausible-but-wrong value on the routes.**
  - 402 is correct: `handleTerminalWriteFailure` (`recopyfast.src.js:1183-1184`) acts only on
    401 and 403.
  - Save alerts `result.error` (`:2900`). Publish shows `result.error` (`:2355`).
  - The code prompt shows `body.message` (`:564`).
  - A refused refresh is ignored unless `nextAction === 'refresh'` (`:428`).
  - The body carries both `error` and `message`, as those readers need.
  - The runbook SQL parses and runs against the current schema (0 rows locally).
- [ ] **The code matches what it claims.** One exception: ADR 041, AC1 and the middleware comment
  say every content write needs the owner's plan. The database still accepts direct writes
  (finding 1), and the A/B routes are outside both of the ADR's lists (finding 2).

## Rules compliance
- [x] **Repo conventions (AGENTS.md).** The comments explain why and name the incident. There is
  one story commit and no migration. Errors are `NextResponse.json({ error })`, and the helper
  logs detail with `console.error` and never returns an exception message. Two small deviations
  (findings 7 and 8) are minor.
- [x] **No accepted ADR contradicted.**
  - ADR 041 amends ADR 035's "Watch" note, and ADR 035's charge-the-owner rule is kept.
  - ADR 019 ("payer identity and site ownership are the same identity") is consistent with the
    earliest-admin owner.
  - ADR 036 is respected: the edit link is never forgotten on a 402.
  - ADR 002 has a small tension on `bulk/update` (finding 8).
- [x] **Design system.** The only UI change is copy inside the existing
  `<p className="mb-6 text-muted-foreground">` on the no-plan panel. There is no new component,
  token or primitive, and no `docs/designs/s51*`, which fits a copy-only change.

## Tests
- [x] **I ran the suite, and it passes.** All on `f2b60d4` in the isolated checkout, against the
  live 56xxx stack:
  - `npx jest`: 295 suites passed, 2 skipped; 3,758 tests passed, 39 skipped, 0 failed.
    - The DB suites ran live. `content-attributes-lifecycle`, a touched fixture, passed 2/2.
    - The skipped and pending suites (`InteractiveHero`, `editor-activation-concurrency`,
      `share-rls`, `share-owner-lockout`, `update-history-policy`, `column-privileges`) are
      untouched by the diff.
  - For information only: an earlier run on the dirty worktree, which includes the
    collaborator-row test addition that is not part of the reviewed commit, had 3,778 passed.
  - `npm run lint`: 0 errors, and none of the 38 inherited warnings is in a touched file.
  - `npm run type-check`, `type-check:build` and `format:check`: clean.
  - `npm run build`: exit 0.
  - `node scripts/build-embed.mjs --check`: up to date, bundle 45,883 B (max 45,883), widget
    33,122 B.
- [x] **The assertions pin the acceptance criteria.**
  - Write rows assert the 402 body, zero recorded mutations, zero model calls, and an entitlement
    read keyed by `OWNER`.
  - Read rows assert 200 with no owner or entitlement read.
  - No-oracle rows assert the route's own refusal, with the plan never read.
  - Regain rows assert the same credential gets 402 then 200, with no write to any credential
    table.
  - The issuance suites run each request twice, with the owner lapsed and then paying, and
    assert identical answers.
- [x] **Bite proven by neutralization.** 11 mutations, each run and then restored with
  `git diff --exit-code` clean:

  | # | Mutation | Red |
  |---|---|---|
  | M1 | Helper fails open when the entitlement read throws | 1 (`owner-can-edit.test.ts`) |
  | M2 | Gate removed from `staging/publish` | 2 (gate table) |
  | M3 | `bulk/import` gate keyed on the **caller** (`resolveEntitlement(service, user.id)`) | 29, all incidental in the bulk fixture suites; **0 in the gate table**. With the collaborator-row addition that is not part of the reviewed commit: 2 in the table. See finding 3 |
  | M4 | Gate moved before authorization on staging PUT (oracle) | 2 |
  | M5 | Gate moved after auth but **before the per-site limiter** on staging PUT | **0: survived.** See finding 4 |
  | M6 | Refusal answered 403 instead of 402 | 29 across 8 suites |
  | M7 | `resolveSiteOwnerId` ordering removed | 1 (`permissions.test.ts`) |
  | M8 | Checkout lets a credits-only buyer through (`=== "none"`) | 1 |
  | M9 | `refresh-grant` gates an unauthenticated grant (oracle) | 2 |
  | M10 | `edit-sessions/create` and `staging/access` gate callers with no row (oracle) | 3 |
  | M11 | Widget treats 402 as terminal | 2 in `plan-ended-message`, plus 8 incidental in `build-size-gate` |

## Regressions
- [x] **No impact on existing code paths.**
  - The payer change for seats (`canShareSite`) and widget AI is the intended correction, and it
    is documented.
  - Every public read, validate route and the WebSocket server are unchanged.
    - `server/index.js` reads only `sites`.
    - `server/auth.js` reads credential tables; its only `.update(` is an HMAC call.
  - The middleware is unchanged.
  - The fixture suites that call a gated route state a paying owner, and none of them was relaxed.

## Write paths enumerated independently
I listed every `src/app/api/**/route.ts` with an insert, update, upsert, delete or rpc call, then
traced writes made inside libraries (`content_elements`, `content_versions` and the A/B tables).

- **Gated:** staging PUT, publish, restore, styles/apply, bulk import, bulk update, v1 POST/PUT,
  translate, suggest, plus the six issuance routes.
- **Deliberately ungated, and documented:**
  - reads and delivery: content GET and discovery, v1 GET, export, the validate routes;
  - edit-board: the history snapshot and `languages` (`content_elements` is only read there);
  - `upload/image`, `api-keys`;
  - `edit-sessions/revoke`;
  - `handoff/redeem`;
  - the WebSocket server.
- **Plan-gated already:** `editor/editors`, through `canShareSite`, which requires the owner's
  `plan`.
- **Not content:** `sites/*`, `teams/*`, domains, notifications, webhooks, blog, telemetry.
- **Missed:**
  - direct PostgREST table writes (finding 1);
  - the `ab-tests` routes (finding 2);
  - `ab-testing/lifecycle.promoteWinner`, which writes `staging_content` from visitor traffic.
    That last one is not a finding: it is system-initiated, and publishing it is gated.

## Findings

1. **major — `supabase` RLS on `content_elements` (and `ab_tests`/`ab_test_variants`): the gate is
   bypassable by writing the table directly.**
   - **The cause.** Policy `"Users can edit content for authorized sites"` is `FOR ALL` for any
     `site_permissions` row with `edit`/`admin` (`20250817000000_complete_database_setup.sql:461`,
     still live). `authenticated` also holds table-level INSERT, UPDATE and DELETE, including the
     `published_content` column.
   - **Proven on the local stack.** I created a user with no `plan_entitlements`, no subscription
     and no credits, which is `none` and the exact lapsed owner the story targets, and gave them
     an `admin` row. With their own JWT and the public anon key:

     ```
     PATCH /rest/v1/content_elements?id=eq.<id>  {"published_content":"WRITTEN BY A LAPSED OWNER VIA POSTGREST"}
     ```

     This returned 200 and the row changed. `GET /api/content/[siteId]` serves that column to
     visitors.
   - **Who can use it.** Any account-holding owner or collaborator. Device-grant editors and API
     keys cannot, because they have no JWT. The same class covers `ab_test_variants.variant_content`
     plus `ab_tests.status`/`target_element_id`, which the embed serves to visitors.
   - **Why it is not critical.** It predates s51. s51 closes the far larger API surface (every
     editor, grant and API key of a lapsed owner) and opens nothing. The fix needs a migration,
     which the plan's interdicts forbid. It also needs care: `bulk/update` and `bulk/import` write
     through the RLS client and depend on that policy.
   - **What to do.**
     - Before merge: add it to ADR 041's "Watch" section, and correct "every content write" in
       ADR 041, AC1's ticking and the middleware comment.
     - Before launch: open a follow-up story that revokes `authenticated`/`anon` writes on
       `content_elements` and the A/B tables, and moves `bulk/*` onto the service role behind
       ADR 037's pattern.
2. **minor — `src/app/api/ab-tests/route.ts` POST/PUT and `src/app/api/ab-tests/generate/route.ts`:
   a live-copy path outside both of ADR 041's lists.**
   - POST and PUT (create a test; PUT spreads `...updates`, so it can set `status: "active"` and
     `target_element_id`) read no plan.
   - `generate` checks and charges the **caller's** plan and credits (`:70-100`), not the owner's.
     That contradicts ADR 041's own rule that AI spend is keyed by the owner.
   - `/ab-tests/active` → `recopyfast.src.js:3386-3388` serves an active variant's copy to
     visitors. So a paying manager can put AI copy live on a lapsed owner's site, which is the
     "edit through a paying manager" case the owner ruled out.
   - It is minor because nothing in the UI calls these routes. `src/app/dashboard/_ab-tests` is a
     private, unrouted folder, so only hand-crafted calls reach them, the same class as finding 1.
   - Close it in the same follow-up, or list it in ADR 041.
   - Also, `generate/route.ts:77` still says "Your credits cover AI suggestions and
     translations." That sentence is false since s51, and the research's list of sentences to fix
     missed it.
3. **minor — `src/__tests__/api/owner-plan-gate.test.ts` in `f2b60d4`: every caller in the table
   is the owner.** So "keyed by the owner, whoever is calling" is never actually tested there.
   - M3, a caller-keyed gate on `bulk/import`, left the table green. It was caught only by
     incidental fixture breakage.
   - A collaborator-row test addition that is **not part of the reviewed commit** sits
     uncommitted in the worktree. Run against M3 in my isolated checkout, it turns the table red
     (2 red).
   - Whether to fold it into the story commit is the lead's decision. If it is folded in, it needs
     a delta re-check, and the commit body's list of test changes should mention it. If it is
     not, this gap stays as recorded here.
4. **minor — gate ordering after the per-site limiter is untested.** M5 survived with 0 red. The
   plan says "the Task 2 no-oracle rows and the limiter suites are the check", but the limiter
   suites stub `checkOwnerCanEdit` to `ok`, and the table stubs the limiter to "allow". The code
   is correct as read; the claim about the tests is not.
5. **minor — `src/lib/feature-gating/permissions.ts` `resolveSiteOwnerId`: edge cases of "earliest
   admin".**
   - `site_permissions.created_at` is nullable, and ascending order puts NULLs last. A legacy admin
     row with NULL `created_at` would lose ownership to a later manager.
   - Team shares insert `admin` rows with `user_id` NULL (`share/route.ts:211-219`), and the query
     does not filter `user_id IS NOT NULL`. If the creator's row is ever removed while a team
     admin row is the oldest, the site is refused as `no_owner`, even with a user admin present.
   - Neither case can be verified without production data (see "Not verified").
6. **minor — ADR 041 "Consequences": "the same credential works again" holds only within the
   credential's lifetime.**
   - During a lapse, `refresh-grant` and `edit-sessions/extend` are refused, so grants (12 h, or
     up to 7 days sliding) and sessions (up to 24 h) age out.
   - `submit-code` spends the code before refusing.
   - After a long lapse, editors must verify again once the owner pays. The ADR should say so.
7. **minor — `docs/prd.md:390` (a framing doc) is edited on the feature branch.** AGENTS.md says
   framing docs are committed on `main`. The validated plan chose this deliberately (a product
   owner decision), and the research had suggested `main`. This is a process note only.
8. **minor — ADR 002 tension on `bulk/update`.** That route has no per-site limiter (known,
   pre-existing). The helper now performs 3–4 service-role reads there behind only
   `getUser()` + a permission read. ADR 041's "Watch" section records the missing limiter, but not
   the service-role reads.
9. **minor — style.** Two comment lines were not re-wrapped after the edit: the new paragraph in
   the `permissions.ts` header ("…is `plan`. Credits are kept but buy nothing on their own…") and
   the `ai/suggest` header ("…always read 0. The owner's wallet is read and spent through…").

## Not verified
- **Playwright write specs** (`share-edit-publish`, `realtime-parity`). I skipped them as
  instructed, because they hard-require the default 54321 stack. The implementer reports 5/5.
  - Their new fixture relies on a `plan_entitlements` row `{ plan_id: "pro", source: "e2e" }`
    resolving to `plan` through the real `resolveEntitlement`. Only those specs prove it.
  - Human gesture: with the default stack up, run
    `RUN_RECOPYFAST_CORE_E2E=1 RUN_RECOPYFAST_PARITY=1 npx playwright test share-edit-publish realtime-parity`.
- **No browser was opened.** I read the widget's 402 behaviour in source and saw it pinned by the
  embed-slicing tests, but never rendered it. Human gestures on a local stack:
  - Seed an owner with Pro, an invited editor and a device grant. Delete the owner's
    `plan_entitlements` row.
  - On the customer page, edit an element and blur. Expect an alert with "This site's plan has
    ended — the owner can reactivate it."
  - Reload. The page should still be in edit mode, with no "Session ended" and the link kept.
  - Click Publish. Expect the same message in the modal.
  - Restore the plan row and save again, without verifying again. It should save.
  - In `/edit`, sign in as the editor and click the lapsed site. Expect the message.
  - In the dashboard, Edit website should show the message.
  - `/dashboard/billing` as a credits-only account should show the new copy and no purchase
    button.
- **Stripe.** The credits-checkout refusal "before any Stripe call" is proved with Stripe mocked.
  I made no real test-mode checkout.
- **Production data.**
  - Whether any `site_permissions` admin row has a NULL `created_at`.
  - Whether any live site's earliest admin is not the payer, for example a client-registered site
    shared with a paying agency. Such a site would be refused after deploy.
  - The runbook's paid credits-only accounts.

  Operator gestures, read-only:
  - `SELECT count(*) FROM site_permissions WHERE permission='admin' AND created_at IS NULL;`
  - for multi-admin sites, compare the earliest admin with the holder of the live subscription;
  - run `docs/operations/edit-needs-a-plan.md`.
- **Owner ordering against real PostgREST.** It is verified by the call shape only, through a
  mocked query chain. I did not exercise two real admin rows through `resolveSiteOwnerId`.
- **Latency.** The deployed WebSocket server was not exercised: `server/` has an empty diff and is
  covered by a source pin. The cost of 3–4 extra reads per write was not measured.

## Verdict

## Product owner disposition (orchestrator, 2026-09-28)

- **Major (direct PostgREST writes bypass the gate) accepted for this merge, fixed before public
  launch:** it predates s51, and s51 closes the far larger API surface. Recorded as a "Watch" entry
  in ADR 041; new P0 story `s56-rls-content-writes-need-plan` (content and A/B tables need the
  owner's plan at the RLS layer, without breaking the dashboard's own writes).
- **Minor 3 folded into the story commit:** the implementer's collaborator rows in
  `owner-plan-gate.test.ts` (kill the caller-keyed mutant: 2 rows red) and the plan's execution-log
  entry — additions only (63 lines, tests + docs), re-run in the gate before merge.
- **`ab-tests/*` (minor 1)** closed together with the A/B tables in s56.
- **Limiter order untested, owner-lookup NULL edge cases, grants ageing during a long lapse,
  bulk/update limiter (ADR 002), comment wrap** → queued with s53 hardening.
- **`docs/prd.md` edited on the branch:** accepted — it lands on `main` through the squash merge,
  the same commit that makes it true.


Max severity: major
Ship allowed: yes
