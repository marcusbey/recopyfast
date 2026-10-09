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
| SPA support (`s67`), paid in-branch | ≤ +850 gross, net ≤ 0 |
| **Total ceiling** | **30,000** |

A row marked "paid in-branch" adds nothing to the total. Its gross bytes are funded by deletions
in the same branch, and both build ceilings then ratchet down to the size measured on that
branch.

`s67` is funded by three changes. Values are bundle / widget, `zlib` level 9, measured in
research.
- Build-time CSS minification of the five `style.textContent` literals: −494 / −525. This
  pre-empts part of `s06c-embed-shrink`.
- Deleting the unreachable socket.io fallback loader: −290 / −287.
- Deleting the `rcf-editable` class, which nothing reads: −28 / −29.

Together that is −812 / −841. If the branch is still over afterwards, the second-line reserve
is the uncalled `assessReadability` method plus `getEditingColors` (−41 / −38). PR #59 does not
spend those. If the branch is over even after the reserve, it stops and asks the owner, and the
ceilings never move up.

---

## Revised after research — 2026-08-16

All 19 stories were researched against the code (`docs/research/<id>.md`). Research is where a
false premise gets repaired, and it repaired several. **Ids are suffixed, never renumbered** —
the last renumbering broke four references in the PRD, two of which silently resolved to a
different real story. Every existing `s01`…`s19` reference below and elsewhere still resolves.

### Two research claims corrected by direct measurement

Research is evidence, not verdict. Two claims were checked and are wrong:

1. ~~**`ab_test_results` and `visitor_buckets` DO exist.**~~ — **THIS CORRECTION WAS ITSELF WRONG.
   Retracted 2026-08-17; `research/s11` was right.** The tables **do not exist**, and priced
   "a database repair" correctly.

   The error: I read `supabase/migrations/20260127_ab_testing_v2.sql:8` and `:40`, saw
   `CREATE TABLE`, found no `DROP`, and concluded the tables were created. **A migration file
   containing a `CREATE TABLE` is not evidence the table exists.** That migration **aborted in
   full** and is marked applied, so it will never run again — exactly the trap
   `20260801200000_missing_base_tables.sql` was written to document. Its tombstone says so
   directly (`:41-42`, `:64-68`):

   > `20260127_ab_testing_v2.sql`  CREATE TABLE ab_test_results / REFERENCES ab_tests → 42P01
   >
   > `ab_test_results` and `visitor_buckets` (20260127) were never created. The A/B pipeline
   > reads and writes both … so creating `ab_tests` here is necessary but not sufficient.

   Confirmed live during `s11a`'s fix run: both tables return `PGRST205` over PostgREST, while
   the error hints name other `public` tables — so the schema cache is populated and the absence
   is real, not a caching artifact.

   **Consequences.** The A/B data plane is dead in production and always has been:
   `src/app/api/ab-tests/track/route.ts`, `.../bucket/[siteId]/route.ts` and
   `src/lib/ab-testing/lifecycle.ts:43` all read or write tables that are not there. **Creating
   them is a scope decision, not a task** — `s11a`'s plan reserves it to the operator, and its
   Task 9 was withdrawn under that stop rule rather than shipping a migration that would abort
   and then be marked applied, reproducing the original scar.

   `research/s09` and `research/s12` cite the same migration and inherit the same error; both
   need re-checking against the live schema before `s09` or `s12` executes.

   **What still survives** from the original note: the file is named `20260127_ab_testing_v2.sql`
   — 8 digits where every other migration uses 14 (`YYYYMMDDHHMMSS`) — so its ledger ordering is
   not guaranteed. Real, and secondary to the fact that it never applied at all.
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

~~**`s06a` alone unblocks `s08`, `s09` and `s11c`** — they need a ceiling to test their byte
allowance against, which a gate answers and a shrink does not.~~ **Wrong, and exactly backwards.
Corrected after `s06a` shipped and was reviewed.**

`s06a` seeds its ceilings at *today's measured size* — the artifact sits at **exactly**
`MAX_BUNDLE_GZ` and `MAX_WIDGET_GZ`, with zero headroom, because seeding at the 30,000 budget
would make the build red the moment the gate landed. Combined with the rule the same story
establishes — *raising a ceiling is a defect, not a fix* — **any story that adds a widget byte
is red on arrival.** `s09` (≤2,000 gz) and `s11c` (≤2,000 gz) therefore do not become buildable
when `s06a` lands; they become *un*buildable, which is the opposite of what this paragraph
claimed.

The gate answers *"did this change fit?"*. It does not create room for a change to fit in.
**`s06c` (the shrink) is what unblocks the additive stories**, and `s04` already contributes by
deleting the retired Edit Board tabs. The real edges:

- `s06a → s06b → s06c`, and **`s06c → s09`, `s06c → s11c`** — not `s06a → …`.
- `s08` is different: it *removes* the 13,141-byte transport, so it is additive-negative and
  only needs the gate plus a deployed service. `s06a → s08` and `s07b → s08` both stand.
- `s07 → s08` becomes `s07b → s08`.

Found by the `s06a` review (finding F3), not by planning — the arithmetic only becomes visible
once the constants are real. Settle it before `s09` reaches `/ks-plan`.

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
- **Corrected at research — this note named the wrong table.** `VersionHistoryPanel` is live
  (`SiteDetailView.tsx:374`), but `/api/edit-board/history` reads `content_versions`, which is
  written **only** by the manual "Save Current Version" button. Joining it, as this note
  originally instructed, would produce a timeline with almost no markers. The always-populated
  log is `content_history` (DB trigger on every `content_elements` change). Settled in
  [ADR 009](./decisions/009-impression-history-change-timeline-source.md). Still join rather
  than record a second edit timeline — just join the right one.
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

## Story s14d-invited-editor-publish — let a scoped editor finish the job

**As an** invited site editor **I want** a Publish action when the owner granted publish
permission **so that** the copy I saved can actually reach visitors without asking the owner to
finish it for me.

### Complexity
2 — one existing widget surface and one already-authorized publish path, plus terminal-session
recovery on the same edit lifecycle.

**Risk:** exposing Publish to an edit-only grant bypasses the owner's permission boundary;
leaving stale credentials editable loses work and invites repeated requests that can never
succeed.

### Acceptance criteria
- [ ] A device grant containing `publish` or `admin` renders one accessible Publish control in the invited-editor banner; `view`-only and `edit`-only grants render none.
- [ ] Save remains a draft write: a fresh visitor keeps the prior published copy until Publish is explicitly confirmed.
- [ ] Publish uses the existing header-only device grant, sends no credential in the URL or body, and makes the saved draft visible to a fresh visitor.
- [ ] A grant is still pinned to its site: the same browser cannot open or publish to a second site that did not invite the address.
- [ ] A terminal 401/403 during Save preserves the typed draft in session storage and in the current DOM, disables further mutation controls, emits one non-blocking recovery state, and offers the correct owner-dashboard or editor-hub re-authentication path.
- [ ] A non-auth write failure stays retryable and does not get misclassified as an expired session.
- [ ] The generated embed artifact is rebuilt, remains within both gzip ceilings, and owner edit-session Publish behaviour is unchanged.
- [ ] A real cross-origin site proves invited-editor email code → handoff → save → Publish → fresh-visitor visibility, followed by restoration and revocation cleanup.

### Dependencies
`s14a-grant-authorized-editing`; uses the existing `X-RCF-Editor-Grant` principal and
`/api/staging/publish` authorization without adding a fourth auth path.

### Agentic notes
- Live production proof on 2026-09-19 found the exact gap: a View/Edit/Publish allowlist row and device grant enabled inline Save, but `showEditorBanner()` intentionally rendered no Publish control while `persistContentUpdate()` wrote `staging_content`; a fresh visitor stayed on the old copy.
- `showPublishConfirmation()` already sends `X-RCF-Editor-Grant` and the route already grades `publish`, so this is UI parity, not a new authorization model.
- Preserve the public widget contract: edit `public/embed/recopyfast.src.js`, rebuild `recopyfast.js`, never raise the byte ceiling, and never expose the grant in a URL, body, report, screenshot, or log.
- The earlier B-19 failure is still present in the same Save catch: native alerts repeat and edit controls remain live after terminal auth failure. Repair it in the shared edit lifecycle rather than adding a second invited-editor-only error path.

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

Route update (s37, 2026-09-25): reuse `/compare` and `/compare/*`; the former
`/alternatives/*` plan is superseded. s37 delivers four comparisons, not all of
this story's engine, discovery and performance acceptance criteria. See
[ADR 032](./decisions/032-comparison-routes-supersede-alternatives.md): s17 owns
the dynamic route migration, shared SoftwareApplication schema and Lighthouse
gate for `/compare` and all comparison detail URLs.

**As a** person searching "TinaCMS alternative" **I want** an honest comparison **so that** I
can tell in one screen whether this fits my site.

### Complexity
3 — content-driven routes with structured data and generated sitemap entries.

### Acceptance criteria
- [ ] `/compare/<competitor>` renders from structured content for at least tinacms, cloudcannon, contentful, storyblok and decap-cms.
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
- **`cron/generate-blog-post` already auto-publishes, today, daily.**
  `src/app/api/blog/generate/route.ts:275-282` inserts with `status: "published"` and
  `published_at: now()`, with no human review anywhere in the path, scheduled by `vercel.json`.
  The PRD's rule — *it drafts, a human publishes* — describes an intention the code does not
  implement. This story must not copy that route's pattern, and the existing behaviour is a
  live finding in its own right: auto-publishing AI content is what the PRD calls "the fastest
  route to a site-wide quality demotion", and at cluster scale it would apply site-wide.

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
- The agency pages carry the PRD's wedge — _"stop doing free copy changes for your clients"_
  — and should use the real arithmetic from `s13`'s comparison against per-site pricing.
- Lowest complexity here and closest to the money. Last only because it depends on the
  engine.

---

## Story s21-stripe-webhook-signing-secret — make live billing events verifiable again

**As the** ReCopyFast operator **I want** the deployed webhook secret to match the exact live
Stripe endpoint **so that** a paid Checkout event can provision access instead of retrying for
three days and expiring.

### Complexity

2 — redundant endpoint rotation, one production environment update, one redeploy and one
disposable live proof.

**Risk:** rotating the wrong endpoint or deleting the old endpoint before the new deployment is
ready creates a billing-event outage; exposing either signing secret turns a trusted boundary into
public data.

### Acceptance criteria

- [x] Live Stripe has exactly one enabled endpoint at `https://www.recopyfa.st/api/webhooks/stripe`, subscribed to the route's exact 13 handled event types.
- [x] The Vercel production value `STRIPE_WEBHOOK_SECRET_LIVE` is the write-only secret returned for that exact endpoint; no secret appears in source, shell output, logs, screenshots, review or PR text.
- [x] Recovery retains the old endpoint until the replacement processes a signed event; it does not claim uninterrupted delivery from the already-failing baseline.
- [x] A controlled live `customer.created` event reaches the deployed handler with valid signature, returns 2xx, records a processed billing-event row, and reaches `pending_webhooks = 0`.
- [x] A live $19 Pro Checkout Session reaches hosted Checkout but remains open/unpaid until payment; no subscription or entitlement is created before payment.
- [x] The disposable Checkout Session was expired and retained by Stripe; the test customer, billing rows and Auth user were deleted. Immutable session/event history is documented.
- [x] The operator guide names the canonical host, all 13 events, per-endpoint secret rule, rotation sequence, rollback point, and a real-delivery verification that cannot be replaced by an unsigned curl probe.

### Dependencies

None. This is inbound Stripe billing configuration, not the customer-configurable outbound webhook
feature in `s16-webhook-config`.

### Agentic notes

- On 2026-09-19 the endpoint URL and event list were correct, but a real live Checkout-created
  customer remained `pending_webhooks=1`; Vercel logged repeated signature verification failures.
  An unsigned canonical POST returned the expected 400 and therefore did not prove secret parity.
- The safe sequence keeps the old endpoint while the replacement is created and the new secret is
  deployed. After the new deployment is `READY`, prove the replacement with a signed overlap
  event, then delete only the resolved old endpoint id and run a new tagged customer event. If
  redeploy fails, retain the endpoints and repair forward unless a secret verified to belong to the
  old endpoint is securely available. Never restore the known-mismatched value or invent a backup.
- Stripe Tax registration/collection is outside this repair and remains a separate commercial
  launch check.

---

## Story s22-production-dependency-security — clear the production security release gate

As an owner, I need the deployed app's dependencies to pass the existing production security
audit so that the reviewed editor release does not ship known vulnerable runtime packages.

Complexity: **3**. Non-UI, inherited stack maintenance; no product or architecture redesign.
User approved the concrete remediation plan on 20 September 2026 UTC ("looking good").

- [ ] Patch the seven audited root dependency packages through targeted changes; retain the
  nested fflate minor line and include Dependabot PR16's fast-uri fix without editing that PR.
- [ ] Preserve other direct dependencies, the Fly server tree, application behavior, all CI
  thresholds, test expectations, embed artifacts and byte ceilings.
- [ ] Clean install, production audit, Sharp loading, typechecks, lint, formatting, production
  build, full tests/coverage and representative image/owner/editor smoke checks pass.
- [ ] Independent review and real CI gate results precede authorized merge/deployment; explicitly
  distinguish a skipped Playwright job from executed browser evidence.
- [ ] Prove the exact deployed release and complete the separately authorized editor rollout
  with restored disposable copy; do not infer paid access or physical-device proof.

Canonical plan: `docs/plans/s22-production-dependency-security.md`.
Research: `docs/research/s22-production-dependency-security.md`.

## Story s24-executed-playwright-ci — run browser gates instead of skipping them

As the operator, I need GitHub to execute the owner/editor/realtime browser suite against an
ephemeral stack so a green E2E badge means browser behavior actually ran.

Complexity: **4**. CI orchestration across Next, Supabase, Redis and the one-process Socket.IO
service, plus safety/cleanup and four currently skipped tests.

- [ ] GitHub Actions starts a throwaway local Supabase stack, Redis, Socket.IO and production Next
  server; no production Supabase, Redis, Fly or Stripe credential is present.
- [ ] A fail-closed safety assertion refuses any mutating E2E target that is not loopback/local.
- [ ] The core owner/share/edit/publish and realtime parity specs execute; the four current suite
  skips are removed only when their real fixtures and assertions are available.
- [ ] Migrations, plan seed, disposable rows, ports, processes and artifacts are deterministic and
  cleaned on success/failure; one CI run cannot contaminate another.
- [ ] The job fails on test failure and publishes a report; it cannot pass through a missing-secret
  guard. Unit/type/build/audit gates remain unchanged.

Research: `docs/research/s24-executed-playwright-ci.md`.
Plan: `docs/plans/s24-executed-playwright-ci.md`.

## Story s23-websocket-dependency-security — clear the realtime server audit

As the operator, I need the separately deployed WebSocket server to carry no known production
dependency advisory so that realtime does not remain the weaker half of the release.

Complexity: **2**. Non-UI patch maintenance on the existing Express 4 line and its release gate.

- [ ] Raise the server's Express 4 floor to a patched compatible release and regenerate only
  `server/package-lock.json`; no Express 5 migration, override or server behavior change.
- [ ] `npm audit --omit=dev --prefix server` reports zero findings, including moderate findings.
- [ ] Existing WebSocket integration/parity behavior, `/health`, one-machine topology and
  websocket-only transport remain unchanged.
- [ ] CI gains a blocking clean-install and zero-advisory server audit so the regression cannot
  return while the root audit stays green.
- [ ] Independent review, exact Fly deployment, `/health`, app readiness and two-client realtime
  evidence pass with a documented rollback image/release.

Research: `docs/research/s23-websocket-dependency-security.md`.
Plan: `docs/plans/s23-websocket-dependency-security.md`.

## s27-launch-content-integrity — page identity and durable link/image attributes

As a customer installing ReCopyFast on multiple pages, every edit must land on its intended element and survive publishing, a fresh visitor load, and restoration.

Complexity: **4**. One rebuilt embed artifact for A-14 and A-26; no new dependencies.

- Computed stable IDs incorporate normalized case-sensitive pathname, ignoring query/hash and trailing slash except root; explicit `data-rcf-id` remains shared across pages.
- Preserve all existing identity guards. D2 accepted by operator: re-key on discovery, no backfill or legacy fallback; zero real customers, QA rows may be orphaned.
- Validate trimmed, bounded href/alt; allow only http/https/mailto/tel and relative/root/fragment references. Changing href to unsafe or unknown schemes receives 400; discovery omits unsupported attributes while retaining the element.
- Retain attributes in metadata across staging, publish, history, fresh public hydration and version restore; drafts remain private until publish.
- Persist nullable page_path for computed identities; author IDs remain All pages. Filter public hydration and staging editor reads by page plus shared rows, with deterministic pagination. Publish remains site-wide; its full-site preview counts changes on the current page and other pages. Show Page in the dashboard content list.
- Preserve absent attributes through capture/restore/publish; detect changes by value. Discovery keeps elements whose authored attributes are unsupported; strict validation applies when a user changes href.
- Save staging plus history atomically; realtime and webhooks carry attribute changes. SPA client-side routing is a known pre-existing limitation deferred to a follow-up.
- Preserve embed ceilings; all requested gates pass; draft PR only, pending independent review.

Research: `docs/research/s27-launch-content-integrity.md`. Plan: `docs/plans/s27-launch-content-integrity.md`.

## s32-try-on-any-site — Try any live site without an account

Operator-approved GTM story (2026-09-24). Complexity: 3. UI: yes.

As an agency owner or founder filming an outbound demo, I can activate a bookmarklet
on a live page, edit text and preview images locally, and discover the trial without
registering, installing the production widget, or persisting changes.

Acceptance: separate dependency-free `public/try/rcf-try.js` at most 8 KB gzipped;
headings, paragraphs, list items, buttons, links and images. Every link navigates
on a plain click; Alt+click (Option+click on macOS) edits a link's text;
hover outline, inline Save/Cancel, Published (preview), top disclaimer/CTA/Exit
and "Alt+click a link to edit it" hint. While editing, a plain click on the edited
element's enclosing link stays on the page;
complete cleanup and idempotence; no API, analytics, or content upload; plain-text
writes. /try includes a stable-URL draggable bookmarklet, browser instructions,
live sample/fallback, metadata and trial CTA; landing navigation and sitemap link it.
Static script delivery must bypass auth and include JS MIME, cache, wildcard CORS,
and nosniff. Unit, page, and local-fixture Playwright coverage are required; update
the exact browser inventory from 39 to 44 after pre-share regression coverage.
No production embed changes or SQL.

Research: `docs/research/s32-try-on-any-site.md`.
Design: `docs/designs/s32-try-on-any-site.md`.
Plan: `docs/plans/s32-try-on-any-site.md`.

## Story s28-billing-correctness — monthly allowances and one open checkout

As a subscriber, I receive the monthly credits my plan grants even when billed annually, and opening Checkout twice cannot create two subscriptions.

Scope: audit A-19 and A-21 / migration M-5 in `docs/archive/goal-audit-closeout.md`. Complexity: 3.

Acceptance criteria:
- Compute the current monthly allowance window from the subscription anchor, with deterministic UTC month-end clamping and no accumulated drift.
- Use the existing live-subscription entitlement statuses (active, trialing, past_due); preserve the separate one-time trial-grant allowance and purchased credits.
- Reserve one pending subscription intent per user in Postgres before Stripe creation, with a partial unique index. Persist the requested price, plan and interval; reuse the session URL only for the same choice. A changed choice expires the old session before releasing the intent and creating the newly requested checkout.
- Align bounded intent/session expiry, safely handle concurrent claims and ambiguous provider failures, and release only the matching intent on completed/expired webhooks without duplicate side effects.
- Add a forward-only idempotent migration with RLS and service-role grants; do not apply it.
- Keep all audit guards, flip the remaining scoped failing markers, run local gates with CI placeholders, then push a draft PR only.

Operator prevalidated this scope in the current task. No UI design is needed. Independent review is pending; no merge or deployment is authorized.

Re-review fix mode 2 adds the 409 retry-time sentence, an ordering-sensitive allowance regression, and corrected webhook/research documentation. N2 (recoverable incomplete/unpaid/paused subscriptions becoming parallel live subscriptions) is explicitly deferred to the follow-up in the plan; the one-pending-intent invariant does not close that pre-existing window.

Research: `docs/research/s28-billing-correctness.md`.
Plan: `docs/plans/s28-billing-correctness.md`.

## Story s29-editor-invite-and-token-lifetime — deliver invitations and keep installs alive

As a site owner, I can invite an editor by email and revoke installation credentials deliberately,
so collaborators find the editor hub and installed widgets do not stop after 90 days.

Complexity: **4**. Operator-prevalidated scope and D3, 2026-09-24.

- Send one best-effort Resend invitation on new enrolment/restoration, never on an active duplicate.
  Include inviter, site name/domain, plain-language permissions, token-free hub CTA and code sign-in instructions.
- Return `invitationEmailSent`; show emailed or manual-link/copy-link notice. Active rows offer
  admin-guarded resend, limited per recipient across invite/restore/resend (3/hour) and per owner
  using the existing limiter.
- Remove only the site-token age cap; preserve HMAC, shape, future-time and origin checks.
- Provide admin-only snippet regeneration with an explicit old-snippet invalidation warning.
- Return readable structured auth errors with CORS only to the permitted origin; preserve authored
  content on refusal. No widget warning or source-byte increase (fix-run decision C1).
- Flip A-25 markers, preserving their intent under D3; pass local gates and open a draft PR.

Research: `docs/research/s29-editor-invite-and-token-lifetime.md`.
Plan: `docs/plans/s29-editor-invite-and-token-lifetime.md`.

## Story s31-magic-link-landing — land confirmed magic links in the app

As a user opening a magic link, I land on my requested app page after confirmation,
without an authentication error for a session that was already established.

Complexity: **1**. Production hotfix, no UI or architecture change. Scope and decisions
pre-validated by the operator in the 2026-09-24 task instruction.

- Confirm unwraps same-origin `/auth/` redirect destinations to their sanitized `next`,
  defaulting to `/dashboard`; the canonical-origin restriction stays intact.
- Callback without a code accepts a user verified through `auth.getUser()` and lands on
  sanitized `next`. Explicit auth errors, failed exchanges and missing sessions still error.
- Route tests cover absolute callback URLs, nested destinations, apex/www, cross-origin
  and open-redirect guards, error precedence and unchanged trial behavior.
- Required local gates pass before a focused commit and draft PR. Independent review
  remains pending; no merge, ready transition, deployment, template/config or SQL changes.

Research: `docs/research/s31-magic-link-landing.md`.
Plan: `docs/plans/s31-magic-link-landing.md`.

## Story s25-stripe-test-entitlement-e2e — prove payment provisions access

As the operator, I need a completed Stripe test Checkout to travel through a genuine signed
webhook into a durable entitlement so paid access is demonstrated rather than inferred.

Complexity: **4**. Real test-mode provider, ephemeral data stack, authenticated Checkout,
webhook causality/idempotency and exact cleanup. Depends on `s24-executed-playwright-ci`.

- [ ] A confirmed disposable user with no trial/paid entitlement creates Checkout through the
  real authenticated application route for one known test-mode subscription SKU.
- [ ] Stripe-hosted Checkout completes with a Stripe test payment method and genuine signed events
  reach the real webhook handler; no synthetic database entitlement is inserted.
- [ ] Checkout reconciles paid, the expected customer/subscription and processed event IDs persist,
  and `/api/billing/entitlement` returns the purchased plan.
- [ ] Replaying the same event is idempotent and creates no duplicate effect.
- [ ] Cleanup cancels/deletes only captured test provider objects and captured ephemeral DB/Auth
  rows, and proves no residue. Secrets/payment data never enter source, artifacts or logs.
- [ ] Evidence says test mode. A live charge remains a separate human action requiring exact SKU,
  period, maximum total, payer and cancel/refund decision.

Research: `docs/research/s25-stripe-test-entitlement-e2e.md`.
Plan: `docs/plans/s25-stripe-test-entitlement-e2e.md`.

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


## Story s33-agency-plan — Agency catalogue and founding offer

Approved by the user on 2026-09-24; this scope supersedes the older s13 pricing questions for catalogue/plan plumbing only. Complexity: 4.

Agency costs $49/month or $490/year (display equivalent $40.83), includes 10 websites, unlimited invited editors/translations, A/B testing, AI, 1,000 monthly AI credits, and $4 additional-site pricing. Features: “10 client websites”, “+$4 per additional website”, “Unlimited invited editors”, “Everything in Pro”, “1,000 AI credits / month”, “Priority support + onboarding call”. Founding Agency (lifetime) costs $299 and grants Agency, limited to the first 50 completed purchases.

- [x] Idempotent migration 20260924065000 adds both catalogue rows and race-safe founding capacity.
- [x] Monthly/yearly/lifetime checkout, webhook grant, entitlement, credits, limits, badges and billing accept Agency.
- [x] Completed sales remain durably counted; concurrent final-spot checkout cannot oversell. Pricing exposes cached aggregate spots remaining and sold out at 50.
- [x] Landing shows Agency beside Starter/Pro and a highlighted founding offer below; pricing/landing tests and strict count contract remain valid.
- [x] Stripe tooling creates/verifies all three prices in TEST mode only; live operator commands documented.
- [x] Targeted tests and required repository gates pass; draft PR only, independent review pending.

Research: `docs/research/s33-agency-plan.md`. Plan: `docs/plans/s33-agency-plan.md`.

## Story s34-checkout-hardening — Bounded holds and subscription checkout safety

Operator-prevalidated scope, 2026-09-25. Complexity: 4. Follow-ups: s33 n3/n4/n5/n7/n8/m5 and s28 N2. Protect the live $299 / 50 founding offer and Agency subscriptions without production actions.

- [x] Unresolved expired founding holds stop consuming capacity after expiry + ten minutes, with service-role-queryable reconciliation flags and sanitized logs; Stripe history includes explicit skew margin.
- [x] Paid late completion of a released hold grants Agency idempotently even if completed sales reach 51; ordinary claims remain serialized and capped, one active hold per account.
- [x] Fix mode: independent flood/new-session limits; 10 new Checkout Sessions per user per 15 minutes, existing-open-session resumes excluded, founding-only deny on store failure, and 429 retry time shown as `Try again at HH:MM`.
- [x] Fix mode: checkout never cancels subscriptions; latest-invoice payment processing blocks with the exact approved 409, other incomplete/past_due/unpaid/paused obligations return invoice/portal recovery, and recovered active/trialing state returns the upgrade message.
- [x] Isolate the positive-price SQL guard, reuse the Agency switch, repair stale explanatory comments and record getUserSubscription's fail-closed contract.
- [x] Focused regressions and full gates pass; fix review approved with no open findings; migrations remain unapplied remotely and PR #32 stays draft.

- [x] Fix mode: `20260925110000_enforce_one_founding_lifetime_per_account.sql` enforces one founding lifetime per account; duplicate paid completion refunds idempotently per Checkout Session without an extra grant/cap count. `checkout.session.async_payment_failed` releases its hold and is added to the live endpoint runbook.
- [x] Fix mode: fresh targeted/DB and final gate evidence, review unchanged and uncommitted, push existing draft PR #32.

Research: `docs/research/s34-checkout-hardening.md`. Plan: `docs/plans/s34-checkout-hardening.md`.

## Story s38-hide-site-api-key — Remove collaborator access to signing secrets

Security priority; complexity 4. Exact implementation and draft-PR delivery authorized by the user on 2026-09-25. No production actions or automatic key rotation.

- [x] Forward migration `20260925120000_sites_api_key_column_grants.sql` removes table-level access and grants authenticated only reviewed non-secret columns; anon has no sites grant, service_role retains full access; unnecessary site mutation grants are removed.
- [x] Audit every public table for credential columns and ineffective column revokes; repair exposures in the same migration and document intentional public/user-visible values.
- [x] Every user-scoped sites read and embedded relation uses explicit safe columns; service-role signing reads retain api_key.
- [x] Real disposable PostgreSQL and Supabase/PostgREST prove view-only JWT cannot select api_key, metadata/dashboard embeds work, role and column invariants fail on regressions, and future columns require a deliberate grant decision. Staging fingerprints are hidden and device hashes cannot be overwritten by site admins.
- [x] Research records the exposure window, affected collaborators, and operator-only rotation recommendation; ADR and AGENTS.md prevent column-only revoke recurrence.
- [x] Local gates and independent review pass; prepare the security fix for the authorized commit, push and draft-PR handoff. Delivery evidence lives in Git/GitHub; no merge/deploy/migration in production.

Research: `docs/research/s38-hide-site-api-key.md`. Plan: `docs/plans/s38-hide-site-api-key.md`.

## Story s36-deflake-share-edit-publish — deterministic save and publish

Operator-prevalidated scope, 2026-09-25. Complexity: 2. An invited editor or edit-session
holder can save and publish without a late duplicate save restoring staging content.

- Establish the root cause from CI logs, source and deterministic regression tests.
- Fix the product if duplicate writes are possible; preserve every existing E2E assertion.
- No retries, timeout increases, skips, weakened guards or new dependencies.
- Saving works when `AbortSignal.timeout` is absent, keeps the 15-second deadline
  where the helper exists, and never replaces the staging mode badge with
  transient save status.
- Lifecycle regressions boot a fresh widget per test so each guard's mutation
  count is independently meaningful.
- Prove at least 20 consecutive local passes with the disposable stack, or three green
  PR E2E jobs if the local stack cannot run. Keep the strict 44-test contract.
- Run required gates; open a draft PR only, with independent review pending.

Research: `docs/research/s36-deflake-share-edit-publish.md`.
Plan: `docs/plans/s36-deflake-share-edit-publish.md`.

## Story s35-activation-checklist — First client publish

Operator-prevalidated scope, 2026-09-25. Complexity: 3. Branch `feature/s35-activation-checklist`.

- [x] Overview and site detail show a three-step per-site checklist from durable install verification, an active invited editor with Publish permission, and any site publish record.
- [x] Each incomplete step has one primary action: copy snippet, open invite form, open edit mode.
- [x] All complete becomes one Live state; dismissal persists per user/site. Loading and read errors never invent progress.
- [x] Site Token copy explains public HTML visibility, requesting-page origin checks and explicit regeneration/revocation per ADR 027.
- [x] Component states/actions/dismissal and authenticated RLS data derivation are tested; required gates pass (3,145 tests passed, 97 pages built; details in plan).
- [x] Existing draft PR #33 stays draft; original independent review is preserved, fix verification is recorded in the plan. No deployment or remote database changes.

Research: `docs/research/s35-activation-checklist.md`. Design: `docs/designs/s35-activation-checklist.md`. Plan: `docs/plans/s35-activation-checklist.md`. Embed allocation: 0 bytes.

Delivery: original implementation `e361c35` is pushed in draft PR #33. The independent review allows ship and records four majors; the operator authorized the fix scope on 2026-09-25. Current fix verification and deferred batching are recorded in the plan. No PR merge or deployment is authorized.


## Story s37-comparison-pages — Agency comparison pages

Operator-prevalidated scope, 2026-09-25. Complexity: 3. Marketing SEO/GTM, extending
the PRD comparison intent and ADR 020 at the explicitly requested `/compare` URLs.

- [x] `/compare` and `/compare/webflow-editor`, `/compare/duda`, `/compare/tinacms`,
  `/compare/cloudcannon` render original, fair, dated content on the Marketing surface.
- [x] Each competitor page leads with a short answer, includes a comparison table,
  both products' best-fit scenarios, visible FAQ and matching FAQPage JSON-LD,
  official pricing/docs citations marked “as of 2026-09”, and `/signup` + `/try` CTAs.
- [x] Repo-verified ReCopyFast capabilities and live catalogue offers honoring the Agency
  switch and Founding availability; dated snapshots apply only to competitor facts.
- [x] Unique canonical metadata/OG, sitemap entries, related-page links and landing footer discovery.
- [x] Render, structured-data and sitemap tests pass; no audit guards weakened, migrations,
  dependencies, customer claims or Playwright count changes.
- [x] Required local gates pass; focused fix commit for the existing draft PR #34.
  Delivery stays draft; independent review and release are separate gates.

Research: `docs/research/s37-comparison-pages.md`. Plan: `docs/plans/s37-comparison-pages.md`.
Initial delivery: `121c9c4`, draft PR #34. Independent review blocked it (C1, M1, M2
and nine minors); fix `ba25a30` addressed those blockers. The independent
re-review allows shipping and requests N1 and n1–n7 before merge. Narrow fix
mode 2 addresses them, retaining the uncommitted reviewer file. SoftwareApplication
JSON-LD is explicitly deferred to s17 in ADR 032; no merge/deploy authority.

## Story s39-editor-back-to-sites — get back to all my sites

Operator-prevalidated scope, 2026-09-25, from hands-on testing. Complexity: 3. Branch
`feature/s39-editor-back-to-sites`. An invited editor who edits more than one site, and is
done with one, can get back to the list of every site they may edit without re-entering a code.

- [x] The in-page editor bar (grant editors only) shows an **All sites** control that returns
  to `recopyfast.com/edit`. The existing unsaved-changes guard still fires on the way out.
  Owners and edit-session holders are unchanged.
- [x] `/edit` checks for a live hub session on load (`GET /api/editor/sites`, today unused):
  valid → the site list renders directly with the signed-in address and "Use a different
  address"; 401 → the email step. Loading never flashes the email form, and a failed read
  is an error state, never an empty list.
- [x] The hub session lives 7 days when "Remember this browser" is ticked at code entry,
  30 minutes otherwise. `submit-code` hub mode honours `rememberDevice`; every hub use still
  re-reads `site_editors`, so removing an editor stays immediate.
- [x] "Remember this browser" on `/edit` defaults to unticked, matching the in-page modal.
- [x] "Use a different address" from a live session clears the hub cookie server-side.
- [x] Embed allocation paid in-branch: CSS comments leave the shipped template strings
  (measured −446 gz), the control is added, and the byte gate ratchets down to the new
  measurement with both deltas itemised.
- [x] Jest covers the hub mount states, cookie lifetime, sign-out and the bar control. The
  Playwright count stays 44 (contract); the journey site → All sites → list → second site is
  proven live in production after deploy.
- [x] Required gates pass; independent review before merge.

Live proof 2026-09-25 (`.omx/qa-20260925/live-s39.mjs`): Remember unticked by default; hub cookie 7.00 days, httpOnly/Secure/Lax; aicompoz → All sites → list with no code → cross-device site → All sites → sign-out → reload stays signed out, cookie cleared.

Research: `docs/research/s39-editor-back-to-sites.md`. Plan: `docs/plans/s39-editor-back-to-sites.md`.

## Story s43-launch-polish — Public pages load without errors, and /pricing works

Operator-prevalidated scope, 2026-09-25, from the launch audit (Playwright against
production, desktop and mobile). Complexity: 2. Branch `feature/s43-launch-polish`.

- [x] `/blog` hydrates without React error #418 in any visitor locale or time zone: blog dates
  (list and article) come from one shared formatter, `en-US` / `dateStyle: "medium"` /
  `timeZone: "UTC"`, identical on server and client and showing the published calendar day.
- [x] `/pricing` is a permanent (308) redirect to `/#pricing` in `next.config.ts`; middleware
  never intercepts it and the sitemap does not list it.
- [x] Formatter unit test passes under `TZ=Pacific/Kiritimati` and `TZ=UTC`; a hydration render
  test proves BlogPostList output is stable across locale/zone; a config test pins the exact
  redirect entry. Other locale-dependent call sites are listed in research, not changed.
- [x] `npm run precommit` and `npm run build` pass; one commit on the branch. No push, PR,
  merge or production action in this run.

Live proof 2026-09-26: `/pricing`, `/PRICING` → 308 `/#pricing`, query kept; `/blog` in fr-FR/Paris, ja-JP/Tokyo, en-US/Los Angeles → no console errors, identical dates.

Research: `docs/research/s43-launch-polish.md`. Plan: `docs/plans/s43-launch-polish.md`.
Embed allocation: 0 bytes.

## Story s42-api-keys-writes — creating, toggling and deleting an API key works

Operator-prevalidated scope, 2026-09-25, from the launch audit. Complexity: 2. Branch
`feature/s42-api-keys-writes`. Production RLS on `api_keys` grants `authenticated` SELECT
only and s38 removed its write privileges, so every create/pause/delete from
`/dashboard/settings` fails today.

- [x] POST, PUT (`isActive`) and DELETE on `/api/api-keys` succeed for a site admin who owns
  the key: authentication and authorization stay on the user-scoped client, the single write
  runs through the service-role client scoped by `id` AND `user_id` (option (a); no migration).
- [x] Non-admins get 403, non-owners 404, unauthenticated callers 401, and no write happens;
  `key_hash` never appears in a response.
- [x] A pre-authentication IP limiter guards every verb (GET fails open, writes fail closed),
  and writes add a fail-closed per-user limiter before the `site_permissions` lookup.
- [x] GET keeps working under the s38 column grants; a real-DB case proves the service-role
  write path and the authenticated denial it replaces.
- [x] Required local gates pass; one story commit. No push, PR, merge or production action.

Live proof 2026-09-26 (`.omx/qa-20260925/live-s42.mjs`, QA owner): create 200 with plaintext once and no `key_hash`; list 200; pause 200 → key refused 401; delete 200 → list empty, key 401. Found alongside: `/api/v1/content` answers 429 to every request (limiter queries columns `rate_limits` never had) → s44.

Research: `docs/research/s42-api-keys-writes.md`. Plan: `docs/plans/s42-api-keys-writes.md`.
The settings panel still has no pause/resume control (PUT is API-only); that is UI work for a
follow-up story.

## Story s40-ai-widget-auth — AI suggestions work in edit mode

Operator-prevalidated scope, 2026-09-25, from hands-on testing. Complexity: 3. Branch
`feature/s40-ai-widget-auth`. The person editing a page — the owner in edit mode, or an invited
editor — clicks "🪄 AI" and gets suggestions, billed to the site owner. Today every attempt fails:
`/api/ai/suggest` expects a dashboard cookie the widget cannot send.

- [x] `POST /api/ai/suggest` authorises the editor with the existing
  `validateEditorTokenFromRequest` + `requireEditorPermission(…, "edit")` (device grant in
  `X-RCF-Editor-Grant`, edit-session or staging token in the body). The public site token alone is
  refused and nothing is spent. No cookie path and no new auth helper.
- [x] Spend is charged to the site owner (`admin` row in `site_permissions`, via the existing
  `resolveSiteOwnerId`), through the service role, never to the caller and never via `sites`.
  The owner's plan is honoured through the existing `canUseAIFeatures` gate; no plan / no credits
  fails closed with a clear message, worded for the owner or for an invited editor.
- [x] Rate limited per IP before authorization and per site after the permission grade, both fail
  closed. Public CORS on every response (429s included), no cookies; `OPTIONS` 204.
- [x] Every goal the modal offers is accepted (`engage`, `professional` and `casual` mapped
  server-side). A missing `OPENAI_API_KEY` refuses before charging and logs loudly; a provider
  failure refunds the owner and never echoes the provider's message.
- [x] The widget sends editor credentials (grant header, or token in the body — never in a URL),
  `siteId`, no site token, and shows the server's message on refusal.
- [x] "Auto-translate with AI" leaves the Edit Board and `POST /api/edit-board/languages` stops
  calling the model: it spent unmetered OpenAI per element into `site_languages.translations`,
  which nothing reads. `/api/ai/translate` has no widget caller and is out of scope.
- [x] Embed allocation paid in-branch: measured at `0b8014f` as +24 bundle / +27 widget gz for the
  credentials and message, −77 / −69 for removing auto-translate, net −53 / −48. The gate ratchets
  down to the new measurement with both deltas itemised (re-measured after the rebase on s39).
- [x] Jest covers the route through the real editor-access code with real signed grants, the
  explicit-payer billing path and the widget's requests. The Playwright count stays 44 (contract);
  owner and invited-editor suggestions are proven live in production after deploy.
- [x] Required gates pass; independent review before merge.

Live proof 2026-09-26: invited editor (grant) and owner (edit link) each got 200 with suggestions through heading → 🪄 AI → Generate; each charged 1 credit to the site owner (`credit_usage`); site-token-only call → 401.

Research: `docs/research/s40-ai-widget-auth.md`. Plan: `docs/plans/s40-ai-widget-auth.md`.

## Story s41-edit-link-multipage — an edit link keeps working as I click through my site

Operator-prevalidated scope, 2026-09-25, from hands-on testing. Complexity: 3. Branch
`feature/s41-edit-link-multipage`. An owner who follows **Edit website**, or anyone who follows a
**Share Preview Link**, stays in edit mode (and staging mode, for share links) as they move
between pages of the site. Today the credential lives only in the first page's memory, so every
later load in the tab (an internal link, a reload, Edit Board's restore reload) boots as a
visitor. Invited editors on device grants are already unaffected.

- [x] Following an edit or share link persists its credential in **sessionStorage**, keyed
  `rcf_edit_link:<SITE_ID>`, and never in localStorage (bearer, no origin or device binding, per
  ADR). Full-page navigations and reloads in the same tab on the same origin boot in edit mode
  (edit session) or staging mode (share link). The address bar is still stripped on arrival, and
  no URL the widget builds gains a credential it did not already carry.
- [x] A new tab opened without the token stays in visitor mode, and this is stated. Preview Live
  opens with `noopener`, so it shows the visitor view and does not inherit the tab's session.
- [x] The stored credential is removed when the server refuses it: 401/403 from
  `/staging/validate`, or a terminal 401/403 on save or publish. It is kept through 5xx and network
  failures. A token in the URL replaces the stored one; an orphan `rcf_token` without
  `rcf_staging=1` is never stored. There is no exit control today, and none is added; closing the
  tab ends the session.
- [x] The server lifetime is the only lifetime: every load and write is still re-validated, and
  persistence adds no client-side expiry or bypass.
- [x] Storage that is blocked, throws or holds garbage never reaches the host page
  (non-negotiable #4). The widget degrades to visitor mode.
- [x] The embed allocation is paid in-branch: the dead email-capture modal (unreachable since
  `747d210`) and the unused `escapeHtml` are removed, and the gate ratchets down to the new
  measurement with every delta itemised (measured −306 / −295 gz net on s39).
- [x] An ADR records the sessionStorage decision and its rejected options. jsdom tests cover
  persist, restore, clear, throw and noopener. The Playwright count stays 44 (contract).
- [x] Required gates pass; independent review before merge.
- [ ] Proven live in production after deploy: owner edit link → click through three pages →
  still editing → save on page 3 publishes. Share link → click through → staging banner on every
  page. A new tab is a visitor tab.

Out of scope: SPA client-side routing (hydration and page path on `pushState`), already deferred
at s27. Tokenless owner link on the dashboard Content page (`rcf_edit`).

Live proof 2026-09-26 (partial, `.omx/qa-20260925/live-s41.mjs`): owner edit link → edit mode; reload → still editing; clean-URL navigation → still editing; new tab → visitor; token in sessionStorage only. Open: a three-page save/publish and the share-link walk need a multi-page site with the snippet — both QA sites have one page.

Research: `docs/research/s41-edit-link-multipage.md`. Plan: `docs/plans/s41-edit-link-multipage.md`.

## Story s44-v1-rate-limiter — the public content API answers requests

Operator-prevalidated scope, 2026-09-25, from live production testing. Complexity: 2. Branch
`feature/s44-v1-rate-limiter`. A freshly created, active API key's first
`GET /api/v1/content` answered 429: the Postgres limiter behind it reads `api_keys.rate_limit`
and queries `rate_limits` by `key`/`timestamp`, none of which exist, so it refuses every request.

- [x] A valid key's first GET answers 200 with its site's content; POST/PUT with a write key
  create/update. The route meters through the shared Redis limiter (option (a)); the Postgres
  `APIRateLimiter` is deleted. No migration.
- [x] The per-key ceiling is the key's own `rate_limit_per_minute` per minute, shared by every
  verb; 429 (with `Retry-After`) only past it. `api_keys.rate_limit` is read nowhere and
  `validateAPIKey`'s admin re-check is unchanged.
- [x] A per-IP limiter runs before `validateAPIKey` on every verb; both limiters fail closed
  (503) on a store outage, before any content is read or written.
- [x] The route's tests run against a database double that errors on a non-existent column,
  with column lists derived from the migrations and anchored to production's.
- [x] Required local gates pass; one story commit. No push, PR, merge or production action.

Live proof 2026-09-26 (`.omx/qa-20260925/live-s44.mjs`, QA owner): a fresh key's first `GET /api/v1/content` → 200 with 18 items; in one fixed window exactly 100 → 200 then 429 with `X-RateLimit-Limit: 100` (real Redis); deleted key → 401.

Research: `docs/research/s44-v1-rate-limiter.md`. Plan: `docs/plans/s44-v1-rate-limiter.md`.

## Story s45-lifetime-ai-credits — the lifetime Founding Agency includes 250 AI credits a month

Operator-prevalidated scope, 2026-09-26, from the launch-readiness open decision ("limit AI
credits or seats on the $299 lifetime Founding Agency"). Complexity: 3. Branch
`feature/s45-lifetime-ai-credits`. A lifetime Founding Agency buyer gets everything Agency has
except the monthly AI-credit allowance, which is 250 instead of 1,000. Spots stay at 50.

- [x] Entitlement resolution for a lifetime Founding Agency purchase yields every Agency limit
  and 250 monthly AI credits; purchased credit packs still stack on top. The 250 never lowers an
  allowance the owner already holds: a Lifetime Pro owner keeps 500, a Pro subscriber keeps 500
  until the period they paid for ends (review fix, ADR 038).
- [x] Agency subscribers keep 1,000, including a lifetime buyer while an Agency subscription
  they already paid for runs out its period; an unpaid Agency comp keeps 1,000; ADR 029
  precedence is unchanged.
- [x] The number lives in `plans` (the `lifetime_agency` row), set by one idempotent forward
  migration; no new plan id, no applied migration edited, no DB function change. The $299 price,
  the 50-spot cap and the Stripe price are unchanged.
- [x] The offer states "Everything in Agency, with 250 AI credits a month" wherever it is
  presented (landing, billing card, plan dialog, /compare, Stripe product description); no other
  pricing copy changes. `/api/pricing` lists no new plan. The billing page's plan card states the
  allowance the owner actually gets and no monthly price for a plan held for life (review fix).
- [x] Required local gates pass; one story commit. No push, PR, merge or production action.
  Operator after merge: deploy, apply the migration, then sync the Stripe product description.

Research: `docs/research/s45-lifetime-ai-credits.md`. Plan: `docs/plans/s45-lifetime-ai-credits.md`.
Embed allocation: 0 bytes.

## Story s46-sentry-wiring — production errors reach Sentry

Operator-prevalidated scope, 2026-09-26 ("add the RecopyFast project to my Sentry"). Complexity:
2. Branch `feature/s46-sentry-wiring`. With the new project's DSN in Vercel production and a
fresh build, a live uncaught error on www.recopyfa.st sent zero requests to Sentry and the DSN's
public key was absent from the homepage JS: the browser SDK was never initialised.

- [x] The browser SDK initialises from `src/instrumentation-client.ts` (the only client entry
  Next 16's default Turbopack build loads) and exports `onRouterTransitionStart`;
  `sentry.client.config.ts` is gone. A build with a DSN carries its public key in
  `.next/static`.
- [x] Exactly one server instrumentation file, `src/instrumentation.ts`, loaded under both
  bundlers: `nodejs` → `sentry.server.config`, `edge` → `sentry.edge.config`, only in
  production with a DSN; it exports `onRequestError = Sentry.captureRequestError`.
- [x] Browser events go same-origin through `tunnelRoute` `/monitoring`; the middleware lets
  that exact path through without a GoTrue round trip or redirect, keeps its security headers,
  and neither the CSP nor the matcher is widened.
- [x] `enabled` stays production-only, sample rates unchanged, no PII. The browser ships error
  reporting and tracing without Session Replay. Operator decision, 2026-09-26: launch pages
  cannot carry it, and it made up 38,965 B gzip of every page's first load.
- [x] Required local gates pass, including `npm run build` with a dummy DSN and no
  `SENTRY_AUTH_TOKEN`; one story commit. No push, PR, merge or production action.

Research: `docs/research/s46-sentry-wiring.md`. Plan: `docs/plans/s46-sentry-wiring.md`.
Embed allocation: 0 bytes.

## Story s47a-founding-20-grant — the first 20 people who sign up get Pro free for 3 months

Operator-prevalidated scope, 2026-09-27 (owner approved the launch offer: "First 20 users get
RecopyFast Pro free for 3 months"). Split from `s47-founding-20-offer` at research (scored 5).
Complexity: 4. Branch `feature/s47a-founding-20-grant`. Today every new account gets the 14-day
Pro trial at first sign-in (ADR 014). For the first 20 accounts created after the offer opens,
that same first sign-in grants Pro for 90 days instead, metered at 100 AI credits a month, no
card. Account 21 onward gets the 14-day trial exactly as today. When the 90 days end the account
lands where a lapsed trial lands and chooses a plan.

- [x] The offer grant IS the account's one trial row (`source = 'trial'`, `plan_id = 'pro'`,
  expiring 90 days after the claim, server clock) marked as the founding offer — so "one trial
  per account, ever" still holds and an expired offer account can never receive a second,
  14-day trial on a later sign-in.
- [x] Exactly 20 spots, owned by the database: concurrent first sign-ins can never claim a 21st;
  eligibility check, trial row and claim are one transaction. Proved against real Postgres with
  a concurrency test that CI runs.
- [x] Only accounts created after the offer opened, with no plan entitlement, subscription or
  credit purchase ever, can take a spot; a repeat sign-in never takes one. Any other outcome,
  including an error in the offer path, falls back to today's 14-day trial and never fails the
  sign-in.
- [x] An offer account resolves to every Pro limit (5 sites, invited editors, All sites, AI)
  with a monthly AI-credit allowance of 100, in windows anchored on the grant date (a 14-day
  trial's single window is unchanged). A higher allowance the account holds from any other
  source is never lowered (ADR 038 floor). Purchased packs stack on top and are spent after the
  allowance, as today.
- [x] Once 20 spots are taken, a new account's first sign-in gets the 14-day trial (500 credits)
  with no other change.
- [x] 90 days after the claim the account resolves to the lapsed state; the billing screen says
  the founding offer has ended (not "Your 14-day Pro trial has ended") and offers the plans. No
  charge, no card ever requested by the offer.
- [x] The dashboard badge and billing card of an offer account state what it has: "Founding
  offer — N days left", "N of 100 AI credits used this month"; never "500 trial AI credits" or a
  14-day countdown.
- [x] A public, uncached endpoint returns only the spots-left count (no user data), correct
  immediately after a claim or release; on any error it returns no number rather than a guess.
- [x] The operator can release a spot held by an internal/QA account without a code change
  (service-role only, runbook in `docs/operations/`). Release sets `revoked_at` only — it must
  not rewrite `source`, or the account would escape the one-trial index. The count goes back up.
- [x] ADR 039 records the representation, the claim lock, the allowance rule, the monthly
  window (amends ADR 014's single window) and the migration-first order.
- [x] Required local gates pass (run in a worktree: the repo-root `.env` breaks tests that read
  `NEXT_PUBLIC_APP_URL`); one story commit. No push, PR, merge or production action. Operator
  before merge (merging deploys): apply the migration FIRST (code reading the new column before it exists would
  fail every gate), then deploy, run the live proof on a QA account, release its spot.

Agentic notes: sign-in path `ensureTrialStarted` → `grantTrialEntitlement`
(`src/lib/billing/trial.ts`), from `/auth/callback` and `/auth/confirm`. Capacity precedent
`reserve_founding_agency_spot` (`20260924065000_agency_plan_and_founding_capacity.sql`) — the
offer takes its own advisory-lock key. Allowance: ADR 038 / s45 cannot express this (the
catalogue refuses a second product granting `pro`, `src/lib/stripe/plans.ts:416-429`); add a
held-by-offer-only branch in `src/lib/billing/effective-plan.ts`. Credit window:
`src/lib/credits/system.ts:192-209`. Revocation trap: `src/lib/billing/entitlements.ts:142`
rewrites `source`. `/api/pricing` can lag ~15 minutes — the count needs its own route. CI runs DB
suites by name (`.github/workflows/ci.yml:258-289`): add a step. Local DB lacks the s45 migration
`20260926120000`. Research: `docs/research/s47a-founding-20-grant.md`. Design:
`docs/designs/s47-founding-20-offer*` (shared with s47b). Risk (why 4): an authorization and
capacity boundary on the sign-in path — a bug either gives away unlimited free Pro or breaks
sign-in. Known interaction: a refunded AI failure currently becomes a permanent purchased
credit (credit check 2026-09-27), which would keep a lapsed offer account in the dashboard; that
defect is fixed in its own story, not here. No Stripe product, price or webhook change.

Embed allocation: 0 bytes.

## Story s47b-founding-20-landing — the landing page shows the offer and the spots left

Split from `s47-founding-20-offer` at research. Complexity: 2. Branch
`feature/s47b-founding-20-landing`. Depends on s47a (count endpoint and the grant it promises).

- [x] While spots remain, the landing presents "First 20 users get RecopyFast Pro free for 3
  months" with a live "X of 20 spots left" read from s47a's count endpoint, per
  `docs/designs/s47-founding-20-offer.md`.
- [x] At 0 spots, or when the count is unknown (loading failed), the landing shows the 14-day Pro
  trial line instead — never a stale or guessed number, and no trial→offer flash that shows the
  wrong promise.
- [x] Every "14-day free trial" claim the offer replaces is updated consistently (Hero, Pricing
  trust point, FinalCTA as designed); the copy tests (`trial-claims`) and the Playwright landing
  check (`e2e/landing.spec.ts:196`) assert both states.
- [x] Required local gates pass (in a worktree); one story commit. No push, PR, merge or
  production action.

Agentic notes: landing sections under `src/components/sections/` (Hero, Pricing, FinalCTA);
Founding Agency "N of 50 founding spots left" block is the visual precedent
(`docs/designs/s33-agency-plan.md`). Research: `docs/research/s47a-founding-20-grant.md`.

Embed allocation: 0 bytes.

## Story s48-credit-integrity — AI credits are charged once, and refunded when the AI fails

Operator-prevalidated scope, 2026-09-28, from the credit purchase verification
(`.omx/qa-20260927/REPORT.md`, defects 1–3; owner: fix all three before launch). Complexity: 4.
Branch `feature/s48-credit-integrity`. Buying credits works; spending them does not always keep
its promise ("Unused credits are refunded if a feature fails", `PurchaseCreditsDialog.tsx:108`).

- [x] A translation request in which no text is translated (AI key missing, every provider call
  failing) charges nothing net: it reports failure, not "Successfully translated 0 elements", and
  any credits taken are returned. A partial batch returns the failed share. An error after the
  charge returns the charge. The AI key is checked before charging, as `/api/ai/suggest` does.
- [x] A refund returns credits to where they came from: an allowance-funded charge goes back to
  the monthly or trial allowance, and only a purchased-credit charge goes back to purchased
  credits. A refund never creates a new never-expiring purchased-credit row, so a trial account
  that never paid resolves to `none` after its trial whether or not it had a refunded failure.
- [x] Concurrent AI requests never lose credits: N simultaneous charges against a balance debit
  exactly the sum of the successful charges, and no request is refused while the balance covers
  it. The deduction is one database function (AGENTS.md: multi-step writes are one transaction),
  proved against real Postgres with a concurrency test CI runs (12 at once, repeated).
- [x] "Total purchased" counts only paid credits (refund credits are no longer written as
  purchases, see above).
- [x] Required local gates pass (in a worktree); one story commit. No push, PR, merge or
  production action. Operator after merge: apply the migration first, then deploy.

Agentic notes: evidence and reproduction scripts in `.omx/qa-20260927/` (`credits-probes.ts`,
`translate-refund-route.mjs`, race results; all refuse non-local targets). Code:
`src/lib/credits/system.ts` (spend `:371-409`, refund `:558-586`, totals `:740-741`),
`src/lib/ai/openai-service.ts:98-104,172-201`, `src/app/api/ai/translate/route.ts:190-270`,
`src/app/api/ai/suggest/route.ts:253-260`, entitlement from balance
`src/lib/billing/effective-plan.ts:527-529`. Risk (why 4): money path shared by every AI feature
and by the entitlement gate. Out of scope: per-text pricing for translation (defect 8) and the
credit-card display fixes (defects 5, 7 display half). Should ship before s47a goes live: a
lapsed offer account with a refunded failure would otherwise keep dashboard access.

Embed allocation: 0 bytes.

## Story s49-buy-credits-anywhere — SUPERSEDED by s51 (not built)

Product owner decision, 2026-09-28, reversing the earlier "anyone may buy credits": the
editing-access fact-find showed that every AI feature lives inside the editor, and editing is a
plan feature (s01 AC: "expiry blocks writes and new resources, never public content delivery").
A no-plan account could buy credits it cannot spend. Credit purchases therefore need a plan; that
rule is delivered by s51. Research (`docs/research/s49-buy-credits-anywhere.md`) is kept for its
billing-screen inventory. No code from this story was committed.

## Story s50-homepage-truth — every claim on the homepage is true

Operator decision, 2026-09-28, from the launch-kit fact check (PR #47). Complexity: 3 (was 2;
research found 23 false claims of 68, and the owner added the plans copy). Branch
`feature/s50-homepage-truth`. The homepage promises things the product or terms don't back.
Research: `docs/research/s50-homepage-truth.md` (claim-by-claim inventory with verdicts).

- [x] The "30-day money-back guarantee" is removed wherever it appears (owner decision: remove,
  refunds stay case by case).
- [x] Features the PRD froze without a customer-facing surface (audit log, role-based
  permissions, and any other graveyard item, `docs/prd.md` § graveyard) are not advertised.
- [x] Every claim the research marks FALSE or UNVERIFIABLE is reworded or removed as it
  recommends, including the unshipped Translate and A/B cards (replaced by Invite and AI Rewrite),
  "works everywhere", "full version history", the image-generation button, the /docs link, the
  hardcoded status and version, and the page metadata/OG text; the result is recorded in the
  story's review with the evidence per claim.
- [x] Support promises say "Email support" on every plan: no "Priority support" and no
  "onboarding call" anywhere (owner decision, 2026-09-28).
- [x] Lifetime Pro no longer promises "all future Pro features" (owner decision, 2026-09-28).
- [x] Every contact address on the site, /terms and /privacy is on `recopyfa.st`:
  `support@recopyfa.st` for customers, `privacy@recopyfa.st` on the legal pages; no address on the
  nonexistent `recopyfast.com` remains. Operator before ship: both mailboxes receive mail.
- [x] The plans catalogue copy (feature rows and descriptions in `plans`) matches: one idempotent
  forward migration, no applied migration edited, no price or limit change. Operator after merge:
  migration, deploy, then `sync:stripe:live` for the product descriptions.
- [ ] Copy tests and the Playwright landing check pass with the new copy. Required local gates
  pass; one story commit. No push, PR, merge or production action.

Agentic notes: launch-kit PR #47 (`docs/gtm/`) lists the unverifiable claims and wording used
instead ("no account" rather than "no login"; "one script tag on the site you already built"
rather than "works on any site", because a strict CSP blocks the script). Landing sections under
`src/components/sections/`. Coordinate with s47b, which edits the same Hero/Pricing copy: ship
s50 first or rebase s47b on it.

Embed allocation: 0 bytes.

## Story s51-edit-needs-a-plan — editing, publishing and buying AI credits need a plan

Product owner decision, 2026-09-28, from the editing-access fact-find. Launch-blocking (P0).
Complexity: 4. Branch `feature/s51-edit-needs-a-plan`. Today no edit or publish path checks the
site owner's entitlement: a lapsed trial, a lapsed founding-offer account, their invited editors
and their API keys keep editing and publishing live indefinitely, and a $19 credit pack buys
permanent editing. This contradicts `docs/stories.md:277` (s01) and
`docs/designs/s01-trial-signup.md:51-53`.

- [ ] Every content write is refused unless the SITE OWNER's entitlement is `plan`: staging save
  and publish, version restore, bulk import and bulk update, `/api/v1/content` POST/PUT, and the
  frozen `edit-board/styles/apply` (which also calls AI without charging). The refusal is a
  structured `upgradeRequired` error; nothing is written. One server-side helper, keyed by the
  owner (not the caller), fails closed on any resolution error.
- [ ] Invited editors of a paying owner are unaffected; invited editors and API keys of a lapsed
  owner can no longer write, and regain access automatically when the owner picks a plan (no
  credential is revoked or reissued).
- [ ] Public delivery never depends on the owner's plan: the embed, `GET /api/content/[siteId]`,
  discovery, `v1` GET, bulk export and the WebSocket broadcast keep working for a lapsed owner,
  proved by tests.
- [ ] Issuance points (edit-session create, editor code submit, handoff, grant refresh) refuse a
  lapsed owner up front, and the widget and `/edit` hub show "This site's plan has ended — the
  owner can reactivate it" instead of a generic error.
- [ ] A credits checkout (`/api/billing/checkout` intent `credits`) requires a `plan`
  entitlement; the no-plan billing screens do not offer credits, and say AI credits come with a
  plan. Credits already held are kept and become spendable when a plan is chosen.
- [ ] `permissions.ts` states that editing needs a plan, and the middleware comment that claims
  the APIs enforce entitlement is made true. ADR records the rule.
- [ ] Required local gates pass (in a worktree, local Supabase up); one story commit. No push,
  PR, merge or production action. Operator before deploy: count production credits-only accounts
  that paid (query in the runbook) and comp or refund each one.

Agentic notes: fact-find table (paths, auth, file:line) is the research seed — see
`docs/research/s51-edit-needs-a-plan.md`. Key points: `src/app/api/edit-sessions/create/route.ts:86`,
`src/app/api/staging/content/[siteId]/route.ts:165`, `src/app/api/staging/publish/route.ts:59`,
`src/lib/auth/editor-access.ts:138,416`, `src/lib/editor-grants.ts:39-47`, `src/app/api/editor/*`,
`src/lib/security/rate-limiter.ts:117-133` (v1 keys), `src/app/api/bulk/{import,update}`,
`src/middleware.ts:165-171`, `src/lib/feature-gating/permissions.ts:74`, owner lookup
`resolveSiteOwnerId`. Risk (why 4): an authorization change across every write path; a bug either
keeps the leak or locks paying customers out. Depends on nothing; s47a's lapsed offer accounts
rely on it to convert.

Embed allocation: small — the widget's upgrade message only.

## Story s52-bill-after-free-period — choosing a plan during the free period doesn't forfeit it

Product owner decision, 2026-09-28, from the s47a design review. Complexity: 3. Branch
`feature/s52-bill-after-free-period`. Today checkout bills from the day a plan is chosen, so a
trial or founding-offer account that upgrades early loses its remaining free days, and the
billing card has to warn about it.

- [ ] A subscription checkout started by an account with a running trial or founding offer sets
  the first charge to the end of that free period; the account keeps the plan it chose from that
  moment, with no gap and no double entitlement.
- [ ] The billing card's "billed from the day you choose" warning is replaced by "billed on
  <date>".
- [ ] Lifetime purchases and credit packs are unaffected. Required local gates pass; one story
  commit.

Agentic notes: `src/lib/stripe/checkout.ts` (subscription_data), ADR 014 trial row, s47a offer
row. Not launch-blocking.

Embed allocation: 0 bytes.

## Story s53-credit-and-offer-hardening — the accepted review findings are bounded and pinned

Product owner decision, 2026-09-28, collecting the findings accepted at the s48, s47a and s50
reviews. Complexity: 3. Branch `feature/s53-credit-and-offer-hardening`. Not launch-blocking.

- [ ] Overlapping-refund bound (s48 review major): ADR 040's "Watch" list states that a refund
  overlapping a later charge at the allowance boundary can leave the customer up to the failed
  call's allowance share short (≤5 translate, ≤1 suggest), and a DB test pins that bound.
- [ ] A refund that fails (RPC error) is reported to Sentry with the usage id, not only logged.
- [ ] `claim_founding_offer_spot` sets a short `lock_timeout`, so a stuck lock holder makes a
  sign-in fall back to the 14-day trial instead of waiting (s47a review m2); tested.
- [ ] The claim-vs-fallback race test is deterministic (s47a review m3): the targeted mutation is
  caught on every run.
- [ ] The catalogue guard covers every retired phrase, not only the five owner phrases, and the
  static price guard includes `additional_site_price` (s50 review minors 5–6).
- [ ] Optional hardening considered and recorded in ADR 040: binding refunds to rows created by
  `spend_credits` (Devin PR #48 finding 4, not exploitable today).
- [ ] Required local gates pass; one story commit.

- [ ] Also collected from the s47a/s47b/s50/s51/s54/s56 reviews and PR bot findings (2026-09-28):
  s47a — dialog-level test pinning `hasSubscription` (moved to s52 with R1/r3); s47b — tie "5 websites"
  on the offer card to Pro's catalogue limit, and `toFoundingOfferView` prefers loading/error over
  retained data on refetch; s51 — test that the gate runs after the per-site limiter, owner lookup
  with NULL `created_at` / team admin rows, ADR 041 note that grants and sessions age out during a
  long lapse; s54 — the bite check reads the rendered HTML string; s56 — bulk/update service-write
  site-scope test, update-history-policy read-back before rollback, ADR 042 Watch for member-writable
  `site_themes`/`copy_styles`/`site_languages` and default-grant inheritance, ADR 042 names ADR 002 §2,
  cap `ab-tests/generate` model input, per-user/site limiters for `ab-tests/generate` and
  `bulk/import`; product copy — `BillingDashboard.tsx` still lists "A/B testing" (not a customer
  feature).

Embed allocation: 0 bytes.

## Story s54-legal-pages-truth — /privacy and /terms describe the product that exists

Product owner decision, 2026-09-28, from the s50 review (minor 4). Complexity: 2. Branch
`feature/s54-legal-pages-truth`. Launch-relevant: done before the public launch posts.

- [x] /privacy and /terms make no claim about features the product does not have: audit logs,
  role-based access control, SIEM integration, or any other PRD-graveyard item.
- [x] The "EU Representative" and any other named role or entity that does not exist is removed or
  replaced by what is true; every contact line uses `privacy@recopyfa.st` or `support@recopyfa.st`.
- [x] The processing and security sections describe the actual stack (Supabase, Stripe, Vercel,
  Fly, OpenAI) without overstating certifications or controls.
- [x] A guard test fails if a graveyard feature name reappears on either page. Required local gates
  pass; one story commit. Legal wording is conservative: remove over invent.

Embed allocation: 0 bytes.

## Story s55-no-visitor-cookie-by-default — the embed sets no cookie unless an A/B test is running

Product owner decision, 2026-09-28, from the s54 research. Complexity: 2. Branch
`feature/s55-no-visitor-cookie-by-default`. Launch-relevant: the embed sets a one-year first-party
`rcf_vid` cookie on every visitor of every customer site on every non-staging page load
(`public/embed/recopyfast.src.js` `initVisitorId`, called before `fetchActiveTests`), for the
parked A/B feature no customer can use. Undisclosed and without consent, it exposes customers to
cookie-law risk just for installing the script.

- [x] On a page load where the site has no active A/B test, the embed reads no cookie, writes no
  cookie and generates no visitor id; published copy still applies exactly as before.
- [x] Only when `fetchActiveTests` returns at least one active test does the embed create or read
  `rcf_vid`, and the A/B pipeline then behaves as today.
- [x] The artifact is rebuilt from the source (`recopyfast.js` is never hand-edited) and the byte
  gate passes; the embed does not grow.
- [x] Tests cover both paths (no tests → `document.cookie` untouched; active test → cookie set).
  Required local gates pass; one story commit.

Agentic notes: `public/embed/recopyfast.src.js:955-962` (A/B pipeline start), `:3218-3238`
(`initVisitorId`), the embed build and byte gate (`scripts/build-embed.mjs`, docs/stories.md §
Byte budget). No server change.

Embed allocation: must be ≤ 0 bytes (net shrink or equal).

## Story s56-rls-content-writes-need-plan — direct database writes also need the owner's plan

Product owner decision, 2026-09-28, from the s51 review (major). Launch-blocking (P0).
Complexity: 3 (to be confirmed at research). Branch `feature/s56-rls-content-writes-need-plan`.
s51 gates every application write route on the site owner's plan (ADR 041), but a signed-in
`edit`/`admin` site member can still write `content_elements.published_content` directly through
PostgREST with the public anon key and their own session: RLS policy "Users can edit content for
authorized sites" is FOR ALL and `authenticated` holds INSERT/UPDATE/DELETE. The A/B tables share
the gap. Proven locally (planless owner PATCH → 200, live row changed).

- [ ] A direct PostgREST INSERT/UPDATE/DELETE on `content_elements` (and every other table that
  holds publishable content or A/B test data) by a member of a site whose OWNER has no `plan`
  entitlement is refused and changes nothing; the same member of a paying owner's site is
  unaffected wherever direct writes are legitimately used.
- [ ] Every application path that writes those tables keeps working for paying owners (dashboard,
  widget, bulk, v1, publish RPCs) — research lists which paths use the user's session vs the service
  role, and the fix is chosen accordingly (owner-plan check inside RLS via a SECURITY DEFINER
  helper, or revoking direct writes where only service-role routes write).
- [ ] Public reads (visitors' content GET, embed) are untouched.
- [ ] `ab-tests/*` routes are gated on the owner's plan like other writes (ADR 041 Watch).
- [ ] Proved against real Postgres through PostgREST with a user JWT (lapsed → refused, paying →
  allowed), run by CI. ADR 041's Watch entry is closed. Migration first, then deploy.

Agentic notes: s51 review report (`docs/reviews/s51-edit-needs-a-plan.md`), ADR 041, the
`owner-can-edit` helper and `resolveEntitlement` (TS), `function-grants.test.ts` rules on SECURITY
DEFINER, `column-privileges.test.ts`, the publish/staging RPCs. Risk: RLS changes can break the
dashboard's own writes — research must enumerate them first.

Embed allocation: 0 bytes.

## Story s57-lapsed-export — an account without a plan can still export its own content

Product owner decision, 2026-09-28, from the s54 review. Complexity: 2. Branch
`feature/s57-lapsed-export`. Not launch-blocking. Today the middleware
(`src/middleware.ts` ~165-196) sends every dashboard page except Billing to checkout for an
account without a plan, so a lapsed trial or founding-offer owner cannot reach the export screen;
/privacy now tells them to email the privacy mailbox instead (s54).

- [ ] A signed-in owner whose plan has ended can open the export screen for their own sites and
  download their content (a read; ADR 041 keeps reads ungated), without regaining any write.
- [ ] Every other dashboard page still redirects to Billing; no write route changes.
- [ ] /privacy's "Your Control" copy is updated to say export stays available after a plan ends.
- [ ] Required local gates pass; one story commit.

Embed allocation: 0 bytes.

## Story s58-mobile-swipe-test-bites — the hero demo swipe test catches the snap-back bug

Product owner decision, 2026-09-28, from the s47b review. Complexity: 2. Not launch-blocking.
`e2e/hero-demo-mobile.spec.ts`'s "two swipes never scroll the demo backwards" passes with the
snap-back fix undone (on main and after s47b), so it does not protect what it was written for.

- [ ] With the snap-back fix reverted, the swipe test fails; with it, the test passes 10/10 runs
  (single worker, iPhone 13 profile). The Playwright total stays 44.

Embed allocation: 0 bytes.


## Story s59-installation-guide — customers and agents can install the real snippet

As a website owner, I can follow a public installation guide or give a complete
brief to my agent, so my intended website pages become editable and I can verify
the result without guessing where to paste the snippet.

Complexity: 3. Dependencies: shipped snippet generation, installation status and
editor invitation flows (s02, s29, s35, s41). Fits the existing self-serve install
and first-client-publish scope; adds guidance, not a new editing/authentication path.

- [ ] Public `/docs/install` explains the generated snippet using placeholders;
  examples match `buildEmbedScript`, including optional websocket configuration.
- [ ] The guide covers exact host registration, page coverage, installation,
  detection, invitation, save versus publish, independent visitor verification,
  rollback and relevant troubleshooting. It does not promise universal SPA support.
- [ ] A visible Copy agent instructions control and a plain-text/Markdown endpoint
  provide the same actionable brief, with required inputs, bounded authority and
  explicit verification/reporting criteria. Public content contains no live tokens.
- [ ] Footer and site Installation card expose the guide. Shared installation
  recipes are corrected so the dashboard does not contradict the public guide.
- [ ] Analytics URL collection and SPA lifecycle caveats are explicit; the guide
  never treats a referrer policy alone as credential-leak protection or a widget
  destroy call as complete SPA teardown.
- [ ] Public reading, keyboard navigation, small-screen layout, copy success and
  clipboard failure are verified. Existing snippet and invitation behavior stays
  unchanged; no new package is introduced.

## Story s60-public-content-timing — published copy reaches visitors sooner

As a visitor to a website with ReCopyFast, I see published copy sooner after the
initial page paint, reducing the visible swap from authored HTML to saved text.

Complexity: 3. Dependencies: existing public content authorization and page-scoped
pagination. This is a latency fix for shipped behavior, not a new content source.

- [ ] A successful widget content GET returns without awaiting advisory liveness
  bookkeeping, while still scheduling that bookkeeping reliably after response.
- [ ] Public page reads avoid the terminal empty database wave when a reliable
  exact row count is available. Unknown/invalid counts preserve current fallback.
  Server row caps, errors, page/shared scope and deterministic ordering stay safe.
- [ ] Existing authentication, CORS, original-copy fallback, staging secrecy,
  editor paths and all-site legacy reads keep their current contracts.
- [ ] Benchmarks record before/after request timing and hero behavior on the same
  aicompoz.com page; improvements are measured rather than inferred from green tests.
- [ ] Documentation does not claim zero flash: browser-side fetching still occurs
  after authored HTML can paint. No hardcoded source-copy sync or whole-page mask.

## Story s61-stable-copy-loading — IN PROGRESS on its branch (PR #59)

Full entry, research, plan and review travel on `feature/s61-stable-copy-loading`. Review:
"Ship allowed: no" — production delivery misses its 200 ms hold. Re-pointing its head bootstrap
to the s65a snapshot is a follow-up of s65a. Sequencing (owner decision, 2026-10-08): s67 merges
first, and #59 rebases onto s67's embed `init` and rows cache. See s67 Dependencies.

## Story s62-versioned-public-content-cache — SUPERSEDED on the visitor read path by s65a (PR #61 parked)

Its migration `20261005000000_versioned_public_content_cache.sql` is applied in production and
lands on main through s65a AC 0. Merging PR #61 now requires rebasing onto s65a's public-row
helper first; otherwise it reintroduces a second allow-list. Closing PR #61 is the owner's call.

## Story s63-release-dependency-patches — clear the existing production dependency gates

Product owner approval, 2026-10-05: “ok start” to the performance/release plan, including
security patches required before production. Complexity: 2. Branch
`feature/s63-release-dependency-patches`, from main. No new dependency.

- [x] Root and server production audits have zero high/critical advisories, with known
  moderate/low patches included when available within existing dependency ranges.
- [x] Only lockfile patch/minor resolutions required by the advisories change. No force
  upgrade, dependency addition, blanket unrelated update or runtime feature change.
- [x] Existing application, sanitization and websocket contracts pass all required gates
  and unchanged embed size ceilings. Root and server resolved versions are recorded.
- [ ] Independent review, one story commit and reviewable draft PR; manual merge/deploy.

PR58 already patches root engine.io/ip-address only. This owner-requested release work
covers the additional root Next/brace-expansion/moment/DOMPurify and server issues. Its
review must explicitly reconcile the overlapping lockfile patch; PR58 remains untouched.

Embed allocation: 0 bytes.

## Story s64-rollout-dependency-refresh — keep the active rollout audit gates green

Owner-approved rollout continuation, 2026-10-06. Complexity 2. Branch
`feature/s64-rollout-dependency-refresh`, independently from main. Fresh registry advisories
made main `719eb45` fail after s63/PR60 passed and shipped. No new dependency.

- [ ] Root and server production audits report zero blocking vulnerabilities after minimal
  within-range updates of proxy-addr, sharp and source-map-js. Existing manifest ranges stay.
- [ ] Generated locks name only the needed patched paths; no force/major/unrelated update.
- [ ] Relevant request-IP, sanitizer/image and websocket tests plus required full gates pass.
  Embed/browser artifacts and fixed gzip ceilings remain unchanged.
- [ ] Fresh independent review and normal hooks/CI pass before authorized squash merge.
  Deployment identity and public health are verified afterward; no billing/content mutation.

Embed allocation: 0 bytes. This security prerequisite stays separate from s59–s62.

## Story s65a-published-copy-snapshot — a host can render published copy into its own HTML

As a website owner, I can opt in to rendering ReCopyFast's published copy inside my own HTML
(server, edge or build), so visitors see published copy first — no authored-copy flash, no
visibility hold. The embed stays the zero-migration default, the editor and the fallback.

Owner approval, 2026-10-06: "let's cook" after the architecture review. The browser-only path
cannot meet s61's 200 ms hold (production content GET median 497–589 ms, 0/20 under 200 ms,
cold first request 3.3 s+). Serves perimeter #4 (no layout shift), #13 (staging → publish) and
#17 (public read for developers). Opt-in: angle #1 ("no rebuild, no API integration") stays
true for every site that only installs the embed. We document the integration; we ship no SDK,
build plugin or middleware into a customer's stack in this story.

Complexity: 4 (public delivery boundary, CDN caching, migration-ledger repair, security ADR,
browser proof). Dependencies: shipped staging → publish (#13), s51/ADR 041 public-delivery
rule. Branch `feature/s65a-published-copy-snapshot`.

Design in one line: an unauthenticated, page-scoped, CDN-cached read of the current published
rows. Freshness comes from a bounded CDN lifetime, not from rebuilding on each writer, so no
writer can be missed and no visitor can force rebuilds. There are no permanent versioned URLs.

- [ ] AC 0 — `supabase/migrations/20261005000000_versioned_public_content_cache.sql` lands on
  main byte-identical to the migration already applied in production (taken from s62), and the
  local migration list matches the remote ledger. No other s62 file is merged by this story.
- [ ] A public snapshot read for one site + page + language + variant returns exactly the rows
  today's `GET /api/content/[siteId]` returns for the same page and fixture (same projection and
  allow-list: never staging content, staging attributes, publisher identity or any private
  column), proven by a parity test. Page-scoped only: no unauthenticated whole-site or page index.
- [ ] The read needs no site token, origin, referrer or cookie. CORS is `*` without credentials.
  Response headers are asserted exactly: CDN lifetime + stale-while-revalidate ≤ 60 s in total,
  a strong ETag derived from the published rows, and no cookies set. The path is in the
  middleware's `isSessionlessPath`: a middleware test shows no `auth.getUser()` call and no
  `set-cookie` on it even when the request carries a session cookie.
- [ ] Freshness: a test changes `published_content` by direct SQL (bypassing every app writer)
  and the next origin read returns the new rows. The route has no second cache layer
  (`export const revalidate`, `unstable_cache`, fetch cache, `stale-if-error`), asserted by a
  test. Documented bound: ≤ 60 s after commit at our edge, stale-while-revalidate included.
- [ ] Retraction: only the current published rows are ever served. A superseded value, a
  deleted element and a deleted site disappear within the same ≤ 60 s bound, each with a test.
  (Sites are hard-deleted; there is no "deactivated" state.)
- [ ] Plan rule: public delivery never depends on the owner's plan (s51 AC 3, ADR 041). A lapsed
  owner's snapshot keeps serving, with a test. No new exposure, no new lockout.
- [ ] Abuse: the uncached origin is rate limited (public read: fail open, justified in a
  comment) — that limiter is the abuse bound, for canonical random keys and every other form
  alike. Malformed site ids, pages, languages or variants and unknown, missing, duplicated or
  reordered query parameters are rejected before any database query (route test: zero database
  calls), and the same refusals hold on a real `next start` server. Percent-encoding spellings
  that Next re-serializes before the handler runs are served as their canonical equivalent:
  canonicalization saves CDN entries, it is not an abuse bound (owner decision 2026-10-07,
  ADR 046). Unknown but well-formed keys get a short negative-cache response.
- [ ] Speed: 20 fresh-connection production requests from the operator's machine (edge region
  recorded) are all CDN hits with server wait (TTFB minus TLS) p50 ≤ 80 ms and max < 200 ms,
  and a reused-connection sample has TTFB p50 ≤ 50 ms. Recorded beside a same-session sample of
  today's content GET. Baseline from `/api/pricing` hits on 2026-10-06: server wait ≈ 60 ms,
  reused connection 16–65 ms. The same operator session probes freshness end to end: one
  publish and one element deletion are each visible / gone at the edge within ≤ 60 s.
  Measured, not inferred from green tests.
- [ ] No flash, proven in this repo: a Playwright fixture page renders the snapshot
  server-side with `data-rcf-id` anchors, then loads the embed. Anchored elements show no text
  change, and no stored `original_content` changes (the embed must not record published copy as
  authored copy).
- [ ] An ADR records unauthenticated published-copy delivery: why token/origin checks are
  dropped for this read only, why there are no permanent versioned URLs (retraction), the
  rejected options (CDN on the authenticated content GET — ineligible while
  Authorization-bearing; Redis behind fresh authorization — s62) and s62's fate. Integrator
  documentation states the URL format, the ≤ 60 s bound (at our edge — the host's own HTML
  caching adds to it), `data-rcf-id` anchoring and that the embed alone is not flash-free.
- [ ] The public-row allow-list lives in one new helper used by the snapshot route. The
  authenticated content GET keeps its inline projection until s65c; the parity test guards
  drift between the two. No behavior change to that GET or the embed runtime, proven by their
  existing suites. Lint, type-check, format, build and full tests pass.

Agentic notes:
- s62 (PR #61, never entered in this backlog) is SUPERSEDED on the visitor read path by s65a.
  Only its applied migration carries over (AC 0). PR #61 stays parked; closing it is the owner's
  call. Port `publicRow` / `validateRows` / `PRIVATE_ROW_FIELDS` from its
  `src/lib/content/published-content-cache.ts` into the single helper; do not merge that file.
- Today's projection is in `src/app/api/content/[siteId]/route.ts:393-442`. Open PRs #59 and #61
  both edit that route: s65a does not touch it (the parity test guards drift); adopting the
  helper there is a follow-up after those PRs settle.
- Published-row writers today: staging publish RPC (`src/app/api/staging/publish/route.ts:178`),
  bulk import/update, v1 POST/PUT/DELETE, site DELETE, and embed discovery
  (`route.ts:92-94`, `:637-642`, inserts rows with `published_content` set). Staging-only:
  A/B promotion (`src/lib/ab-testing/lifecycle.ts:186-195`), version restore, styles/apply.
  The TTL design makes this list informational, not load-bearing.
- Element identity: the runtime honours an authored `data-rcf-id` verbatim
  (`public/embed/recopyfast.src.js:872`); otherwise it hashes page path + structural DOM path
  (:879), which a server cannot recompute. Integrators pin existing ids as anchors.
- Hosting is settled in research (unauthenticated Next route behind Vercel's CDN vs Supabase
  Storage). No Cloudflare Workers (stack rule), no new dependency without justification.

Follow-ups, not this story: s65b; s65c; the aicompoz.com server integration (separate site-repo story
and PR, replacing PR #31's script-only install as the zero-flash path); re-pointing s61's head
bootstrap to the snapshot; server-side A/B; keeping or dropping s62's revision triggers.

Embed allocation: 0 bytes.

## Story s65b-snapshot-change-webhook — a host learns when to rebuild after published copy changes

As a website owner whose site builds statically or caches rendered HTML for long periods, I
receive a signed notification when published copy changes, so I can rebuild or revalidate
instead of polling. (Hosts that revalidate on a timer need nothing beyond s65a's ≤ 60 s bound;
this does not promise "within seconds": dispatch runs on the `*/5` cron, ADR 010.)

Complexity: 4 (two existing dispatch defects fixed, new event, payload merge). Dependencies:
s65a, outgoing webhooks (#18, ADR 010). Serves perimeter #18 ("static-site customers who must
trigger a rebuild"). Branch `feature/s65b-snapshot-change-webhook`.

- [ ] A new opt-in event `content.published` fires for the writers that change what visitors
  see: staging publish, bulk import/update, v1 POST/PUT/DELETE and AI translate. Embed discovery
  does not fire it (it records authored text the host already renders). Each writer has a test,
  including the negative one. Existing subscribers receive nothing new unless they opt in.
- [ ] Backward compatibility: a test pins every existing `content.updated` envelope and payload
  key and type; `content.updated` keeps firing exactly where it fires today.
- [ ] The payload carries the site id, the affected page paths merged across the coalescing
  window (or an explicit "all pages" flag when unknown or over a cap) and the s65a URL template.
  Delivery stays deferred, coalesced and signed, never on a writer's critical path.
- [ ] Lost update fixed: an event recorded while a sweep is delivering the previous payload is
  delivered in a later sweep, with a test. Today `sweepDueDispatches` clears `pending_*`
  unconditionally after sending (`src/lib/webhooks/manager.ts:380-399`).
- [ ] The pending-slot model carries each subscribed event type correctly: a webhook subscribed
  to both `content.updated` and `content.published` receives each under its own label, with a test.
- [ ] Worst-case delivery latency (cron interval + coalescing window) is verified in production
  and documented next to s65a's bound.

Agentic notes: marker `recordQualifyingEvent` (`src/lib/webhooks/manager.ts:307-346`, latest
payload replaces earlier at :337-339; event type set once per window at :342); sweep
(`:380-403`); only caller today `src/app/api/staging/publish/route.ts:214`; writers in
`src/app/api/bulk/{update,import}/route.ts`, `src/app/api/v1/content/route.ts`,
`src/app/api/ai/translate/route.ts`; cron `vercel.json:7-9`; ADR 010.

Embed allocation: 0 bytes.

## Story s65c-content-get-adopts-public-helper — one public projection

As the maintainer, the authenticated content GET uses s65a's public-row helper, so there is
exactly one public projection. Complexity: 1. Dependencies: s65a merged, and PRs #59/#61
settled (both edit `src/app/api/content/[siteId]/route.ts`).

- [ ] `GET /api/content/[siteId]` builds its rows with the s65a helper; its existing suite and
  s65a's parity test pass unchanged.

Embed allocation: 0 bytes.

## Story s66a-app-design-tokens-and-panels — straight, flat primitives, and the two panels the owner pointed at fit any screen

Split from `s66-app-design-system` at research. `docs/research/s66-app-design-system.md` (commit
`b534b23`) covers s66a, s66c and s66b; this entry keeps the original request and evidence. The
branch the research was written on, `feature/s66-app-design-system`, was renamed to this story's
branch, so this story's commits carry the s66 story and research commits too.

As a site owner working in the dashboard, every shared control and container is straight-edged
and flat: containers square, controls at 2 px, hairline borders that render the colour they were
given, opaque menus. The site-registered panel and the Share preview link dialog are readable
and usable at any width from 320 to 1920 px.

Owner request, 2026-10-07, with a screenshot of the site-details panel: "This panel needs a serious
redesign. and while u'r here, inspect all the application pages and improve the design. specialy
the layout and alignement, avoid rounded corner as much as possible and keep it straight and
clean. like 'supabase' website. make sure it's responsive." Second screenshot: the "Expires in"
select in Share Preview Link, a rounded box with its chevron jammed against the right border.

Owner decisions, 2026-10-08. The owner accepted the research recommendation as a whole, so its
five open questions take their defaults:
- Containers have 0 radius. Controls (inputs, selects, buttons) have 2 px. Badges are square
  (2 px, the control radius). Borders are 1 px hairlines. Only popovers, menus and dialogs cast a
  shadow. Surfaces are flat.
- Shell values: 56 px header, 24/600 page titles, 40 px controls, content width about 1180 px
  with 16/24/32 px gutters. These are the research values; refine them only with evidence. The
  shell lands in s66b; s66a records the values in `docs/design-system.md`.
- The marketing files that share `src/components/ui/*` square up too (accepted side effect).
  `/try` counts as Marketing. Marketing's own `rounded-*` classes are not touched
  ([ADR 050](./decisions/050-app-radius-is-two-semantic-tokens.md)).
- Split into s66a (this story), s66c (site information architecture) and s66b (page passes),
  executed in that order.

Observed defects (from the owner's screenshots, measured in research):
- **Site-registered panel.** There is a tall empty band above the content. The snippet and the
  instruction lines overflow the panel and are clipped. There is a panel-level horizontal
  scrollbar, and rounded boxes nest inside a rounded modal. Root cause: `DialogContent` is a grid
  whose implicit column takes the width of the unwrapped 300-character `<pre>` (2,524 px inside a
  588 px panel). The same mechanism affects all 12 dialog call sites (research fact 1).
- **Share preview link at 375 px.** There is a horizontal scrollbar and the content is clipped
  (`ShareLinkCard.tsx:69-70`). The native "Expires in" select draws the browser's chevron about
  6 px from its border.
- **Global CSS.** The unlayered `* { border-color: var(--line) }` (`globals.css:215-216`)
  overrides every `border-*` colour utility. Input boundaries therefore render at 1.45:1 (dark)
  and 1.34:1 (light) instead of at least 3:1. `bg-popover` has no token, so every dropdown and
  Select menu is transparent.

Complexity: 4. It covers cross-cutting primitives with 12 dialog call sites, a CSS-layer change
that also repaints authored border colours on marketing pages, and a new authenticated
Playwright harness. Dependencies: none. Branch `feature/s66a-app-design-tokens-and-panels`.
Design: `docs/designs/s66a-app-design-tokens-and-panels.md` and its `.html` mockup. Plan:
`docs/plans/s66a-app-design-tokens-and-panels.md`.

- [ ] **AC 1 — Site-registered panel.** At 320, 375, 768, 1280 and 1920 px:
  - the dialog's `scrollWidth` is at most its `clientWidth`, no descendant's right edge passes
    the dialog's, and the page has no horizontal scroll;
  - the title "Site registered" sits within the first 120 px of the panel (no empty band);
  - the snippet wraps inside its code block and can be read in full;
  - the block's Copy button is visible without horizontal scrolling and copies exactly the
    `embedScript` the API returned;
  - the dialog has exactly one scroll container (its body).

  Proved by the new `e2e/app-layout.spec.ts` (layout) and `SiteRegistrationModal.test.tsx` (the
  copied string).
- [ ] **AC 2 — Share preview link dialog.** The same overflow and single-scroll assertions hold
  at the same five widths, with two fixture links (one with a 60-character label and an
  unverified email). "Expires in" is a `NativeSelect`: its chevron's right edge sits 12 px (± 1)
  inside the control's right border, and the option text never runs under it. Proved by
  `e2e/app-layout.spec.ts` and `src/components/ui/__tests__/native-select.test.tsx`.
  `ShareSiteDialog.test.tsx` passes unchanged (label "Expires in", option "7 days", the
  Permissions checkbox group).
- [ ] **AC 3 — One radius scale for the app.** The scale is two tokens, `--radius-control: 2px`
  and `--radius-container: 0px`, used as `rounded-control` and `rounded-container`.
  `src/__tests__/design/radius-guard.test.ts` fails, naming file and line, when an app-surface
  file uses:
  - bare `rounded`;
  - the legacy `rounded-{xs…4xl}` scale, corner and side forms included;
  - `rounded-[n]` above 2 px;
  - `rounded-full` outside the exception list;
  - an inline `borderRadius` or `border-radius`.

  It also fails if either token exceeds its value. A per-file baseline of today's offenders may
  only shrink (s66b empties it). `src/components/ui/**`, `SiteRegistrationModal.tsx`,
  `ShareSiteDialog.tsx` and `ShareLinkCard.tsx` are at zero. The plan lists the exceptions
  (avatars, status dots up to 8 px, spinners). The guard's own fixtures prove it fails.
- [ ] **AC 4 — The two global CSS bugs.**
  - (a) The border reset sits in `@layer base`, so authored `border-*` colours apply. In the
    harness, an `Input`'s computed border colour is `--line-strong` and contrasts at least 3:1
    with the card, in dark and in light.
  - (b) `--color-popover` and `--color-popover-foreground` exist. The harness opens the Sites
    sort menu and finds its background opaque.

  A Jest test parses `globals.css` and pins both.
- [ ] **AC 5 — The dialog's root cause is fixed at all 12 call sites.**
  - `DialogContent` is a flex column that never scrolls.
  - `DialogBody` is the only scroll container, and its children can shrink (`min-width: 0`).
  - Header text is left-aligned at every width.
  - Below 640 px the dialog is a full-width bottom sheet.

  A source-scan test fails if a reachable `<DialogContent>` call site renders no `DialogBody`,
  or passes `overflow-*`, `max-h-*`, `rounded-*`, padding or `grid` classes to `DialogContent`.
- [ ] **AC 6 — Primitives match `docs/design-system.md` (s66a revision).** Each has an RTL test:
  - Button: heights 40/32/48/56 kept, 2 px radius, no shadow.
  - Input and a new Textarea: 2 px radius, `border-input`.
  - A new NativeSelect.
  - Radix Select: trigger aligned with Input, menu opaque.
  - Card: square and flat; the `interactive` variant no longer lifts.
  - Badge: 2 px radius.
  - Tabs: underline style; they wrap rather than clip.
  - DropdownMenu: opaque and square.
  - Alert: square.
  - A new CodeBlock: a label bar with an always-visible Copy button; it wraps by default and
    `wrap={false}` scrolls inside the block itself; the button reads "Copied" for 2 s; it copies
    the exact string.

  Every reachable native `<select>` (8 at research time) renders through NativeSelect, enforced
  by a source-scan test.
- [ ] **AC 7 — Contrast and focus.** In the harness, at 1280 px in dark and in light, body and
  muted text on the dialog surface contrast at least 4.5:1. A keyboard-focused Button, Input,
  NativeSelect and tab trigger each show a 2 px outline or ring and have a border radius of at
  most 2 px, so the focus outline is square.
- [ ] **AC 8 — Behaviour unchanged, except the listed copy.** The unit suite and the existing
  e2e flows pass. The only edited existing tests are the ones the plan lists:
  - `card.test.tsx` (radius, shadow, title size);
  - `badge.test.tsx` (radius);
  - `SiteRegistrationModal.test.tsx` (the success-state copy, and the removed "Go to Site
    Dashboard" button).

  The PR names each one with its reason. The Playwright contract (`playwright.config.ts` and
  `.github/workflows/ci.yml`) rises by exactly the harness's test count.
- [ ] **AC 9 — Evidence.** Run with `RCF_LAYOUT_SCREENSHOTS=1`, the harness writes captures of
  both panels at 375, 768, 1280 and 1920 px to
  `docs/designs/s66a-app-design-tokens-and-panels/after/`. They contain fixture data only: the
  site token reads `•••` and no real email appears. The PR also shows before/after captures at
  1280 and 375 of the marketing pages that import `ui/*` (the Header, `/docs/install`, a blog
  post, 404 and `/try`), so the accepted side effect is seen rather than reasoned about.
- [ ] **AC 10 — Docs and gates.** `docs/design-system.md` describes the s66a system (tokens,
  primitives, dialog rules), and ADR 050 records the radius-token choice. Lint, type-check,
  format, build and the full suite pass.

Not in this story:
- the page shell, page titles and per-page layout (s66b);
- routes, labels outside the two panels, and the site information architecture (s66c);
- `.surface-interactive`, `.text-display` and the legacy `--radius` scale, which marketing still
  uses;
- the default permissions of a preview link (s66c).

Embed allocation: 0 bytes.

## Story s66c-site-page-and-access — one page per site, and one clear way to give someone access (split proposed: s66c1 / s66c2)

Split from `s66-app-design-system` at research (§ Information architecture).

Owner requests, verbatim:
- 2026-10-07: "https://www.recopyfa.st/dashboard/sites is overwelming. have multiple levels of
  settings. and invite a client, and editors are confusing. which one to use and when ?"
- 2026-10-08, with a screenshot of the card's "Settings" button and the "Edit Website" dialog it
  opens: "also i told u this page https://www.recopyfa.st/dashboard/sites is overwelming. u need
  to have subpages to it. steps for user with advanve or quick setting."

Owner decisions, 2026-10-08:
- One URL per site, replacing the in-place "View Details" swap.
- One people section with exactly two clearly labelled actions:
  - "Add editor": durable. The editor can edit and publish on the live site and signs in with a
    one-time code.
  - "Share preview link": temporary. It is for viewing unpublished changes and is view-only by
    default.
- "Invite a client" is removed. The activation checklist opens the same Add editor flow under the
  same name.
- The card's misleading "Settings" button is renamed ("Edit website").
- Delete can be reached without hover.
- The Sites page gets lighter: fewer actions per card.
- Second message: real subpages; a guided "quick" setup for new sites; a separate "advanced"
  settings page; the "Edit Website" button and dialog brought onto the s66a design system.

What research found (re-verified at design on `origin/main` `d4dae46`):
- **The detail view.** "View Details" swaps the Sites page for an 11-card view held in component
  state, with no URL. It is about 4,400 px tall at 1280 and shows the install snippet three times.
- **Two access mechanisms under three labels, with field-for-field identical forms:**
  - "Add editor" (`site_editors`, durable);
  - "Invite a client" (the same `SiteEditorsCard`, inside a dialog);
  - "Share preview link" (`staging_access`, an emailed invite that expires).
- **The card's "Settings" button starts an edit session.** It goes through a dialog whose raw
  `EditWebsiteButton` is pill-shaped, opens the tab only after `await` (so pop-up blockers catch
  it), and injects an emerald DOM toast.
- **Delete sits behind a hover-only kebab** (`SiteCard.tsx:107`), so touch cannot reach it.
- **`GET /api/sites` is not RLS-scoped.** It uses the service client with an explicit
  `site_permissions.user_id = session user` filter (`src/app/api/sites/route.ts:26-29, :46-51`).
  It returns install credentials to admins only (`:169-181`) and never computes views (`:156`).
- **Renaming a site or changing its domain has no API.** `src/app/api/sites/[siteId]/route.ts`
  exports only `DELETE`, and only the creator may delete (`:43-48`).
- **The install guide names the old labels:** `src/lib/docs/installation-content.ts:118-119`,
  `:216` ("View Details") and `:226` ("Invite a client").

**Proposed split** (design and plan: `docs/designs/s66c-site-page-and-access.md`,
`docs/plans/s66c-site-page-and-access.md`, [ADR 052](./decisions/052-site-subpages-share-one-site-record.md)):

| Story | Scope | Size |
|---|---|---|
| `s66c1-site-pages` | The site's subpages with real URLs, the light Sites list, People & access with exactly two actions, the advanced Settings page, "Edit website" on the design system, labels and docs copy | 10 tasks |
| `s66c2-quick-setup` | The guided quick setup on the site Overview, which replaces the activation checklist and ends Live; per-site API keys in advanced Settings | 6 tasks |

Order: **s66b1-app-shell first** (it ships `PageShell`, ADR 053). Then s66c1 runs in parallel with
s66b2-app-page-passes; they touch different files. s66c2 follows s66c1. Whichever of s66c1 and
s66b2 merges second rebases the four shared files:
- `e2e/app-layout.spec.ts`, plus the Playwright count in `playwright.config.ts` and `ci.yml`;
- `src/__tests__/design/radius-baseline.json`;
- `docs/design-system.md`;
- this file.

No API, data or embed change in either: `git diff main...HEAD -- src/app/api supabase public/embed server`
is empty. Embed allocation: 0 bytes. One sanctioned exception, in s66c1: `GET /api/sites` returns the
caller's own `permission` (PR #72 review D1, ADR 052 Amendment).

Not in s66c1 or s66c2:
- renaming a site or changing its domain (needs `PATCH /api/sites/[siteId]`, which changes which
  origin `authorizeSiteRequest` accepts on a live install: a separate API story);
- returning the caller's role from `GET /api/sites` so Delete can be hidden from admins who did
  not create the site (an API follow-up; today the 403 shows in the dialog);
- computing page views;
- retiring `/api/sites/[siteId]/share` and `components/collaboration/*` (a dead-code chore);
- removing the account-level Settings › API Keys tab (s66b decides once s66c2 gives keys a
  per-site home).

## Story s66c1-site-pages — every site has its own pages, and one clear way to give someone access

As a site owner, the Sites page is a short list. Each site opens on its own URL with four
subpages: Overview, Install, People & access and Settings. On People & access I see exactly two
ways to give someone access, and each says when to use it.

Complexity: 4. Dependencies: **s66b1-app-shell merged** (`PageShell`, the page-shell guard, ADR
053), and s66a merged. Branch `feature/s66c1-site-pages`; today this is
`feature/s66c-site-page-and-access`, renamed on split validation. Decision: ADR 052.

- [ ] **AC 1 — Subpages with real URLs.**
  - `/dashboard/sites/[siteId]` (Overview), `/install`, `/people` and `/settings` each render
    through `PageShell`:
    - `title` is the site name, the page's only h1;
    - `meta` is its `StatusBadge`;
    - `description` is the domain as an external link;
    - `actions` are "Edit website" and "Version history";
    - `nav` is `SiteSubnav`: four links with exact hrefs, the current one `aria-current="page"`.
  - Navigating between subpages pushes history, so Back and Forward walk them and Back from
    Overview returns to Sites.
  - An id missing from the signed-in user's `GET /api/sites` response renders "Site not found"
    with a link back to Sites, and no other account's data. That route filters `site_permissions`
    by the session user.
  - A failed fetch renders a destructive Alert with Try again, never "not found".
  - Loading is a skeleton.

  Proved by the new `src/app/dashboard/sites/[siteId]/__tests__/layout.test.tsx` and by the new
  `e2e/site-pages.spec.ts` (navigate, Back, Forward, at 375 and 1280).
- [ ] **AC 2 — One site record (ADR 052).** `SiteProvider`, keyed by `siteId` in the site layout,
  fetches `GET /api/sites` once per visit and shares the site with every subpage.
  - While the site awaits install it re-polls every 5 s. It stops once the site is live and when
    the owner leaves the site.
  - A regenerated snippet replaces the snippet and token on every subpage at once.
  - A refresh that returns the site without install credentials clears them in the same render.
  - A rotation that resolves after the site changed is ignored.
  - Re-rendering with another `siteId` shows none of the first site's token.

  Proved by the new `src/components/dashboard/site/__tests__/SiteProvider.test.tsx`. The four poll
  tests move there from `sites/__tests__/page.test.tsx:200-284`, and the credential tests from
  `SiteDetailView.test.tsx:298-516`. Their assertions are unchanged.
- [ ] **AC 3 — A light Sites list.** One bordered list, one row per site. A row holds:
  - the name, as a link to the site's Overview;
  - the domain;
  - the `StatusBadge` and "Last edited …";
  - one primary action: "Continue setup" (a link to the Overview) while the site awaits install,
    "Edit website" otherwise;
  - a ⋮ menu, visible at rest, named "Open menu for <name>", reachable by keyboard. It holds Open
    site page, Edit website, Share preview link and Delete site.

  No hover-only control remains: the copy-domain button is gone. No in-place detail view or "View
  Details" remains. The page renders through `PageShell` and leaves the page-shell guard's
  pending list.

  Proved by the new `SiteRow.test.tsx` (it replaces `SiteCard.test.tsx`), by
  `sites/__tests__/page.test.tsx`, and by `e2e/site-pages.spec.ts` at 375: ⋮ is visible, and
  Delete is reached by taps alone, with the DELETE fulfilled by `page.route`.
- [ ] **AC 4 — Edit website.** One `EditWebsiteButton`, built on the s66a `Button`
  (`rounded-control`; no pill, no DOM toast, no confirmation dialog), over a `useEditSession`
  hook extracted from `ActivationChecklist`:
  - it opens the tab synchronously on click;
  - it POSTs `/api/edit-sessions/create` with `durationHours: 2` and the permissions the
    caller's own grant allows (PR #72 review D1, ADR 052 amendment): from the row, the menu and
    the header an admin sends `["edit","admin"]`, a publish member `["edit","publish"]`, an edit
    member `["edit"]`, and a viewer gets no Edit website; the checklist sends `["edit","publish"]`;
  - it navigates only to an http(s) URL on the registered host.

  A blocked pop-up or a refused request closes the tab and shows an inline destructive Alert. The
  "Edit Website" dialog and the "Settings" and "Open site in edit mode" labels are gone.

  Proved by the new `EditWebsiteButton.test.tsx` and `useEditSession.test.ts`.
  `ActivationChecklist.test.tsx:393-480` (the open-tab, host-check and pop-up tests) passes with
  only its button name changed.
- [ ] **AC 5 — Install.**
  - The install snippet appears **exactly once** on the page, in every install state: a
    `CodeBlock` labelled HTML whose "Copy snippet" copies the exact `embedScript`. Live and stale
    no longer hide it behind "View install snippet".
  - The `SiteInstallationCard` status, mismatch warning and checking alert follow it, then the
    platform recipes (text only).
  - Then "Site token": a `CodeBlock` with "Copy site token", and "Regenerate snippet" with the
    same confirmation and the same POST.
  - A member without install credentials sees "Only this site's admins can see its install
    snippet." instead of the placeholder `YOUR_SITE_TOKEN` snippet.

  Proved by the new `install/__tests__/page.test.tsx` (exactly one element whose text contains
  `data-site-token`; the copied string is exact) and by `SiteInstallationCard.test.tsx`.
- [ ] **AC 6 — People & access.** It has exactly two action buttons, each with its explainer:
  - "Add editor": "For someone who keeps editing this site. They sign in with a code sent to their
    email and keep access until you remove them."
  - "Share preview link": "For a one-off review of unpublished changes. View only unless you allow
    more, and the link stops working after the time you choose."

  Below them come "Editors" (`SiteEditorsCard`, now list-only: rows, resend, remove, previously
  removed) and "Preview links" (the new `PreviewLinksList`: `ShareLinkCard` rows with copy and
  revoke), each under its own heading with a count. Each list refetches after its action.

  - "Add editor" opens the new `AddEditorDialog`: `InviteEditorForm`, `POST /api/editor/editors`,
    default View+Edit. After success, the dialog shows the delivery notice or the editor-hub
    fallback, then "Done".
  - "Share preview link" opens `ShareSiteDialog`, now **create-only**. Its default grant is
    **`["view"]`**, and it resets to `["view"]` after each send. The s68c 409 (removed editor)
    shows in its Alert.
  - A member who is not an admin sees both actions disabled, with "Only this site's admins can
    give access."

  Proved by the new `people/__tests__/page.test.tsx` (exactly these two action buttons), the new
  `AddEditorDialog.test.tsx` (the enrolment tests move there from `SiteEditorsCard.test.tsx`), the
  new `PreviewLinksList.test.tsx`, and `ShareSiteDialog.test.tsx` (the default grant is
  `["view"]`).
- [ ] **AC 7 — "Invite a client" is gone.**
  - The checklist step is labelled "Add editor" and opens `AddEditorDialog` with today's
    View+Edit+Publish preset (s35).
  - Its edit action is "Edit website".
  - `/docs/install` names "Open site page / Install / People & access / Add editor".
  - The teams-moved notice points at People & access.
  - `git grep -n "Invite a client" -- src ':!**/__tests__/**'` matches only tombstone comments.

  Proved by `ActivationChecklist.test.tsx`, by new assertions in
  `src/lib/docs/__tests__/installation-content.test.ts`, and by `teams-moved-notice.test.tsx`.
- [ ] **AC 8 — Settings (advanced).**
  - The page opens with "Advanced settings. You don't need any of these to start editing."
  - General: name and domain, read-only, then "Renaming a site or changing its domain isn't
    available yet."
  - Domain ownership (`DomainVerification`, moved from the detail view).
  - Webhooks.
  - Content import and export. Its "History" tab is renamed "Operation history", so the word no
    longer means two things.
  - A Danger zone with Delete site: the same `DELETE /api/sites/[siteId]` and the same
    confirmation, titled "Delete site?" in sentence case. Success replaces the URL with
    `/dashboard/sites`. The creator-only 403 shows in the dialog.

  Proved by the new `settings/__tests__/page.test.tsx`. `BulkOperations.test.tsx:506,516,527`
  passes unchanged: `/history/i` still matches.
- [ ] **AC 9 — Overview and entry points.**
  - The Overview shows the relabelled checklist, then three metrics (Edits, Content elements, Last
    activity), then Site details (Created, Last updated, Site ID with Copy). "Page views" is
    dropped because `GET /api/sites` never computes it.
  - The registration success panel gains "Open site page", which goes to the new site's Overview.
  - The dashboard's "Your sites" rows link to their own site page.
  - The breadcrumb reads "Dashboard › Sites › Site › People & access": a UUID segment reads "Site".
    `Breadcrumbs.tsx` is s66b-owned; s66c1 makes only this change, and the second to merge
    rebases.

  Proved by the new Overview page test, a new assertion in `SiteRegistrationModal.test.tsx`, and
  new cases in `Breadcrumbs.test.tsx`.
- [ ] **AC 10 — Tests that change, radius at zero, and gates.** The PR names each changed test
  with its reason:
  - `sites/__tests__/page.test.tsx`:
    - the `SiteCard` mock (`:28-38`) becomes a `SiteRow` mock;
    - the `SiteDetailView` mock (`:40-46`) is removed;
    - the poll tests (`:200-284`) move to `SiteProvider.test`;
    - "View Details" / "Back to Sites" (`:349-392`) become a row-link href assertion.
  - `teams-moved-notice.test.tsx`: the mocks (`:35-45`), and `/Share panel/i` (`:90`) becomes
    `/People & access/i`.
  - `SiteCard.test.tsx` becomes `SiteRow.test.tsx`:
    - the metrics (`:57-62`, `:174-182`) are removed;
    - View Details / Settings (`:70-86`) become the link and "Edit website";
    - "Delete Site" (`:96`) becomes "Delete site";
    - the hover copy-domain test (`:102-126`) is removed.
  - `SiteDetailView.test.tsx` is split across the provider, Install, Settings and Overview
    tests:
    - "Embed Script" / "Copy Embed Script" (`:139`, `:189`, `:330-351`) become the single "Copy
      snippet";
    - "Site Token" (`:207-212`, `:534`) becomes "Site token";
    - the quick stats (`:120-127`) lose Page views;
    - `onClose` (`:566-585`) is removed.
  - `SiteInstallationCard.test.tsx`:
    - "keeps the snippet available but out of the way" (`:151-160`) becomes: the snippet is shown
      when live;
    - `findByText("Copied")` (`:102`) becomes a role query, because `CodeBlock` also announces
      "Copied" in its live region.
  - `SiteEditorsCard.test.tsx`: the enrolment tests (`:117`, `:165-239`, `:374-557`) move to
    `AddEditorDialog.test.tsx`.
  - `ActivationChecklist.test.tsx`:
    - "Invite a client" becomes "Add editor" (`:141`, `:147`, `:160`, `:322`, `:378`);
    - "Open … in edit mode" becomes "Edit website: …" (`:150`, `:161`, `:404-476`);
    - the `SiteEditorsCard` mock (`:9-25`) becomes an `AddEditorDialog` mock.
  - `ShareSiteDialog.test.tsx`:
    - the default grant becomes `["view"]` (`:76-80`, `:110-122`);
    - `renderDialog` (`:25-37`) no longer waits for a list fetch.
  - `e2e/app-layout.spec.ts`:
    - `openShareDialog` (`:296-301`) opens from People & access;
    - the long-label check moves to the page list;
    - `/Create a shareable link/` (`:550`) becomes the new description;
    - the share-icon visibility check (`:505-508`) becomes the row ⋮.

  No other existing test changes. The e2e flows (register, share, edit, publish) pass.

  Gates:
  - The 14 s66c-owned files in `radius-baseline.json` (49 offences) reach zero and leave the
    baseline: `sites/page.tsx`, `ActivationChecklist`, `BulkOperations`, `DomainVerification`,
    `EditWebsiteButton`, `InviteEditorForm`, `SiteDetailView`, `SiteEditorRow`, `SiteEditorsCard`,
    `SiteInstallationCard`, `VersionHistoryPanel`, `VersionPreviewDialog`, `VersionTimelineItem`
    and `WebhooksPanel`.
  - New files have zero offences, and every new `sites/**` page passes the page-shell guard.
  - `e2e/site-pages.spec.ts` finds no page-level horizontal scroll and no descendant past its
    container on any subpage or the list, at 375 and 1280. The Playwright contract (`56`, in
    three places) rises by exactly its test count.
  - `git diff main...HEAD -- src/app/api supabase public/embed server` is empty, save one
    sanctioned addition (PR #72 review D1, 2026-10-08; ADR 052 Amendment): `GET /api/sites` returns
    each site's `permission`, the caller's own grant. It only chooses what "Edit website" asks for
    (admin → `["edit","admin"]`, publish → `["edit","publish"]`, edit → `["edit"]`, view → no
    button); the session route re-reads the live grant and refuses anything higher (s68a,
    ADR 047), so the field grants nothing.

> Hand-off from s66b2 (2026-10-08): s66b2 left `radius-baseline.json` holding only this story's
> 14 entries. If s66c merges last, it deletes the baseline once empty and makes
> `radius-guard.test.ts` zero-tolerance (owner decision in the s66b plan). s66b2 also added
> rules R5 (flat), R6 (no 700) and R7 (1px borders) to `page-shell-guard.test.ts`, with this
> story's offenders pending, shrink-only: `sites/page.tsx` [R1, R2, R5],
> `EditWebsiteButton.tsx` [R5], `VersionTimelineItem.tsx` [R5: the hover shadow and, since the
> s66b2 review widened R5 to rings, the `ring-4` / `ring-2` halos on its status dots],
> `SiteDetailView.tsx` [R6]. When s66c deletes or renames a pending file, it deletes the PENDING
> entry together with the file, in the same change: the guard fails on an entry whose file is
> gone and names it. When a pending file passes its rule, the shrink-only check fails until the
> rule is removed from its entry.

Embed allocation: 0 bytes.

## Story s66c2-quick-setup — a new site is walked to Live, and advanced settings hold the rest

As a site owner with a new site, its Overview walks me through three steps until the site is
Live, and picks up where I left off. Everything optional lives on the site's Settings page.

Complexity: 3. Dependencies: s66c1 merged. Branch `feature/s66c2-quick-setup`.

- [ ] **AC 1 — Quick setup replaces the activation checklist.** One component, `QuickSetup`,
  replaces `ActivationChecklist`. It keeps the same `useSiteActivation` data, the same dismissal
  endpoint, and the same loading and error states. It has three steps:
  1. "Site added": always done.
  2. "Install the snippet": a `CodeBlock` "Copy snippet", the line "Paste it just before
     `</body>`…", a link to Install, and a live status row. The row flips from "Waiting for the
     first page view…" to "Installed…" on the provider's poll, with no reload. The step is done
     when activation says `installed` or the site is no longer awaiting install.
  3. "Start editing": "Edit website", or "Add editor", which opens `AddEditorDialog` with
     View+Edit+Publish. Edit website and Add editor appear when step 3 becomes current, once
     step 2 is done. Before that, step 3 shows only its title and one line. The step is done when
     `invited` or `published`.

  The current step is expanded. The header reads "Step N of 3". Progress comes from the server
  only, so leaving and returning resumes at the first incomplete step. The step markers reuse the
  registration panel's `InstallStep`, extracted to `components/dashboard/InstallStep.tsx`.

  Proved by `QuickSetup.test.tsx`, which replaces `ActivationChecklist.test.tsx` (its assertions
  are carried over where the behaviour stays).
- [ ] **AC 2 — Done means Live.**
  - When the site is live, the header reads "Setup complete — <name> is live" in the success tone.
    A stale site (installed, not live) reads "… is installed", as its Stale badge does.
  - Step 3 stays offered until it is done or the owner chooses "Hide quick setup" (persisted, as
    today). Then the panel is gone.
  - This replaces s35's single completion card ("installed + invited + published").

  Proved by `QuickSetup.test.tsx`.
- [ ] **AC 3 — Dashboard Overview: one row per unfinished site.** Each row reads
  "<name> · Step 2 of 3: Install the snippet" with a "Continue setup" link to the site Overview.
  It replaces a full checklist per site. Proved by `src/app/dashboard/__tests__/page.activation.test.tsx`
  (its mock and its count assertion change).
- [ ] **AC 4 — New sites land in quick setup.** "Open site page" on the registration panel and
  "Continue setup" on a Sites row both land on the Overview with step 2 active. Proved by
  `e2e/site-pages.spec.ts` (the register and activation responses are fulfilled by `page.route`)
  at 375 and 1280.
- [ ] **AC 5 — Per-site API keys in advanced Settings.** `ApiKeysPanel` takes an optional
  `siteId`; with it, the site selector is hidden and the keys are that site's. The site's Settings
  page shows it between Domain ownership and Webhooks. Account Settings keeps its tab; s66b
  decides its fate. Proved by a new `ApiKeysPanel.test.tsx`.
- [ ] **AC 6 — Gates.**
  - No API, data or embed diff.
  - New files have zero radius offences and pass the page-shell guard.
  - The quick-setup e2e passes at 375 and 1280, and the Playwright contract rises by exactly its
    count.

Embed allocation: 0 bytes.

## Story s66b-app-page-layout — every app page shares one shell, one title and one left edge

Split from `s66-app-design-system` at research. It completes the original story's AC 3 and AC 4
on every app page, using s66a's primitives, radius guard and layout harness.

As a site owner, every app page sits in the same frame:
- a 56 px header;
- content up to 1180 px wide, with 16/24/32 px gutters;
- the same title row on every page (a 24/600 h1, actions on the right);
- one left edge shared by headings, filters, panels and tables.

No page scrolls sideways or clips content at 375, 768, 1280 or 1920 px.

Owner request, 2026-10-07 (quoted in s66a): "inspect all the application pages and improve the
design. specialy the layout and alignement … make sure it's responsive." Owner decisions,
2026-10-08: 56 px header; 24/600 page titles; content about 1180 px wide with 16/24/32 px
gutters (research values; refine them only with evidence).

**Split again at design, 2026-10-08, into s66b1 and s66b2.** That day the owner gave s66c
everything under `/dashboard/sites`:
- the light list;
- the per-site subpages;
- the quick-setup stepper and the advanced settings;
- the Edit Website dialog;
- the site components.

s66b now provides the page frame that s66c builds on, and applies it to every other app page,
the sidebar and the header. The frame must land first, so:
- **Order:** s66b1 → then s66c and s66b2 in parallel. They touch different files; whichever
  merges second rebases the shared ones.
- **This changes s66c's dependency:** s66c now depends on s66b1, not the reverse.
- **Docs:** design `docs/designs/s66b-app-page-layout.md` (+ `.html`); plan
  `docs/plans/s66b-app-page-layout.md` (Part 1 = s66b1, Part 2 = s66b2); decision
  [ADR 053](./decisions/053-page-frame-is-layout-plus-page-shell.md).

Measured defects, re-verified in code at `d4dae46` (after s66a):
- **Four title styles:**
  - `.text-display` (a 26–32 px clamp, 600), on Overview and Sites through `PageHeader`, and
    hand-rolled on Billing;
  - 30/700 on Content and Settings;
  - an h2 at 24/700 with no h1 on Analytics, which shows no title at all while sites load;
  - an h3 inside a card on site detail (s66c).
- **Billing** nests `container mx-auto px-4` in all five of its states and in its Suspense
  fallback. Its title sits 16 px right of every other page's.
- **Analytics** puts the title, the site select, two date inputs and two export buttons in one
  non-wrapping row, which overflows the page by 3 px at 1280 (research measurement; code path
  unchanged).
- **Header and sidebar.** The header is 64 px, translucent with a backdrop blur, and the sidebar
  brand row matches its 64 px. Sidebar items, rail, plan box and brand tile are rounded. The
  mobile overlay blurs.
- **Overview's metric grid** leaves its right third empty at 1024 px and wider.
- **Standalone pages.** `/login`, `/signup` and `/auth/error` have no h1 (`CardTitle` is an h3).
- **Flatness.** `.surface-interactive` (lift plus shadow) is on two app call sites, and
  `hover:shadow-md` is on `ContentElementCard`.
- **Weight.** `font-bold` appears 13 times in 5 reachable files.
- **Radius baseline.** 45 files and 122 offences:
  - 3 files / 10 offences are the shell's (s66b1);
  - 28 files / 63 are s66b2's;
  - 14 files / 49 are s66c's (the site components).
- **Already fixed by s66a, proven here.** The Settings tabs wrap at 375. The Sites status
  filter's clipping at 375 is s66c's now.

`.text-display` is not repurposed: `/blog` uses it, and `globals-css.test.ts` pins it
byte-identical. The page title gets `.text-page-title` (ADR 053).

Not in s66b (either part):
- **Everything under `/dashboard/sites` and the site components (s66c):**
  - `SiteDetailView`, `SiteCard`, `ShareButton`, `ShareSiteDialog`, `ShareLinkCard`,
    `SiteRegistrationModal`, `ActivationChecklist`, `EditWebsiteButton`;
  - `SiteEditorsCard`, `SiteEditorRow`, `InviteEditorForm`, `SiteInstallationCard`,
    `DomainVerification`, `WebhooksPanel`, `BulkOperations`;
  - `VersionHistoryPanel`, `VersionPreviewDialog`, `VersionTimelineItem`.
- **Off-palette colour.** The Analytics icon hues, Billing's emoji and the "PRO PLAN" copy, and
  the emerald DOM toast in `EditWebsiteButton`. The toast needs design-system gap 1, a toast
  primitive (research § Off-system colour; follow-up).
- **`.text-title` from 17 to 16 px.** It is pinned byte-identical and was never in these ACs.
- **The marketing site and `/blog`.**

Embed allocation: 0 bytes.

## Story s66b1-app-shell — one frame and one title on every app page

Complexity: 3. It covers the shell files, a new composition primitive and five page headers,
plus a guard and the harness at four widths. Dependencies: s66a merged (done). **Blocks s66c.**
Branch `feature/s66b1-app-shell` (this design's worktree branch,
`feature/s66b-app-page-layout`, is renamed at Execute, as s66a did).

> Execute, 2026-10-08: AC 2–6 are implemented, and their source-guard and RTL proofs are green.
> Their harness proof (`app pages @375/@768/@1280/@1920`) has not run yet: no local Supabase
> was available, so CI's E2E job is its first run. Tick AC 2–6 when that job is green.

- [x] **AC 1 — `PageShell` and `PageHeader`.** `src/components/ui/page-shell.tsx` exports
  `PageShell({ title, eyebrow?, meta?, description?, actions?, nav?, children })`.
  - Its root is `[data-page-shell]`, a column with gaps of 24 px (16 below 640).
  - It renders `PageHeader` (`header[data-page-header]`): exactly one h1 in the new
    `.text-page-title` (24/32, 600, −0.015em).
  - `meta` sits inline after the h1. `actions` are on the title row at ≥640 and in their own
    row after the description below 640. `nav` sits under the header.
  - The children render as direct children of the root.
  - `.text-display` stays byte-identical.

  Proved by:
  - `src/components/ui/__tests__/page-shell.test.tsx` (new): one h1; every slot renders in
    order; the children are direct children;
  - a new `.text-page-title` case in `src/__tests__/design/globals-css.test.ts` (the existing
    cases are unchanged).
- [ ] **AC 2 — The frame.** In `src/app/dashboard/layout.tsx`:
  - The header is 56 px, opaque `bg-card`, with no blur. Its inner row uses the main column's
    `max-w-[1180px]` and gutters (16 / 24 / 32 at <640 / ≥640 / ≥1024).
  - The sidebar brand row is 56 px with a bottom rule level with the header's.
  - Sidebar items, the active rail, the plan box and the brand tile are square. The tile's text
    is weight 600.
  - Below 1024, the menu button is centred in the header over its spacer at every gutter, and
    the overlay does not blur.
  - `layout.tsx`, `DashboardNavigation.tsx` and `Breadcrumbs.tsx` leave
    `src/__tests__/design/radius-baseline.json`.

  Proved by:
  - the new harness tests `app pages @375/@768/@1280/@1920` in `e2e/app-layout.spec.ts`:
    header height 56 ± 0.5; at ≥1024 the brand row's bottom equals the header's;
  - `radius-guard.test.ts`, unchanged; its baseline loses 3 entries.
- [ ] **AC 3 — One title on every non-sites app page, in every state.** Overview, Content,
  Analytics, Settings and Billing each render exactly one `PageShell`, so exactly one h1 at
  24/600:
  - Content and Settings drop their local 30/700 headers.
  - Analytics' title is the h1 "Analytics". It was the h2 "Analytics Dashboard", the
    **one listed label change**; no test pins it. `AnalyticsDashboard` renders the frame in its
    loading, error, empty and ready states, and `analytics/page.tsx` no longer returns a
    titleless spinner.
  - Billing renders one `PageShell` across its five states and its Suspense fallback. Its
    no-plan heading becomes an h2.

  Proved by:
  - `src/__tests__/design/page-shell-guard.test.ts` (new):
    - every routed `src/app/dashboard/**/page.tsx`, or its listed delegate, renders
      `<PageShell`;
    - `<PageHeader` appears only in `ui/page-shell.tsx`;
    - no `<h1` on the app surface outside `ui/page-header.tsx` and the four standalone pages;
    - `src/app/dashboard/teams/page.tsx` is exempt as a redirect;
    - the pending list holds `src/app/dashboard/sites/page.tsx` only, is shrink-only, and s66c
      empties it;
    - self-test fixtures prove each rule fires;
  - new RTL tests counting h1s per state:
    - `src/__tests__/components/dashboard/AnalyticsDashboard.page-shell.test.tsx`;
    - `src/__tests__/app/dashboard/content-page-shell.test.tsx`;
    - `src/components/billing/__tests__/BillingDashboard.page-shell.test.tsx`;
  - the harness (one visible h1 per page at each width).
- [ ] **AC 4 — One left edge.** On those five pages at 375, 768, 1280 and 1920 px:
  - the h1's left x is 16 / 24 / 288 (± 0.5) at 375 / 768 / 1280. At 1920 it is the main
    column's left plus 32 (530 with overlay scrollbars; the 1180 column centres in whatever
    width the scrollbar leaves). It is one value per width across the five pages;
  - `[data-page-shell]` has at least two element children, and every visible one starts on
    that x.

  To get there:
  - Billing's container is removed, and no `container` utility remains on the app surface (a
    guard rule);
  - Content's filter row leaves its card;
  - Analytics' site select and dates become a wrapping filter row under the header, with the
    `Input` primitive for the dates;
  - the exports become header actions.

  Proved by the harness and the guard.
- [ ] **AC 5 — No sideways page scroll, readable chrome.** The five pages have
  `documentElement.scrollWidth ≤ clientWidth` at 375, 768, 1280 and 1920 px (Analytics at 1280
  included). At 1280, in dark and in light, these contrast at least 4.5:1 with their own
  background: the h1, the description, the breadcrumb, and the inactive and active sidebar
  items. Proved by the harness.
- [ ] **AC 6 — Contract handed over, nothing else moves.**
  - The unit suite and the e2e flows pass.
  - No route changes. No label changes except AC 3's Analytics title.
  - Existing tests are not edited. The only changes to test files are:
    - the baseline entries in AC 2;
    - the Playwright contract, rising by exactly 4: `playwright.config.ts` and
      `.github/workflows/ci.yml`, on top of whatever s66c has added if it merged first;
    - the capture root in `e2e/app-layout.spec.ts`, parameterised so s66b writes to
      `docs/designs/s66b-app-page-layout/after/` (s66a's assertions are unchanged).
  - `docs/design-system.md` records `PageShell`, `.text-page-title`, the 16/24 rhythm and the
    shell values as in code. ADR 053 is merged.
  - Lint, type-check, format, build and the full suite pass.

Follow-up (review m-8): scrollbar-gutter: stable deferred — with a reserved gutter,
react-remove-scroll-bar adds body margin-right on Radix scroll lock, shifting layout on
classic-scrollbar systems; fix options: compensate via --removed-body-scroll-bar-size /
data-scroll-locked margin reset, modal={false}, or reserve the gutter on the scroll container only.

Embed allocation: 0 bytes.

## Story s66b2-app-page-passes — flat, square, nothing clipped

Complexity: 3. It is many files, but mostly class-level changes, against guards that already
exist. Dependencies: s66b1 merged. It runs in parallel with s66c. Branch
`feature/s66b2-app-page-passes`.

> Execute, 2026-10-08: AC 1–6 are implemented. AC 1 and AC 3 are proved by source guards and
> ticked. `standalone pages @375/@768/@1280/@1920` ran red, then green, against `next start`
> (signed out, no Supabase needed). `app pages @w` (clip check and its negative control, rest
> and hover shadows, the metric grid, the tabs) has not run: no local Supabase, so CI's E2E job
> is its first run. Tick AC 2, 4, 5 and 6 when that job is green. The radius baseline holds
> only s66c's 14 entries, so the guard is not flipped here (AC 1, second branch).
>
> Review fix, 2026-10-08 (`docs/reviews/s66b2-app-page-passes.md`): AC 6's contrast is measured
> on the changed surfaces in both themes (hovered Overview row, ThemePicker's selected label and
> option boundary, the standalone h1 and description); ThemePicker's options take `border-input`;
> R5 reads every shadow, ring and hover movement, and Card is exempt in `elevated` only; R7 pins
> 1px borders. Same Playwright count (64).

- [x] **AC 1 — Radius at zero on s66b's files.** Each of the 28 s66b2-owned baseline files
  (listed in the plan; 63 offences) has zero radius offences, and its entry is deleted. The only
  `rounded-full` left is the rule's own exceptions: `Avatar`, status dots of 8 px or less, and
  spinners. `UserMenu` uses the `Avatar` primitive and keeps the classes
  `UserMenu.test.tsx:258` pins.
  - If the baseline is then empty (s66c merged first), the guard drops the baseline and becomes
    zero-tolerance on the whole app surface. That change to `radius-guard.test.ts` is listed in
    the PR.
  - If it is not empty, only s66c entries remain, and s66c flips it.

  Proved by `src/__tests__/design/radius-guard.test.ts`.
- [ ] **AC 2 — Flat panels.**
  - No `surface-interactive`, `hover:shadow-*`, `group-hover:shadow-*`, `transition-shadow` or
    `hover:-translate-y-*` on the app surface. `ui/metric.tsx` and Overview's site rows drop the
    lift, and `ContentElementCard` drops `hover:shadow-md`. Marketing keeps
    `.surface-interactive`.
  - A static `shadow-*` appears only on floating primitives (dialog, menu, select content, Card
    `elevated`, the version sheet) and on the skip link's `focus:` state.

  Proved by:
  - new rules in `page-shell-guard.test.ts` (with self-tests; pending: s66c-owned files only,
    shrink-only);
  - the harness: no element in `main` has a `box-shadow` at rest, and a hovered Overview metric
    and site row keep `transform: none` and `box-shadow: none`.
- [x] **AC 3 — No 700 in the app.** No `font-bold`, `font-extrabold` or `font-black` on the app
  surface: the nine in `AnalyticsDashboard` and the rest become `font-semibold`. Proved by a new
  rule in `page-shell-guard.test.ts` (pending: `SiteDetailView.tsx`, s66c, shrink-only).
- [ ] **AC 4 — Page passes.**
  - **Overview.** The metric grid fills its width: at ≥1024 the lead takes a third and spans
    three rows, and the other three take two thirds. "Your sites" is one panel of divided rows.
    `loading.tsx` matches.
  - **Billing.** Inner insets, tiles, progress tracks and the benefits box are square.
    `UpgradeDialog` and `ThemePicker` drop `border-2` (selected: accent border plus tick).
  - **Settings.** The tabs at 375 keep every trigger inside the tab list's box.
  - **Content.** The error and empty icon circles become `IconTile`s.
  - **Error surfaces.** `dashboard/error.tsx` and `ErrorBoundary` are square.

  Proved by the harness:
  - at ≥1024, the rightmost metric's right edge equals the content's right edge (± 0.5);
  - at 375, every tab trigger lies inside the `tablist`'s box;

  by the radius guard (square), and by R7 in `page-shell-guard.test.ts` (no box border over 1px,
  so `border-2` cannot come back; added at review). The radius guard reads radius only.
- [ ] **AC 5 — Nothing clipped, standalone pages included.** On Overview, Content, Analytics,
  Settings and Billing, and on new signed-out harness tests
  `standalone pages @375/@768/@1280/@1920` for `/login`, `/signup`, `/auth/error` and `/edit`
  (+4 tests):
  - no page-level horizontal scroll;
  - no visible element whose `overflow-x` is not `visible` has `scrollWidth` more than 1 px over
    its `clientWidth`. Form controls, `text-overflow: ellipsis`, `sr-only` elements and a
    `CodeBlock` `pre` are excepted.

  Each standalone page has exactly one h1 in `.text-page-title`, a square logo tile where the
  page has one (`/login` and `/signup`; `/auth/error` and `/edit` have none), and `IconTile`s in
  place of circles. With `RCF_LAYOUT_SCREENSHOTS=1`, the harness writes every
  page at the four widths to `docs/designs/s66b-app-page-layout/after/`, with fixture data only.
- [ ] **AC 6 — No behaviour change.**
  - The unit suite and the e2e flows pass. No route or label changes.
  - Existing tests change only where the PR lists them:
    - the baseline entries;
    - `radius-guard.test.ts`, if AC 1 flips it;
    - the Playwright contract (+4).
  - At 1280, in dark and in light, body and muted text contrast at least 4.5:1 on every changed
    surface (harness).
  - `docs/design-system.md` statuses for s66b flip to "in code".
  - Lint, type-check, format, build and the full suite pass.

Embed allocation: 0 bytes.

## Story s66d-design-system-gaps — STUB (backlog, not planned)

Logged at the s66b2 review, 2026-10-08: three Spacing rows of `docs/design-system.md` have a spec
and no story (s66b scoped them out). One line each; no research or plan until the owner schedules
it.

- [ ] Panel (`Card`) padding 16 below 640 (24 from 640 is in code). Row "Panel (`Card`)
  padding".
- [ ] Panel toolbar row: 48 tall, with a `border-b`. Row "Panel toolbar row".
- [ ] Table header / row: 36 / 44, `px-4`. There is no `Table` primitive (gap 8, "No `Table`
  primitive"), so this starts with whether a third screen needs one. Row "Table header / row".

Embed allocation: 0 bytes.

## Story s67-embed-spa-support — the plain snippet works on any site, including single-page apps

As a site owner whose site renders in the browser (React, Vite, Vue, Svelte, any client
router), I paste the plain snippet before `</body>` and every page is editable and shows
published copy, both on first load and after in-app navigation, with no site-specific code.

Owner decision, 2026-10-07, after the openflows.ai install: "Fix embed and don't hardcod
anything. out solution shoul work on any website using the script." No host-side workaround:
openflows.ai keeps the plain snippet as the real-world proof.

Evidence: openflows.ai production on 2026-10-08, plain snippet (marcusbey/openflows-ai#3),
headless Chromium.

- `/` and `/fr`: the embed's first scan runs at about 385 ms and finds 0 candidates. React has
  rendered 335 candidates by 671 ms. The body `MutationObserver` is attached at about
  1,230 ms, at the end of the async init chain (`setupMutationObserver`, after
  hydrate, A/B and socket), so it never sees React's render and never rescans. The page ends
  with 0 editable elements and published copy is never applied. A manual
  `window.ReCopyFast.scanForContent()` finds 212.
- `/blog`: 94 elements are found, only because posts arrive after the observer is attached.
- Devin review on openflows-ai#3, confirmed in code: `hydrateStoredContent()` fetches
  page-scoped rows once (`page_path`). After a client-side route change, the rescan reports
  the new elements but never fetches or applies that route's published copy.
- Related gaps to confirm in research: the observer only watches `childList`, so text set
  via `characterData` (i18n, frameworks updating text nodes) is missed. The debounce has no
  max wait, so continuous mutation postpones a rescan indefinitely. A framework re-render
  can write authored copy back over applied published copy.

Owner decisions, 2026-10-08, on the research's open questions
(`docs/research/s67-embed-spa-support.md`). The owner accepted every recommended default:

1. Rows nobody edited stop overwriting page text. Only a row with an actual human edit is
   applied. Accepted loss: rows created by the API create call (`POST /api/v1/content` stores
   `original_content = published_content`) no longer write text. Making that call store
   `original_content = null` is a follow-up, not s67.
2. On an edited element, published copy wins over any host re-render, capped at 10 rewrites
   per element per page view.
3. Hash-route sites (`/#/route`) are out of scope. The install guide documents the limitation
   and the workaround.
4. s67 merges before PR #59 (s61), and #59 rebases afterwards.
5. AC 9 is restated: the embed patches no host global. It wraps no history method, and it
   detects route changes with a path check on DOM mutation plus the Navigation API event
   where the browser has one.

Added to scope, 2026-10-08, from security review finding M8 (deferred into s67 because it is
embed startup configuration): `window.RECOPYFAST_API` / `window.RECOPYFAST_WS` DOM clobbering
(`public/embed/recopyfast.src.js:23-36`). See AC 12.

Complexity: 4 (embed startup ordering, history integration, re-render races, byte budget,
fixture and production proof). Dependencies: none to build it. Sequencing (owner decision 4,
2026-10-08): s67 merges before PR #59 (s61), which also edits embed startup. #59 rebases onto
s67's `init` and rows-cache shape afterwards. Its late-swap policy against s67's model is
decided at that rebase. Branch `feature/s67-embed-spa-support`.

- [ ] AC 1, late render: content rendered at any time after the script starts is scanned. On
  openflows.ai `/` with the plain snippet, editable elements are > 0 within 2 s of render
  settling.
- [x] AC 2, late elements get published copy: an element found by any rescan receives its
  published row from the page rows already fetched, without a refetch, within one rescan
  cycle. Only edited rows write text (AC 11).
  Evidence: `embed-spa.test.ts` ("applies a late element's edited row without a second GET"); e2e `embed-spa` E1.
- [x] AC 3, route change: when the normalized page path changes (`pushState`,
  `replaceState`, `popstate`), the embed fetches that page's rows once and applies them. New
  ids use the new path. Elements that persist across routes keep working. A change of query
  or hash only does not refetch. Hash-route sites (`/#/route`) are out of scope (owner
  decision 3). `/docs/install` states the limitation and the workaround: switch the router to
  history mode, or give each route's elements an author-written, unique `data-rcf-id`.
  Evidence: `embed-spa.test.ts` (AC 3 block: one GET per path, none on revisit or query/hash change, ids equal to a full load, authored restore, Navigation API, a node added before `pushState` in the render's task, edit-click check, mid-fetch `replaceState`); e2e E1, E2; `/docs/install` SPA section (`installation-content.test.ts`).
- [x] AC 4, framework re-render (owner decision 2): if the host rewrites an element that has
  an edited row, whatever text it writes, published copy is applied again. The cap is 10
  writes per element per page view, where one in-app route visit counts as one page view.
  The embed's own writes never trigger a loop.
  Evidence: `embed-spa.test.ts` (AC 4 block: synchronous re-apply via `textContent`, `nodeValue` and unrelated text, 10-write cap, no self-loop); e2e E1 (no frame shows authored copy after the host write-back), E3.
- [x] AC 5, no starvation: continuous DOM mutation cannot postpone a rescan beyond a bounded
  max wait.
  Evidence: `embed-spa.test.ts` ("rescans within 1,000 ms under a 100 ms ticker").
- [ ] AC 6, static and SSR sites unchanged: the existing embed unit and e2e suites stay green.
  Existing tests change only in the ways `docs/plans/s67-embed-spa-support.md` lists
  (harness teardown, one config setup, the install guide's SPA wording, the e2e count), and
  the PR states each change. aicompoz.com keeps server-rendered copy in first paint, with 0
  swaps.
- [x] AC 7, edit mode across navigation: an invited editor keeps the edit session after
  in-app navigation, and newly rendered elements are editable.
  Evidence: `embed-spa.test.ts` (AC 7 block); e2e E5.
- [x] AC 8, budget: the embed stays within its gzip ceiling. Any added byte is paid for in
  this branch, because raising a ceiling is a defect.
  Evidence: 45,841 / 33,073 gz after the review, re-review, verification and PR #69 review fixes (D2, D3; D1 deferred to `s67b-nested-edit-composition`), ceilings ratcheted down from 45,880 / 33,120 (`scripts/build-embed.mjs`, `build-size-gate.test.ts`); gross +804 / +825 against the funded floor.
- [x] AC 9, degrades and never breaks (owner decision 5): no uncaught exception reaches the
  host page. The embed patches no host global: `history.pushState` and
  `history.replaceState` keep their identity. Route changes are detected by a path check on
  each DOM mutation batch, plus the Navigation API `currententrychange` event where the
  browser has it.
  Evidence: `embed-spa.test.ts` (AC 9 block: history identity, own globals, throwing navigation path; throwing observer callback); `embed-startup-config.test.ts`; e2e E1 (history identity, 0 page errors).
- [ ] AC 10, proof: a framework-free SPA fixture (renders after a delay, navigates with
  `pushState`, re-renders text) runs in CI e2e. In production on openflows.ai with the
  plain snippet, edit and publish on `/` and on a route reached by in-app navigation; both
  show published copy, on load and after navigation.
- [x] AC 11, edited rows only (owner decision 1): a row whose current copy equals its
  `original_content` never writes page text. A row with no `original_content` counts as
  edited. Attribute rows (`href`, `alt`) apply as before.
  Evidence: `embed-spa.test.ts` (AC 11 block); e2e E1 (the unedited ticker row is never written).
- [x] AC 12, startup configuration cannot be clobbered (M8):
  - `window.RECOPYFAST_API` and `window.RECOPYFAST_WS` are honoured only when they are
    strings whose origin equals the origin of the embed script's own `src`.
  - Anything else is ignored, whether it is an element from DOM clobbering or a cross-origin
    string. The endpoint then comes from `data-api-url` / `data-ws-url`. For the API only, it
    is otherwise derived from `script.src`. There is still no derived WebSocket URL.
  - A unit test proves it, and it is paid within the s67 allocation.
  Evidence: `embed-startup-config.test.ts` ("startup endpoints (M8)").
- [x] AC 13, host-safe writes: writing copy never replaces or removes a node the host
  rendered. A React 19 app whose edited element later re-renders structurally (a conditional
  text removed, an element inserted before the text) keeps running: no `NotFoundError`, and
  the root does not unmount.
  Evidence: `embed-react-writes.test.tsx` (R1c, R1d, text-node identity, copy in the direct text node beside a `<span>`, `<svg>` kept, no write on a matching DOM); e2e E3, E4.

Follow-ups, not this story: the comment above the Navigation API handler in
`public/embed/recopyfast.src.js` (about :3962-3964) says the callback's own writes are
"discarded" with `takeRecords`; when the observer's own delivery runs first, they are passed to
the callback instead (harmless, verification minor 1). Correct it with the next embed change: a
comment edit changes the artifact's `@generated-from-sha256` line, so s67 ships the verified
build as is.

Embed allocation: ≤ +850 gz gross on each measurement (bundle and widget), net ≤ 0, paid in
this branch. See § Byte budget and `docs/plans/s67-embed-spa-support.md`.

## Story s67b-nested-edit-composition — STUB (backlog)

Owner decision, 2026-10-08, on the PR #69 fix run's byte overrun: **"Ship D2+D3 now, D1 as
follow-up"**. D2 (A/B markers leave with the route) and D3 (null-prototype row index) shipped
with s67. This story is D1. There is no research or plan until the owner schedules it.

**Evidence: PR #69 bot review (Devin), D1, red** (`docs/reviews/s67-embed-spa-support.md`).
A parent and a mapped descendant both have edited rows (`<h1>Buy <span>now</span></h1>`).
Writing the parent (`writeText`) blanks the child's text, and the child's re-apply changes the
parent's aggregate text. The observer re-applies each in turn until both hit the 10-write cap.
One edit ends missing or mixed, and the host wins every later write-back. The bug is new with
s67's reapply-on-overwrite. The fix run reproduced it in the `embed-spa.test.ts` harness: 30
writes on that `h1` during boot.

**Rule designed in the fix run (implemented and tested, not shipped).**
- An element owns every text node beneath it, except those inside a descendant whose own copy
  the embed applied in this page view. Such a descendant is a mapped element with a recorded
  write: an edited row, a realtime update, a variant or an editor save. A write goes into the
  owned text nodes only. The re-apply check, discovery, the Edit Board and the editor read
  only the owned text.
- "Has applied copy", not "is mapped". Protecting every stamped descendant breaks rows saved
  on main that hold the parent's whole text: `<h1>Build faster with <span>AI</span></h1>`
  edited once would render "…AIAI".
- Spacing. The outer element owns `"Buy "` with its trailing space, so its row must be
  `"Shop "`. A row of `"Shop"` renders "Shoptoday". So the editor reads and saves the owned
  text untrimmed around such a descendant.
- The restore on a route change ignores the rule and writes over the whole element. The
  authored copy was recorded with the child's words inside it, and restoring only the owned
  part gave "Buy nownow". Consequence: when a persistent parent and child are both edited, the
  parent shows its whole authored text after navigation, and the child stays blank until the
  host re-renders it.
- Editor: on an outer element with such a descendant, text typed inside the descendant belongs
  to the descendant, and the outer save does not keep it.
- Tests that went red then green: the `h1` settles on "Shop today" in at most 3 writes, a
  rescan writes nothing, and 12 alternating host write-backs are each undone in place; the
  route-change restore, reported under the new path; the editor saves the outer element's
  own copy ("Sell ").

**Cost.** Measured in the fix run, D1 with D2+D3 built to 45,932 / 33,162 gz: +89 / +89 over
the ceilings in force then (45,843 / 33,073). D1's own share over D2+D3 is +87 / +84:
- the rule's core: +63 / +63;
- the restore over the whole element: about +11 / +5;
- the editor: about +12 / +12;
- the identity check: +2 / +3.

Behaviour-preserving micro-funding found about −10 at most. Re-measure against the ceilings in
force when this story is planned (45,841 / 33,073 after s67).

**Funding options measured against the D1+D2+D3 build.** Each one changes shipped behaviour,
so each is the owner's call:
- Drop discovery coalescing entirely (the 10 s spacing, the trailing report, the
  10-per-page-view cap): −94 / −94, which fits. It brings back the research's risk of a live
  feed hitting the 100/min discovery limit.
- Keep the 10 s spacing, drop the trailing report and the cap: −70 / −70.
- Drop only the 10-per-page-view cap: −21 / −19.
- Stop observing shadow roots: −14 / −15.
- A different rule, "outer edit wins": an inner element yields while its parent shows applied
  copy. It costs +36 / +38 on top of D2+D3, against D1's +87 / +84. It is untested, and it
  renders "Shop " rather than "Shop today".

**Embed allocation:** TBD.

## s68 — security hardening (split into s68a / s68b / s68c)

Product owner decision, 2026-10-08: **"s68 now: H1 + H2 + top mediums"** through the pipeline;
lows go to the backlog (`s69-security-lows`). Runs before s66/s67 ship. Source: the security
review of `origin/main` `659778e`, every claim re-verified in code by the s68 research
(`docs/research/s68{a,b,c}-*.md`). Planning showed more than ten tasks across three deploy
targets, so the story is split by blast radius: database and session authority (s68a), HTTP abuse
bounds (s68b), realtime parity (s68c).

**Precondition, owner action — not code (C1).** Live-format production credentials exist in public
repository history (a service-role JWT, a Supabase personal access token, the Postgres password, a
Redis URL; introduced at `1e620ac` and `216d10e`). Values are never reproduced in any document.
Checklist the owner confirms before s68a ships, one tick each:
- [ ] Supabase service-role key rotated; Vercel and Fly env updated; old key refused.
- [ ] Supabase personal access token revoked.
- [ ] Postgres password reset; pooler connection strings updated wherever stored.
- [ ] Redis credential rotated; `REDIS_URL` updated on Vercel and Fly.
- [ ] History rewrite / secret-scanning alert closure decided (rotation is the fix; a rewrite only
  limits further copying).

Re-verification outcome (what the review said vs the code): H1 confirmed, and reproduced on a
fresh replay. **H2 is false as a replay risk** — `20260809120000` revokes on replay and the
function-grant and RLS suites pass 6/6 against a fresh PG14 replay — but neither suite is ever run
by CI. M4 confirmed for a different reason than reported: the authorizer verifies the token
against the database's `site.id`, not the route's spelling. M9 reproduced on a replay; one of its
policies is live in production (inert there). A new finding of the same class as the realtime
revocation item — HTTP never consults `site_editors` for staging tokens — is folded into s68c.

Order: **s68a first** (production exploit, migration); **s68b in parallel** (independent, no
migration); **s68c after s68a merges** (reuses ADR 047 and s68a's e2e seeds).

Follow-ups, not s68:
- M8 — DOM clobbering of `window.RECOPYFAST_API` in the embed: belongs with s67, which is rewriting
  embed startup (follow-up line only; s67's docs are not edited here).
- All lows → `s69-security-lows` (stub below).
- Lows found by the s68 research itself (raw-id limiters on editor routes, unbounded bulk
  operations, `staging_access` admin direct writes, unmetered share and domain routes, …) →
  `s69-security-lows` R1–R10.

## Story s68a-edit-session-authority — an edit session never carries more than its holder's live grant

Owner decision 2026-10-08 (above). Launch-blocking: the escalation is live in production.
Complexity: 4. Dependencies: none (C1 is an owner precondition, not a code dependency). Branch
`feature/s68a-edit-session-authority`. Decision: ADR 047.

Evidence: an `edit` member inserts `edit_sessions {permissions: ['admin'], expires_at: '2099-…'}`
with their own JWT (policy `20250817000000_complete_database_setup.sql:483-492`, live in
production; reproduced on a replay) and publishes with it, because `validateEditSessionAccess`
(`src/lib/auth/editor-access.ts:416-457`) trusts the row and `POST /api/staging/publish`
(`route.ts:106-138`) gates on it. Removing the member (`share/route.ts:514-518`) leaves the session
alive. Replay-only self-escalation policies (`20260731008000:117-123,201-210`) and a live invitee
rewrite policy (`20260801200000:956-968`) sit beside it. The definer-function guard
(`function-grants.test.ts`) passes on a replay but no CI step runs it against a database.

- [x] An edit-session token grants at most the intersection of its row's permissions and the
  holder's live direct `site_permissions` row for the site, read at every validation: an `edit`
  member's `admin`-stamped session cannot publish (403), a removed member's session is refused
  (401), a NULL-holder session is refused (401). Tests:
  `src/lib/auth/__tests__/edit-session-authority.test.ts`,
  `src/__tests__/api/staging/publish-edit-session-authority.test.ts`.
- [x] A session older than 24 h from `created_at` is refused whatever its `expires_at`. Test:
  `edit-session-authority.test.ts` ("refuses a session past the 24 h lifetime").
- [x] Removing a member deactivates their edit sessions for that site (scoped by site and user).
  Test: `src/__tests__/api/sites/share-revokes-edit-sessions.test.ts`.
- [x] Edit sessions are issued only through the service role, after the caller's grant is read
  under their own session. Test: `src/__tests__/api/edit-sessions/create-service-role.test.ts`
  (insert on the service client, never the user client).
- [ ] Migration `20261008100000_edit_sessions_service_role_writes.sql`: PUBLIC/`anon`/`authenticated`
  hold no write privilege or write policy on `edit_sessions`, `anon` no SELECT; an `edit` member's
  direct INSERT (SQL and PostgREST with a real JWT) is refused; rows the new rules would refuse are
  deactivated, idempotently. Test: `src/__tests__/db/edit-sessions-privileges.test.ts`.
- [x] Migration `20261008110000_converge_replay_privileges.sql`: on a replayed database a stranger
  cannot insert themselves into a team, an invitee cannot rewrite their invitation, a collaborator
  admin cannot UPDATE `site_permissions` (the creator row stays unstamped); team managers still
  update invitations. Test: `src/__tests__/db/replay-privilege-convergence.test.ts`.
- [x] The definer-function and RLS invariants run against both replays in CI with a required
  database (`function-grants`, `rls-policies` and the two new suites, in
  `scripts/run-db-invariants.mjs` and the e2e job's DB step), and the convergence migration's
  postcondition aborts if any `SECURITY DEFINER` function is executable by `anon`/PUBLIC or by
  `authenticated` outside the three allowlisted predicates. Test: negative control in
  `replay-privilege-convergence.test.ts` ("postcondition refuses a definer function executable by
  anon"); CI red when the database is unreachable.
- [ ] `e2e/share-edit-publish.spec.ts` and `e2e/realtime-parity.spec.ts` seed edit sessions owned
  by the site owner and pass; Playwright total stays 45.
- [ ] Rollout: application first, then the two migrations; the dry run lists exactly those two
  files; the read-only verification query in the plan returns zero rows in production, recorded in
  the PR. Runbook `docs/operations/edit-session-authority.md`.
- [ ] ADR 047 merged (amends ADR 042's "Watch"); `docs/quality/qa-register.md` no longer states
  `20260809120000` is blocked without the operator's ledger evidence. Required local gates pass;
  one story commit plus one migration commit.

Embed allocation: 0 bytes.

## Story s68b-api-abuse-bounds — public and member endpoints cannot be turned into probes, forgers or slow loops

Owner decision 2026-10-08 (above). Complexity: 3. Dependencies: none (parallel with s68a).
Branch `feature/s68b-api-abuse-bounds`. Decision: ADR 048. Covers M1, M2, M3, M4, M5, M6, M10.

- [ ] M1 — webhook deliveries and test sends never follow redirects; a 3xx is a failed attempt
  with a fixed message and nothing from a redirect target is stored or returned. Tests:
  `src/__tests__/webhooks/manager.test.ts` ("a 302 is a failure and stores no body"),
  `src/__tests__/webhooks/redirect-not-followed.test.ts` (real loopback servers: the target gets
  zero requests).
- [ ] M10 — domain file verification does not follow redirects, does not echo the target's status
  text on a redirect, and checks addresses with the webhook guard's unicast allowlist;
  `PUT /api/domains/verify` is limited per user, fail closed, before any DNS or HTTP work. Tests:
  `src/__tests__/security/domain-verification.test.ts`, `src/__tests__/api/domains/verify-limiter.test.ts`.
- [ ] M2 — `useRegex: true` is refused per operation and no `RegExp` is built from request input;
  `((a+))+$` against 30 characters returns in < 100 ms; literal find/replace unchanged (ADR 048).
  Test: `src/__tests__/api/bulk/update-literal-only.test.ts`.
- [ ] M3 — editor code routes canonicalise `siteId` (lower-case UUID, malformed → 400) before the
  limiters, so case spellings share one bucket. Tests: `src/__tests__/api/editor/request-code/route.test.ts`,
  `src/__tests__/api/editor/submit-code/route.test.ts`.
- [ ] M3 — each guess is charged atomically before comparison: 20 concurrent wrong guesses
  against one code are compared at most 5 times and burn the code. Tests:
  `src/lib/auth/__tests__/editor-verification-attempts.test.ts`, `src/__tests__/db/editor-code-attempts.test.ts`
  (real Postgres, CI e2e DB step).
- [ ] M4 — the per-site limiters of content discovery POST and `ab-tests/{bucket,active,track}` key
  on the authorized `site.id`: an upper-case spelling with the genuine token spends the canonical
  bucket; no spelling is refused. Test: `src/__tests__/api/public-site-bucket-canonical.test.ts`.
- [ ] M5 — `ab-tests/track` accepts what the embed sends today and refuses with 400, before any
  database call, more than 50 events, a body over 64 KB, malformed ids, unknown event types,
  oversized or prototype-polluting `metadata`, a `visitor_id`/`session_id` that is empty, over 64
  characters or carries control characters, and a `geo_*` over 64 characters. The two values the
  host page passes to the public `trackConversion(eventName, value)` are coerced, never refused
  (plan amendment 2026-10-08): an unusable `value` is stored as 1, and the event name is
  stringified (a non-text, non-number, non-boolean name becomes "conversion"), stripped of control
  characters and cut to fit the 1 KB metadata bound. A repeated conversion for the same (visitor,
  test) is not counted, nor one from a visitor with neither a bucket assignment for that test nor a
  view of it (recorded or in the same batch) — the view and conversion beacons may arrive in either
  order (PR #65 review D1). Test: `src/__tests__/api/ab-tests/track-bounds.test.ts`.
- [ ] M6 — staging verification and editor-code e-mails escape the site label; `POST
  /api/staging/access` refuses a non-string label, one over 80 characters or with control
  characters (400, nothing created). Tests: `src/lib/email/__tests__/resend-codes.test.ts`,
  `src/__tests__/api/staging/access.test.ts`.
- [ ] No migration, no new dependency, no `public/embed/` or `server/` change. Required local gates
  pass; one story commit; post-deploy operator checks (plan "Rollout") recorded in the PR.

Embed allocation: 0 bytes.

## Story s68c-realtime-grant-parity — the realtime service admits exactly whom HTTP admits

Owner decision 2026-10-08 (above), including the two medium items left open by the s07a review
(`docs/reviews/s07a-realtime-service-hardening.md:40-59`). Complexity: 3. Dependencies: s68a merged
(ADR 047, e2e seeds). Branch `feature/s68c-realtime-grant-parity`.

- [x] M7 — staging admission and every re-validation apply HTTP's device binding: a forwarded
  verified link presented with another User-Agent, or a verification older than 12 h, is refused at
  the handshake and dropped by the sweep. Tests: `src/__tests__/websocket/auth-parity.test.ts`
  (binding and UA-hash rows), `src/__tests__/websocket/server.integration.test.ts`
  ("staging admission is device-bound").
- [x] `join-dashboard` requires a live editor grant: a socket holding only the public site token is
  refused and receives no `content-updated`. Test: `server.integration.test.ts` ("a plain viewer's
  join-dashboard is refused").
- [x] Editor revocation matches e-mail case-insensitively: `John@Example.com` is refused at the
  handshake and dropped within one sweep after `john@example.com` is removed. Test:
  `server.integration.test.ts` (revocation block, mixed-case fixture).
- [x] Edit-session sockets follow ADR 047: the holder's live grant bounds the permissions, a removed
  holder's socket is dropped within one sweep, a session past 24 h is refused. Tests: parity rows in
  `auth-parity.test.ts`; integration "drops an edit-session socket whose holder was removed".
- [x] HTTP staging validation (and code re-send/verify) refuses a token whose e-mail has a revoked
  `site_editors` row for the site, in any case; no directory row changes nothing. Test:
  `src/lib/auth/__tests__/staging-access.revoked-editor.test.ts`.
- [ ] `e2e/realtime-parity.spec.ts` passes; `server/` imports nothing from `src/`. Required local
  gates pass; one story commit; the operator's Fly deploy and smoke recorded in the PR.

Embed allocation: 0 bytes.

## Story s69-security-lows — STUB (backlog, not planned)

Owner decision 2026-10-08: the lows of the `659778e` security review go to the backlog. One line
each; no research or plan until the owner schedules it.

**L1–L20 of the review** (verbatim scope from the 2026-10-08 review of `659778e`; line numbers
at that commit, to be re-verified at research time):

- [ ] L1 — Production CSP is `script-src 'self' 'unsafe-inline'` (`src/middleware.ts:247`, live);
  no inline-XSS protection. Move to a per-request nonce with `'strict-dynamic'`.
- [ ] L2 — Bulk CSV export has no formula-injection guard (`src/lib/bulk/csv.ts:21-25`); the
  analytics export has one.
- [ ] L3 — Unauthenticated health endpoints return raw DB/storage errors, missing env var names
  and the region (`src/app/api/health/route.ts:93,130`; `health/ready/route.ts:41,78,104,159`).
- [ ] L4 — `CRON_SECRET` compared with `!==` (`cron/*/route.ts`, `blog/generate/route.ts:21`);
  use `timingSafeEqual` over SHA-256 digests.
- [ ] L5 — Raw Stripe errors returned to authenticated callers (payment-method existence oracle);
  payment-methods has no limiter (`billing/payment-methods/route.ts:121,206`;
  `subscription/route.ts:106,143`).
- [ ] L6 — `edit-board/styles/apply/route.ts:141-145` loads a style by id with no site or preset
  scope.
- [ ] L7 — Public routes with no limiter before authorization, against AGENTS.md:
  `ab-tests/{bucket,active,track}`, `staging/content` GET, `staging/publish`,
  `staging/validate`, `edit-sessions/{validate,extend}`.
- [ ] L8 — `public/embed/__fidelity__/index.html` test harness is served in production (live
  200) and uses `?widget=<url>` as a script `src` (`:380-409`); move it out of `public/`.
- [ ] L9 — `analytics/track` is a service-role write with `onStoreFailure:"allow"` (`:91-97`); a
  site-token caller can forge `login`/`content_edit` activity rows.
- [ ] L10 — `upload/image` reachable with only the public site token (`:124-136`): image hosting
  and quota exhaustion.
- [ ] L11 — `v1/content` POST stores `metadata` without `optionalMetadata` (`:236,298,322`), and
  `/api/published` then serves it.
- [ ] L12 — Grant minting accepts any subdomain (`src/lib/auth/editor-request.ts:73`) while the
  content routes pin the exact host.
- [ ] L13 — WS server: no helmet, `x-powered-by: Express`, `ACAO:*` and the live connection count
  on `/health` (`server/index.js:78,125-136`; live).
- [ ] L14 — WS per-site bucket consumed before token verification (`server/index.js:226-234`):
  121 bare handshakes/min lock real editors out of realtime.
- [ ] L15 — Edit Board history sets `innerHTML` from `created_by` (an email)
  (`public/embed/recopyfast.src.js:6157`, `:6234`); use `textContent`.
- [ ] L16 — `server/Dockerfile:9` is `node:20-alpine`: end of life and unpinned; CI audits on
  Node 24.14.0.
- [ ] L17 — Grant hygiene: `ALTER DEFAULT PRIVILEGES … REVOKE … FROM PUBLIC`
  (`20260809120000:213`) is a no-op; `generate_verification_code()` uses `random()` and is
  executable by `authenticated` (`20251230000000:172,275`); view-only members can read webhook
  `url` and `pending_payload` (`20260818000000:981`).
- [ ] L18 — `COMPLETE_DATABASE_SETUP_CLEAN.sql:461-478` recreates `FOR ALL` billing policies and
  `prepare-production.js:40` tells operators to run it; TLS verification off in
  `scripts/check-schema.mjs:78`, `scripts/check-ab-schema.mjs:139`, `setup-db-direct.js`.
- [ ] L19 — CI/header hygiene: `ci.yml` has no top-level `permissions:` and actions are pinned by
  tag, not SHA; HSTS lacks `includeSubDomains`; legacy `X-XSS-Protection` still set;
  `docs/operations/deployment-checklist.md:24` carries a truncated live-key account prefix.
- [ ] L20 — Dev-only dependency advisories: critical `shell-quote` via `concurrently` 9.2.0
  (GHSA-pqg4-j6r4-53mv, fixed args only), high brace-expansion/braces/micromatch via
  `eslint-config-next`, `@typescript-eslint`, jest, and server `nodemon`. `npm audit fix` clears
  shell-quote and brace-expansion.

**Lows the s68 research verified itself** (R-series, overlapping L7/L17 where noted):

- [ ] R1 — Per-site limiters keyed on the raw site id on authenticated editor routes
  (`staging/publish/route.ts:153`, `staging/content/[siteId]/route.ts:280`,
  `ai/translate/route.ts:218`, five `edit-board/*` routes): spelling variants multiply buckets.
- [ ] R2 — `bulk/update` accepts an unbounded `operations` array (`route.ts:31-38`); linear
  database cost per request once s68b removes regex mode.
- [ ] R3 — `staging_access` keeps admin-only INSERT/UPDATE policies for `authenticated`
  (`20251230000000_staging_workflow.sql:120-142`); an admin can write rows that bypass route
  validation (ADR 047 "Watch").
- [ ] R4 — `revokeSiteEditor` sweeps device grants but not the editor's `staging_access` rows
  (`src/lib/auth/editor-directory.ts:271-299`); s68c makes it non-load-bearing, the dashboard still
  lists them as live.
- [ ] R5 — `POST`/`GET`/`DELETE /api/domains/verify` have no limiter (`route.ts:132,389,451`); s68b
  covers `PUT` only.
- [ ] R6 — `/api/sites/[siteId]/share` (POST/GET/DELETE) has no limiter.
- [ ] R7 — The webhook URL guard narrows DNS rebinding but does not close it
  (`src/lib/security/webhook-url-safety.ts:19-26`, a recorded decision); pinning the resolved IP in
  a custom dispatcher would.
- [ ] R8 — `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE … FROM PUBLIC`
  (`20260809120000:213-214`) cannot remove PostgreSQL's global PUBLIC default for functions; every
  new definer function must revoke explicitly. s68a puts the guard in CI; a migration lint would
  catch it before review.
- [ ] R9 — `POST /api/teams/invitations/accept` writes under the user client
  (`route.ts:104,120`) and cannot succeed in production; teams are PRD graveyard — delete or 410.
- [ ] R10 — `request-code` never sets `siteLabel` (`route.ts:93-106`); after s68b escapes it, drop
  the dead parameter or set it deliberately.
- [ ] D2 — A/B conversion dedupe is check-then-insert (PR #65 Devin): a partial unique index on ab_test_results (test_id, visitor_id) WHERE event_type = 'conversion' + conflict-aware insert makes it atomic; needs a migration.

Embed allocation: 0 bytes.

## Story s70-content-changes — the Content page shows what changed, where, in words an owner understands

As a site owner, the Content page tells me what copy changed on my sites — edited, pending and
published — grouped by site and page, in human-readable locations, so I can review, compare,
revert or open it on the page without scrolling through hundreds of untouched strings.

Owner, 2026-10-08, looking at /dashboard/content: "what is the content page about ?? it doesn't
look great to me." Owner decision, same day: redesign it as a "Changes" page, next after s66c2.

Evidence (production, 2026-10-08):

- Every discovered element is one tall card titled with its internal id (`rcf-1gom2eazz3g`) and a
  CSS selector path (`div:nth-child(7) > div > button:nth-child(3) > span:nth-child(1)`).
- Untouched "Original" rows dominate; the few edited ones are buried. No grouping by site or page,
  no pagination.
- The embed's own UI was recorded as site content: the 🪄 AI-suggest button, "Failed to generate
  suggestions. Please try again.", buttons under `#rcf-editor-banner`. Research must confirm
  whether the current embed (after s67) still reports them and where the exclusion is missing.

Direction (accepted by the owner, to be sharpened by research and design):

- Default view: edited, pending and published rows only; "all discovered text" is a filter.
- Grouped by site → page; dense rows with a human-readable location ("Homepage · main heading"),
  the current text (expand to compare with the original), status, who/when, and actions: open on
  the page, history, revert where the product supports it.
- The same view filtered to one site as a "Content" tab on the s66c site pages.
- Junk rows from the embed's own UI are excluded, and the discovery bug is fixed at the source.

Complexity: TBD at research. Dependencies: s66c1 (site pages, merged), s67 (embed discovery,
merged). Branch `feature/s70-content-changes`.

Embed allocation: TBD at plan (the self-discovery fix may need embed bytes; ceilings only go
down).

Split at plan (owner-validated 2026-10-08, `docs/plans/s70-content-changes.md`), shipped in this
order:

- **s70a-embed-ui-not-content** (complexity 2) — the embed never maps or reports a node under a
  root it injected (Edit Board panel, AI suggestions modal, form-field popover, …); ceilings
  ratchet down to the measured bytes; one forward migration deletes the untouched rows it already
  recorded, after the owner approves the read-only count. Closes the leak of an editor's email
  ("by <email>") into public snapshot rows.
- **s70b-changes-page** (complexity 4) — `/dashboard/changes` (308 from `/dashboard/content`):
  Pending + Published by default, site → page groups, readable locations, compare, history,
  revert (Save as draft · Revert and publish for publishers), 50 rows a page from a
  security-invoker view (ADR 054); two read-only routes; never calls `GET /api/sites`.
- **s70c-site-content-tab** (complexity 2) — the same view for one site under its site page.

## Story s71-billing-plan-badge — the billing page never calls a paid plan "Free"

Owner, 2026-10-08, with a screenshot of `/dashboard/billing`: "here is my account. it says FRee on
the right and PRO on the left." The sidebar says **Pro**; the plan card says **Pro plan · Lifetime
access** and, in its top-right corner, a **Free** badge.

Cause (verified on `origin/main` `828970c`): `SubscriptionCard`'s status badge
(`src/components/billing/SubscriptionCard.tsx:133`) prints "Free" whenever there is no live
subscription row. A lifetime grant has no subscription row, so every lifetime owner sees "Free"
next to the plan they paid for. "Free" names a retired plan nobody is on
(`DashboardNavigation.tsx:136`). The empty payment-methods state then tells the same owner to "Add
a card to start a subscription" (`PaymentMethodsCard.tsx:205`).

Acceptance criteria:
- [ ] A plan held for life shows a "Lifetime" badge, never "Free".
- [ ] A live subscription keeps its status badge (Active, Trialing, Past due, …). A lifetime
  owner still running out a lower subscription's period sees "Lifetime" — the card describes the
  plan in force, which is the lifetime one — while that subscription's period and cancel rows stay
  visible below (as in the validated plan, case 3).
- [ ] A subscription still running out under a lifetime plan is named on the card (its plan, its
  end or renewal date, its status), and Reactivate is never offered for it.
- [ ] No state of the card prints "Free": with no subscription and no lifetime grant the card
  shows no status badge rather than a wrong one.
- [ ] The empty payment-methods copy does not offer "start a subscription" to an account whose
  plan is held for life; it says a card is for AI credits.
- [ ] Unit tests cover all four badge states and both empty-state copies.

## Story s72-edit-board-history-xss — a version's author is shown as text, never run on the customer's site

Owner decision, 2026-10-09, on the s70a review's F1 (major, pre-existing on main): **"Start s72 now,
in parallel (Recommended)."** Security story; no new UI, so no Design step. Source:
`docs/reviews/s70a-embed-ui-not-content.md` F1 and F4(a). Research:
`docs/research/s72-edit-board-history-xss.md`. Closes s69 L15 (the same sink at older line
numbers).

Cause (verified on `origin/main` `85784a5` and s70a `107c400`): the Edit Board History tab builds
"by <author>" with `innerHTML` from `content_versions.created_by`
(`public/embed/recopyfast.src.js:6496` main / `:6516` s70a). The author is a staging invite's
address, which a site admin chooses with no format check (`src/app/api/staging/access/route.ts:102-107`)
and can verify without the mailbox (column SELECT of `verification_code`,
`20260925120000:153-158`; table INSERT/UPDATE, `20251230000000:272`). A payload address runs on the
customer's origin when a staging-invite editor opens History, beside the edit link's bearer tokens
in `sessionStorage`. The same panel renders a restore's error and result through `innerHTML` too
(server-fixed strings today; the result prints "Restored true elements"). Only a site `admin` can
plant it; no non-admin or anonymous path reaches `created_by`.

Acceptance criteria:
- [ ] A version whose author is `<img src=x onerror=…>` shows the address as inert text in
  History: no element is created, and the date and "by …" keep their two-item layout. Test:
  `src/__tests__/embed/edit-board-history-xss.test.ts`.
- [ ] A restore's refusal message and its result are text; a successful restore reads "Version
  restored", never "Restored true elements" (plan decision 1). Test: same file.
- [ ] Every `innerHTML` in the embed source is a string literal or the constant icon map;
  `outerHTML`, `insertAdjacentHTML`, `document.write`, `createContextualFragment` and `DOMParser`
  do not occur. Test: `src/__tests__/embed/html-sinks-are-literal.test.ts` (red on main).
- [ ] `POST /api/staging/access` refuses with 400, creates nothing and echoes nothing when `email`
  is not a string or not a valid address (WHATWG rule, dotted domain, ≤ 254 characters); the shared
  `isPlausibleEmail` applies the same rule to the editor routes (plan decision 2). Tests:
  `src/__tests__/api/staging/access.test.ts`, `src/lib/auth/__tests__/editor-directory-email.test.ts`.
- [ ] The "THE RULE" comment above `shouldSkipElement` names the container hint as its one
  exception (s70a review F4(a)), inside the same byte-negative source edit.
- [ ] Embed bytes go down: the branch measures at or under main's ceilings at merge (45840 / 33073
  once s70a is in), and `MAX_*` / `SEEDED_MAX_*` ratchet to the measurement (research:
  45828–45829 / 33062–33064).
- [ ] No migration, nothing under `server/`, no new dependency. Required gates pass; one story
  commit. After deploy, the served `/embed/recopyfast.js` no longer contains the sink, and the
  owner's read-only count of payload-shaped stored values is in the PR (plan decision 4).

Complexity: 2. Dependencies: s70a (PR #75) merged — s72 rebases on it (same file, its ceilings).
Branch `feature/s72-edit-board-history-xss`. Follow-up: s72b (the database half, below).

Embed allocation: ≤ 0 bytes — measured −11 / −9 at research; the ceilings ratchet down to the
branch's measurement.

## Story s72b-staging-invite-writes — STUB (backlog, not planned)

Split from s72 at research, 2026-10-09 (`docs/research/s72-edit-board-history-xss.md`, "What a
site admin can do to `staging_access`"). A site admin writes `staging_access` directly through
PostgREST — table-level INSERT/UPDATE for `authenticated` (`20251230000000:272`) under admin-only
policies (`:120-142`) — and reads `verification_code` and `token` (`20260925120000:153-158`). So
route rules (s68b's label, s72's email) are advisory against an admin, and an admin can verify an
invite without its mailbox (read the code, insert their own, or write `email_verified` and the
device binding). Not an escalation of site rights — the writer is already `admin` — but the "row is
the authority" shape of ADR 047's "Watch". Revoking the code's SELECT alone closes nothing; the fix
is ADR 037's pattern: invite create and revoke through the service role after the RLS admin read,
web-role INSERT/UPDATE (and the platform's default privileges) revoked, `verification_code`
dropped from the authenticated SELECT list, a real-database privilege suite (ADR 033), code-first
deploy. Absorbs s69 R3. Alternative to weigh first: retire staging invites, since `site_editors`
is the access model (s66c1).

Complexity: 3 (estimate). Embed allocation: 0 bytes.
