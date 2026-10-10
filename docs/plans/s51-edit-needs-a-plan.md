---
validated: yes
---
# Plan — Story s51-edit-needs-a-plan

Branch: `feature/s51-edit-needs-a-plan`
Research: `docs/research/s51-edit-needs-a-plan.md`. Read it first; this plan does not repeat it.

## Target story

`docs/stories.md:1903-1945`, P0, complexity 4. Editing, publishing and buying AI credits need the
**site owner's** entitlement to be `plan`. Public delivery never depends on it. Editors and API
keys of a paying owner are unaffected. Nothing is revoked, and access returns by itself when the
owner picks a plan.

- **AC1.** Every content write is refused unless the owner's entitlement is `plan`. The refusal
  is a structured `upgradeRequired` and nothing is written. There is one helper, keyed by the
  owner, and it fails closed.
- **AC2.** Editors and API keys of a lapsed owner are refused. They regain access with the same
  credential once the owner holds a plan.
- **AC3.** Public delivery is unaffected, proved by tests: embed, content GET, discovery, v1
  GET, bulk export, WebSocket.
- **AC4.** The issuance points refuse a lapsed owner up front. The widget and the `/edit` hub
  show "This site's plan has ended — the owner can reactivate it".
- **AC5.** Credits checkout needs `plan`. The no-plan billing screens offer no credits and say AI
  credits come with a plan. Credits already held are kept.
- **AC6.** `permissions.ts`, the middleware comment and ADR 041 state the rule.
- **AC7.** Local gates pass in the worktree, in one story commit, and the operator runbook query
  exists.

Decisions this plan takes from the research's open questions. The reviewer should check them
against the owner's intent:
- the AI routes are gated too (Q1);
- one message is used for owner and editor (Q2);
- middleware routing is unchanged (Q3);
- the owner becomes deterministic (Q4).

## Before task 1

- **Timing.** Start only after the s48 implementer reports finished, because s48's DB suite uses
  the shared local Supabase. Build from `main` after s48 and s47a merge if they have. If not,
  branch from `main` and expect mechanical conflicts at rebase (see Sequencing).
- **Worktree.** `git worktree add .omx/worktrees/s51-edit-needs-a-plan -b feature/s51-edit-needs-a-plan main`,
  then `npm run setup`. Copy `.env.local` from the main tree and run `npx supabase start`.
- **Docs.** The story text is uncommitted on `main`. Bring `docs/stories.md` (the s51 section),
  the research and this plan into the story commit, per AGENTS.md "Story docs".
- **Baseline.** Record `npm test` pass/fail counts before changing anything.

## Tasks (ordered)

1. [x] **The helper and a deterministic owner, test-first.**

   Write two sets of tests first (RED).

   New `src/__tests__/lib/billing/owner-can-edit.test.ts`. It mocks `resolveSiteOwnerId` and
   `resolveEntitlement`:
   - `allows a write when the site owner holds a plan`
   - `refuses a credits-only owner as plan_ended`
   - `refuses an owner with no entitlement as plan_ended`
   - `resolves the site's owner, never the caller`: the helper takes `siteId` only, and
     `resolveEntitlement` receives the owner id and the service-role client
   - `refuses a site with no admin row as no_owner and logs it`
   - `fails closed as unavailable when the owner lookup throws`
   - `fails closed as unavailable when the entitlement read throws`
   - `answers plan_ended and no_owner with 402 { error, message, reason, upgradeRequired: true }`
   - `answers unavailable with a retryable 503 that is not the plan message`

   In `src/__tests__/lib/feature-gating/permissions.test.ts`:
   - `resolveSiteOwnerId picks the earliest admin row, so a manager added later is never the payer`
     (asserts `order("created_at", { ascending: true })`, then `order("id")`, before `limit(1)`)

   Then implement.
   - New `src/lib/billing/owner-can-edit.ts` exporting:
     - `checkOwnerCanEdit(siteId)`, which returns
       `{ ok: true, ownerId } | { ok: false, reason: "plan_ended" | "no_owner" | "unavailable" }`;
     - `PLAN_ENDED_MESSAGE`, the story's sentence with a full stop;
     - `ownerCanEditRefusal(result)`, which returns the `NextResponse`.
   - It reads with `createServiceRoleClient()` (ADR 035 precedent). It sends `console.error`
     with the site id on `no_owner` and `unavailable`, and never returns an exception message.
   - Add the two `.order` calls to `resolveSiteOwnerId` (`permissions.ts:206-212`). Rewrite its
     comment (`:194-200`): multi-admin sites exist (`share/route.ts:78`), so the earliest row is
     the payer for seats, widget AI and editing.
   - Add `order` to the stubs that lack it: `src/__tests__/lib/feature-gating/seat-quota.test.ts:94-110`
     and `src/__tests__/api/ai/suggest/editor-credentials.test.ts:110-129`.

   Verify: both files green, `npx jest src/__tests__/lib/feature-gating` green.

2. [x] **The table-driven gate test, RED.** New `src/__tests__/api/owner-plan-gate.test.ts`.

   The harness:
   - uses the **real** helper and the **real** route handlers;
   - mocks only these (a partial `requireActual` for the rest of each module):
     - `resolveEntitlement` and `resolveSiteOwnerId`;
     - the rate limiter, which allows every request;
     - authentication and authorization: `authorizeFirstPartyEditorAccess`, `validateEditorTokenFromRequest`,
       `StagingAccessManager.validateStagingAccess` and `validateAPIKey`, each granting admin
       on `SITE`;
     - a recording Supabase fake, shared by `supabase/service`, `supabase/server` and
       `@supabase/ssr`. Every chain method returns the builder. It is thenable to
       `{ data: [], error: null }` and records `insert/update/upsert/delete/rpc`;
     - an `aiService` spy.

   `WRITE_ROUTES` covers:
   - staging PUT and publish POST;
   - version restore POST and `styles/apply` POST;
   - bulk import POST and bulk update POST;
   - v1 POST and PUT;
   - `ai/translate` POST and `ai/suggest` POST.

   Named tests over `WRITE_ROUTES`:
   - `refuses <route> for a lapsed owner with 402 plan_ended and writes nothing` (AC1). The fake
     records no mutation and `aiService` is never called.
   - `refuses <route> for a credits-only owner` (AC1, AC5)
   - `lets <route> through for an owner on a plan` (AC2)
   - `answers an uncredentialed caller of <route> with its own refusal, never plan_ended`.
     `resolveEntitlement` is not called, so the response is no oracle.

   `READ_ROUTES`: content GET, discovery POST, v1 GET, bulk export POST and GET, staging content
   GET, publish preview GET, history GET.
   - `serves <route> for a lapsed owner without reading any entitlement` (AC3)

   Regain tests:
   - `an editor of a lapsed owner writes again with the same grant once the owner picks a plan`
     (AC2). Same request, entitlement flipped from `none` to `plan`: 402, then 200. The fake
     records no write to `editor_device_grants`, `edit_sessions`, `site_editors` or `api_keys`.
   - `an API key of a lapsed owner writes again once the owner picks a plan` (AC2)
   - `the WebSocket service has no content write path` (AC3). A source pin: `server/index.js`
     contains no `.from("content_elements")`, `.insert(` or `.upsert(`.

   Expected state: every write row RED, every read row and the WS pin green. Record the RED run.

3. [x] **Gate the writes the widget calls (GREEN, part 1).** Insert
   `checkOwnerCanEdit(siteId)` and return `ownerCanEditRefusal` wrapped in the route's own CORS
   helper. Place it after authorization and after the per-site limiter, before the first write:

   | Route | Gate goes |
   |---|---|
   | `staging/content/[siteId]` PUT | after `:281` |
   | `staging/publish` POST | after `:154` |
   | `edit-board/history/[versionId]` POST | after the grade, before `:290` |
   | `edit-board/styles/apply` POST | after `:122` |

   Each insertion gets one house-style comment:
   - why 402 and never 401/403: the widget's terminal path (`recopyfast.src.js:1183`) would
     forget the edit link and show "Session ended";
   - why the gate sits after authorization: to avoid an oracle.

   Fixture updates. Add `jest.mock("@/lib/billing/owner-can-edit", …)` answering
   `{ ok: true, ownerId: "owner-1" }`, with the comment "the fixture's owner holds a plan (s51)",
   to:
   - `src/__tests__/api/staging/` `content-put-permissions`, `content-href`,
     `content-concurrent-elements`, `content-concurrent-write`, `content-device-grant`,
     `grant-revocation-midsession`, `publish-webhook-hook` and `service-role-rate-limit`;
   - `src/__tests__/db/content-attributes-lifecycle.test.ts`.

   Verify: these table rows green, all touched suites green.

4. [x] **Gate the dashboard and API writes (GREEN, part 2).**

   | Route | Gate goes |
   |---|---|
   | `bulk/import` POST | after `:107`, before the `bulk_operations` insert |
   | `bulk/update` POST | after `:52` |
   | `v1/content` POST (PUT delegates) | after `:247`, keyed by `apiKey.site_id` |
   | `ai/translate` POST | after `:187`, before `consumeFeatureUsage` |
   | `ai/suggest` POST | replaces `resolveSiteOwnerId` at `:262-263`; the charge uses the helper's `ownerId`; `no_owner` keeps `NO_PAYER_MESSAGE` 403 |

   Fixture updates, same mock:
   - `src/__tests__/api/bulk/` `import`, `import-outcomes` and `roundtrip`;
   - `src/__tests__/api/v1/content-route.test.ts`;
   - `src/__tests__/api/ai/suggest/` `route` (move its `resolveSiteOwnerId` null case at
     `:513-527` onto the helper mock) and `editor-credentials`;
   - `src/__tests__/api/ai/translate/route.test.ts`.

   Verify: the whole table green, touched suites green.

5. [x] **Issuance points refuse up front, and the message reaches people, test-first.** Named
   tests (RED first):
   - `edit-sessions/create refuses a lapsed owner's site with the plan-ended message and inserts no session`
   - `edit-sessions/create answers a caller with no access on the site as today, reading no plan`
   - `edit-sessions/extend refuses to prolong a session on a lapsed owner's site`
   - `staging/access refuses a new invite on a lapsed owner's site`
   - `submit-code refuses to mint a grant on a lapsed owner's site after the code is spent`
   - `submit-code hub sign-in still lists a lapsed owner's sites`
   - `handoff/create returns the plan-ended message for a lapsed owner's site`
   - `handoff/redeem mints no grant for a lapsed owner's site`
   - `refresh-grant refuses to rotate a lapsed owner's grant and revokes nothing`

   New suites are needed for `extend`, `staging/access`, `handoff/redeem` and `refresh-grant`,
   which have no route tests today. Pins that prove the message reaches people with **0 widget
   bytes**:
   - in a new `src/__tests__/embed/plan-ended-message.test.ts`, using the file's existing
     slicing pattern:
     - `a 402 plan_ended save alerts the server's message and keeps the edit link and editing unlocked`
     - `a 402 plan_ended publish shows the server's message`
     - `the code prompt shows the plan-ended message from submit-code`
     - `a refused grant refresh keeps the stored grant`
   - in `src/app/edit/__tests__/EditorSignIn.test.tsx`:
     - `shows the plan-ended message when a site can't be opened`

   Implement:
   - `edit-sessions/create` and `staging/access`: call `authorizeFirstPartyEditorAccess(siteId, "view")`.
     Only when it returns an access, gate. Then continue unchanged.
   - `extend`: gate after `validateEditorAccess`.
   - `submit-code`: gate after `:159`, site mode only.
   - `handoff/create`: after `:63`.
   - `handoff/redeem`: after the origin check, before `redeemHandoff`.
   - `refresh-grant`: after `readDeviceContext`. Return
     `{ ok: false, reason: "plan_ended", message }` with 402 and **no** `nextAction: "refresh"`.

   Fixture updates:
   - `src/__tests__/api/edit-sessions/create-token-leak.test.ts`: helper mock; leave its
     `test.failing` cases untouched;
   - `src/__tests__/api/editor/handoff/create/route.test.ts`: helper mock.

6. [x] **Credits need a plan; the billing copy tells the truth, test-first.**

   RED tests, in a new `src/__tests__/api/billing/checkout-credits-plan.test.ts`:
   - `refuses a credits checkout from an account with no plan before any Stripe call`, for
     `none` and `credits`
   - `still lets a plan holder buy credits`
   - `fails closed when the entitlement read throws`

   RED tests, in `src/components/billing/__tests__/BillingDashboard.trial.test.tsx`, or a sibling
   if s47a has reshaped it:
   - `no-plan screens render no credit purchase control`, for the credits, lapsed and
     never-trialled variants
   - `each no-plan screen says AI credits come with a plan`
   - `a credits holder is told the credits are kept and work again with a plan`

   Implement:
   - In the checkout route, after `parseIntent` (`:166-170`) and for `intent.type === "credits"`,
     require `getEffectivePlan(user.id).kind === "plan"`. Otherwise return 403
     `{ error: "AI credits come with a plan. Choose a plan to buy more.", upgradeRequired: true }`.
   - Add `getEffectivePlan` → `{ kind: "plan" }` to the entitlements mock in
     `src/__tests__/api/billing/checkout-concurrency.test.ts:212-214`.
   - Copy in `BillingDashboard.tsx:171-176`, or in s47a's `ENDED_*_COPY` constants if that
     branch has merged. Every variant gains "AI credits come with a plan". The credits variant
     replaces "to spend on AI suggestions and translations" with "are kept and work again once
     you choose a plan". Headings are unchanged; `:103-147` pins them.

7. [x] **Make the documentation true** (AC6, AC7). Edit:
   - `permissions.ts`: the header (`:15-37`) says editing needs the owner's plan and names the
     helper. The `CREDITS_ARE_NOT_A_PLAN` reason (`:71-76`) keeps the substring "needs a plan",
     which `permissions.test.ts:492,503` and `seat-quota.test.ts:224` match.
   - `effective-plan.ts:137-141`: `credits` confers no editing and no AI spend until a plan
     exists.
   - `middleware.ts:25-38` and `:161-166`: comments only. They name `checkOwnerCanEdit` and list
     the public reads that are deliberately ungated.
   - `docs/architecture.md`: the entitlement gate row `:363` and the AI row `:366`.
   - `docs/prd.md:390`: the "Credits | Anyone" row becomes "Credits | Plan holders" (product
     owner decision at validation, 2026-09-28: AI routes are gated too, so credits are spendable
     only with a plan).
   - New ADR `docs/decisions/041-editing-needs-the-site-owners-plan.md`, with options rejected:
     - the gate inside `validateEditorAccess`: it would also gate reads and misses the owner's
       session path;
     - "any admin holds a plan": it lets a lapsed owner edit through a paying manager;
     - 403: the widget treats it as terminal;
     - revoking credentials on lapse: that breaks automatic regain.

     Its consequences name the payer change for seats and widget AI.
   - New runbook `docs/operations/edit-needs-a-plan.md`. It lists paid credits-only accounts to
     comp or refund before deploy:
     ```sql
     SELECT cp.user_id, u.email, count(*) AS packs, sum(cp.price_cents) AS paid_cents,
            sum(cp.credits_remaining) AS credits_left
     FROM credit_purchases cp JOIN auth.users u ON u.id = cp.user_id
     WHERE cp.stripe_payment_intent_id IS NOT NULL
       AND cp.stripe_payment_intent_id NOT LIKE 'refund_%'
       AND NOT EXISTS (SELECT 1 FROM plan_entitlements pe WHERE pe.user_id = cp.user_id
             AND pe.revoked_at IS NULL AND pe.plan_id <> 'free'
             AND (pe.expires_at IS NULL OR pe.expires_at > now()))
       AND NOT EXISTS (SELECT 1 FROM billing_subscriptions bs WHERE bs.user_id = cp.user_id
             AND bs.status IN ('active','trialing','past_due') AND bs.plan <> 'free')
     GROUP BY cp.user_id, u.email;
     ```
     Run it read-only via the `read-prod-database` path, which is the operator's step and not
     the implementer's.
   - Add the runbook to the `operations/` table in `docs/README.md` (`:120-126`).

   Verify: permissions and seat-quota suites green.

8. [x] **Give the e2e fixtures an owner with a plan.** In `e2e/share-edit-publish.spec.ts` and
   `e2e/realtime-parity.spec.ts`:
   - create the owner with `auth.admin.createUser`;
   - insert a `site_permissions` admin row;
   - insert a `plan_entitlements` row `{ plan_id: "pro", source: "e2e" }` with no expiry;
   - delete the user in `afterAll`, which cascades.

   Add no test (the contract count stays 44). First run both specs **without** the fixture
   change, with `RUN_RECOPYFAST_CORE_E2E=1` and `RUN_RECOPYFAST_PARITY=1` against local Supabase,
   and record the plan-ended refusal (RED). Then run them with it, green.

9. [x] **Gates and the story commit.** In the worktree, with local Supabase up:
   - `npm run lint`, `npm run type-check`, `npm run type-check:build`, `npm run format:check`;
   - `npm test`, which must be green overall, including the Task 2 table;
   - `npm run build` (prebuild runs the embed build);
   - `node scripts/build-embed.mjs --check`;
   - both mutating e2e specs.

   Then run the interdict checks below. Make **one** commit on `feature/s51-edit-needs-a-plan`,
   conventional `fix:`, carrying the code, tests, ADR 041, runbook, research, plan and the story
   text. Tick the boxes. Do not push, open a PR or merge.

## Run interdicts

- `git diff main -- public/embed scripts/build-embed.mjs` is empty. The design costs 0 bytes, so
  **stop and report** if a widget change seems needed. Never raise `MAX_BUNDLE_GZ`.
- `git diff main -- server/` is empty.
- No diff in these public-read files: `src/app/api/content/[siteId]/route.ts`,
  `src/app/api/bulk/export/route.ts`, the three validate routes and `editor/request-code`.
- In `src/middleware.ts`, only comment lines change (`git diff -U0` shows `//` and `*` lines
  only).
- No `supabase/migrations/` file is added or edited.
- The plan refusal is never 401 or 403 on a route the widget calls: staging content,
  publish, restore, `ai/suggest`, `submit-code`, `handoff/redeem` or `refresh-grant`.
- No gate runs before authorization, or before the route's per-site limiter where one exists.
- Nothing is revoked on lapse. The diff contains no write to `edit_sessions.is_active`,
  `editor_device_grants.revoked_at`, `site_editors.revoked_at` or `api_keys.is_active`.
- No test is loosened, deleted, skipped or `.only`'d. A fixture states that the owner holds a
  plan. `test.failing` cases stay as they are. `git diff main -- src/__tests__/e2e/playwright-ci-contract.test.ts`
  is empty.
- Leave s48's charge/refund internals (`credits/system.ts`, `consumeCredits`) and s47a's offer
  logic in `effective-plan.ts` untouched. s51 only reads `kind`.
- No push, PR, merge, deploy, production query or remote `supabase db push`.

## The point everything turns on

**One helper keyed to a deterministic owner, answered with 402 after authorization.** It could
be wrong in three places:

1. **Who the owner is.** Compare `resolveSiteOwnerId`'s new ordering against how admin rows are
   born: `sites/register/route.ts:138-147` (the creator, first) and `share/route.ts:78,210-221`
   (managers, later). Also against a site whose creator row was deleted. If it is wrong, a paying
   agency is refused, and seat or AI billing moves to the wrong wallet.
2. **The status code and body shape.** Compare against every display site in the research's
   Fact 3 table, and against `handleTerminalWriteFailure` (`recopyfast.src.js:1183`). If any
   widget or hub path ignores the body, or treats 402 as terminal, the message is lost, or the
   edit link is forgotten, which breaks "nothing revoked".
3. **Ordering in each route.** Check the gate sits after authorization and after the limiter.
   The Task 2 no-oracle rows and the limiter suites are the check, but read each insertion.
   `edit-sessions/create` and `staging/access` are the two whose authorization hides inside a
   library that also writes.

Also check that `unavailable` (a resolution error) gives a retryable 503 and never the
plan-ended text. A Supabase blip must not tell a paying customer their plan ended.

## Sequencing

- **Merge order:** s48, then s47a, then s51, all deployed before launch. s51 depends on
  neither, but it shares hunks with both:
  - with s48: `ai/suggest`, `ai/translate`, `permissions.ts` and both AI suites;
  - with s47a: the `BillingDashboard.tsx` copy and `effective-plan.ts` comments.

  Building s51 last means it rebases once, onto code that is already reviewed.
- **Deploy order:** s47a's migration first, per its runbook. s51 ships no migration. Run the
  operator's credits-only query before the s51 deploy.
- **If launch pressure forces s51 ahead of s47a,** s47a rebases over s51's copy change, and
  that conflict is mechanical.

## Files touched

- **New:**
  - `src/lib/billing/owner-can-edit.ts`
  - `docs/decisions/041-editing-needs-the-site-owners-plan.md`
  - `docs/operations/edit-needs-a-plan.md`
- **Routes:**
  - `src/app/api/staging/content/[siteId]/route.ts`
  - `src/app/api/staging/publish/route.ts`
  - `src/app/api/edit-board/history/[versionId]/route.ts`
  - `src/app/api/edit-board/styles/apply/route.ts`
  - `src/app/api/bulk/import/route.ts`
  - `src/app/api/bulk/update/route.ts`
  - `src/app/api/v1/content/route.ts`
  - `src/app/api/ai/translate/route.ts`
  - `src/app/api/ai/suggest/route.ts`
  - `src/app/api/edit-sessions/create/route.ts`
  - `src/app/api/edit-sessions/extend/route.ts`
  - `src/app/api/staging/access/route.ts`
  - `src/app/api/editor/submit-code/route.ts`
  - `src/app/api/editor/handoff/create/route.ts`
  - `src/app/api/editor/handoff/redeem/route.ts`
  - `src/app/api/editor/refresh-grant/route.ts`
  - `src/app/api/billing/checkout/route.ts`
- **Lib and UI:**
  - `src/lib/feature-gating/permissions.ts` (ordering and comments)
  - `src/lib/billing/effective-plan.ts` (comment only)
  - `src/middleware.ts` (comments only)
  - `src/components/billing/BillingDashboard.tsx` (copy)
- **Docs:** `docs/architecture.md`, `docs/README.md` (the runbook row), `docs/stories.md` (the s51 text), the research, this plan.
- **Tests, new:**
  - `src/__tests__/lib/billing/owner-can-edit.test.ts`
  - `src/__tests__/api/owner-plan-gate.test.ts`
  - `src/__tests__/embed/plan-ended-message.test.ts`
  - `src/__tests__/api/billing/checkout-credits-plan.test.ts`
  - route suites for `edit-sessions/extend`, `staging/access`, `editor/handoff/redeem` and
    `editor/refresh-grant`
- **Tests, fixtures only:** the 15 Jest suites named in Tasks 1 and 3–6, plus
  `e2e/share-edit-publish.spec.ts` and `e2e/realtime-parity.spec.ts`.
- **Tests, extended:** `permissions.test.ts`, `EditorSignIn.test.tsx`, `BillingDashboard.trial.test.tsx`.

## Test strategy

- **Unit: the helper** (Task 1). Every entitlement kind, every failure mode, the owner-not-caller
  keying, and the response shapes. This is the only place the refusal body is defined.
- **Route level: one table** (Task 2).
  - It is the story's proof: real helper, real handlers, entitlement mocked at `resolveEntitlement`.
  - Writes are refused and write nothing. Reads are served and read no entitlement. No write
    route leaks plan status to an uncredentialed caller.
  - The same credential works again after the owner pays.
- **Issuance:** one named test per route (Task 5).
- **Client pins with 0 bytes** (Task 5). The widget shows the server's text on 402 and keeps its
  credential. The hub shows `message`.
- **Billing** (Task 6). The checkout route's refusal comes before Stripe, and the no-plan copy
  offers no purchase control.
- **End to end** (Task 8). The two mutating Playwright specs exercise the real helper against
  local Postgres through a seeded paying owner.
- **Existing suites.** They are updated to state a paying owner, never to relax the gate. The
  implementer lists every such fixture change in the commit body, because AGENTS.md "Tests"
  requires the PR to say so.

## Definition of Done

- Every AC above has a named, green test. The Task 2 table covers all nine write handlers and
  the eight read surfaces listed there.
- These all pass in the worktree with local Supabase up: `lint`, `type-check`,
  `type-check:build`, `format:check`, `test`, `build` and `build-embed --check`. So do both
  mutating e2e specs.
- The artifact is byte-identical (45,883 B gzipped).
- Every run interdict holds, checked by the commands given.
- ADR 041 and the runbook exist. The comments in `permissions.ts`, `effective-plan.ts` and the
  middleware state the rule.
- There is one story commit on `feature/s51-edit-needs-a-plan`, not pushed. Review
  (`/ks-review`) comes next. After merge, the operator runs the runbook query and comps or
  refunds each account it finds, before deploying.

## Execution log

- **2026-09-28: `editor/refresh-grant`, gate placement (CTO decision).** The plan put the gate
  "after `readDeviceContext`". The grant, however, is only authenticated inside
  `refreshDeviceGrant`, so a gate there would answer "plan ended" to a garbage grant: an oracle,
  which the run interdicts forbid. As decided, the route first authenticates the grant with the
  exported `validateDeviceGrant` (one extra read plus a `last_used_at` touch). It gates only a
  valid grant (402 `{ ok: false, reason, message }`, no `nextAction`; 503 on a read error), then
  calls `refreshDeviceGrant`. Tested:
  - a garbage grant gets the same answer on a lapsed site as on a paying one;
  - a valid grant on a lapsed site gets 402.
- **2026-09-28: `editor/handoff/redeem`, no gate (CTO decision, option c).** The code is only
  checked inside `redeemHandoff`, which also consumes it and mints the grant, so a gate in front
  would be an oracle. `redeemHandoff` is not split, to keep `editor-handoff.ts` out of scope. It
  is safe without a gate because:
  - redeem is reachable only through the gated, authenticated `handoff/create`;
  - the code lives 60 seconds;
  - every write is gated.

  The planned test "handoff/redeem mints no grant for a lapsed owner's site" is replaced by "a
  grant redeemed for a lapsed owner's site is refused with the plan-ended 402 on its first staging
  save, and saves once the owner picks a plan". The handoff/create refusal test stays. Also
  recorded in ADR 041, "Considered options".
- **2026-09-28: no-oracle rule for every issuance gate (CTO decision).** A gate runs only after
  the caller is authenticated for the site. Every issuance route that an unauthenticated caller,
  or one without access to the site, can reach now has a test: the same request, sent once with
  the owner lapsed and once paying, must get an identical answer, and no plan is read. Covered
  routes: `edit-sessions/create` and `extend`, `staging/access`, `editor/submit-code`,
  `editor/handoff/create`, `editor/refresh-grant` and `editor/handoff/redeem`.

- **2026-09-28: mutation check on the gate (CTO request).** Six deliberate mutants, each run
  against the API, billing and feature-gating suites, then restored:
  - gate keyed on the caller, on staging save and on `ai/translate`;
  - gate dropped from publish;
  - fail open on a resolution error;
  - owner lookup left unordered;
  - refusal answered 403.

  All six were killed. The two caller-keyed mutants exposed a gap: in the gate table every caller
  was the owner, so only incidental fixture failures, and the redeem test, caught them. The table
  now has two rows per write route with a collaborator as the caller. One gives the collaborator
  a plan on a lapsed owner's site (refused 402); the other has a planless collaborator on a
  paying owner's site (no `plan_ended`). Both caller mutants now fail those rows directly.
- **2026-09-28: rebased onto `main` at `7c21d00`, which includes s50.** No conflicts. The final
  gates ran after the rebase.
- **2026-09-28: rebased onto `main` at `50f0a3c` (s47a merged).** Conflicts were resolved by
  intent, keeping both stories' behaviour:
  - `docs/README.md`: both runbook rows are kept.
  - `BillingDashboard.tsx`: s47a's offer-aware lapsed branch (`ENDED_TRIAL_COPY` /
    `ENDED_FOUNDING_OFFER_COPY`), `hasSubscription` and lifetime suppression are kept as merged.
    s51's sentence "AI credits come with a plan" goes into both `ENDED_*_COPY` bodies, as this
    plan's Task 6 foresaw, and into the never-trialled body.
  - `BillingDashboard.trial.test.tsx`: s47a's and s51's `describe` blocks are both kept. s51's
    no-plan variants gain the ended-founding-offer screen, which renders no credit purchase
    control and says AI credits come with a plan. s47a's verbatim pin of the ended-offer body
    now includes that sentence.
