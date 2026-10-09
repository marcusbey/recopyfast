---
validated: no
previously_validated: yes
validation_reopened: 2026-09-12
---
# Plan — Story s11b-ab-surface

> **Validation history.** This plan was initially validated. Execution preflight on 2026-09-12
> reopened it before source work: Task 7 specified an index command that cannot run inside a
> Supabase transactional migration, and Task 4 specified a parent-plus-children write without the
> atomic database boundary required by `AGENTS.md`. The corrections below require a fresh human
> validation. No production migration was applied and no source implementation began under the
> superseded wording.

Branch: `feature/s11b-ab-surface`
Research: `docs/research/s11-ab-run-test.md` — read it first; this plan does not repeat it.

## Target story

`s11b — the A/B surface` (complexity 4), the second of the three stories `s11-ab-run-test` was
split into (`docs/stories.md:136`).

> *As a marketer I want to create and start a test from the dashboard so that the feature Pro
> sells is one I can actually use.*

Design is binding: **`docs/designs/s11b-ab-surface.md`** (mockup:
`docs/designs/s11b-ab-surface.html`). It inventories every component this story reuses and
states, per file, what changes. This plan does not restate it; where the two could be read
differently, the design wins on appearance and this plan wins on sequence and on what must
fail a test.

Criteria this story owns, from `docs/stories.md:672-680`:

- `/dashboard/ab-tests` is a live route, reachable from the navigation for entitled accounts.
- An owner can create a test on an existing content element with two or more text variants and
  a traffic split.
- Only one test can be active per content element; a second attempt is refused with a clear
  reason.

Criteria it does not own: bucketing correctness (`s11a`, a hard dependency — the tests must
exist before a UI can start putting traffic through them), delivery and bytes (`s11c`),
results, significance and the lifecycle cron (`s12`).

**Dependencies.** `s11a-ab-data-plane` (data plane proven honest), `s01-trial-signup`
(defines who is entitled).

**Much of this is re-enabling, not building** — and that premise is exactly why Task 1 is an
audit and not an implementation. `d7cc8e0` ("take A/B testing out of the launch, reversibly")
renamed `dashboard/ab-tests` → `dashboard/_ab-tests`, removed the nav entry and the site-detail
card, and removed the cron from `vercel.json`. It deliberately kept `plan.limits.abTesting` in
the seeded plans, because *"changing what a plan includes is a pricing decision rather than a
scope cut"* — so Pro is selling this today (`src/lib/stripe/plans.ts:200`). Nothing in that
commit argues the feature is wrong; it argues it was unfinished and metered.

## Tasks (ordered)

- [ ] **1 — Audit what works, before writing anything, as characterization tests.**
  The story's own note says *"audit what works before writing anything"*, and an audit that is
  only prose cannot fail. So the deliverable is a test file that pins today's behaviour:
  `src/__tests__/api/ab-tests/surface-baseline.test.ts` plus
  `src/__tests__/app/dashboard/ab-tests-page.test.tsx`. Cover, one case each:
  `GET /api/ab-tests` lists for a permitted user; `PUT /api/ab-tests` activates and — asserted
  as **currently true, and wrong** — activates for an account with no A/B entitlement
  (`route.ts:210-288` checks session + `site_permissions` only); `POST /api/ab-tests/generate`
  refuses an unentitled account (already covered by `generate-unentitled.test.ts`, extend not
  duplicate); `POST /api/ab-tests` writes `content_element_id`/`variant_name`/`content` and
  **never sets `ab_tests.target_element_id`**, so `applyVariants` returns early
  (`recopyfast.src.js:3058-3059`) and a test created this way can never appear on a page; the
  parked page component renders its three views. Record the audit verdict as a table appended
  under this task. The unentitled-activation and missing-`target_element_id` cases are written
  with `test.failing` markers or as explicit "this is the defect" assertions, and Tasks 3 and 8
  are what flip them.
  *Fails when:* a claim in `docs/stories.md:684-690` about what is built and working is untrue.

- [ ] **2 — Un-park the route and put the nav entry back.**
  `git mv src/app/dashboard/_ab-tests src/app/dashboard/ab-tests`. In
  `src/components/dashboard/DashboardNavigation.tsx`: delete the stale comment at `:49-51`
  (already false — it misnames the directory as `ab-tests`) and add
  `{ label: "A/B Tests", href: "/dashboard/ab-tests", icon: FlaskConical, badge: "Pro",
  requiresPlan: "pro" }` to the Workspace group, using the **exact** `requiresPlan` mechanism
  `Teams` uses at `:59-64`. `FlaskConical` is already imported at `:11` and currently unused.
  `src/__tests__/components/dashboard/DashboardNavigation.test.tsx:131-137` asserts the item's
  absence and its comment says the feature is not being pursued — **change the test and say so
  in the PR description**, per `AGENTS.md` ("do not modify a test to accommodate a change in
  behaviour… or change the test *and say so*"). It becomes an entitled/unentitled pair.
  *Fails when:* an unentitled account is offered a working link, or an entitled one is not
  offered the item at all.

- [ ] **3 — One entitlement source of truth, enforced on activation as well as generation.**
  Today three gates disagree: nav uses `PLAN_RANK` on `entitlement.planId`
  (`DashboardNavigation.tsx:122-132`), `generate` uses `plan.limits.abTesting`
  (`generate/route.ts:70-93`), and activation uses **nothing at all**. Extract the `generate`
  check verbatim into `src/lib/billing/ab-testing-entitlement.ts` —
  `requireABTestingEntitlement(userId): Promise<{ ok: true } | { ok: false; response: NextResponse }>`,
  preserving the three distinct messages already written there (credits-only, no plan, plan
  without the capability) because they are the copy the user reads. Call it from `generate`, from
  `PUT /api/ab-tests` before the status update, and from the manual create path in Task 4. Add
  a test asserting the nav's `PLAN_RANK` gate and `limits.abTesting` select the same set of
  seeded plans, so the two cannot drift silently.
  *Fails when:* an account that cannot generate can still activate.

- [ ] **4 — A manual create path: variants without AI, without credits, committed atomically.**
  Extend `POST /api/ab-tests` (Task 8 converges it) to accept
  `{ site_id, target_element_id, name, variants: [{ name, content, traffic_percentage,
  is_control }] }`, writing `ab_tests.target_element_id` and the `(name, variant_content,
  traffic_percentage, is_control)` column pair the embed endpoint reads
  (`active/[siteId]/route.ts:57-71`; the `sync_ab_test_variant_columns` trigger keeps the second
  naming generation in step). No OpenAI call, no `CREDIT_COSTS.AB_TEST_GENERATION` spend —
  entitlement still required (Task 3). Validation through `src/lib/api/validation.ts`, extended
  with a `requireIntegerInRange` and an array validator; **not zod** (ADR 003).

  The route must not repeat the inherited parent-insert / child-insert / compensating-delete
  sequence. The same forward migration Task 7 uses defines this exact database boundary:

  `public.create_ab_test_atomic(p_site_id uuid, p_target_element_id text, p_name text,
  p_variants jsonb) returns jsonb`.

  It is `SECURITY INVOKER`, pins `search_path = public, pg_temp`, derives `created_by` from
  `auth.uid()` and runs through the authenticated request client so the existing `ab_tests` and
  `ab_test_variants` RLS policies remain the tenant boundary. Revoke `PUBLIC`/`anon` execute and
  grant only `authenticated` and `service_role`. The function validates again at the trusted
  boundary: the target element exists on `p_site_id`; `p_name` is non-empty; `p_variants` is an
  array of at least two objects; every object has a non-empty `name`/`content`, integer
  `traffic_percentage` in 1..100 and boolean `is_control`; exactly one control exists; the total
  is exactly 100. It inserts one draft `ab_tests` row (`success_metric='conversion_rate'`) and all
  variants in the same transaction, then returns exactly
  `{ "test_id": <uuid>, "variants": [{ "id": <uuid>, "name": <text>, "content": <text>,
  "traffic_percentage": <integer>, "is_control": <boolean> }] }`, in request order. The route
  validates that result before returning `{ test: { id, variants } }`; a missing/malformed result
  is a generic 500, never treated as a successful draft.

  The manual branch remains local during `review-and-split`: its editable cards say **“Unsaved
  draft”**, never “Saved,” because no server row exists yet. Once two or more complete variants
  sum to 100, “Next” calls this atomic create route. The wizard advances only after the response
  supplies the persistent test and variant ids; failure leaves the local draft and split intact.
  If the user navigates back after that point, subsequent edits use Task 6's real variant route and
  may show “Saved” only after its response succeeds. AI-generated variants already exist and use
  that persisted branch from the first review render.

  Stable failures: malformed name/variant/split uses SQLSTATE `22023` and maps to 400; a missing
  target uses `P0002` and maps to 404; RLS/permission denial uses `42501` and maps to the existing
  enumeration-safe 403; every other database failure maps to the generic 500 after server-side
  detail logging. The route must never return raw SQL text. A DB-backed test forces a child-row
  failure after the parent insert and proves both tables remain unchanged; success proves exactly
  one parent, every child and the returned ids. Route tests prove each stable mapping.
  *Fails when:* a manually created test does not appear in `GET /api/ab-tests/active/:siteId`
  with a non-null `target_element_id`, or any variant failure leaves an orphan parent/partial set.

- [ ] **5 — Traffic split, validated server-side and surfaced client-side.**
  Server: every `traffic_percentage` an integer in 1..100 and the set summing to **exactly**
  100; otherwise 400 naming the observed total. Two or more variants required (control counts
  as one). Client, per the design: a plain `Input type="number"` with a right-side `%` unit
  label and a `Label` "Traffic split" per variant card; a running total in
  `.text-metric .tabular` reading `text-foreground` at 100 and `text-tone-danger-text` away from
  it, with an `Alert variant="warning"` beneath — "Splits must add up to 100% — currently {n}%.";
  "Next" disabled until the total is exactly 100 and every variant has non-empty text, mirroring
  `ABTestElementPicker.tsx:150`. `Add variant` is `Button variant="outline" size="sm"` with
  `Plus`. Compose from `src/components/ui/` only. The manual branch persists the complete split
  in Task 4's atomic create. For an already-persisted AI/manual draft, Task 6's route writes the
  edited percentage; activation re-reads every stored variant and refuses unless all are integers
  in 1..100 and total exactly 100, so React state can never be the source of truth at start time.
  *Fails when:* a 99% or 101% split is accepted by the route, or the client lets "Next" through.

- [ ] **6 — Review-step edits actually persist.**
  `useABTestCreation.ts:157-163` — `saveEdit` mutates local state and nothing else, so the user
  edits a headline, activates, and the AI's original text ships. Add exactly one route,
  `PUT /api/ab-tests/variants/[variantId]`, using the signed-in server client plus the parent
  test's `site_permissions` `edit|admin` check. Its allowlist accepts `content` and
  `traffic_percentage`, updates both naming columns (`content` and `variant_content`) for text,
  and validates an edited percentage as an integer in 1..100. It is awaited, with failure surfaced
  in the wizard's existing
  `Alert` (`ABTestCreateFlow.tsx:43-47`). Only after the round trip does the design's inline
  `text-tone-success-text` check + "Saved" appear, at `--dur-fast`. That inline confirmation is
  the documented workaround for design-system gap #1 (no toast primitive) — it is not a new
  component, and this story does not invent one. The response returns the persisted variant;
  re-read/activation tests assert its content and split, not only the local hook state. Manual
  cards without ids follow Task 4's “Unsaved draft” state and never call this route.
  *Fails when:* an edited variant reloads as the AI original, or "Saved" appears before the
  server confirms.

- [ ] **7 — One active test per element: a transactional partial unique index and a 409 with a reason.**
  The forward migration shared with Task 4,
  `supabase/migrations/<YYYYMMDDHHMMSS>_ab_test_surface_invariants.sql`, first aborts with one
  legible preflight error if existing active rows duplicate `(site_id, target_element_id)`, then
  creates:
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_ab_tests_active_element ON ab_tests
  (site_id, target_element_id) WHERE status = 'active' AND target_element_id IS NOT NULL;`.
  **Do not use `CONCURRENTLY`:** Supabase runs each migration inside a transaction and PostgreSQL
  rejects `CREATE INDEX CONCURRENTLY` there; the repository records this exact incident and uses a
  plain index in `20260611050000_content_elements_query_index.sql:16-20`. With zero users and the
  current table size, the brief write lock is the bounded deploy tradeoff for a migration that can
  actually apply atomically.
  `ab_tests` already carries RLS and policies from
  `20260801200000_missing_base_tables.sql`; this migration adds the Task 4 function and this
  index, creates no table and changes no policy, and its header says so (ADR 002). Never edit an
  applied migration. Map
  Postgres `23505` on activation to **409** with `{ error, reason, conflicting_test_id }` — the
  reason string is the copy the design specifies: *"This element already has an active test
  running. Pause or end it first, or choose a different element."* Client: the existing greyed
  picker row (`ABTestElementPicker.tsx:90,127-131`) stays as the *preventive* half; the
  *reactive* half is an `Alert variant="destructive"` at step 1 or step 4 carrying the server's
  reason plus "Choose a different element" (`variant="outline"`) and "View active test"
  (`variant="ghost"`), reusing the wizard's existing `Alert` position.
  *Fails when:* a second activation on the same element succeeds, or is refused with a bare
  string instead of a stated reason and a way out. **A greyed-out row alone does not pass.**

- [ ] **8 — Resolve the dead `POST /api/ab-tests`: converge, do not delete.**
  It writes `content_element_id`/`variant_name`/`content` (`route.ts:182-188`) and never sets
  `target_element_id`, so tests created through it are invisible on the page; the migration's own
  comment flags the duplication as follow-up (`20260731006000:26-28`). Deleting it is the tidier
  move, but Task 4 needs a create route and standing up a second one beside a dead one is worse
  than fixing the one that exists — so it converges on the v2 shape. Its 307 lines of test
  (`src/__tests__/api/ab-tests/route.test.ts`) change with it; **say so in the PR description**.
  *Fails when:* a test created via `POST /api/ab-tests` still has a null `target_element_id`.

- [ ] **9 — The list and wizard surface swaps, exactly as designed.**
  `ABTestManager.tsx`: `Loader2` spinner → row-shaped `Skeleton`s; hand-rolled empty block →
  `EmptyState` with `IconTile`/`FlaskConical`, "No A/B tests yet", the design's description, and
  a "Create test" primary action; hand-rolled `<p role="alert">` → `Alert variant="destructive"`
  carrying the server message `useABTests`'s `readError` already surfaces honestly, plus retry.
  `page.tsx`: same two swaps for the *site* list. `ABTestElementPicker.tsx`: second CTA "Write
  variants manually" (`Button variant="outline"`) beside "Generate with AI".
  `ABTestConfigForm.tsx`: button copy "Activate Test" → "Start test". `WizardStepIndicator`
  labels follow the new step set `select-element → [generate | skip] → review-and-split → start`.
  `ABTestCard`, `ABTestStatusBadge` and the whole `results` view are **unchanged** — `s12` owns
  results.
  *Fails when:* a failed list fetch renders as the empty state, or loading renders a spinner.

- [ ] **10 — State the cron position, and do not re-add it.**
  `d7cc8e0` removed `/api/cron/ab-test-lifecycle` from `vercel.json` as *"the part actually
  spending"*, and that reason still holds for a 5-minute cron over a table with no completed
  tests. It is **not** re-added here. But `s11b` is what makes tests activatable, so an active
  test with no lifecycle runs forever — record that plainly in the PR description as a hard
  follow-on obligation on `s12`, which owns `checkTestCompletion` and `promoteWinner`. What
  `s11b` ships instead is the manual control that already exists: pause/resume/end on
  `ABTestCard`. Assert it works.
  *Fails when:* `vercel.json` gains a cron entry in this diff, or pause/resume does not change
  `ab_tests.status`.

## Run interdicts

- **Compose from `src/components/ui/`. Never invent a primitive beside it.** The seventeen that
  exist are: `alert`, `avatar`, `badge`, `button`, `card`, `content-value`, `dialog`,
  `dropdown-menu`, `empty-state`, `icon-tile`, `input`, `label`, `metric`, `page-header`,
  `skeleton`, `status-badge`, `tabs`. There is no slider, and none is needed — a percentage that
  must sum to exactly 100 across an unknown number of variants is better typed than dragged.
  There is no toast; design-system gap #1 stays open and the inline "Saved" is the prescribed
  workaround, cited not invented.
- **Validation via `src/lib/api/validation.ts`, extended when a validator is missing. Never
  zod** (ADR 003). Parse bodies with `readJsonObject`; reject `__proto__`/`constructor`/
  `prototype`; cap size and depth; redact control characters before echoing a rejected value;
  cap how many rejections a response enumerates.
- **New or changed tables carry RLS in the same migration** (ADR 002). Tasks 7 creates an index
  on an existing, already-policied table and must say so in the migration header rather than
  silently adding nothing. **Never edit an applied migration** — forward-only,
  `YYYYMMDDHHMMSS_snake_case.sql`.
- **One entitlement source of truth.** After Task 3 there is exactly one function deciding
  whether an account may use A/B testing, and it is called on generation *and* on activation.
  Do not add a fourth gate.
- **Do not regress `3099c07`.** This story does not touch `active`, `bucket` or `track`; if a
  diff appears in any of them, it is out of scope. The site-token gate stays.
- **Ownership is an `admin`/`edit` row in `site_permissions`, never a column on `sites`.**
  Counting via `sites.user_id` returns 0 and passes every quota check — that bug already shipped.
- **Do not touch the results view or `src/lib/ab-testing/lifecycle.ts`.** `s12` owns them.
- **Do not touch `public/embed/`.** No widget bytes are spent by this story.
- **Do not re-add the lifecycle cron to `vercel.json`.**
- **Do not apply the new migration to any live or shared database during Execute or automated
  tests.** Use a fresh isolated fixture. Deployment remains a later ship decision.
- **Do not lower `jest.config.js` coverage thresholds.** Ratchet only.
- **Server state is a custom hook** (`useState` + `useEffect` + `fetch`, returning
  `{ data, loading, error, refetch }`); a non-ok response produces an error state, never an
  empty list. `useABTests` already does the honest thing — match it, do not replace it with a
  library. No React Query, no Zustand (ADR 005).

## The point everything turns on

**The refusal has to come from the database, and it has to arrive as a sentence.**

Every other task here is re-enabling work with an obvious right answer. This one is not, and it
is the criterion the story would most plausibly ship broken. `useContentElements.ts:54-64`
already computes `hasActiveTest` and `ABTestElementPicker.tsx:90` already greys the row — so it
is genuinely tempting to call the criterion met and move on. It is not met. A greyed row is a
*hint*, computed from data that was fetched at step 1 and acted on at step 4. The window between
those two is a real race: a second browser tab, a colleague, an API client. And a hint that has
gone stale fails **open** — the wizard completes, two tests go active on one element, and from
that moment both are serving traffic to overlapping visitor populations and every number `s11a`
just worked to make honest is quietly wrong again.

So the constraint lives in Postgres — a partial unique index on `(site_id, target_element_id)
WHERE status = 'active'` — because that is the only place a check and a write cannot be
separated by a network. And the `23505` becomes a **409 carrying a reason and two ways out**,
not a 500 and not a generic "something went wrong", because the user who hits it did not do
anything stupid: they picked an element that was free when they picked it. The design says the
same thing in interface terms — *the greyed row is the preventive half, the `Alert` is the
reactive half, and the reactive half is the one that has to exist.*

Second, smaller, and easy to lose: **entitlement**. Three gates disagree today and the middle
one is missing entirely, so re-enabling the route without Task 3 ships a path where an
unentitled account cannot generate a variant but can activate a test. That is the whole feature,
free.

## Files touched

**Renamed**
- `src/app/dashboard/_ab-tests/` → `src/app/dashboard/ab-tests/` (`git mv`, so history follows)

**Modified**
- `src/app/dashboard/ab-tests/page.tsx` — `EmptyState` / `Alert` swaps for the site list (9)
- `src/components/dashboard/DashboardNavigation.tsx` — nav item, stale comment removed (2)
- `src/components/dashboard/ABTestManager.tsx` — `Skeleton`, `EmptyState`, `Alert` (9)
- `src/components/dashboard/ABTestCreateFlow.tsx` — new step set; the 409 `Alert` (7, 9)
- `src/components/dashboard/ab-create/ABTestElementPicker.tsx` — "Write variants manually" (9)
- `src/components/dashboard/ab-create/ABTestVariantReview.tsx` — split input, running total,
  "Add variant", persisted-save confirmation (5, 6)
- `src/components/dashboard/ab-create/ABTestConfigForm.tsx` — "Start test" copy (9)
- `src/components/dashboard/ab-create/WizardStepIndicator.tsx` — step labels (9)
- `src/hooks/useABTestCreation.ts` — manual path, split state, `saveEdit` as a real write,
  409 handling (4, 5, 6, 7)
- `src/app/api/ab-tests/route.ts` — converge `POST` on the v2 shape; entitlement + 409 on `PUT`
  (3, 4, 7, 8)
- `src/app/api/ab-tests/generate/route.ts` — call the extracted entitlement helper (3)
- `src/app/api/ab-tests/variants/[variantId]/route.ts` — persisted content/split edits (6)
- `src/__tests__/api/ab-tests/route.test.ts` — follows Task 8; **called out in the PR**
- `src/__tests__/components/dashboard/DashboardNavigation.test.tsx` — follows Task 2;
  **called out in the PR**
- `jest.config.js` — coverage ratchet up

**Created**
- `supabase/migrations/<YYYYMMDDHHMMSS>_ab_test_surface_invariants.sql` —
  `create_ab_test_atomic` (4) + plain partial unique index (7)
- `src/lib/billing/ab-testing-entitlement.ts` (3)
- `src/__tests__/api/ab-tests/surface-baseline.test.ts` (1)
- `src/__tests__/app/dashboard/ab-tests-page.test.tsx` (1, 9)
- `src/__tests__/api/ab-tests/one-active-per-element.test.ts` (7)
- `src/__tests__/api/ab-tests/entitlement-on-activation.test.ts` (3)
- `src/__tests__/api/ab-tests/manual-create.test.ts` (4, 5)
- `src/__tests__/hooks/useABTestCreation.test.ts` (6)

**Read, not modified**
- `docs/designs/s11b-ab-surface.md` and `.html`, `docs/design-system.md`,
  `src/components/ui/*`, `src/hooks/useABTests.ts`, `src/hooks/useContentElements.ts`,
  `src/lib/billing/entitlements.ts`, `src/lib/stripe/plans.ts`
- `public/embed/**` — untouched by this story

## Test strategy

Jest + Testing Library, colocated under `src/__tests__/`.

**Characterization first (Task 1).** The audit's output is executable. Two of its cases assert
defects rather than desired behaviour — unentitled activation succeeds, `POST /api/ab-tests`
leaves `target_element_id` null — and Tasks 3 and 8 are done when those two flip. That is the
mechanism that stops "audit what works" from becoming a paragraph nobody can check.

**Route tests**, Supabase mocked at the module boundary as the existing
`src/__tests__/api/ab-tests/*.test.ts` do:
- activation by an unentitled account → 403 with `upgrade_required`; by an entitled one → 200
- a second activation on an element already under test → **409**, with a non-empty `reason` and
  a `conflicting_test_id`; the response body is asserted, not just the status
- splits of 99, 101, 0-for-a-variant, one variant only → 400 naming the observed total; exactly
  100 across two and across three variants → 200
- a manual create → `target_element_id` non-null and the row visible through
  `GET /api/ab-tests/active/:siteId`
- manual cards remain “Unsaved draft” until atomic create returns test/variant ids; create failure
  preserves the local draft and does not advance
- persisted variant edit → content and split persisted, and re-read at activation; activation
  refuses when stored splits do not total 100

**Database fixture tests** run only against a fresh isolated database: the atomic create RPC
commits one parent and every child on success; a forced child-insert exception rolls the parent
back; invalid target/name/variant/control/split inputs expose the stable SQLSTATE contract; the
plain partial index refuses two active tests on one element while permitting drafts and different
elements. No `supabase db push` or production connection is part of this task.

**Component tests**:
- nav renders the item for a Pro entitlement and renders it locked (`opacity-45`,
  `cursor-not-allowed`, "Pro" badge, click intercepted) for an unentitled one — the same DOM
  `Teams` produces today
- list loading renders `Skeleton`s, not a spinner
- list fetch failure renders `Alert variant="destructive"` with the server's message and
  **never** the empty state — the distinction `useABTests` already keeps
- zero tests renders `EmptyState` with the "Create test" action
- the running total turns danger away from 100 and "Next" is disabled until 100
- manual review never renders “Saved” before atomic create; the label changes from “Unsaved draft”
  only after ids return, and a later edit shows “Saved” only after its PUT resolves
- the 409 `Alert` renders the server's reason and both actions, at step 1 and at step 4

**Not tested here:** bucketing distribution and hash parity (`s11a`), swap timing and bytes
(`s11c`), significance and promotion (`s12`).

**Coverage.** Raise `jest.config.js` to the new measured floor in the same commit. Never lower.

## Definition of Done

- [ ] Task 1's audit table recorded in this file, with the two defect cases flipped green by
      Tasks 3 and 8.
- [ ] `/dashboard/ab-tests` is a live route; the directory is renamed via `git mv`; the nav item
      is present, gated by the same `requiresPlan` mechanism `Teams` uses; the stale comment at
      `DashboardNavigation.tsx:49-51` is gone and its test updated and called out in the PR.
- [ ] Exactly one function decides A/B entitlement, and it is called on generation **and** on
      activation. A test proves the nav gate and `limits.abTesting` agree on the seeded plans.
- [ ] An owner can create a test with two or more text variants **and** a traffic split, without
      an AI call and without spending credits; the parent and children commit through
      `create_ab_test_atomic` or roll back together, and the manual UI never claims persistence
      before that response returns ids.
- [ ] Splits are integers summing to exactly 100, enforced by the route (400) as well as the
      form (disabled "Next").
- [ ] A review-step edit round-trips to the server; "Saved" appears only after it confirms; the
      activated test ships the edited text.
- [ ] The plain transactional partial unique index exists; a second activation on the same element returns **409**
      with a stated reason and a way out, and the `Alert` renders it at step 1 and step 4.
- [ ] `POST /api/ab-tests` sets `target_element_id` and writes the column pair the embed reads;
      its test file follows and the change is called out in the PR.
- [ ] List and wizard states match `docs/designs/s11b-ab-surface.md`: `Skeleton`, `EmptyState`,
      `Alert variant="destructive"`, "Start test", "Write variants manually", "Add variant".
      Every one composed from `src/components/ui/`; no new primitive.
- [ ] `vercel.json` is unchanged; the cron obligation is written into the PR description as a
      follow-on for `s12`; pause/resume/end works from `ABTestCard`.
- [ ] `git diff main...feature/s11b-ab-surface` touches no file under `public/embed/`, none of
      `active`/`bucket`/`track`, and nothing in the results view or `lib/ab-testing/lifecycle.ts`.
- [ ] `lint`, `type-check`, `format:check`, `build`, `test` all green; coverage ratcheted up.
- [ ] One commit for the story; the migration may be a second.
