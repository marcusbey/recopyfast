# Research — Story s09-section-impressions

> **Review gate warning.** `docs/reviews/stories.md` ends `Max severity: major` /
> `Stories ready: no`. Three of its open findings name `s09` directly — **M2** (the `s09`/`s12`
> data-model conflict, `reviews/stories.md:116-132`), **m2** (the byte allocation double-counts
> A/B, `:178`) and **m4** (`s11` re-enables an `rcf_vid` cookie while `s09` sells the opposite
> privacy position on the same widget, `:182`). Operator confirmed proceeding. This is a
> warning, not a block — but M2 is settled below and the settlement changes `s12`, not `s09`.

## Premise verdict

**Every premise the story states is TRUE and independently confirmed in code. One premise it
does *not* state is false, and it is load-bearing.**

Confirmed true, checked against the files rather than recalled:

- `IntersectionObserver` appears **nowhere** in `public/embed/` — `grep -rn "IntersectionObserver"
  public/embed/` exits 1. It does appear at `src/components/landing/InteractiveHero.tsx:518`,
  `src/components/three/sky/SkyBackground.tsx:235`, `public/demo-site/scripts.js:66,207`,
  `src/components/landing/__tests__/InteractiveHero.attract.test.tsx:40-74` and `jest.setup.js:178`,
  so a repo-wide grep misleads exactly as the story warns. **No impression tracking exists.**
- `jest.setup.js:177-182` is a global `IntersectionObserver` mock whose `observe` is `jest.fn()` —
  a no-op. Confirmed verbatim (177 is the comment, 178 the assignment, 179-181 the three methods,
  182 the close).
- `src/app/api/analytics/track/route.ts:29-35` accepts exactly
  `["page_view", "content_edit", "login", "logout", "api_call"]`, verbatim.
- `computeStableElementId` is `public/embed/recopyfast.src.js:819-824`;
  `content_elements` is unique on `(site_id, element_id, language, variant)`
  (`supabase/migrations/20250817000000_complete_database_setup.sql:26-40`).
- The widget measures **46,781 bytes gzipped** today
  (`gzip -9c public/embed/recopyfast.js | wc -c`, re-run this session) — the exact number
  `stories.md` and `architecture.md:182` state. `scripts/build-embed.mjs` contains **zero**
  gzip/ceiling logic (`grep -a "gzip|ceiling|budget|30000"` exits 1 over all 251 lines), so the
  `s06` dependency is real, not ceremonial.

**The unstated false premise — `element_id` is page-blind, so "per section" silently means
"per section per template", not "per section per page".** `computeStableElementId` derives from
`structuralPath` (`recopyfast.src.js:731-764`): tag names, same-tag sibling indices, nearest
authored ancestor `id`. **No URL, no pathname, no document identity.** Two pages rendered from
one template produce byte-identical ids. This is a *known, recorded, still-open* defect: A-14 in
`docs/archive/2026-08-07-qa-production-audit.md:521`, decision D2 in
`docs/archive/goal-audit-closeout.md:69`, and three live `test.failing` cases at
`src/__tests__/embed/element-id-page-scope.test.ts:157,187,214`.

s09 says *"A section is an already-mapped content element. Reuse `content_elements.element_id`
… do not invent a second identity scheme."* Followed literally, a marketer with a templated site
sees `/about`'s hero and `/pricing`'s hero as **one row with one merged impression count**, and
nothing in the UI says so. The whole story's user value — *"I edit the copy that is being read"* —
is destroyed for exactly the multi-page marketing sites the PRD targets. The story must either
scope impressions by page URL as a *second* dimension on the impression row (leaving
`content_elements` alone, so A-14 is not pre-empted), or state explicitly that counts are
template-scoped. This is not a planning detail; it changes the primary key of the new table.

---

## The five structuring facts (five one-liners with file:line)

1. **The widget already has a per-visitor identity and a per-visitor event stream, and s09 is
   about to declare the opposite policy on the same script.** `recopyfast.src.js:2956-2976`
   mints/reads a one-year first-party `rcf_vid` cookie; `:3096-3109` (`click`), `:3113-3135`
   (`view`) and `:3137-3161` (`conversion`) each post `{site_id, test_id, variant_id, visitor_id,
   event_type, geo_country, geo_region}` to `/ab-tests/track` via `sendBeacon` (`:3163-3179`).
   The whole pipeline runs unconditionally on every non-staging page load (`:898-906`).
2. **The A/B `view` event is already the "impression" `s12` needs — and it is deduplicated per
   `(visitor_id, test_id)` for the lifetime of the test, not per page view.**
   `src/app/api/ab-tests/track/route.ts` counts existing `event_type='view'` rows for
   `(visitor_id, test_id)` and inserts only when the count is 0. `ab_test_results`
   (`supabase/migrations/20260127_ab_testing_v2.sql:8-25`) has `visitor_id TEXT NOT NULL` and
   `event_type CHECK IN ('view','click','conversion')`.
3. **`conversion_events` is not an A/B table.** `supabase/migrations/20260731002000_missing_tables_audit_analytics.sql:154-164`
   constrains `event_type` to `('trial_start','subscription','upgrade','churn')` and it is written
   only by the billing funnel tracker (`src/lib/analytics/tracker.ts:156`). `docs/architecture.md:243`
   lists it under **A/B**, which is a documentation error worth correcting — an implementer sent
   there for the conversion half of `s12` lands on the Stripe funnel.
4. **Nothing in the repo reads `navigator.doNotTrack`.** A grep for
   `doNotTrack|DoNotTrack|DNT` across `**/*.{js,ts,tsx}` (excluding `node_modules`) returns zero
   hits. s09 AC 9 requires DNT to be respected; there is no precedent to copy, and no existing
   test asserts it.
5. **The widget has no entitlement signal and no per-site plan lookup exists.** Entitlement is
   per *user* (`getEffectivePlan(userId)`, `src/lib/billing/entitlements.ts:56`, returning the
   three-state union in `src/lib/billing/effective-plan.ts:60-73`); a site's payer is resolved via
   `resolveSiteOwnerId` — an `admin` row in `site_permissions`
   (`src/lib/feature-gating/permissions.ts:155-172`). Neither `/api/ab-tests/active/[siteId]`
   nor `GET /api/content/[siteId]` returns any plan field to the widget. `PlanLimits`
   (`src/lib/stripe/plan-types.ts:61-69`) has `abTesting: boolean` and **no impressions key**.

---

## Target story

**s09-section-impressions — see which sections people actually look at**
(`docs/stories.md:467-519`)

*As a marketer on Pro I want to see how many people actually saw each section of my page so that
I edit the copy that is being read instead of guessing.*

Stated complexity **4** — "high-volume ingest plus third-party runtime work". Stated risk:
impression events are orders of magnitude more numerous than edit events; an unbatched,
unsampled implementation costs more than the plan it gates.

### Acceptance criteria, as written

1. Impression recorded when ≥ 50% of a tracked section is in the viewport for ≥ 1 continuous second.
2. A section scrolled past in under 1 second records no impression.
3. Leave + re-enter within one page view records exactly one impression.
4. Impressions batch and flush on `visibilitychange` and on unload; a visitor closing the tab
   immediately after scrolling still has their impressions recorded.
5. Ingest requires a valid site token — no unauthenticated write path.
6. Impression counts per section appear in the dashboard next to that section's current text.
7. Entitled Pro and trialling accounts see counts; unentitled accounts see an upgrade prompt and
   the widget sends no impression events for them.
8. Impression code adds ≤ 2,000 bytes gzipped to the widget; total stays ≤ 30,000.
9. Do Not Track is respected, and no per-visitor identifier is stored.

### Dependencies

`s06-embed-budget-gate` (byte gate — hard, see Trap 1), `s01-trial-signup` (defines entitlement).
`s10-impression-history` and `s12-ab-results` both declare `s09`; the `s12` edge is disputed
below and should be **removed**.

---

## Current state of the code

**Nothing of this story exists.** There is no impressions table, no impression route, no
observer, no dashboard surface. Concretely:

| Thing the story needs | Current state |
|---|---|
| `IntersectionObserver` in the widget | Absent from `public/embed/` entirely |
| An impressions table | No migration matches `CREATE TABLE .*impress` |
| A batched ingest route | Absent. `/api/analytics/` contains only `export/`, `performance/`, `track/` |
| `visibilitychange` / `pagehide` handling in the widget | Absent. Only `beforeunload` at `:4172,4230`, and that is the edit-mode unsaved-changes guard |
| SPA route-change detection in the widget | Absent. No `popstate`, no `pushState` patch |
| A dashboard slot beside a section's current text | `src/components/dashboard/ContentElementCard.tsx` renders original/current/staging rows; `src/app/dashboard/content/page.tsx:414` is the only consumer. Nothing displays a per-element metric |
| DNT handling | Absent repo-wide |
| An entitlement signal reaching the widget | Absent. `GET /api/content/[siteId]` returns a bare array of elements |
| A gzip ceiling in the build | Absent — `scripts/build-embed.mjs` has none. `--check` is a stale-artifact SHA check only |

**What *does* exist and is directly reusable:**

- `MutationObserver` rescan pattern the story tells you to follow for SPA churn —
  `recopyfast.src.js:3339-3357`, `childList` + 500 ms debounce → `scanForContent()` +
  `sendContentMap()`.
- `sendBeacon`-with-`fetch(keepalive)`-fallback for unload-safe delivery —
  `recopyfast.src.js:3163-3179`.
- `this.elements` — the `Map<elementId, {element, …}>` populated by `scanForContent()`
  (`:890`), which is exactly the set of "tracked sections".
- Ingest authorization: `authorizeIngestRequest(request, siteId)`
  (`src/lib/security/ingest-auth.ts:50-106`) — site token first, session fallback, never both.
- `enforceRateLimit(request, {limit, endpoint, identifier, identifierType, onStoreFailure})`
  (`src/lib/api/rate-limit.ts:91-152`) over the presets in
  `src/lib/security/rate-limiter.ts:369-390`.
- `withCors` + `OPTIONS` pattern for a widget-facing route —
  `src/app/api/analytics/track/route.ts:47-58` (with its comment explaining why `*` is safe once
  origin is pinned inside `authorizeSiteRequest`).

---

## Anchor points

| Purpose | Path |
|---|---|
| Widget source (**never edit `recopyfast.js`**) | `/Users/marcusbey/Desktop/02-CS/05-Startup/recopyfast/public/embed/recopyfast.src.js` |
| Element identity block (sliced by a test — do not rename the markers) | `public/embed/recopyfast.src.js:680-824` |
| Widget boot sequence / where an observer would attach | `public/embed/recopyfast.src.js:890-928` |
| Existing telemetry send helper to mirror | `public/embed/recopyfast.src.js:3163-3179` |
| MutationObserver rescan pattern | `public/embed/recopyfast.src.js:3339-3357` |
| Build script (needs the `s06` gate first) | `scripts/build-embed.mjs` |
| Ingest auth (mandatory per ADR 002 §3) | `src/lib/security/ingest-auth.ts` |
| Rate limit wrapper + presets | `src/lib/api/rate-limit.ts`, `src/lib/security/rate-limiter.ts:369-390` |
| Widget-facing route to copy in shape (but **not** extend) | `src/app/api/analytics/track/route.ts` |
| Site-owner → plan resolution | `src/lib/feature-gating/permissions.ts:155-172`, `src/lib/billing/entitlements.ts:56` |
| Dashboard card that must show the count | `src/components/dashboard/ContentElementCard.tsx`, consumed at `src/app/dashboard/content/page.tsx:414` |
| Global observer mock that will silently void tests | `jest.setup.js:177-182` |
| Working example of overriding that mock | `src/components/landing/__tests__/InteractiveHero.attract.test.tsx:40-74` |
| Migration conventions + RLS rule | `AGENTS.md` non-negotiables 5-6, `docs/decisions/002-rls-tenant-boundary.md` |

---

## Verified APIs / functions

Signatures read from source this session, not recalled.

```ts
// src/lib/security/ingest-auth.ts:50
authorizeIngestRequest(request: NextRequest, siteId: string): Promise<IngestAuthResult>
// IngestAuthResult = {ok:true; mode:"site-token"|"session"; userId?:string}
//                  | {ok:false; status:401|403; error:string}
// Never throws. A presented-but-bad token returns 401 and does NOT fall through to the
// session path — deliberate, see the comment at :66-68.

// src/lib/api/rate-limit.ts:91
enforceRateLimit(request: NextRequest, options: {
  limit: keyof typeof RATE_LIMIT_CONFIGS;
  endpoint: string;
  identifier?: string;              // defaults to client IP
  identifierType?: "user"|"ip"|"api_key";
  onStoreFailure?: "allow"|"deny";  // defaults to "deny"
  message?: string;
}): Promise<NextResponse | null>     // null === proceed
```

`RATE_LIMIT_CONFIGS` (`rate-limiter.ts:369-390`), complete: `API_GENERAL` 60/min,
`API_AUTH` 5/15min, `API_CONTENT` 100/min, `API_UPLOAD` 10/min, `USER_GENERAL` 100/min,
`USER_CONTENT_EDIT` 50/min, `USER_DOMAIN_VERIFY` 3/5min, `IP_GENERAL` 200/min,
`IP_AUTH` 10/15min, `IP_REGISTRATION` 5/hr, `API_KEY_DEFAULT` 1000/min,
`API_KEY_PREMIUM` 5000/min, `API_KEY_ENTERPRISE` 20000/min. **None of these is sized for
impression volume, and none is keyed on a site.** ADR 002 §4 requires a service-role route to
carry a **site-keyed, fail-closed** (`onStoreFailure: "deny"`) limiter — so this story adds a
preset, it does not reuse one. The story's own note ("size the limits for impression volume — an
existing limit applied unchanged will drop real data") is correct and now has the numbers behind it.

```js
// public/embed/recopyfast.src.js:819
computeStableElementId(element) -> string
//   element.getAttribute('data-rcf-id') || 'rcf-' + hashPath(structuralPath(element))
// structuralPath (:731-764): tag names + same-tag sibling index, anchored at the nearest
// ancestor carrying an author-written id, shadow boundaries crossed via the host.
// No text, no class names, no clock, NO URL.
```

```ts
// src/lib/billing/entitlements.ts:56
getEffectivePlan(userId: string): Promise<Entitlement>
// Entitlement = {kind:"plan"; planId:string; plan:SubscriptionPlan}
//             | {kind:"credits"; planId:null; plan:null}
//             | {kind:"none";    planId:null; plan:null}
// hasAnyEntitlement(e) === e.kind !== "none"; capability questions must narrow on kind==="plan".
// LIVE_SUBSCRIPTION_STATUSES = ["active","trialing","past_due"] — "trialing" is already
// entitled, which is what makes s09 AC 7's "trialling accounts see counts" satisfiable.

// src/lib/feature-gating/permissions.ts:155 (module-private — export or duplicate deliberately)
resolveSiteOwnerId(supabase, siteId): Promise<string | null>
//   site_permissions WHERE site_id = ? AND permission = 'admin' LIMIT 1
//   Throws on query error rather than defaulting to "nobody owns this".
```

Table shapes that matter:

```sql
-- 20250817000000_complete_database_setup.sql:26
content_elements(id uuid pk, site_id uuid, element_id text, selector text,
  original_content, current_content, language default 'en', variant default 'default',
  metadata jsonb, …, UNIQUE(site_id, element_id, language, variant))
-- index idx_content_elements_element_id ON content_elements(element_id)   :391

-- 20260127_ab_testing_v2.sql:8
ab_test_results(id, test_id, variant_id, visitor_id TEXT NOT NULL, session_id,
  event_type CHECK IN ('view','click','conversion'), value, metadata,
  geo_country, geo_region, recorded_at)

-- 20260127_ab_testing_v2.sql:40
visitor_buckets(id, site_id, visitor_id TEXT NOT NULL, test_id, variant_id,
  geo_*, bucketed_at, UNIQUE(visitor_id, test_id))

-- 20260731002000_missing_tables_audit_analytics.sql:154  -- BILLING, not A/B
conversion_events(id, site_id, user_id, event_type CHECK IN
  ('trial_start','subscription','upgrade','churn'), value, metadata, created_at)

-- site_analytics(site_id, date, page_views, unique_visitors, content_updates, …,
--   UNIQUE(site_id, date))   -- site-level daily rollup; has no element dimension
```

---

## M2 — the s09/s12 data model conflict

### Verdict: **NOT joinable. `s12` must change; `s09` must not.**

**The two models cannot be joined, and the join is unnecessary because the data `s12` wants
already exists on a different table.**

**Why not joinable.** `s12` AC 2 requires *"a click on a tracked CTA within the same page view
as an impression of the tested section"*. That is a three-way correlation over
`(visitor or page-view key) × (impression) × (click)`. `s09` AC 9 forbids the key: *"no
per-visitor identifier is stored"*, and its trap note is stronger still — *"No cookie, no
fingerprint, no visitor id. Aggregate counts only."* Its ingest writes pre-aggregated counts.
An aggregate count carrying no page-view and no visitor key cannot, by construction, establish
that a specific click and a specific impression belong to the same page view. There is no join
column and no join column can be added without repealing AC 9. As specified, `s12` AC 2 is
unbuildable from `s09`, and no amount of planning fixes it — the two ACs contradict.

**And `s09` cannot supply it even if you weakened the privacy line, because *neither* model has
a page-view identifier.** I checked: `ab_test_results` has `visitor_id` and an unused
`session_id` (nothing in the widget ever sets `session_id` — `sendTrackEvent` payloads at
`:3100-3108`, `:3121-3129`, `:3145-3155` omit it, and `track/route.ts` maps it to `null`).
"Same page view" is *currently unrepresentable anywhere in this codebase*. Whichever model wins,
`s12` AC 2 needs a page-view key minted client-side per page view, or it needs to be reworded.

**Why the join is unnecessary — the per-visitor stream already exists and already computes the
answer.** The widget emits, on every non-staging page load (`recopyfast.src.js:898-906`):

- `trackImpressions()` (`:3113-3135`) → one `event_type: 'view'` per active test, carrying
  `visitor_id`,
- `setupClickTracking()` (`:3077-3111`) → `event_type: 'click'` on the tested element or its
  nearest `a`/`button` ancestor, carrying `visitor_id`,
- `trackConversion(name, value)` (`:3137-3161`, exposed publicly at `:6191`) →
  `event_type: 'conversion'`, carrying `visitor_id`,

all posted to `POST /api/ab-tests/track` (`:3163-3179`) and stored in `ab_test_results` with
`visitor_id NOT NULL` and an index on `(visitor_id, test_id, event_type)`. Persistent assignment
lives in `visitor_buckets`, unique on `(visitor_id, test_id)`, written by
`/api/ab-tests/bucket/[siteId]:121,201`. And `src/app/api/ab-tests/[testId]/results/route.ts`
**already** computes `views` and `conversions` per variant from `ab_test_results` and runs a
z-test on them. `s12` is finishing that path, not inventing one — and its impression half is
already in place.

**Two defects in the existing path that `s12` inherits and must fix — these are `s12`'s problem,
not `s09`'s, but they explain why "just use the existing views" is not zero work:**

1. `view` events are deduplicated per `(visitor_id, test_id)` **for the life of the test**
   (`api/ab-tests/track/route.ts`, the `uniqueChecks` loop). So `views` is a
   *unique-visitor* count, not an impression count, and `conversions / views` is a
   per-visitor conversion rate. That is a defensible denominator for an A/B test — arguably the
   *correct* one — but it is not what `s12` AC 1 ("Each variant's impressions and conversions")
   says, and the UI label must match the arithmetic.
2. `click` and `conversion` events are **not** deduplicated at all, so a visitor clicking twice
   contributes two conversions against one view and the rate can exceed 1.0.

**Remediation, in order of preference.**

**A (recommended).** Redefine `s12` AC 2 over the existing stream: *a conversion is a `click` or
`conversion` event recorded for the same `visitor_id` and `test_id` as a `view` event*, with
`view` deduplicated per visitor per test as it already is. Then **delete `s09` from `s12`'s
Dependencies and delete the `s09 → s12` edge** from the graph at `stories.md:61-62`. This costs
`s12` nothing it was not already going to do, removes a false blocker from the critical path
(`s09` currently gates `s12` and therefore serialises two complexity-4 stories that are
independent), and leaves `s09`'s privacy position — and its GDPR selling point — intact. Add to
`s11`'s "audit what works before writing anything" note: `trackImpressions` (`:3113`),
`setupClickTracking` (`:3077`), `trackConversion` (`:3137`), `sendTrackEvent` (`:3163`) and the
`rcf_vid` write (`:2975`).

**B (only if the section-level join is genuinely wanted).** `s09` gains a per-page-view
identifier — an in-memory, non-persisted, non-cookie random id regenerated on every page view
and every SPA route change, sent on both impression and A/B events. This is *weaker* than a
visitor id (it dies with the tab and cannot follow anyone across page views) and is arguably
still outside consent scope, but it is a per-visitor identifier *within* a page view and it
contradicts the literal words of AC 9. **That trade belongs in the PRD as a decision, not inside
a story** — and note `prd.md:436` still lists the conversion definition under *"Still open"*
while `stories.md` states it as resolved, so the PRD is already the right venue.

**Do not choose C**: making `s09` visitor-keyed. It costs the one thing `s09` sells that neither
TinaCMS nor CloudCannon has and that the European local-business segment is being sold on, in
exchange for a correlation the A/B stream already provides.

**Collateral finding (review m4, and it stands).** `s09`'s GDPR claim is *already* untrue on any
page where A/B runs: `rcf_vid` is a one-year first-party cookie set unconditionally at
`recopyfast.src.js:2975` for every non-staging visitor, whether or not a test is active — the
cookie is written by `initVisitorId()` at `:900`, *before* `fetchActiveTests()` at `:901`. So
today every live install already sets a persistent visitor cookie. `s09`'s consent-scope claim
must be scoped to "the impressions feature adds no identifier", not "RecopyFast sets none".

---

## Traps & constraints

1. **`s06` is a hard gate, not a courtesy.** The widget is 46,781 gz against a 30,000 ceiling —
   already breached by 56% before this story adds a byte. There is no build gate to fail
   (`scripts/build-embed.mjs` measures nothing), so an implementer can add 2 KB and see green.
   AC 8's "total stays ≤ 30,000" is **unachievable until `s06` and `s08` both land**. Do not let
   this story be scheduled as if AC 8 were checkable on its own.
2. **The global `IntersectionObserver` mock voids every impression test silently.**
   `jest.setup.js:178` returns `{observe: jest.fn(), unobserve, disconnect}` — `observe` never
   invokes a callback, so *no* entry is ever delivered and every assertion of the form "no
   impression was recorded" passes for the wrong reason. AC 2 ("scrolled past in under 1 second
   records no impression") is the specific criterion that will pass vacuously and ship broken.
   The test must install its own observer — `InteractiveHero.attract.test.tsx:40-74` is the
   working precedent (a class implementing `IntersectionObserver` assigned over
   `global.IntersectionObserver` in `beforeEach`). It needs to be **controllable**: the test
   drives entry/exit and clock, `jest.useFakeTimers()` supplies the ≥ 1 s dwell.
3. **Page-blind element ids merge counts across pages** — see the premise section. Live
   `test.failing` cases at `src/__tests__/embed/element-id-page-scope.test.ts:157,187,214` will
   flip to passing the moment anyone page-scopes the id, which is the designed signal. The
   impression table should carry a page dimension of its own rather than waiting on A-14.
4. **Do not extend `/api/analytics/track`.** Confirmed why: it writes one row per event into
   `user_activity_logs` via `analytics.track…`, its `ACTION_TYPES` union is
   `satisfies readonly UserActivityLog["action_type"][]` so widening it widens the activity-log
   type across the app, and `s03` depends on that log staying cheap. Impressions need their own
   batched endpoint writing pre-aggregated counts.
5. **ADR 002 binds this route.** A site-token ingest path uses `createServiceRoleClient()`, and
   §3 requires an explicit call to `authorizeIngestRequest` / `authorizeSiteRequest` before
   touching data (no fourth auth path), §4 requires a **site-keyed, `onStoreFailure: "deny"`**
   rate limiter, §1 requires the RLS policy in the *same migration* that creates the table.
   The ADR names `s09` explicitly as one of the three stories that motivated it.
6. **Volume arithmetic is the actual risk and no criterion measures it.** The story's Risk
   paragraph is right, but no AC bounds events per page view or rows per day. A page with 40
   mapped elements and a visitor who scrolls the whole thing produces 40 impressions per page
   view. Pre-aggregating client-side to one request per flush is necessary but not sufficient —
   the *row* count at the database is what costs money. Plan a per-(site, element, day, page)
   upsert-and-increment, not an append-only event row, or `s10`'s pruning story inherits an
   unprunable table.
7. **The widget has no entitlement signal, and AC 7 asks it to have one.** Resolving
   site → `site_permissions.admin` → `getEffectivePlan(userId)` on every widget boot puts two
   database round-trips and the billing subsystem on a public, cached, cross-origin hot path.
   `/api/ab-tests/active/[siteId]` sets `Cache-Control: public, max-age=60,
   stale-while-revalidate=300` and does **no** entitlement check at all — that is the precedent,
   and it is a precedent for *not* checking. Options: gate server-side at ingest (silently
   discard for unentitled sites — but then AC 7's "the widget sends no impression events" is
   false), or return a boolean on an already-made request. Neither is free and the story does not
   say which.
8. **SPA route changes have no hook.** No `popstate` listener and no `history.pushState` patch
   exists anywhere in the widget. `MutationObserver` (`:3339-3357`) fires on DOM churn but cannot
   distinguish "new page" from "modal opened" — and AC 3 ("exactly one impression per page view")
   depends entirely on getting that distinction right. Following the `MutationObserver` pattern,
   as the story instructs, gives you rescanning but not page-view boundaries.
9. **`visibilitychange` is not `beforeunload`.** The widget's only unload listener
   (`:4172,4230`) is the edit-mode unsaved-changes guard and is the wrong hook to extend. On
   mobile Safari `beforeunload` frequently does not fire; `visibilitychange` → `hidden` plus
   `pagehide` is the pair AC 4 actually needs, and `sendBeacon` (already present at `:3168`) is
   the only delivery mechanism that survives either.
10. **`recopyfast.js` is generated.** Edit `recopyfast.src.js`, then `npm run build:embed`.
    `--check` fails CI on a stale artifact. Do not rename or move the
    `// STABLE ELEMENT IDENTITY` (`:680`) or `class ReCopyFast {` (`:826`) markers —
    `element-id-page-scope.test.ts:60-70` slices the file between them and throws a
    deliberately loud error if they move.
11. **Degrade, never break** (`AGENTS.md` non-negotiable 4). An observer that throws on a host
    page reaches the customer's `window`. There is no error surface on their domain, so the
    failure presents as "editing stopped working on one site".

---

## Open questions

1. **Page scope (blocking a correct schema).** Does an impression row carry the page URL/path?
   Without it, counts merge across every page sharing a template (A-14) and the feature misleads.
   With it, `s09` has a `(site, element, page)` key while `content_elements` has `(site, element)`
   and the dashboard join is one-to-many. **Recommendation: carry a normalised pathname on the
   impression row.** It leaves `content_elements` untouched, so A-14/D2 stays independently
   decidable, and it is the only version of the feature a marketer can act on.
2. **Entitlement enforcement point (AC 7).** Widget-side (needs a plan signal on a cached public
   route) or ingest-side (contradicts "the widget sends no impression events")? The two readings
   produce materially different code. Note `LIVE_SUBSCRIPTION_STATUSES` already includes
   `"trialing"`, so once `s01` lands, `hasAnyEntitlement` + `kind === "plan"` answers "trialling
   counts as entitled" with no new logic.
3. **Does `PlanLimits` gain an `impressions` key?** It has `abTesting: boolean` and nothing for
   impressions (`plan-types.ts:61-69`); `plans.limits` is JSONB
   (`20260802000000_plans_catalog.sql`) and the comment there enumerates the expected keys. If
   the gate is per-plan rather than "any plan", the catalogue changes and `s13` (agency plan)
   must carry the same key.
4. **Is the ≤ 2,000 gz allowance net of `s06`, or against today's 46,781?** `stories.md:100`
   allocates it against the *post-`s06`* 24,000 target. Review m2 (`reviews/stories.md:178`)
   showed the A/B row of that same table double-counts code already in the baseline. The `s09`
   row does not have that problem (impressions are genuinely new), but the *total* line does,
   and AC 8 asserts the total.
5. **`s12` dependency — needs an operator decision now, not at plan time.** Remediation A above
   (drop the edge) versus B (add a page-view id to `s09`). A also unblocks parallel scheduling of
   `s09` and `s12`. PRD decision 5 (`prd.md:427-432`) and the "Still open" list at `prd.md:436`
   disagree with each other about whether this is even settled.
6. **DNT detection semantics.** `navigator.doNotTrack` returns `"1"`, `"yes"`, `"0"`, `null` or
   `undefined` depending on browser and vintage, and Safari removed it. Which values suppress
   tracking, and does `Sec-GPC` count? No precedent exists in this repo (Fact 4), so this is a
   decision, and AC 9 is untestable until it is made.

---

## Real complexity

**Confirmed 4 — but a *high* 4, and it is a 4 only if `s06` has already shipped.**

`stories.md` scores it 4 ("high-volume ingest plus third-party runtime work"). That holds, and I
found nothing that pushes it to 5 *by itself*. What the story understates is the breadth: this is
not one surface, it is five — widget runtime (observer, dwell timer, page-view boundaries, DNT,
batching, flush), a new table plus RLS plus a new rate-limit preset, a new authenticated ingest
route, an entitlement decision that touches billing, and a dashboard surface. Any one of them is
routine; the combination is what makes it a genuine 4.

Three specific things push it to the top of the band rather than the middle:

- **The byte budget makes it conditionally impossible.** AC 8 cannot be satisfied at all until
  `s06` + `s08` land (46,781 today). This is a real sequencing constraint, not a nice-to-have.
- **The test approach must be built before the feature.** Because of the global mock, the *first*
  task is a controllable `IntersectionObserver` double plus fake timers. Writing the observer
  first and the tests second yields a green suite that asserts nothing.
- **Two open decisions are load-bearing on the schema** (page scope, entitlement point). Neither
  can be deferred past the first migration, and `AGENTS.md` non-negotiable 5 forbids editing an
  applied migration.

**No split proposal** — a 4 does not require one, and the natural seams here (ingest / read model
/ dashboard) are already the seam between `s09` and `s10`. Splitting further would produce a
story that collects data nobody can see, which is the "dark feature" failure mode `stories.md`
opens by warning about. If the operator chooses remediation B for M2, re-score: adding a
page-view identifier reopens the PRD privacy decision and would make this a 5.
