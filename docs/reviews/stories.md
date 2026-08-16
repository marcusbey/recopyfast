# Stories Review — RecopyFast (second pass)

> Fresh-context re-review of `docs/stories.md` (revision `6f11b3f`) against `docs/prd.md`. Two halves: disposition of the 17 issues raised by the prior report, then a full re-run of the checklist on the revised file as if new.
> Every "already built" and "already measured" claim in the revision was checked against code rather than accepted on the file's word — the prior report's core finding was that this file made "already built" claims that were false when checked, so the same skepticism was applied to the revision's own claims.

## Perimeter coverage

| PRD feature (core loop) | Covered by | OK? |
|---|---|---|
| 1 Auth + account | Built — `src/app/login`, `src/app/signup`, `src/app/api/auth/*`, `src/middleware.ts` | ✅ |
| 2 Site registration → token + snippet | Built — `src/lib/sites/embed-script.ts:83-99` (`buildEmbedScript`), `api/sites/register` | ✅ |
| 3 Script generation + sharing + install verification | `s02-install-verified` | ✅ |
| 4 Embed runtime (scan, selectors, MutationObserver) | Built; the budget breach is owned by `s06-embed-budget-gate` | ✅ |
| 5 Inline editing on the live page | Built — widget edit mode + inline toolbar | ✅ |
| 6 Email invite → non-account grant | Built (single-site); made plural by `s14-agency-client-handoff` | ✅ |
| 7 Payment flow (Stripe + credits + entitlements) | Built — `src/lib/stripe/plans.ts:67,77,84,90`, `src/lib/billing/*` | ✅ |
| 8 AI edit — suggest / rewrite in place | Built — widget `/ai/suggest` path | ✅ |
| 9 AI translate + language variants | Built — Edit Board Languages tab → `/api/edit-board/languages` → `aiService.translateText` | ✅ |
| 10 Images — upload / replace in place | Built — widget image modal → `/api/upload/image` | ✅ |
| 11 Real-time multi-user sync | `s07-realtime-service` + `s08-embed-transport` | ✅ (was ❌ critical) |
| 12 Content versioning + rollback | Built — `VersionHistoryPanel` rendered in `SiteDetailView` | ✅ |
| 13 Staging → publish | Built — `api/staging/*`, widget publish, `publish_staging_content_atomic` | ✅ |
| 14 A/B testing | `s11-ab-run-test`, `s12-ab-results` | ✅ (definition defect — M2) |
| 15 Per-section impressions | `s09-section-impressions`, `s10-impression-history` | ✅ |
| 16 Analytics dashboard + export | Built — `dashboard/analytics/page.tsx:37` renders `AnalyticsDashboard`, which calls `/api/analytics/export` | ✅ |
| 17 Public API v1 + API keys | Built — `ApiKeysPanel` imported and rendered at `src/app/dashboard/settings/page.tsx:16,374` | ✅ |
| 18 Outgoing webhooks | `s16-webhook-config` | ✅ |
| 19 Bulk import / export | `s05-bulk-content-portability` | ✅ (was ❌ critical) |

- [x] Every feature of the PRD "Replicated (core loop)" table is delivered by at least one story or a verified-built claim — **YES**. Both prior coverage criticals are genuinely closed.

## Scope
- [x] No story reintroduces an item from the PRD graveyard. `s04` now removes the widget's graveyard surface as well as the dashboard's; `s14` states explicitly that it uses grants and touches no `/api/teams/*` route; `s13` records client sub-accounts as deliberately dropped for being org-teams under another name.
- [ ] No story goes beyond the perimeter — `s13`'s branded-subdomain criterion is in-perimeter per `prd.md:159-160` but is greenfield origin/DNS infrastructure bolted onto a billing story without a score change (M4). `s08`'s protocol-versioning trap asks for backwards compatibility the PRD explicitly disclaims (m5).
- [x] Graveyard has no live UI surface once `s04` lands — verified: `recopyfast.src.js:5454-5460` ships `styles` and `themes` tabs today, calling `/edit-board/styles/apply` (`:5726`) and `/edit-board/themes` (`:6028, :6129, :6159`). `s04` criteria 4 and 5 remove both.

## Story quality
- [x] Each story is an end-to-end shippable slice, not a technical layer — no pure layers. `s06` and `s17` are the closest calls; both ship an observable outcome.
- [ ] Every acceptance criterion can become a test — much improved, but three do not survive contact: `s11`'s "original text is never painted" (M3), `s12`'s conversion definition (M2), and `s14`'s WebSocket-revocation criterion in the orderings the graph permits (M5).
- [x] Agentic notes present and useful — strong, with real files, real line numbers and real commit hashes. Every claim I could check is now accurate (see Claim verification).
- [ ] Complexity scored; no unsplit 5; every 4 states its risk — all nine 4s now carry an explicit **Risk** paragraph (prior m2 closed). `s13` reads as a 5 after the branded-subdomain criterion was added (M4). `s08`'s downgrade to 4 is earned — ruling below.

## The list as a whole
- [ ] Dependency order executable: no cycle, no forward reference — no cycles, and every id cross-reference **inside** `stories.md` resolves correctly under the new numbering (all of them walked individually). But the renumbering left four stale references in `prd.md`, the scope-authority document (M1), and the header graph again disagrees with three stories' own Dependencies sections (m1).
- [x] Ids well-formed (`s<number>-<slug>`), unique — `s01`…`s19`, all conforming, all unique. The old→new map is complete and arithmetically correct (16 + 1 split + 2 new = 19), and each mapped pair matches the story content it claims.
- [x] No overlap or duplication between stories — the prior overlaps are resolved by explicit ownership: `s02` owns the install-recipe module, `s03` owns the edit-activity read model. One accounting overlap remains in the byte table (m2).

---

## Part A — disposition of the 17 prior issues

**12 fully closed, 5 partially closed, 0 untouched.** Four of the five partials are cases where the fix worked but created a new defect underneath it; those are carried into Part B rather than left here.

### Closed (12)

**C1 — real-time sync uncovered.** Closed. `s07-realtime-service` delivers it, and every piece of evidence the story cites is accurate: `src/lib/sites/embed-script.ts:63-81` returns `""` without `NEXT_PUBLIC_WS_URL`; `:92-96` omits `data-ws-url` on the empty string; `public/embed/recopyfast.src.js:2703-2705` is the `if (!RECOPYFAST_WS) { return; }` early return, with the surrounding comment at `:2700-2702` stating "nothing is listening: server/index.js is a separate Express process that Vercel cannot host"; `server/fly.toml:22` still reads `app = "recopyfast-ws"   # change to your chosen Fly app name`, an uncustomised template. The PRD's two-browser < 1s criterion is now `s07` AC 4.

**C2 — bulk import/export uncovered.** Closed. `s05-bulk-content-portability` delivers it, and the dark-feature premise holds: grepping `src/` for `BulkOperations` returns only `src/components/dashboard/BulkOperations.tsx:28` and `:33` — its own interface and its own export. Nothing imports it, not even a test.

**M1 — embed budget story was a 5 whose arithmetic did not close.** Closed. Split into `s06` (measure, gate, shrink), `s07` (stand up the service) and `s08` (swap the transport), each with a stated numeric target, and the arithmetic now closes against measured figures. See the `s08` ruling for the scoring question that split raises.

**M2 — `s02` named an ingest path the embed never calls.** Closed, and the correction is right. `postContentMap` is defined at `recopyfast.src.js:2853`; it posts to `RECOPYFAST_API + '/content/' + encodeURIComponent(SITE_ID)` at `:2924`. `SiteDetailView.tsx:91` computes `hasReportedContent` from `site.stats?.content_elements_count`, exactly as the story now describes. The `/api/analytics/track` route does accept only `page_view`, `content_edit`, `login`, `logout`, `api_call` (`route.ts:30-34`).

**M4 — widget Styles/Themes tabs still live.** Closed. The tab list at `recopyfast.src.js:5454-5460` is exactly the five tabs named, and both graveyard endpoints are called from the widget at the cited lines. `s04` AC 4 and AC 5 remove the tabs and the requests while AC 7 keeps the routes and their tests intact.

**m1 — the `IntersectionObserver` claim.** Closed. Narrowed to `public/embed/`, the other repo occurrences are listed so a repo-wide grep does not mislead, and the global mock is flagged. Verified: `jest.setup.js:177-182` is a `global.IntersectionObserver` mock with a no-op `observe`, so tests written against it would pass vacuously — precisely the trap `s09` now names.

**m2 — four of seven 4s stated no risk.** Closed. All nine complexity-4 stories (`s01`, `s06`, `s07`, `s08`, `s09`, `s11`, `s12`, `s13`, `s14`) now carry an explicit **Risk** paragraph, and each names a plausible silent-failure mode rather than restating the complexity.

**m4 — three undecidable acceptance criteria.** Closed, all three. The CSP disjunction became `s08`'s "degrades to the HTTP path, logs one explicit console warning, and editing still works — a silent failure fails this criterion". The backfill disjunction became `s03` AC 5's `unmeasurable` marking plus a test asserting such an account contributes to no percentile. "Visible to the operator without SQL" became `s03` AC 7's named route, `/dashboard/analytics`.

**m6 — `s02` and the stack-recipes story both owned install recipes.** Closed. `s02` AC 6 declares the typed recipe module and says "this story owns that module"; `s18` AC 2 renders from it and forbids a second copy; `s18` declares `s02` as a dependency.

**m7 — three independent edit-activity read models.** Closed. `s03` AC 8 makes `account_milestones` the single source for account-level edit activity, and `s14` AC 7 and `s15` AC 1 both say they read from it.

**m9 — PRD SEO/GTM items with neither story nor entry.** Closed. "Not stories, deliberately" now carries the badge, the public perf-budget page, the two free tools, the partner directory and the affiliate program, each with a reason.

**m10 — cross-site view sitting near "org activity".** Closed. `s14`'s notes state that it uses the grant model, touches no `/api/teams/*` route, and must not introduce a role, with the grants-vs-roles distinction spelled out.

### Partially closed (5)

**M3 — undeclared `s06` dependency on the A/B results story.** Partially closed. The edge is now declared (`s12` Dependencies name `s09`) and drawn. But the dependency it declares is incoherent: `s12`'s conversion definition cannot be computed from `s09`'s data model. Carried forward as **M2** in Part B.

**M5 — Agency tier under-delivered.** Partially closed. Coverage is fixed: the branded subdomain is now `s13` AC 8, and client sub-accounts are recorded in "Not stories, deliberately" with the org-teams reasoning. But the criterion was added without adjusting the complexity score, and the work behind it is a second external-systems axis. Carried forward as **M4**.

**m3 — header graph disagreed with stories' Dependencies.** Partially closed. The old `s01`-edge misplacement is gone; three new mismatches took its place. Carried forward as **m1**.

**m5 — four criteria deferred the number that would make them testable.** Partially closed. Three are fixed with real numbers: `s11`'s ±2 percentage points over 10,000 simulated assignments, `s12`'s ≥ 95% confidence and ≥ 1,000 assignments per variant, `s15`'s "asserted by a test on the text part — no HTML tags, all links present as URLs". The fourth, "without a visible flash", swapped a missing number for an unachievable criterion. Carried forward as **M3**.

**m8 — no byte budget allocated across the embed stories.** Partially closed. The allocation table is the right structural fix and the numbers behind it are real (see Byte budget). But it double-counts A/B, whose code is already inside the measured baseline. Carried forward as **m2**.

---

## Part B — findings on the revised file

### Critical
None. Both prior criticals are genuinely closed, and no PRD perimeter feature is left uncovered.

### Major

**M1 — the renumbering left four stale story references in `prd.md`, the scope-authority document. Two of them now resolve to a different, real story.**

`stories.md:34-51` says the old→new map exists "for reading `reviews/stories.md`, which cites the old numbering." It missed that `prd.md` also cites story ids — and `prd.md` is the file every downstream stage reads first:

- `prd.md:121` — *"Decision: re-enabled — see stories s08/s09."* A/B is now `s11`/`s12`. `s08` is the embed transport; `s09` is impressions.
- `prd.md:424` — *"Stories `s08` and `s09`."* The same error in the decisions log.
- `prd.md:428` — *"Impression definition → … Story `s06`."* Impressions are now `s09`. **`s06` is the embed budget gate** — an agent following this reference lands on a story about gzip and finds no impression definition.
- `prd.md:434-435` — *"`s10` assumes agency-only, single invoice. Confirm before `s10` reaches `/ks-plan`."* The agency plan is now `s13`. **`s10` is impression-history** — so PRD open decision 5 currently gates the wrong story, and the gate on the agency plan is silently gone.

`prd.md:166` and `:422` both cite `s01-trial-signup`, which is still correct — the slug saved those two.

These are not cosmetic. Two of the four resolve to a real story with different content, which is worse than a dangling reference because nothing errors and the reader gets a confident wrong answer.

**Remediation.** Update `prd.md:121`, `:424`, `:428` and `:434-435` to the new ids. Add a line to the renumbering note in `stories.md` recording that `prd.md` was swept, so the next renumbering does not repeat the omission.

**M2 — `s12`'s conversion definition cannot be computed from `s09`'s data model. The dependency added to close the prior M3 joins two incompatible identity models.**

`s12` AC 2: *"A conversion is defined as a click on a tracked CTA **within the same page view as an impression of the tested section**."* Its Dependencies name `s09` as the supplier of the impression half, and its notes say the omission of that edge is what made the earlier graph non-executable.

`s09` forbids exactly what the join requires. AC 9: *"Do Not Track is respected, and **no per-visitor identifier is stored**."* Its notes: *"No cookie, no fingerprint, no visitor id. Aggregate counts only."* Its ingest writes *"pre-aggregated counts"* (`stories.md:506`). You cannot establish that a click occurred "within the same page view as" an impression from an aggregate count carrying no page-view or visitor key. As specified, `s12` is unbuildable.

It is also unnecessary, because the A/B pipeline **already has its own per-visitor event stream in the widget** — which neither `s11` nor `s12` mentions:

- `recopyfast.src.js:3113` `trackImpressions()` emits `event_type: 'view'`
- `:3100` emits `event_type: 'click'`
- `:3137` `trackConversion()` emits `event_type: 'conversion'`

each carrying `site_id`, `test_id`, `variant_id` and `visitor_id`, posted to `/ab-tests/track` (`:3165`) via `sendBeacon`. The correlation `s12` needs exists there today.

Worth noting: `prd.md:436` lists the conversion definition as an **open** decision requiring agreement before the significance work starts. `s12` states it as resolved.

**Remediation.** Define conversion over the existing A/B event stream — `view` → `click` on the same `visitor_id` within a test — then drop `s09` from `s12`'s Dependencies and remove the edge from the graph. Extend `s11`'s "audit what works before writing anything" note to name `trackImpressions`, `trackConversion` and the `sendTrackEvent` payload shape explicitly. If the section-impression join is genuinely wanted instead, `s09` must gain a page-view identifier, which contradicts its own privacy criterion and its GDPR argument, and that trade should go back to the PRD as a decision rather than being settled inside a story.

**M3 — `s11` AC 6 ("original text is never painted") requires a change to the snippet contract that no story owns.**

AC 6: *"Variant content is applied before first paint; a test asserts the original text is never painted when a variant is assigned."*

The PRD's embed constraint is an **async** script (`prd.md:210`), and the snippet `buildEmbedScript` issues is a single async `<script>` tag (`src/lib/sites/embed-script.ts:98`). An async external script cannot execute before the host page paints its own HTML — the original text is painted by construction. Anti-flicker in script-tag products (the story itself points at Optimizely and Mutiny) is achieved with a *synchronous inline* hide-and-reveal, i.e. a second, blocking snippet fragment.

That change is neither free nor local. The snippet shape is owned by `s02`'s install-recipe module, republished per stack by `s18`, and `s06`'s own trap records that `/embed/recopyfast.js` is *"baked into every snippet already issued"* and must keep working. No story carries that cost, and no dependency edge connects `s11` to `s02`.

**Remediation.** Either (a) keep the strong criterion, give `s11` a declared dependency on `s02`, and add an AC covering the amended snippet and the behaviour of already-issued single-tag installs; or (b) restate the criterion in terms a single async script can meet — for example *"no original text is painted after the widget's first frame; time-to-swap is measured, stated, and a variant is never applied later than N ms after script execution."* Do not leave it as written: an agent will hit the wall, weaken the criterion unilaterally, and the weakened version will never be reviewed.

**M4 — `s13` is scored 4, but the branded-subdomain criterion added to close the prior M5 makes it a 5.**

`s13` was correctly a 4 for *"payments, quotas and catalogue changes on the live billing path."* AC 8 now adds: *"An agency can serve its sites from a branded subdomain, and content delivered through it is identical to content delivered through the default origin."*

None of that exists. Grepping `src/` for `subdomain|custom_domain|customDomain` returns only `src/types/index.ts` and three test files (`src/__tests__/lib/security/site-auth-origin.test.ts`, `src/components/dashboard/__tests__/SiteRegistrationModal.test.tsx`, `src/__tests__/security/domain-verification.test.ts`) — no serving path, no DNS or certificate handling, no origin registration. It is a second external-systems axis: wildcard host routing, cert provisioning, and a new trusted origin threaded through `src/lib/security/site-auth.ts`, which `s02` and `s07` both build on. Under the PRD's own scale (`prd.md:129`, *"5 real-time, migrations, external systems"*), billing-catalogue work plus custom-origin serving in one story is a 5, and a 5 must be split.

The other half of the prior M5 fix — recording client sub-accounts as deliberately dropped — is correct and stays.

**Remediation.** Split AC 8 into its own story (`branded subdomain`, complexity 3-4, depending on `s13`), leaving `s13` a clean 4. Add it to the dependency graph and fold it into the PRD's open decision 5, which already says the Agency plan shape must be confirmed before this reaches `/ks-plan`.

**M5 — `s14` AC 4 requires terminating a live WebSocket on revocation, but `s14` declares no dependency on `s07`/`s08` and sits on a branch that never reaches them.**

AC 4: *"Revoking a grant takes effect on the next request, and an open editing session cannot continue saving after revocation — **including over an established WebSocket connection**."* Its declared Dependencies are `s13` and `s03`. The header graph puts `s14` on `s01 → s13 → s14 → s15`; `s07` and `s08` are on a structurally disconnected branch.

The agentic note is aware of the coupling — *"Once `s07`/`s08` land, revoking a grant must also terminate any live editing connection it holds. An HTTP-only check leaves a socket writing content after revocation"* — but the criterion is written unconditionally, and neither `s07` nor `s08` claims the work in its own criteria. So in the ordering the graph permits (`s14` before `s08`), the criterion is vacuous when tested and the socket-revocation path ends up owned by nobody. The result is a revoked editor still writing content over an open socket — the exact defacement scenario `s14` names as its own risk and the PRD calls *"security-critical: a leaked grant is a defacement"* (`prd.md:113`).

**Remediation.** Pick one: add `s08` to `s14`'s Dependencies and draw the edge, or move the socket clause into `s08` as its own AC ("an established connection is terminated when its grant is revoked or expires") and leave `s14`'s criterion HTTP-scoped. Either closes it. Leaving the criterion floating between two stories does not.

**M6 — `s07` and `s08` disagree on who holds a real-time connection, and the disagreement is the difference between every visitor and only editors.**

- `s07` AC 4: *"An edit made in one browser appears in a second browser **viewing** the same page in under 1 second."*
- `s08` AC 3: *"A page with the script installed and **no editing session open** opens zero WebSocket connections."*
- `s08` AC 4: *"Entering edit mode establishes sync, and the two-browser under-1-second criterion from `s07` still passes."*

`s08` AC 4 only holds if `s07`'s "second browser viewing the page" is read as a second browser *in edit mode*. `s07` never says that, and today's widget connects on load irrespective of edit mode — `establishConnection` gates on `RECOPYFAST_WS` alone (`recopyfast.src.js:2703`) and passes `editMode` merely as a query param (`:2713`). An agent executing `s07` literally will connect every visitor of every customer site to the new service; `s08` then rips that out. That is rework, plus a live scaling hazard against a service `s07` explicitly says may start as a single instance.

The PRD does not settle it either: `prd.md:118` sells *"the page updates while you watch"* and `prd.md:247` says *"appears in a second browser in < 1s"* — both readable as passive viewers.

**Remediation.** Decide once, in `s07`, and use the same words in both stories. If editors-only — my recommendation, as it is cheaper, matches `s08` AC 3, and the demo is two people editing the same page — then say so in `s07` AC 4 and note in `s07`'s risk paragraph that the PRD's "updates while you watch" means two edit-mode sessions rather than a visitor.

### Minor

**m1 — the header dependency graph disagrees with three stories' own Dependencies sections.** `s14` declares `s13` and `s03`; the graph (`stories.md:54-68`) draws only `s13 → s14`. `s15` declares `s14` and `s03`; the graph draws only `s14 → s15`. Conversely the graph's `s09 ──> s10 ──┐ … s11 ──────────┴─> s12` asserts an `s10 → s12` edge that `s12` does not declare (`s12` declares `s11` and `s09`). Execution order survives in each case, but the graph is the artefact a planner reads first, and this is the same defect class as the prior m3. Fix: draw the two `s03` edges, drop the spurious `s10 → s12`.

**m2 — the byte allocation double-counts A/B.** The table charges *"A/B bucketing (`s11`) ≤ 2,000"* as new spend, but that code is already in the widget and therefore already inside the measured 34,063 baseline: `fetchActiveTests` (`recopyfast.src.js:2978`), `bucketVisitor` (`:2993`), `trackImpressions` (`:3113`), `trackConversion` (`:3137`), `sendTrackEvent` (`:3163`), plus the `rcf_vid` cookie write (`:2975`) and the geo fields. Impressions (`s09`) are genuinely new — `IntersectionObserver` is absent from `public/embed/`. Fix: state that `s11`'s allowance covers *net* change against the post-`s06` baseline, or reclaim the 2,000 into reserve.

**m3 — `s06`'s 24,000 target leans on deletions `s04` does not promise to make.** `s06`'s notes say *"`s04` removes two of those tabs — **sequence `s04` first if both are in flight**, since it deletes code this story would otherwise spend effort minifying."* But `s04` AC 4 only requires that the Edit Board *no longer renders* Styles and Themes, and AC 5 that no request is made to their endpoints. Not rendering leaves the implementation bytes in the artifact and yields `s06` nothing. Fix: make `s04` AC 4 require that the two tab implementations are removed from `recopyfast.src.js` (API routes and their tests untouched, consistent with "frozen means unexposed, not deleted" — deleting widget code is reversible by git, deleting a route is not), and promote the sequencing hint to a declared dependency.

**m4 — `s11` is silent on the `rcf_vid` visitor cookie it re-enables, while `s09` sells the opposite position on the same widget.** `s09`'s privacy trap: *"No cookie, no fingerprint, no visitor id … keeps the feature out of GDPR consent scope, itself a selling point for the European local-business segment."* The A/B path sets a one-year first-party `rcf_vid` cookie at `recopyfast.src.js:2975`, and `s11` AC 3 ("deterministic from a stable input, never random per request") depends on having such an identifier. Both features can be live on one customer's page. Fix: state `s11`'s position on `rcf_vid` and DNT explicitly, and scope `s09`'s consent claim to sites not running A/B.

**m5 — `s08`'s protocol-versioning trap asks for a compatibility obligation the PRD disclaims.** *"Old snippets may still carry a socket.io `data-ws-url`. The server must handle both, or version the endpoint path."* `prd.md:221-222`: *"0 users today: **no migration debt, no backwards-compatibility obligation.** This is a one-time window to cut scope hard."* The only socket.io-carrying snippets that could exist are ones `s07` itself issued days earlier, to zero users. Supporting two protocols on one service is real work and is the single item most likely to push `s08` back toward a 5. Strike it, or replace it with "reissue snippets".

**m6 — `s19` depends on `s13`'s output with no edge.** *"should use the real arithmetic from `s13`'s comparison against per-site pricing."* `s19` declares only `s17`, and the two sit on branches with no ordering between them, so the agency pricing may not exist when `s19` runs. Fix: declare it, or soften the requirement to "if the Agency plan has shipped".

**m7 — `s11` should update the navigation comment it invalidates.** `DashboardNavigation.tsx:49-51` currently reads *"A/B Tests is deliberately absent. The feature is not being pursued, and the route it pointed at now 404s — see src/app/dashboard/ab-tests. The components and API routes are kept so the decision is reversible."* `s11` reverses that decision; leaving the comment turns it into exactly the stale-comment trap `s01` is careful to fix in `permissions.ts:21`. Add it as an AC or a note. (Small aside: the comment says `src/app/dashboard/ab-tests`, while the directory is `_ab-tests` — worth correcting in the same pass.)

**m8 — `s01` AC 8 defers the trial credit allowance.** *"AI features during the trial draw on a granted trial credit allowance and stop at zero — a trial never grants uncapped OpenAI spend."* The stop-at-zero half is testable; the allowance size is unstated and is a pricing decision with a direct COGS consequence. Fix the number, or mark it as owed at `/ks-plan` alongside PRD open decision 5.

---

## Ruling: is `s08-embed-transport` a 4?

**The downgrade is earned. Keep it at 4.**

1. The PRD scored feature 11 a 5 for a specific bundle: *"separate deployed service, reconnection, Redis pub/sub for horizontal scale, conflict handling"* (`prd.md:118`). `s07` absorbs the separate service, its deploy procedure, its uptime, its per-site connection authorization and its origin/CORS surface. That is the larger half of the 5, and it is now a different story with its own risk paragraph. A 5 split into two 4s is precisely the outcome the split rule asks for — the objection would be a 5 relabelled as a 4, and this is not that.
2. `s08`'s contracted scope — its eight acceptance criteria — moves on one axis only: the transport. No migration, no new external dependency, no billing or statistical correctness, no new UI. The server-side addition is bounded and named: three messages (`join`, `content-map`, `content-update`) on a service `s07` already runs and already authorizes.
3. The byte ceiling is not `s08`'s to hit. `s06` owns reaching 24,000; `s08` only has to spend zero, which native `WebSocket` does by definition. The prior story's 5 came substantially from owning the shrink *and* the transport at once, and that coupling is gone.
4. The genuinely nasty part — silent, environment-specific CSP failure on customers least likely to file a useful bug report — is written into the criteria as a testable requirement (*"degrades to the HTTP path, logs one explicit console warning, and editing still works — a silent failure fails this criterion"*) rather than left as a hope. Hard is not the same as 5; a 5 is *broad*.

Two conditions attach, both already itemised above and both cheap:

- **Strike the dual-protocol back-compat trap (m5).** Carrying socket.io and plain-WS simultaneously on one service is a second axis and would put `s08` back at 5 on merit. The PRD's zero-users clause means it is not owed.
- **Settle the connection model in `s07` (M6)** so `s08` is not silently reinterpreting a criterion it inherited. As written, `s08` AC 4 asserts that `s07`'s criterion "still passes" under a reading `s07` never states.

With those two edits, `s08` is a 4 and does not need to split further.

---

## Byte budget — measured and confirmed

**I could not measure this myself.** This review session had Read, Grep and Glob only — no shell — so `gzip -9c public/embed/recopyfast.js | wc -c` was not available to me, exactly as in the prior pass. What I could establish from the file alone was that the table is internally consistent in a way that indicates real measurement rather than estimation: 34,063 + 13,085 = 47,148 against a stated bundle of 46,781, and that 367-byte shortfall is the expected effect of gzip finding cross-file redundancy when the two inputs are compressed as one stream. Invented figures typically sum exactly. Separately, 13,085 gz for `socket.io-client` 4.x as an IIFE is consistent with that library's published size.

**The measurement was subsequently supplied by the main session, which ran it with a shell.** `gzip -9`:

| Component | gzipped | Status |
|---|---|---|
| `recopyfast.js` as shipped | **46,781** | measured |
| — of which `socket.io-client.min.js` | 13,085 | measured |
| — of which widget code alone | **34,063** | measured (bundle minus the concatenated socket.io prefix) |

The table in `stories.md:83-102` is therefore **confirmed, not estimated**, and the prior review's M1 — which flagged its own arithmetic as an estimate and could not settle whether removing socket.io reaches budget — is resolved: it does not. The widget alone is 34,063 gz against a 30,000 ceiling (`docs/architecture/overview.md:326`), which is what justifies `s06` existing separately from `s08`. Recorded here with its provenance so the next reader knows which claims in this report rest on my own verification and which do not.

Structurally, the right answer is the one `s06` AC 1 already proposes: have the build measure and print it, and fail on a committed ceiling, so the number is never again a claim anyone has to take on trust. Note that `scripts/build-embed.mjs:232-245` already prints *raw* sizes for bundle, widget and socket.io separately and has no gzip check — so `s06` AC 1 is a small, well-targeted extension of code that exists, not new machinery.

---

## Claim verification

Recorded because these claims drive the plan. Everything below was checked against code during this review.

**Verified accurate:**

- **`s07`'s real-time-is-off premise** ✅ — `embed-script.ts:63-81` (`getPublicWebSocketUrl` returns `""`), `:92-96` (attribute omitted), `recopyfast.src.js:2703-2705` (early return with the "nothing is listening" comment above it), `server/fly.toml:22` (uncustomised `app = "recopyfast-ws"   # change to your chosen Fly app name`). The Dockerfile and fly.toml exist but show no sign of ever having been deployed.
- **`s05`'s dark-feature premise** ✅ — `BulkOperations` appears only at `BulkOperations.tsx:28,33`. No importer anywhere in `src/`, including tests.
- **`s02`'s corrected first-contact signal** ✅ — `postContentMap` at `:2853`, `fetch(RECOPYFAST_API + '/content/' + encodeURIComponent(SITE_ID))` at `:2924`, `hasReportedContent` at `SiteDetailView.tsx:91`. `analytics/track` accepts only the five event types the story lists (`route.ts:30-34`).
- **`s04`'s widget claim** ✅ — five-tab list at `:5454-5460`; `/edit-board/styles/apply` at `:5726`; `/edit-board/themes` at `:6028`, `:6129`, `:6159`. Teams nav entry at `DashboardNavigation.tsx:59-60`. The `_ab-tests` precedent exists (`src/app/dashboard/_ab-tests/page.tsx`) with its documenting comment at `:49-51`.
- **`s09`'s jest note** ✅ — `jest.setup.js:177-182` is a global `IntersectionObserver` mock with a no-op `observe`. Impression assertions written against it would pass vacuously.
- **`s13`'s catalogue claim** ✅ — `plans.ts` holds `starter` (`:67`), `pro` (`:77`), `credits` (`:84`), `lifetime_pro` (`:90`), and no `agency`. `additional_site_price` already exists as a concept in `plan-types.ts` and `permissions.ts`, so AC 4 is grounded in something real.
- **The 30KB budget lives where the story says** ✅ — `docs/architecture/overview.md:326`.
- **`s06`'s reading of the build script** ✅ — socket.io concatenated first at `build-embed.mjs:225`, `--check` staleness detection at `:191-210`, raw-size reporting at `:232-245`, and no gzip check today.
- **Coverage spot-checks on "built" claims** ✅ — analytics export is reachable (`dashboard/analytics/page.tsx:37` renders `AnalyticsDashboard`, which calls `/api/analytics/export`), and API keys are reachable (`settings/page.tsx:16,374`). Neither is an orphan of the `BulkOperations` kind.

**Newly discovered, not mentioned by any story:**

- **The widget already emits A/B `view`, `click` and `conversion` events** with `visitor_id`, `test_id`, `variant_id` and geo fields (`recopyfast.src.js:3100`, `:3113`, `:3137`, posted at `:3165`), and sets a one-year `rcf_vid` cookie at `:2975`. This is load-bearing for M2, m2 and m4.

**Could not verify:**

- **"suite is green (1954 passing)"** (`stories.md:11`) — no shell, no test run. Unchanged from the prior pass.

---

## Verdict

The revision is a substantial improvement and the corrections it makes about itself hold up under checking. Both criticals are genuinely closed — I checked the code rather than the claims, and the code agrees. Twelve of seventeen prior issues are fully closed and the remaining five are partials whose residue is carried forward here. Coverage of the PRD perimeter is complete, no graveyard item is reintroduced, all nine complexity-4 stories now state a real risk, and the ids are clean and correctly mapped.

What blocks readiness is a second generation of defects, most of them created by the fixes: the renumbering broke four references in the PRD, two of which now resolve to a different real story; the dependency edge added to close the prior M3 joins two incompatible data models; the criterion added to close the prior M5 pushed `s13` to a 5; and the two new real-time stories disagree with each other about who holds a connection. All six majors are mechanical to fix, and none requires re-architecting the backlog.

Max severity: major
Stories ready: no
