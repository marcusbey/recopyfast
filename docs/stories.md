# User Stories — RecopyFast

> One story = one shippable slice, written to be executed by an agent.
> Id format: `s<number>-<short-slug>` — reused in every pipeline file and in the branch name.
> Scope authority: [`prd.md`](./prd.md). Nothing from the PRD graveyard appears here.
> Review: [`reviews/stories.md`](./reviews/stories.md). This revision closes every issue it raised.

## Reading this file

**This is a delta backlog, not a build plan.** RecopyFast is in production and its suite
is green (1954 passing). Most of the PRD core loop is genuinely built, and writing stories
for it would re-implement working software.

**But "built" was verified, not assumed.** The first revision of this file claimed the
whole core loop was in production. A fresh-context review checked that claim against the
code and found two features listed as shipped that are not usable: real-time sync is
switched off in production, and bulk import/export has no user-facing surface. Both are
now stories (`s07`, `s05`). The lesson is recorded here because it will apply again: on a
brownfield product, *"there is a route and a test"* is not the same as *"a stranger can
use it"*, and only the second one satisfies the PRD.

Every story below is one of five things:

1. **A gap** — in the PRD perimeter, not in the code (impressions, Agency plan, trial).
2. **A dark feature** — code exists, no reachable surface (bulk portability, real-time).
3. **A breach** — built, but violating a stated constraint (embed size).
4. **A reversal** — built, then deliberately disabled, now back in scope (A/B).
5. **A surface** — the acquisition machinery the PRD's SEO/GTM sections require.

Reference implementation for every story: **TinaCMS** (tina.io) and **CloudCannon**
(cloudcannon.com) both run in production. Where they have an equivalent screen, the
agentic notes name it.

### Renumbered at review

Ids shifted when `s05` and `s07` were inserted and the old `s05` was split. No branches or
pipeline files existed yet, so ids were still free, and keeping numeric order aligned with
dependency order matters more than id stability at this stage. Map for reading
[`reviews/stories.md`](./reviews/stories.md), which cites the old numbering:

| Old | New | Old | New |
|---|---|---|---|
| s01–s04 | unchanged | s10 | **s13** |
| s05 | **split → s06 + s08** | s11 | **s14** |
| s06 | **s09** | s12 | **s15** |
| s07 | **s10** | s13 | **s16** |
| s08 | **s11** | s14 | **s17** |
| s09 | **s12** | s15 | **s18** |
| — | **s05** (new, C2) | s16 | **s19** |
| — | **s07** (new, C1) | | |

### Dependency order

```
s01 ─┬─────────────> s03                    s01 also gates entitlement in s09, s11, s13
     └─> s13 ──> s14 ──> s15
s02 ─┴─────────────> s03
s02 ──────────────────────────> s18
s04   (independent)
s05   (independent)
s06 ─┬─> s09 ──> s10 ──┐
     ├─> s11 ──────────┴─> s12
     └─> s08
s07 ─────────────────> s08
s16   (independent)
s17 ─┬─> s18
     └─> s19
```

Reading the graph:

- **`s06` gates every embed change.** `s09` (impressions) and `s11` (A/B) both add code to
  the widget. Until the budget is measured and enforced, "does this fit?" is unanswerable.
- **`s07` gates `s08`.** The transport replacement needs a running WebSocket service to
  replace the transport *of*. There isn't one today.
- **`s12` needs `s09`.** A/B results are counted in impressions, which `s09` builds.
- **`s06` and `s08` are separate on purpose.** Shrinking the widget and swapping its
  transport were one story; the review showed that story was a complexity 5 whose
  arithmetic did not close. Split, each is a 4 with a real target.

### Byte budget

The PRD constraint is **≤ 30KB gzipped** for `public/embed/recopyfast.js`
([`architecture.md` → The embed widget](./architecture.md#the-embed-widget); formerly
`docs/architecture/overview.md:326`, now archived). Measured on this revision:

| Component | gzipped |
|---|---|
| `recopyfast.js` as shipped | **46,781** |
| — of which `socket.io-client` | 13,085 |
| — of which widget code | **34,063** |

The widget alone is over budget with socket.io entirely removed. Allocation, so that three
stories are not each asserting the same ceiling and silently competing for it:

| Owner | Allowance (gz) |
|---|---|
| Widget core after `s06` | ≤ 24,000 |
| Transport after `s08` (native `WebSocket`) | 0 |
| Impressions (`s09`) | ≤ 2,000 |
| A/B bucketing (`s11`) | ≤ 2,000 |
| Reserve | ≤ 2,000 |
| **Total ceiling** | **30,000** |

---

## Revised after research — 2026-08-16

All 19 stories were researched against the code (`docs/research/<id>.md`). Research is where a
false premise gets repaired, and it repaired several. **Ids are suffixed, never renumbered** —
the last renumbering broke four references in the PRD, two of which silently resolved to a
different real story. Every existing `s01`…`s19` reference below and elsewhere still resolves.

### Two research claims corrected by direct measurement

Research is evidence, not verdict. Two claims were checked and are wrong:

1. **`ab_test_results` and `visitor_buckets` DO exist.** `research/s11` claimed both tables are
   missing and priced "a database repair" into its re-score. They are created at
   `supabase/migrations/20260127_ab_testing_v2.sql:8` and `:40`, with no `DROP` anywhere.
   `research/s09` and `research/s12` cite the same migration correctly. **What survives** is a
   narrower concern worth keeping: that file is named `20260127_ab_testing_v2.sql` — 8 digits
   where every other migration uses 14 (`YYYYMMDDHHMMSS`) — so its ordering in the ledger is not
   guaranteed. That is a real defect, and it is `s11a`'s to confirm.
2. **The widget is 34,063 gz, not 33,699.** `research/s06` proposed correcting the byte table
   downward and seeding a build constant at 33,699. Re-measured here: artifact **46,781**,
   socket.io prefix **13,085**, widget alone **34,063** — the table above was already right.
   `s06a` seeds `MAX_WIDGET_GZ` at **34,063**.

### Five stories re-scored to complexity 5 — split, per the scale's own rule

| Story | Was | Now | Split into | Cut line |
|---|---|---|---|---|
| `s06-embed-budget-gate` | 4 | **5** | `s06a-embed-byte-gate` (2), `s06b-embed-fixture-harness` (3), `s06c-embed-shrink` (4) | Gate vs. safety net vs. the shrink itself |
| `s07-realtime-service` | 4 | **5** | `s07a-realtime-service-hardening` (4), `s07b-realtime-deploy` (4) | Local vs. deployed |
| `s11-ab-run-test` | 4 | **5** | `s11a-ab-data-plane` (4), `s11b-ab-surface` (4), `s11c-ab-variant-delivery` (4) | Data plane vs. surface vs. delivery |
| `s13-agency-plan` | 4 | **4** + new | `s13-agency-plan` (4, AC 1-7+9), `s20-agency-branded-subdomain` (4, AC 8 alone) | Exactly at AC 8 |
| `s14-agency-client-handoff` | 4 | **5** | `s14a-grant-authorized-editing` (4), `s14b-multi-site-grants` (3), `s14c-cross-site-edit-activity` (3) | Single-site security floor vs. plural vs. the cross-site view |

Other re-scores, no split required: `s03` 3→**4**, `s05` 2→**3**, `s16` 3→**4**.
`s02` 3, `s08` 4, `s09` 4, `s10` 3, `s12` 4, `s15` 3, `s17` 3, `s18` 3, `s19` 2 all confirmed.

**`s06a` alone unblocks `s08`, `s09` and `s11c`** — they need a ceiling to test their byte
allowance against, which a gate answers and a shrink does not. The `s06 → …` edges become
`s06a → …`; `s07 → s08` becomes `s07b → s08`.

### Open majors from `reviews/stories.md`, settled by research

**M2 — `s09` ↔ `s12` data models. Resolved: drop the `s09` edge from `s12`.**
`s09` and `s12` were researched independently and reached the same verdict. `s12` needs to prove
a click and an impression happened *in the same page view*; that needs a shared key. `s09` AC 9
forbids every candidate ("no per-visitor identifier is stored", aggregate counts only) — by
construction there is no join column, and adding one repeals the criterion that keeps the
feature out of GDPR consent scope. The join is also unnecessary: the widget already emits
per-visitor `view` / `click` / `conversion` events carrying `visitor_id`, `test_id`, `variant_id`
(`public/embed/recopyfast.src.js:3096-3161`, `rcf_vid` cookie at `:2956-2976`) into
`ab_test_results` (`visitor_id NOT NULL`), and `/api/ab-tests/[testId]/results` already computes
per-variant views and conversions from it. **`s12`'s conversion is defined over that stream.**
Its `s09` dependency is removed below. One caveat both reports raise: *"same page view"* is
currently unrepresentable anywhere — `session_id` exists on `ab_test_results` but nothing ever
sets it — so `s12` must mint a page-view key or reword. That is `s12`'s open question.

**M3 — `s11`'s anti-flicker criterion. Resolved: not achievable as written; replaced.**
Three independent facts defeat "variant applied before first paint": the snippet is pasted
before `</body>` (`HowItWorks.tsx:32`), `init()` awaits `DOMContentLoaded` first
(`recopyfast.src.js:868`, `:2321-2329`), and three sequential fetches separate that from
`applyVariants()` (`:896`, `:901`, `:902`, `:903`). No change confined to this story can fix it.
Replaced by a measured swap-window criterion in `s11c`, whose main lever is folding the active
test set and the visitor's assignment into the existing `GET /api/content/:siteId` response —
which also makes "a no-test site issues zero extra requests" true.

**M4 — `s13`'s branded subdomain. Resolved: split to `s20`.** A tenant-scoped serving origin
threads through three snippet call sites, the content route's CORS grant, the CSP, the
auth-redirect resolver and the Stripe return-URL builder, and needs wildcard DNS and a wildcard
certificate. It is a second axis, not a ninth criterion — and every issued subdomain inherits
the permanent-URL promise, so it is irreversible in a way the billing half is not.

**M5 — who owns revocation-over-WebSocket. Resolved: the socket half moves to `s07a`.**
The defect is server-side and live today: `server/index.js:386-405` resolves permissions once at
handshake and caches them on `socket.data`; `:527` reads that cache on every `content-update`;
nothing re-reads `site_editors`. `s08` replaces only the *client* library, so putting the
criterion there would leave the Socket.io dashboard path uncovered. The HTTP half stays with the
grant story (`s14a`) where it is already true and only needs a test.

**Also found, not previously known:** `server/index.js:541-586` writes `content_elements` and
inserts `staging_history` directly over the socket. That is a straight violation of
[ADR 004](./decisions/004-embed-transport-split.md) rule 1 — *HTTP stays authoritative; realtime
broadcasts, it never becomes a second write path*. `s07a` enforces rule 1, which collapses the
revocation problem from "a revoked editor can still save" to "a revoked editor can still receive
broadcasts" — a disclosure issue, not a defacement.

### Blocking open questions, unchanged by research

- **Who is billed in agency mode** — agency only, or agency with client-paid upgrades? PRD open
  decision 7. `s13` assumes agency-only, single invoice. It changes the data model. Must be
  answered before `s13` reaches `/ks-plan`.
- **`npm run check:stripe` is test-mode only** and can pass vacuously — `s13` AC 9 as written
  cannot be satisfied by the command it names.
- **`s19`'s CTA targets trial signup, which is `s01`.** `s19` declares only `s17` as a
  dependency. That edge is missing.

### Resulting backlog — 27 stories

`s01` · `s02` · `s03` · `s04` · `s05` · **`s06a` `s06b` `s06c`** · **`s07a` `s07b`** · `s08` ·
`s09` · `s10` · **`s11a` `s11b` `s11c`** · `s12` · `s13` · **`s14a` `s14b` `s14c`** · `s15` ·
`s16` · `s17` · `s18` · `s19` · **`s20`**

Each split story's scope, criteria and rationale live in its parent's research report under
`## Split proposal`. The split stories inherit their parent's research; they were not
re-researched, because the research covered the parent's whole scope.

---

## Story s01-trial-signup — 14-day Pro trial without a card

**As a** web agency evaluating RecopyFast **I want** to use the full product for 14 days
without entering a card **so that** I can prove it works on a real client site before
asking anyone to pay.

### Complexity
4 — billing, entitlements and quota enforcement.

**Risk:** this story edits the single function every authorization gate calls. A defect in
`getEffectivePlan` does not fail loudly in one feature — it silently grants or denies
across the whole product, including on accounts that are paying.

### Acceptance criteria
- [ ] A new account, immediately after email confirmation, has Pro-level entitlements with no Stripe customer and no payment method in existence.
- [ ] `getEffectivePlan` returns an entitled result for a trialling account whose limits equal the `pro` plan's limits.
- [ ] The trial expires 14 days after confirmation; the same account then resolves to unentitled and site/editor creation is refused with `upgradeRequired: true`.
- [ ] After expiry, content stays readable and the installed embed keeps serving current content — expiry blocks writes and new resources, never public content delivery.
- [ ] Subscribing during the trial converts without a gap: no request observes an unentitled state at any point during checkout.
- [ ] An account that has trialled cannot start a second trial, including after deleting and recreating its sites.
- [ ] The dashboard shows days remaining, and an expired state with a single upgrade action.
- [ ] AI features during the trial draw on a granted trial credit allowance and stop at zero — a trial never grants uncapped OpenAI spend.

### Dependencies
None.

### Agentic notes
- Core files: `src/lib/billing/entitlements.ts` (`getEffectivePlan` — the chokepoint),
  `src/lib/feature-gating/permissions.ts`, `src/lib/stripe/plans.ts`,
  `src/lib/credits/system.ts`.
- **Do not add a `trial` plan row.** The catalogue is DB-driven and Stripe-mirrored; a plan
  with no Stripe price breaks `resolveStripePriceId` and the public pricing feed. Model the
  trial as a **time-boxed grant of the existing `pro` plan** — the mechanism `lifetime_pro`
  already uses via `grants_plan_id` (`plans.ts:462`). Read how lifetime entitlements
  resolve before writing anything.
- `permissions.ts:21` states there is no free tier to fall through to. Update that comment;
  a stale one there will mislead the next agent working on gates.
- **Trap — clock source.** Expiry must be computed server-side from a stored timestamp,
  never from a client-supplied date. Trial expiry is an authorization boundary.
- **Trap — the flicker.** `checkout-reservation.ts` and `user-lock.ts` already serialize
  checkout. Conversion must run inside that same lock, or a concurrent request mid-conversion
  observes neither trial nor subscription.
- Target reference: CloudCannon offers a 14-day trial with no card; TinaCMS gates on a free
  tier instead. We match CloudCannon — PRD decisions log, item 1.

---

## Story s02-install-verified — the site turns green by itself when the script is live

**As a** site owner who just pasted the snippet **I want** the dashboard to confirm by
itself that it can see my site **so that** I know the install worked without asking anyone.

### Complexity
3 — business logic across several states, no new integrations.

### Acceptance criteria
- [ ] A registered site starts in an explicit `awaiting-install` state, visibly distinct from `live`.
- [ ] The first authenticated content report from the embed on the registered domain flips the site to `live` with no user action.
- [ ] The dashboard reflects the flip within 10 seconds while the page stays open — no manual refresh.
- [ ] A report from a domain other than the registered one does not verify the site and is recorded as a mismatch.
- [ ] The `awaiting-install` state shows the snippet, a copy control, and the install location for WordPress, Next.js and plain HTML.
- [ ] Install recipes are stored as typed data in one module, and both this state and `s18`'s public pages render from it — this story owns that module.
- [ ] A site that was live and has reported nothing for a configurable window shows as `stale`, and `stale` never blocks content delivery or editing.
- [ ] State and transition timestamps are readable via the sites API, so `s03` can consume them.

### Dependencies
None. **Owns the install-recipe data consumed by `s18`.**

### Agentic notes
- Existing: `src/components/dashboard/DomainVerification.tsx` (live, rendered at
  `SiteDetailView.tsx:369`), `src/app/api/domains/verify/route.ts`,
  `src/app/api/sites/[siteId]/route.ts`.
- **First-contact signal is `POST /api/content/:siteId`,** reached via `postContentMap()`
  at `recopyfast.src.js:2853` and `:2924`. An earlier revision of this story named
  `/api/analytics/track` — the embed never calls it. Verified: grepping the widget for
  `analytics/track` and `page_view` returns nothing.
- A partial version of this already exists: `SiteDetailView.tsx:91` computes
  `hasReportedContent` from `site.stats.content_elements_count > 0`. That is a derived
  count, not a state machine and not a timestamp — this story replaces it with both.
- Authorization exists in `src/lib/security/ingest-auth.ts`. Reuse `authorizeIngestRequest`;
  do not write a new auth path for a status transition.
- **Trap — origin trust.** `src/lib/security/site-auth.ts` already resolves and validates
  request origin, including the localhost case its comments document. Use that resolution,
  not a raw `Referer`.
- **Trap — stale must be advisory.** A low-traffic customer will go quiet. Marking them
  stale is a nudge; blocking them would take their site down.
- Target reference: CloudCannon's site-connection status. TinaCMS has no equivalent because
  its install is a repo change, not a paste — worth making visible.

---

## Story s03-activation-funnel — measure time-to-first-edit

**As the** operator of RecopyFast **I want** the signup → first-edit funnel instrumented
**so that** I can tell whether the product's primary claim is true.

### Complexity
3 — read models and event plumbing over existing data.

### Acceptance criteria
- [ ] Four timestamps persist per account: account confirmed, first site registered, first verified install, first persisted content update.
- [ ] Time-to-first-edit is queryable as p50 and p90 over an arbitrary date range.
- [ ] Step-to-step drop-off is queryable: how many accounts reached each of the four steps.
- [ ] Each timestamp is written exactly once per account and is never overwritten by a later event, asserted by a test that replays a duplicate event.
- [ ] Accounts that predate this story are marked `unmeasurable` and are excluded from p50/p90, and a test asserts an unmeasurable account contributes to no percentile.
- [ ] Edits by non-account grant holders are attributed to the site's owning account, and are separately countable as non-account edits.
- [ ] The funnel is readable at `/dashboard/analytics` without running SQL by hand.
- [ ] This story's `account_milestones` table is the single source for account-level edit activity; `s14` and `s15` read from it rather than re-aggregating the activity log.

### Dependencies
`s01-trial-signup` (defines account start), `s02-install-verified` (defines the install step).

### Agentic notes
- Existing: `src/lib/analytics/tracker.ts`, `src/app/api/analytics/track/route.ts`,
  `src/app/api/analytics/performance/route.ts`, `src/app/dashboard/analytics/page.tsx`.
- The PRD names time-to-first-edit < 5 min the **primary success metric**. It is not
  instrumented — confirmed, no milestone table across the 43 files in
  `supabase/migrations/`. Until this ships, every activation claim is unfalsifiable.
- Model as a narrow `account_milestones` table with nullable timestamps and a write-once
  constraint, not as a scan over the activity log. The activity log is high-volume and will
  be pruned; milestones must survive pruning.
- **Trap — non-account edits.** The angle predicts ≥ 50% of edits come from grant holders
  with no account. Attribution keyed on `user_id` makes those edits vanish and the metric
  read as failure. Key on site ownership.
- `tracker.ts` has two dead locals (`siteAnalytics`, `date`) flagged by lint; clean them
  while in the file.

---

## Story s04-retire-graveyard-surfaces — a dashboard and an editor with only what I use

**As a** site owner **I want** to be shown only features I can actually use **so that** I am
not asked to understand an org chart, or given a way to restyle my site by accident.

### Complexity
2 — routing, navigation and removing two widget tabs.

### Acceptance criteria
- [ ] "Teams" is absent from the dashboard navigation.
- [ ] `/dashboard/teams` redirects to the site sharing surface — not a 404, not a broken page.
- [ ] No dashboard route renders `TeamSelector`, `InvitationManager`, `NotificationCenter` or `SecurityDashboard`.
- [ ] The embed widget's Edit Board no longer renders the **Styles** and **Themes** tabs; the remaining tabs are Elements, Languages and History.
- [ ] The widget makes no request to `/edit-board/styles/apply` or `/edit-board/themes`.
- [ ] Per-element typography and colour controls in the floating editor toolbar still work — this story does not touch them.
- [ ] `/api/teams/*`, `/api/notifications`, `/api/security/*`, `/api/audit/*`, `/api/edit-board/styles/apply` and `/api/edit-board/themes` all respond exactly as before, and their existing tests pass unchanged.
- [ ] Email invitation to edit a site is unaffected and remains reachable.

### Dependencies
None.

### Agentic notes
- Dashboard side: `src/components/dashboard/DashboardNavigation.tsx:59-60` (the Teams
  entry), `src/app/dashboard/teams/page.tsx`. The four components above are already imported
  nowhere but their own files and `src/__tests__/integration/collaboration.test.tsx` —
  verified. This removes the last dashboard entry point.
- **Widget side — the part the first revision of this file missed.** The Edit Board's tab
  list at `public/embed/recopyfast.src.js:5454-5460` ships five tabs, two of which are the
  PRD graveyard's site-wide style editor verbatim: `styles` → `:5726`
  `fetch(RECOPYFAST_API + '/edit-board/styles/apply')`, and `themes` → `:6028, :6129, :6159`
  `fetch(RECOPYFAST_API + '/edit-board/themes')`. This runs on **every customer site**,
  which is precisely the surface the graveyard rule exists for.
- **Do not delete API routes or their tests.** Frozen means unexposed, not deleted. A
  deletion is unrecoverable scope loss if an agency later asks for real teams.
- Precedent: `src/app/dashboard/_ab-tests/` — the underscore prefix makes a route private
  without deleting it, and `DashboardNavigation.tsx:49-51` documents why. Same reversible
  technique; this story additionally needs a redirect so bookmarks land somewhere sane.
- Remember the widget is a built artifact: edit `recopyfast.src.js`, never `recopyfast.js`,
  then rebuild.

---

## Story s05-bulk-content-portability — get my content out, and back in

**As a** site owner **I want** to export all my content and re-import it **so that** my copy
is mine and switching away from RecopyFast is never a hostage situation.

### Complexity
2 — form, persistence and list over API routes that already exist and are tested.

### Acceptance criteria
- [ ] A control in the dashboard exports one site's content elements as CSV and as JSON.
- [ ] The export includes element id, selector, current content, language and variant.
- [ ] An exported file re-imported unchanged produces zero content differences, asserted by a round-trip test.
- [ ] Import reports per-row outcomes — created, updated, skipped, failed with a reason — and a malformed row fails that row alone without aborting the import.
- [ ] Import refuses a file targeting a site the caller has no permission on.
- [ ] Import of a file larger than a stated size limit is refused before parsing.
- [ ] Imported changes appear in version history as normal, revertible edits.

### Dependencies
None.

### Agentic notes
- **This is a dark feature.** `src/app/api/bulk/{import,export,update}/route.ts` exist and
  are tested (`src/__tests__/api/bulk/*`). Their only caller,
  `src/components/dashboard/BulkOperations.tsx`, is imported by **nothing** — grep across
  `src/app/` returns no matches. There is no export control anywhere a user can reach.
- Start from `BulkOperations.tsx` rather than rewriting: the work is wiring, permission
  checks and the round-trip guarantee, not new endpoints.
- The PRD scores this feature 2 and calls it the item that *"kills the lock-in objection in
  the sales call"*. Its parity criterion is explicitly scoped to *"a stranger, unaided"* —
  an endpoint with no UI does not satisfy it.
- `BulkOperations.tsx` has three lint warnings (unused `sites`, unused `_`, a missing
  `fetchOperations` dependency); fix them while wiring it up.
- **Trap — import is a content write.** Route it through the same path as a human edit so
  version history, staging state and webhooks all behave normally. A direct database write
  bypasses all three.
- Target reference: both TinaCMS (git — content is already the customer's) and CloudCannon
  (source-file export) make portability trivially true. We have to demonstrate it.

---

## Story s06-embed-budget-gate — measure the widget, enforce a ceiling, shrink it

**As a** site owner **I want** RecopyFast to not slow my site down **so that** installing it
never costs me search ranking or visitors.

### Complexity
4 — no new integrations, but it touches the whole widget and regressions are invisible
until a customer's Core Web Vitals move.

**Risk:** aggressive minification or dead-code removal on a 5,397-line widget can drop a
branch that only fires on a customer's DOM shape. The embed has no error surface on the
host page by design, so a broken branch will not page us — it will present as "editing
stopped working on one site".

### Acceptance criteria
- [ ] `scripts/build-embed.mjs` measures and prints the gzipped size of the artifact and of the widget code alone, excluding the concatenated transport library.
- [ ] The build fails when the artifact exceeds a declared ceiling, and the ceiling is a committed constant.
- [ ] The ceiling is set to today's measured size on the first commit, then lowered — the gate ratchets and never regresses.
- [ ] Widget code alone is ≤ 24,000 bytes gzipped on completion (from 34,063 today).
- [ ] The existing `--check` stale-artifact detection still works.
- [ ] The full embed test suite passes unchanged — no test is modified to accommodate a size change.
- [ ] Editing, publishing, staging, history, languages and image replacement each still work against a real fixture page after the shrink.
- [ ] The widget contributes 0 to the host page's Cumulative Layout Shift.

### Dependencies
None. **Gates `s08`, `s09` and `s11`.**

### Agentic notes
- Measured on this revision, and these are measurements not estimates:
  `recopyfast.js` **46,781** gz, of which `socket.io-client` **13,085** and widget code
  **34,063**. Budget is 30,000 ([`architecture.md` → The embed widget](./architecture.md#the-embed-widget)).
  **Removing socket.io alone does not reach budget** — hence this story exists separately
  from `s08`.
- Reproduce with `gzip -9c public/embed/recopyfast.js | wc -c`; isolate the widget by
  removing the `socket.io-client.min.js` prefix that `build-embed.mjs:225` concatenates.
- Files: `scripts/build-embed.mjs`, `public/embed/recopyfast.src.js` (source of truth —
  never hand-edit the output), `src/lib/editingRules.core.ts` (spliced in at the inject
  markers; leave that mechanism intact).
- Where the bytes likely are: five Edit Board tab implementations, inline CSS strings, and
  duplicated DOM-building helpers. `s04` removes two of those tabs — **sequence `s04` first
  if both are in flight**, since it deletes code this story would otherwise spend effort
  minifying.
- **Trap — the artifact is a public URL.** `/embed/recopyfast.js` is baked into every
  snippet already issued. It must keep working for existing installs.
- Target reference: TinaCMS ships no third-party runtime at all — it is build-time. Being
  slower than a competitor that adds zero bytes is not survivable.

---

## Story s07-realtime-service — turn real-time on

**As a** site owner **I want** my edits to appear immediately for anyone else looking at the
page **so that** working with my agency on a page feels like one shared surface.

### Complexity
4 — external system: a second deployed service, its own configuration, its own uptime.

**Risk:** this stands up a service the product has been running without. Everything
currently works over HTTP; enabling a second write path introduces ordering and
consistency questions that do not exist today. It must be provably additive — if the
WebSocket service is down, editing must continue exactly as it does now.

### Acceptance criteria
- [ ] `server/index.js` is deployed and reachable at a stable origin, with a documented deploy procedure.
- [ ] `NEXT_PUBLIC_WS_URL` is set in production, and newly issued snippets carry `data-ws-url`.
- [ ] The health endpoint reports the service up, and its status is visible alongside the app's existing health checks.
- [ ] An edit made in one browser appears in a second browser viewing the same page in under 1 second — the PRD's real-time parity criterion, demonstrated against a fixture page on a non-RecopyFast domain.
- [ ] With the WebSocket service stopped, editing, saving, staging and publishing all still work over HTTP with no user-visible error.
- [ ] A site whose snippet predates this story — no `data-ws-url` — keeps working unchanged.
- [ ] Two editors changing different elements on one page both persist; neither overwrites the other.
- [ ] Socket connections are authorized per site, and a connection cannot join a site room it has no grant or permission for.

### Dependencies
None. **Gates `s08`.**

### Agentic notes
- **The PRD calls real-time sync "the demo" and scores it 5. It is off.** Evidence:
  `src/lib/sites/embed-script.ts:63-81` — `getPublicWebSocketUrl()` returns `""` unless
  `NEXT_PUBLIC_WS_URL` is set; `:93-96` then omits `data-ws-url` entirely.
  `public/embed/recopyfast.src.js:2703-2705` — `if (!RECOPYFAST_WS) { return; }`, commented
  *"nothing is listening: server/index.js is a separate Express process that Vercel cannot
  host."* `:2801-2821` — `sendContentMap()` reports over HTTP because *"`this.socket` is
  null on every real install."* `docs/quality/qa-register.md:83-86` records
  `NEXT_PUBLIC_WS_URL` being removed from production.
- Deploy assets exist but were never used: `server/Dockerfile`, `server/fly.toml` — the
  latter still reads `app = "recopyfast-ws"   # change to your chosen Fly app name` at
  line 22. Vercel cannot host a long-lived Express process; Fly, Railway or Render can.
- Redis is already a dependency and is the intended pub/sub layer for running more than one
  instance. One instance is acceptable to start; say so explicitly rather than assuming it.
- **Trap — the HTTP path must remain authoritative.** Content is persisted over HTTP today.
  Real-time should broadcast, not become a second source of truth. If both write, they will
  disagree.
- **Trap — CORS and origin.** The service accepts connections from arbitrary customer
  domains. Reuse the origin validation in `src/lib/security/site-auth.ts` rather than the
  permissive default in `server/index.js`; commit `3099c07` already tightened edit-board
  CORS and this must not regress it.
- Existing tests: `src/__tests__/websocket/server.test.ts`.

---

## Story s08-embed-transport — real-time without the 13KB

**As a** site owner **I want** real-time editing that does not cost my visitors a payload
**so that** I get the feature without paying for it on every page load.

### Complexity
4 — a new wire protocol and hand-written reconnection, on top of a service that `s07` has
already proven works.

**Risk:** the failure mode is silent and environment-specific. A transport that works in
development and on our own domain can fail only on customers serving a restrictive CSP —
the exact customers least likely to file a useful bug report.

Scored 4 rather than 5 because `s07` supplies the running service and `s06` supplies the
byte gate; what remains is replacing a client library on a system that already works.

### Acceptance criteria
- [ ] `public/embed/recopyfast.js` is ≤ 30,000 bytes gzipped, enforced by `s06`'s build gate.
- [ ] The widget contains no bundled socket.io client.
- [ ] A page with the script installed and no editing session open opens zero WebSocket connections.
- [ ] Entering edit mode establishes sync, and the two-browser under-1-second criterion from `s07` still passes.
- [ ] Sync works on a host page served with `Content-Security-Policy: script-src 'self'`.
- [ ] On a host page served with `connect-src 'self'`, the widget degrades to the HTTP path, logs one explicit console warning, and editing still works — a silent failure fails this criterion.
- [ ] A dropped connection reconnects with jittered exponential backoff, capped, and a server restart does not end an open editing session.
- [ ] No uncaught exception reaches the host page's window under any of the above.

### Dependencies
`s07-realtime-service`, `s06-embed-budget-gate`.

### Agentic notes
- Approach: **speak plain WebSocket from the widget.** Native `WebSocket` costs zero bytes.
  Add a plain-WS endpoint to the `server/` service for embed clients and keep socket.io for
  the first-party dashboard, where CSP is ours and not a constraint. The embed↔server
  protocol is three messages: `content-map`, `content-update`, `join`.
- **Read `scripts/build-embed.mjs`'s header before proposing anything else.** It records why
  socket.io was inlined: the widget used to pull it from `cdn.socket.io`, which any site
  serving `script-src 'self'` blocks outright, killing real-time editing.
- **The obvious alternative is wrong.** Lazy-loading `/embed/socket.io-client.min.js` from
  our origin fails on exactly those `script-src 'self'` customers, because our origin is not
  their `'self'`. It reintroduces the original bug in a form that passes local testing.
  `recopyfast.src.js:64` already derives that URL from the script URL — the trap is live.
- **Trap — reconnection.** socket.io provides reconnection with backoff for free. Native
  `WebSocket` does not. Write it explicitly, with jitter, or a deploy silently ends every
  open editing session.
- **Trap — protocol versioning.** Old snippets may still carry a socket.io `data-ws-url`.
  The server must handle both, or version the endpoint path.

---

## Story s09-section-impressions — see which sections people actually look at

**As a** marketer on Pro **I want** to see how many people actually saw each section of my
page **so that** I edit the copy that is being read instead of guessing.

### Complexity
4 — high-volume ingest plus third-party runtime work.

**Risk:** impression events are orders of magnitude more numerous than edit events. An
unbatched, unsampled implementation generates ingest volume that costs more than the plan
it gates.

### Acceptance criteria
- [ ] The widget records an impression for a tracked section when ≥ 50% of it has been in the viewport for ≥ 1 continuous second.
- [ ] A section scrolled past in under 1 second records no impression.
- [ ] A section that leaves and re-enters the viewport within one page view records exactly one impression.
- [ ] Impressions batch and flush on `visibilitychange` and on unload; a visitor closing the tab immediately after scrolling still has their impressions recorded.
- [ ] Impression ingest requires a valid site token — no unauthenticated write path.
- [ ] Impression counts per section appear in the dashboard next to that section's current text.
- [ ] Entitled Pro and trialling accounts see counts; unentitled accounts see an upgrade prompt and the widget sends no impression events for them.
- [ ] Impression code adds ≤ 2,000 bytes gzipped to the widget, and the total stays ≤ 30,000.
- [ ] Do Not Track is respected, and no per-visitor identifier is stored.

### Dependencies
`s06-embed-budget-gate`, `s01-trial-signup` (defines who is entitled).

### Agentic notes
- **No impression tracking exists.** `IntersectionObserver` appears nowhere in
  `public/embed/` — it does appear elsewhere in the repo
  (`src/components/landing/InteractiveHero.tsx:518`,
  `src/components/three/sky/SkyBackground.tsx:235`, `public/demo-site/scripts.js:66,207`),
  so a repo-wide grep will mislead. `analytics/track` accepts only `page_view`,
  `content_edit`, `login`, `logout`, `api_call` (`route.ts:29-35`).
- **`jest.setup.js:177-178` mocks `IntersectionObserver` globally** with a no-op `observe`.
  Tests for this story must supply their own controllable mock, or every impression
  assertion will pass vacuously.
- This is angle 4 of 5 in the PRD and the stated reason Pro exists. Neither TinaCMS nor
  CloudCannon has an equivalent — **there is no reference implementation to copy.**
- Do not extend `/api/analytics/track`. It writes one row per event into the activity log;
  impressions need their own batched endpoint writing pre-aggregated counts, or the activity
  log becomes the bottleneck for everything else including `s03`'s milestones.
- Reuse `authorizeIngestRequest` and `src/lib/api/rate-limit.ts`, but size the limits for
  impression volume — an existing limit applied unchanged will drop real data.
- A "section" is an already-mapped content element. Reuse `content_elements.element_id` and
  the existing `computeStableElementId`; do not invent a second identity scheme.
- **Trap — SPA route changes.** Impressions reset per logical page view, and a client-side
  route change is a new page view with no page load to hook. `MutationObserver` already
  handles DOM churn for editing — follow that pattern.
- **Trap — privacy.** No cookie, no fingerprint, no visitor id. Aggregate counts only. This
  keeps the feature out of GDPR consent scope, itself a selling point for the European
  local-business segment.

---

## Story s10-impression-history — impressions over time, and what changed

**As a** marketer **I want** a section's impressions over time alongside when its copy
changed **so that** I can tell whether my edit did anything.

### Complexity
3 — aggregation and read models over data `s09` already collects.

### Acceptance criteria
- [ ] Per-section impressions are queryable by day over a 90-day window.
- [ ] The timeline marks points at which that section's content changed, sourced from existing version history.
- [ ] Raw impression events older than the retention window are pruned by a scheduled job, and pruning never removes daily aggregates.
- [ ] Aggregation is idempotent: running it twice over the same period produces identical totals.
- [ ] A section with zero impressions shows as zero, distinct from "not tracked".
- [ ] Retention window and the aggregation timezone are documented configuration values, not literals in code.

### Dependencies
`s09-section-impressions`.

### Agentic notes
- Version history exists: `src/app/api/edit-board/history/route.ts`,
  `src/components/dashboard/VersionHistoryPanel.tsx` (live, rendered at
  `SiteDetailView.tsx:374`). Join against it; do not record a second edit timeline.
- Aggregate on write into daily buckets. Read-time aggregation over raw impressions will not
  survive the first customer with real traffic.
- **Trap — timezone.** "Per day" must be defined in one timezone and stated in the schema. A
  bucket boundary that shifts with the viewer's locale makes totals irreproducible.
- PRD metric served: ≥ 40% of Pro accounts make at least one impression-informed edit —
  measurable only once edit and impression share a timeline.

---

## Story s11-ab-run-test — run an A/B test on a section

**As a** marketer on Pro **I want** to test two versions of a headline against real traffic
**so that** I ship the one that performs instead of the one I prefer.

### Complexity
4 — traffic bucketing inside a third-party runtime, with correctness that is hard to observe
after the fact.

**Risk:** a bucketing bug is silent. Visitors get served variants, numbers accumulate, and
the results are wrong with no error anywhere. The bucketing function needs tests before it
needs a UI.

### Acceptance criteria
- [ ] `/dashboard/ab-tests` is a live route, reachable from the navigation for entitled accounts.
- [ ] An owner can create a test on an existing content element with two or more text variants and a traffic split.
- [ ] A returning visitor is served the same variant on every visit for the test's duration — bucketing is deterministic from a stable input, never random per request.
- [ ] Over 10,000 simulated assignments, each bucket's share is within ±2 percentage points of its configured split, asserted in a unit test.
- [ ] A visitor to a site with no active test receives default content and the widget makes no additional network request.
- [ ] ~~Variant content is applied before first paint; a test asserts the original text is never painted when a variant is assigned.~~ **Withdrawn at research (M3) — not achievable for an async third-party script on a server-rendered host page.** Replaced in `s11c-ab-variant-delivery` by a measured swap-window criterion: the active-test set and the visitor's assignment fold into the existing `GET /api/content/:siteId` response, removing two sequential fetches from the widget's critical path, and the swap window is asserted against a stated budget rather than against "before first paint".
- [ ] Only one test can be active per content element; a second attempt is refused with a clear reason.
- [ ] Bucketing code adds ≤ 2,000 bytes gzipped to the widget, and the total stays ≤ 30,000.

### Dependencies
`s06-embed-budget-gate`, `s01-trial-signup` (entitlement).

### Agentic notes
- **This was built, then deliberately switched off.** Commit `2026-08-03`, *"feat: take A/B
  testing out of the launch, reversibly"*, renamed the route to
  `src/app/dashboard/_ab-tests/`; `DashboardNavigation.tsx:49-51` carries the matching
  comment. Read that commit first — the reasons it was parked may still apply in part.
- Built and dormant: `/api/ab-tests` (create/list), `/ab-tests/active/[siteId]`,
  `/ab-tests/bucket/[siteId]`, `/ab-tests/track`, `/ab-tests/generate`,
  `/ab-tests/[testId]/results`, `/api/cron/ab-test-lifecycle`, and
  `src/components/dashboard/ab-create/ABTestElementPicker.tsx`. The widget already calls
  `/ab-tests/{active,bucket,track}`. **Audit what works before writing anything** — much of
  this story is re-enabling and finishing.
- Commit `3099c07` closed unauthenticated A/B writes. Do not regress it: re-check that
  `bucket` and `track` require a site token.
- **Trap — flash of original content.** The host page renders its own HTML first. Swapping
  after paint is visible and will be reported as a bug by the customer's client. The
  criterion above requires solving it, not accepting it.
- **Trap — it runs on someone else's site.** A slow or failed bucket call must fall back to
  default content immediately and must never block the host page's render.
- Target reference: neither target offers A/B. Study Optimizely's and Mutiny's *anti-flicker
  and bucketing* behaviour — both are script-tag products with the same constraint.

---

## Story s12-ab-results — call the winner

**As a** marketer **I want** to see which variant won and have the test end by itself **so
that** I get a decision, not a spreadsheet.

### Complexity
4 — statistics that must not lie, plus scheduled lifecycle.

**Risk:** a wrong significance calculation does not error — it produces a confident,
plausible, incorrect recommendation, and the customer acts on it. This is the story where a
silent defect does the most commercial damage.

### Acceptance criteria
- [ ] Each variant's impressions and conversions are shown with the observed rate.
- [ ] A conversion is defined as a click on a tracked CTA within the same page view as an impression of the tested section, and that definition is documented in the UI.
- [ ] A winner is declared only at ≥ 95% confidence and ≥ 1,000 assignments per variant; below either threshold the result reads "inconclusive".
- [ ] The significance calculation is unit-tested against at least three known input/output pairs, including one that must not reach significance.
- [ ] No significance figure is displayed while a test is running and below the minimum sample — the UI shows progress toward the sample instead.
- [ ] The lifecycle cron ends tests at their configured end date and records the outcome.
- [ ] Ending a test promotes the winning variant to the element's live content, and that promotion appears in version history as a normal, revertible edit.
- [ ] A test ended while inconclusive keeps the original content and says so.
- [ ] The cron is idempotent: a duplicate run promotes nothing twice.

### Dependencies
`s11a-ab-data-plane`, `s11b-ab-surface`.

> **The `s09` edge was removed at research (M2).** `s09` stores anonymous aggregate counts with
> no per-visitor key, so it cannot supply the "same page view" join this story's conversion
> needs — and the widget's existing per-visitor A/B event stream already can. See
> "Revised after research" above and `docs/research/s12-ab-results.md`.

### Agentic notes
- Existing: `src/app/api/ab-tests/[testId]/results/route.ts`,
  `src/app/api/cron/ab-test-lifecycle/route.ts`.
- The conversion definition above resolves PRD open decision 6. It depends on `s09`'s
  observer, which is why `s09` is a declared dependency — an earlier revision of this
  backlog omitted that edge and the graph was not executable.
- **Trap — peeking.** Showing a running significance figure invites stopping the test the
  moment it looks good, which inflates false positives. The "no significance below minimum
  sample" criterion exists for this reason; do not relax it into a tooltip.
- **Trap — promotion is a content write.** Route it through the same path as a human edit so
  version history, staging state and webhooks behave normally. A direct database update
  silently bypasses all three.

---

## Story s13-agency-plan — one subscription for all my client sites

**As a** web agency **I want** a plan priced for many sites under one bill **so that** adding
a client site is a decision I make in seconds, not a purchase I justify.

### Complexity
4 — payments, quotas and catalogue changes on the live billing path.

**Risk:** this changes the plan catalogue, which is mirrored in Stripe and read by the
public pricing feed. A mismatch between the two shows up as a price changing at checkout —
the failure mode the codebase already removed a hardcoded fallback to prevent.

### Acceptance criteria
- [ ] An `agency` plan exists in the catalogue with its own site limit, editor limit and monthly credit allowance.
- [ ] The plan appears in the public pricing feed with live Stripe amounts, alongside existing plans.
- [ ] An agency account can create sites up to its limit, enforced by the existing site-count gate.
- [ ] Exceeding the limit offers additional sites at the plan's per-site price rather than a hard refusal, when `additional_site_price` is configured.
- [ ] Upgrading Pro → Agency preserves all sites, content and grants, and prorates through Stripe.
- [ ] Downgrading below the current site count is refused **before** the Stripe call, naming how many sites must be removed first.
- [ ] One invoice covers all sites on the account.
- [ ] An agency can serve its sites from a branded subdomain, and content delivered through it is identical to content delivered through the default origin.
- [ ] `npm run check:stripe` passes against the new plan in both test and live mode.

### Dependencies
`s01-trial-signup` (shares the entitlement resolution path).

### Agentic notes
- **The plan does not exist.** `src/lib/stripe/plans.ts:66-90` holds exactly `starter`,
  `pro`, `credits`, `lifetime_pro`. The PRD names agencies the primary buyer, which makes
  this the largest single gap in the product.
- The branded subdomain criterion is included because `prd.md:159-160` explicitly rules it
  **in** scope while ruling full white-label out. It was missing from the first revision.
- **Client sub-accounts are deliberately not in this story.** The PRD's pricing table names
  them, but implementing them means per-client identities with roles under one org — which
  is the graveyard's org-teams model returning under another name. `s14` delivers the same
  user value through scoped grants instead. Recorded in "Not stories, deliberately".
- The catalogue is DB-driven: `plans` is source of truth, Stripe price ids come from env via
  `PRICE_ID_ENV_VARS`. A new plan means a migration **and** new env vars in every
  environment. Use `scripts/sync-stripe-catalogue.mjs`.
- There is deliberately **no hardcoded fallback catalogue** — the header comment in
  `src/app/api/pricing/route.ts` records that a previous fallback silently served drifted
  prices. Do not add one.
- Site ownership is an `admin` row in `site_permissions`, not a column on `sites`. See
  `countOwnedSites` (`permissions.ts:79`) whose comment at `:150` records that a previous
  `sites.user_id` filter silently returned 0 and let every quota check pass. Count via the
  permissions table.
- Target reference: CloudCannon prices per site, which is exactly the pain this removes. The
  comparison page in `s17` should say so with real arithmetic.

---

## Story s14-agency-client-handoff — hand a client the keys to their own copy

**As a** web agency **I want** to invite each client to edit only their own site in one
action **so that** I can stop being the person who changes their phone number.

### Complexity
4 — permissions and expiry across many sites.

**Risk:** a leaked or over-scoped grant is a defacement of a customer's live site, performed
with our credentials, visible to their visitors. This is the highest-consequence security
surface in the backlog and the one the product's main angle depends on.

### Acceptance criteria
- [ ] An agency can invite an editor to a specific site by email from that site's view, in one action.
- [ ] The invited editor can edit only that site; reaching any other site on the account is refused.
- [ ] Invitations can be sent to several sites at once, each producing an independently scoped grant.
- [ ] Revoking a grant takes effect on the next request, and an open editing session cannot continue saving after revocation over HTTP. **(The "over an established WebSocket connection" half moved to `s07a-realtime-service-hardening` at research — M5. The defect is server-side and live: `server/index.js:386-405` caches permissions at handshake, `:527` reads that cache on every `content-update`, nothing re-reads `site_editors`. `s08` replaces only the client library, so the criterion cannot live there without leaving the Socket.io dashboard path uncovered.)**
- [ ] Grants expire on schedule, enforced server-side.
- [ ] The agency sees, per site, who holds a grant and when each expires.
- [ ] One view lists recent edits across all the agency's sites, showing site, editor and element, read from `s03`'s milestone and activity data.
- [ ] An expired or revoked link shows a clear message and a way to request a new one — never a stack trace or a blank page.
- [ ] The invite flow does not reveal whether an email already has an account.

### Dependencies
`s13-agency-plan`, `s03-activation-funnel` (owns the edit-activity read model).

### Agentic notes
- The single-site version works: `src/app/edit/EditorSignIn.tsx`,
  `/api/editor/{request-code,submit-code,handoff/create,handoff/redeem,refresh-grant,validate-grant}`,
  `/api/edit-sessions/*`, `src/components/dashboard/ShareSiteDialog.tsx`,
  `SiteEditorsCard.tsx`, and `rcf_handoff` in the widget with coverage in
  `src/__tests__/embed/handoff-roundtrip.test.ts`. This story makes it plural and adds the
  cross-site view.
- **This uses the grant model and touches no `/api/teams/*` route.** Stated explicitly
  because a cross-site activity view resembles the graveyard's "org activity". The
  distinction is real: grants are per-site and expiring, roles are per-org and persistent.
  Do not introduce a role.
- Prior hardening to preserve: `728b646` (hid site install credentials, restricted site
  delete), `aca2eb2` (last-admin revoke). Re-read both before touching permissions.
- **Trap — revocation and the open socket.** Once `s07`/`s08` land, revoking a grant must
  also terminate any live editing connection it holds. An HTTP-only check leaves a socket
  writing content after revocation.
- **Trap — enumeration.** A grant code must not be guessable, reusable across sites, or
  valid after redemption by someone else.
- Target reference: TinaCMS and CloudCannon both require the client to have an account. Not
  requiring one is the differentiator — protect it by keeping the grant genuinely narrow.

---

## Story s15-agency-digest — show the agency what it saved

**As a** web agency **I want** a monthly summary of what my clients changed themselves **so
that** the subscription justifies itself without me thinking about it.

### Complexity
3 — scheduled job, aggregation and email.

### Acceptance criteria
- [ ] A monthly email to each agency account reports edits per client site for the period, read from `s03`'s activity data.
- [ ] The email states a total edit count and an estimated time saved, and names the per-edit assumption used.
- [ ] An account with zero edits in the period receives no email.
- [ ] The digest is idempotent: what was sent is recorded before sending, and a re-run for the same period sends nothing twice.
- [ ] The email renders correctly as plain text, asserted by a test on the text part — no HTML tags, all links present as URLs.
- [ ] Recipients can unsubscribe from the digest without affecting transactional email.
- [ ] Send failures are logged with account and period, and are retryable without duplicating successful sends.

### Dependencies
`s14-agency-client-handoff`, `s03-activation-funnel`.

### Agentic notes
- Existing: `src/lib/email/`, Resend already a dependency, `src/app/api/cron/` holds the
  scheduled-job pattern, `vercel.json` carries cron configuration.
- The PRD's retention argument: a local business logs in around four times a year, so
  end-client MAU reads as catastrophic churn and means nothing. Retention lives with the
  agency, and this email makes value legible to the payer.
- **Be honest about time saved.** State the assumption in the email itself ("we count 10
  minutes per edit"). An invented figure presented as measurement loses an agency's trust
  permanently.
- **Trap — idempotency under retry.** Cron platforms retry. Record what was sent before
  sending, not after.

---

## Story s16-webhook-config — tell my system when content changes

**As a** developer running a static site **I want** RecopyFast to call my endpoint when
content changes **so that** my site rebuilds without me watching for it.

### Complexity
3 — outbound integration with delivery guarantees.

### Acceptance criteria
- [ ] An owner can configure a webhook URL per site and see recent delivery history.
- [ ] A content change delivers a signed POST, verifiable with a secret shown once at creation.
- [ ] A failed delivery retries with exponential backoff to a stated limit, then is marked failed and visible as such.
- [ ] Rapid successive edits are coalesced within a configurable window so a burst of edits does not trigger a burst of rebuilds; the default is stated in the UI.
- [ ] The URL is validated against SSRF — private, loopback and link-local addresses refused — at configuration time **and** again at delivery time.
- [ ] A slow or hanging endpoint times out and does not delay the edit that triggered it.
- [ ] Test delivery can be triggered manually from the dashboard.

### Dependencies
None.

### Agentic notes
- Existing: `/api/webhooks/route.ts`, `/api/webhooks/test/route.ts`, `src/lib/webhooks/`.
  Stripe's inbound webhook at `/api/webhooks/stripe` is a different concern — do not
  entangle them.
- `ipaddr.js@^2.2.0` is already a dependency and is the right tool for the SSRF check.
- **Trap — DNS rebinding.** Validating the hostname at configuration time is not enough;
  resolve and re-check the address at delivery time. Hence the two-point criterion.
- Target reference: CloudCannon's build hooks, TinaCMS's git-commit-triggered rebuilds. This
  is parity work that removes an objection from static-site customers — the target's core
  audience.

---

## Story s17-cluster-engine — comparison pages that rank

**As a** person searching "TinaCMS alternative" **I want** an honest comparison **so that** I
can tell in one screen whether this fits my site.

### Complexity
3 — content-driven routes with structured data and generated sitemap entries.

### Acceptance criteria
- [ ] `/alternatives/<competitor>` renders from structured content for at least tinacms, cloudcannon, contentful, storyblok and decap-cms.
- [ ] Each page states what the competitor does better, not only what we do better.
- [ ] Each page carries `SoftwareApplication`, `FAQPage` and `BreadcrumbList` JSON-LD that validates.
- [ ] Every generated page appears in `sitemap.ts` automatically — the sitemap is never hand-maintained.
- [ ] An unknown competitor slug returns 404, not an empty page.
- [ ] `llms.txt` is served and lists the comparison pages.
- [ ] Each page passes Core Web Vitals thresholds in a Lighthouse run in CI.
- [ ] Page content lives in typed, validated data, so adding a competitor requires no new route code.

### Dependencies
None. **Gates `s18` and `s19`.**

### Agentic notes
- Existing SEO surface: `src/app/sitemap.ts`, `robots.ts`, `blog/[slug]`,
  `opengraph-image.tsx`, `manifest.ts`. No cluster routes exist.
- This builds the **engine**; `s18` and `s19` are clusters riding on it. Build it so a new
  cluster is a data file plus a template, not a new subsystem.
- **The honesty requirement is a mechanism, not a value statement.** AI search surfaces cite
  comparisons that acknowledge trade-offs and skip pure marketing. The PRD's SEO plan depends
  on being cited, not only ranked.
- **Trap — thin content at scale.** Pages differing only by a swapped noun get demoted under
  the Helpful Content system, and the demotion is site-wide. Every page needs distinct
  substance.
- `cron/generate-blog-post` exists and can draft this content, but the PRD is explicit: **it
  drafts, a human publishes.** Do not wire auto-publish.

---

## Story s18-stack-recipes — a verified install page for my stack

**As a** developer with a site on some specific stack **I want** the exact snippet and the
exact place to paste it **so that** I am installed in a minute instead of guessing.

### Complexity
3 — content plus real verification work per stack.

### Acceptance criteria
- [ ] `/cms-for/<stack>` renders for at least wordpress, shopify, webflow, squarespace, framer, next-js, astro and plain-html.
- [ ] Each page renders from the install-recipe module `s02` owns — no second copy of the instructions exists.
- [ ] Each page names the exact file or admin location where the snippet goes for that stack.
- [ ] Each stack's snippet has been installed on a real instance of that stack and verified live, with evidence committed to the repository.
- [ ] Each page is reachable from the comparison cluster and appears in the sitemap.
- [ ] A stack where install is not actually possible is documented as unsupported rather than omitted silently.

### Dependencies
`s17-cluster-engine`, `s02-install-verified` (owns the recipe data).

### Agentic notes
- The PRD requires ≥ 8 stacks with a verified install recipe. This story produces that
  evidence.
- **Documentation and marketing at once.** `s02` owns the data; this story adds stacks and
  the public rendering. Two copies will drift, and a wrong install instruction is an
  activation failure.
- Verification is manual and cannot be faked — a screenshot or recorded check per stack,
  committed. "It should work" is not an acceptance criterion.
- Surface honestly per stack: sites rendering content client-side after our scan need the
  MutationObserver path, and some platform editors strip injected scripts. Where a stack is
  genuinely hostile, say so on the page.

---

## Story s19-audience-pages — pages for the people who actually buy

**As a** dentist or an agency owner **I want** a page that describes my situation **so that**
I recognise the product as being for me.

### Complexity
2 — content pages on the existing engine.

### Acceptance criteria
- [ ] `/for/<vertical>` renders for at least restaurants, dental-practices, law-firms and gyms.
- [ ] `/agencies/<use-case>` renders for at least client-content-updates and multi-site-management.
- [ ] Each vertical page names the content that actually changes for that business — hours, prices, menu, staff — not generic feature copy.
- [ ] Each page carries valid structured data and appears in the sitemap.
- [ ] Each page has one primary call to action leading to trial signup.
- [ ] No page duplicates another page's body content.

### Dependencies
`s17-cluster-engine`.

### Agentic notes
- Runs on `s17`'s engine. If this needs new route code, `s17` was built wrong — fix `s17`
  rather than special-casing here.
- The agency pages carry the PRD's wedge — *"stop doing free copy changes for your clients"*
  — and should use the real arithmetic from `s13`'s comparison against per-site pricing.
- Lowest complexity here and closest to the money. Last only because it depends on the
  engine.

---

## Not stories, deliberately

Recorded so a future agent does not mistake these for missing work. **Each "built" claim
below was verified against code during the story review, not assumed.**

**Built, reachable, and in production:** auth and accounts; site registration and snippet
generation; the embed runtime (scan, stable ids, MutationObserver); inline editing;
non-account email grants; content versioning and rollback; staging and publish; AI rewrite
via the widget's suggestion path; AI translate via the Edit Board Languages tab; image
replace; Stripe subscriptions, credits and entitlements; analytics dashboard and export;
public API v1 and API keys.

> Note on AI translate: `/api/ai/translate`'s only caller,
> `src/components/dashboard/TranslationDashboard.tsx`, is orphaned — but the feature ships
> through a different path (`/api/edit-board/languages` → `aiService.translateText`). It is
> delivered. Recorded so it is not re-raised as a gap.

**Was claimed built, actually was not — now stories:** real-time sync (`s07`, `s08`) and
bulk import/export (`s05`).

**Graveyard — frozen, not deleted.** Org teams and roles, audit console, security events
dashboard, notification centre, site-wide theme editor. `s04` removes their last live entry
points, in the dashboard **and** in the widget's Edit Board. Their API routes and tests stay.

**Client sub-accounts.** Named in the PRD's Agency pricing row, deliberately not built:
per-client identities with roles under one org is the graveyard's teams model under another
name. `s14` delivers the same value through scoped, expiring grants.

**Per-element typography and colour controls.** In scope and shipped. The graveyard entry
covers site-wide themes only.

**Free-forever tier.** Resolved against — the trial in `s01` is the answer.

**PRD SEO/GTM items with no story, by choice:** the "Edited with RecopyFast" badge (PRD open
decision 8, unresolved); the public embed perf-budget page (write it once `s06` produces a
number worth publishing); the two free public tools (content extractor, translate preview);
the agency partner directory and affiliate program. All are post-launch marketing, none
blocks a story.

**WordPress plugin.** The PRD's first post-launch investment. Belongs to the launch that
follows this backlog, not to it.
