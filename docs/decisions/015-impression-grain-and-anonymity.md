# ADR 015 — Impression grain is pre-aggregated and carries no visitor identifier

- Status: accepted
- Date: 2026-08-16
- Scope: story s09-section-impressions

## Context

`s09-section-impressions` adds the widget's first high-volume ingest path. The story's own risk
statement names the shape of the danger: *"impression events are orders of magnitude more
numerous than edit events. An unbatched, unsampled implementation generates ingest volume that
costs more than the plan it gates"* (`docs/stories.md:582-584`). A page with 40 mapped elements
and one visitor who scrolls the whole thing is 40 candidate impressions from a single page view;
`content_elements` — the table impressions attach to — has no cap on elements per site. Every
row this feature writes is a row someone pays to store and a row a rate limiter must be sized
for. The grain — what one stored row represents — decides whether that cost is bounded or not,
and it decides it once: `AGENTS.md` non-negotiable 5 forbids editing an applied migration, so
whatever grain lands in the first `section_impressions` migration is permanent
(`docs/plans/s09-section-impressions.md:81-83`, task 2).

The same story's acceptance criterion 9 states the other half of the same choice: *"Do Not Track
is respected, and no per-visitor identifier is stored"* (`docs/stories.md:595`), echoed in the
story's own trap note — *"No cookie, no fingerprint, no visitor id. Aggregate counts only. This
keeps the feature out of GDPR consent scope, itself a selling point for the European
local-business segment"* (`docs/stories.md:622-624`). The PRD independently states the same
definition as a resolved decision: *"≥ 50% of the section in viewport for ≥ 1 continuous second,
one impression per section per page view, no visitor identifier"* (`docs/prd.md:427-429`,
decision 4).

**Grain and anonymity are not two decisions — they are the same one, argued from two
directions.** A row that identifies "who" cannot be an aggregate count; an aggregate count
cannot identify "who." Splitting them into separate ADRs would let a later change to one silently
repeal the other — for instance, "just add a `visitor_id` column, we'll leave the anonymity ADR
alone" is exactly the kind of change that looks locally reasonable and globally isn't.

**This model was contested, not assumed.** `docs/research/s09-section-impressions.md`'s M2
section examined whether `s09` should instead carry a per-visitor or per-page-view key, because
`s12-ab-results` AC 2 needs to prove *"a click on a tracked CTA within the same page view as an
impression of the tested section"* — a correlation that, on its face, needs a shared key between
the two data sets. The research concluded the two requirements cannot both hold: *"`s09` AC 9
forbids every candidate ('no per-visitor identifier is stored'), aggregate counts only — by
construction there is no join column and adding one repeals the criterion that keeps the feature
out of GDPR consent scope"* (`docs/research/s09-section-impressions.md:279-282`). It also found
the join was never necessary: the widget already runs a separate, pre-existing per-visitor event
stream for A/B testing — `trackImpressions()` (`public/embed/recopyfast.src.js:3113-3135`),
`setupClickTracking()` (`:3077-3111`) and `trackConversion()` (`:3137-3161`), each carrying
`visitor_id` into `ab_test_results`, fed by the `rcf_vid` cookie minted in `initVisitorId()`
(`:2956-2976`) and read back at boot (`:900-901`). `s12`'s conversion definition can be built
entirely on that existing stream, so nothing about `s09`'s grain needed to change to unblock it.
`docs/stories.md:149-161` ("M2") records the resolution taken from that research: the `s09 → s12`
dependency edge was removed, and `s12`'s conversion is now defined over the A/B event stream
(`docs/stories.md:735-738`, the note attached to `s12`'s Dependencies). This ADR is the settlement
of that contest, on the `s09` side: `s09`'s model did not move.

## Decision

**`section_impressions` stores pre-aggregated counts at grain `(site_id, element_id, page_path,
bucket_date)`. No row, column, or payload field anywhere in the pipeline carries a per-visitor
identifier, a per-page-view identifier, a cookie, or a device/browser fingerprint.**

The grain and the anonymity are one decision because the grain is what makes the anonymity
achievable: a table keyed on `(site, section, page, day)` with an `impression_count` that is
upsert-incremented has no slot for "who" to occupy, so there is nothing to later be tempted to
fill in. Concretely:

- **What counts as an impression.** ≥ 50% of a tracked section's area is in the viewport for
  ≥ 1 continuous second, exactly as the PRD states (`docs/prd.md:427-429`) and `s09` AC 1
  restates (`docs/stories.md:587`).
- **Dedupe unit.** One impression per section per page view. A page view begins at widget boot
  and again on every SPA route change (`docs/plans/s09-section-impressions.md:173-187`, task 7);
  leaving and re-entering the viewport within the same page view does not produce a second
  impression (AC 3, `docs/stories.md:589`).
- **What is written.** Not an event row per impression — a count. The widget batches
  `{elementId, pagePath}` occurrences client-side and flushes an aggregate; the server-side
  write is `insert … on conflict (site_id, element_id, page_path, bucket_date) do update set
  impression_count = impression_count + excluded.impression_count`
  (`docs/plans/s09-section-impressions.md:88-92`, task 2) — an increment, never an append and
  never a read-then-write.
- **The page dimension.** `page_path` is a normalised pathname, not a visitor attribute. It
  exists because `computeStableElementId` is page-blind (`public/embed/recopyfast.src.js:819-824`,
  derived from `structuralPath` at `:731-764` — tag names, sibling index, nearest authored
  ancestor id, no URL anywhere in the input), so two pages built from one template produce the
  same element id. Without a page dimension on the impression row, `/about`'s hero and
  `/pricing`'s hero would merge into one count, silently, for exactly the templated multi-page
  sites the PRD's local-business segment runs. `page_path` answers "which page," which is a
  property of the request, not a property of a person, and it is the second half of the grain
  precisely so the anonymity half does not have to do that job instead.
- **What is never written.** No cookie is set by this feature. No fingerprint is derived or
  stored. No `visitor_id`. No `session_id`. No page-view id crosses the wire in either direction
  — not in the batched POST body, not in a response, not in a query string alongside the site
  token. Do Not Track (`navigator.doNotTrack`, `window.doNotTrack`, `navigator.msDoNotTrack`
  equal to `"1"` or `"yes"`, and `navigator.globalPrivacyControl === true`) suppresses the
  tracker entirely — it never starts, never attaches an observer — rather than observing and
  discarding (`docs/plans/s09-section-impressions.md:189-200`, task 8).

## Considered options

**A. Raw per-event rows with a visitor id — rejected.** The naive shape: one row per impression,
carrying whatever identifier ties it to a visitor. Rejected on two independent grounds. First,
volume: an unsampled, per-event table inherits exactly the cost problem the story's Risk
paragraph names — every scroll on every page is a row, with no natural ceiling tied to traffic
rather than to distinct (section, page, day) combinations. Second, and the reason this option is
foreclosed even if the volume were solved by sampling: a visitor id on an impression row is
precisely the identifier AC 9 prohibits, and it repeals the property that is itself a selling
point for the European local-business segment — the PRD's own framing (`docs/stories.md:623-624`)
is that *no visitor identifier* is what keeps this feature out of GDPR consent scope. A raw
event table with an identifier is not "impressions, made more granular" — it is a different,
regulated feature wearing the same name.

**B. Extending `/api/analytics/track` — rejected.** The obvious reuse: impressions are just
another `action_type` on the existing activity-log route. Rejected because that route writes one
row per event into `user_activity_logs`, whose `ACTION_TYPES` union is
`satisfies readonly UserActivityLog["action_type"][]`
(`src/app/api/analytics/track/route.ts:29-35`) — widening it widens the activity-log's type
across the app. `s03-activation-funnel` depends on that log staying cheap to build its
`account_milestones` timestamps from (`docs/stories.md:333`); routing impression volume through
the same table would make the log the bottleneck for milestones, funnel analysis, and every other
consumer, not only for impressions. This is also a grain mismatch independent of volume: that
route's contract is one row per discrete event, and impressions are not discrete events by the
time they reach ingest — they are already-batched counts. Extending a per-event log to accept
pre-aggregated counts is a shape it was never built for.

**C. Sampling — assessed and ruled out.** Sampling (record every Nth impression, or every Nth
visitor) is the standard answer to "too many events," and it was considered because the story's
own risk framing invites it. It does not fit here for two reasons specific to this feature.
First, it does not need to be reached for: the grain in the Decision above is already bounded
independent of traffic — the row count is `sites × elements × distinct page_paths × days`, not
`sites × elements × visits`, because writes are increments against a fixed key, not appends. A
site's `section_impressions` row count cannot grow no matter how much traffic it receives; only
the counter values grow. Sampling exists to bound row count under an append-only model; there is
no append-only model here to bound. Second, sampling would actively work against AC 7 and the
dashboard's non-negotiable zero-vs-not-tracked distinction
(`docs/plans/s09-section-impressions.md:241-245`, task 11): a sampled count is an estimate a
marketer cannot audit ("does 0 mean nobody saw it, or nobody was sampled?"), which is precisely
the ambiguity the design calls out as intolerable. Sampling is the right tool for a volume
problem this grain does not have.

**D. Adding a visitor key to serve `s12`'s conversion join — rejected; this is the M2
resolution.** `s12-ab-results` AC 2 wants to define a conversion as a click within the same page
view as an impression of the tested section (`docs/prd.md:430-432`, decision 5;
`docs/stories.md:723`). The literal-minded way to satisfy that is to give `s09` a join key —
either the visitor id already used by A/B tracking, or a narrower page-view-scoped id minted
fresh. Both were considered (`docs/research/s09-section-impressions.md:334-341`, option B) and
both were rejected, because either one is a per-visitor identifier by the plain meaning of AC 9,
full stop — a page-view-scoped id is weaker than a persistent visitor id (it cannot follow
anyone across page views, it is never persisted) but it is still an identifier that ties an
impression to *a specific visit by a specific visitor*, which is the exact thing AC 9 forbids
carrying. **The join was removed instead of the anonymity.** `s12`'s widget already emits a
per-visitor event stream for A/B tests — `view` (`recopyfast.src.js:3113-3135`), `click`
(`:3077-3111`) and `conversion` (`:3137-3161`) events, each carrying `visitor_id`, into
`ab_test_results` (`visitor_id TEXT NOT NULL`,
`supabase/migrations/20260127_ab_testing_v2.sql:8-25`) — and that stream already supplies
everything a same-page-view correlation needs, because it was built for exactly that
correlation. `docs/stories.md:149-161` records the settlement: the `s09 → s12` dependency edge
is deleted, and `s12`'s conversion is redefined over the A/B stream instead. `s09` pays nothing
for `s12`'s join; `s12` was never actually blocked on `s09` to begin with.

## Consequences

**`s12` cannot ever join to `section_impressions` — and that is the point, not a gap.** A future
agent looking at `s12`'s conversion definition and `s09`'s table side by side may see an
unexploited correlation sitting right there and reach to close it with a foreign key or a shared
identifier. Don't. The absence of a join column is this ADR's decision made durable in the
schema, not an oversight later stories should fix. If `s12` (or any future story) genuinely needs
"was this click in the same page view as this impression," the answer is the A/B event stream's
existing `visitor_id`/`test_id` correlation (option D above), never a key added to
`section_impressions`.

**The ≤ 2,000 gz byte allowance is a hard ceiling this grain was chosen to fit inside.**
Aggregating client-side to one flush per `visibilitychange`/`pagehide` and sending counts rather
than events keeps the wire payload small regardless of how many sections a visitor scrolled past;
an append-only per-event model would have made the byte budget and the storage budget compete for
the same headroom. This grain buys back both at once — the widget ships fewer bytes because it
sends less data, and the database stores fewer rows because the write is an increment.

**SPA route changes are new page views with no page load to hook.** The dedupe unit ("one
impression per section per page view") depends on correctly detecting a page-view boundary, and
on a client-rendered site there is no `beforeunload`/reload signal to anchor it to — the widget
must listen for `popstate` and wrap `history.pushState`/`replaceState`
(`docs/plans/s09-section-impressions.md:173-187`). Get this wrong in either direction and the
grain silently degrades: treating a route change as *not* a new page view under-counts (a visitor
who navigates back to a page and re-reads a section never gets a second impression); treating DOM
churn from the existing `MutationObserver` rescan (`recopyfast.src.js:3339-3357`) as a new page
view over-counts (every content re-render resets dedupe for elements that never left the
viewport). Both failure modes are invisible in a green test suite that doesn't specifically drive
a `pushState` to a new path versus the same path — which is why `docs/plans/s09-section-impressions.md`
task 7 requires both cases as separate assertions.

**`jest.setup.js:177-182` globally mocks `IntersectionObserver` with a no-op `observe`.** The
mock (`global.IntersectionObserver = jest.fn().mockImplementation(() => ({ observe: jest.fn(),
unobserve: jest.fn(), disconnect: jest.fn() }))`) never invokes a callback, so under the global
mock *every* impression assertion of the form "no impression was recorded" passes for the wrong
reason — including AC 2 ("a section scrolled past in under 1 second records no impression"),
which is the criterion most likely to ship broken while its test stays green. This ADR's grain
and anonymity guarantees are only as real as the tests that exercise them, and the global mock
delivers no entries at all, so a test suite that never overrides it would prove nothing about
either. Every impression test must install its own controllable `IntersectionObserver` double
locally (the pattern at `src/components/landing/__tests__/InteractiveHero.attract.test.tsx:40-74`
is the existing precedent for assigning over `global.IntersectionObserver` in `beforeEach`) and
drive entry/exit and dwell time explicitly — passing vacuously against the shared mock is not
verification of this ADR's grain, and must not be reported as such.

**Watch: the widget already carries a persistent visitor identifier for a different feature, and
this ADR's privacy claim must not be overstated because of it.** `initVisitorId()`
(`recopyfast.src.js:2956-2976`) sets a one-year first-party `rcf_vid` cookie unconditionally on
every non-staging page load (`:900`, before `fetchActiveTests()` at `:901`), regardless of
whether an A/B test is active. So on any site where the widget runs at all, a persistent visitor
cookie already exists today — this feature does not introduce it and cannot remove it.
`s09`'s truthful claim is narrower than "RecopyFast sets no identifier": it is *"the impressions
feature adds no identifier of its own."* State it that way in any customer- or consent-facing
copy; the broader claim is false and checkable as false from the same file this ADR cites.
