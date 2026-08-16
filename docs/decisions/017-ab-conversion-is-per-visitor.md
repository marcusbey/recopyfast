# ADR 017 — A/B conversion is defined over the existing per-visitor event stream, not `s09`

- Status: accepted
- Date: 2026-08-16
- Scope: story s12-ab-results

## Context

This ADR records the resolution of review finding **M2** (`docs/reviews/stories.md:116-132`),
which flagged `s12`'s conversion definition as unbuildable from its declared dependency on
`s09-section-impressions`. Two independent research passes — `docs/research/s12-ab-results.md`
`## M2` and `docs/research/s09-section-impressions.md` `## M2` — reached the same verdict
without coordinating: drop the `s09` edge. That agreement, arrived at from opposite ends of
the dependency, is why this is written down as a decision rather than left as a research note.

`s12` AC 2 (`docs/stories.md:723` at time of research) requires establishing that a click and
an impression of the tested section happened **in the same page view**. That is a three-way
correlation — `(page-view key) × (impression) × (click)` — and it needs a column that exists
on both records. No such column exists between the two candidate sources, for opposite
reasons:

- `s09` forbids one by design. Its own acceptance criteria state *"Do Not Track is respected,
  and no per-visitor identifier is stored"* and its privacy trap note is explicit: *"No
  cookie, no fingerprint, no visitor id. Aggregate counts only. This keeps the feature out of
  GDPR consent scope"* (`docs/stories.md:488`, `:515-517`). `s09` writes pre-aggregated counts,
  not events. An aggregate count with no key cannot be joined to an individual click, by
  construction. Adding a join column to `s09` — a visitor id, a session id, a page-view id —
  is not a schema tweak; it repeals the acceptance criterion that keeps the feature out of
  consent scope, which is the feature's stated differentiator against TinaCMS and CloudCannon
  for the European local-business segment.
- `s12`'s own event stream has the opposite problem: it has a visitor key but no page-view
  key. The A/B pipeline already carries per-visitor identity end to end — `view`, `click`, and
  `conversion` events, each posting `site_id`, `test_id`, `variant_id`, `visitor_id`
  (`public/embed/recopyfast.src.js:3096-3161`), keyed by a one-year first-party `rcf_vid`
  cookie minted at `:2956-2976`, persisted into `ab_test_results` with `visitor_id NOT NULL`
  (`supabase/migrations/20260127_ab_testing_v2.sql:8`). `/api/ab-tests/[testId]/results`
  already aggregates `views` and `conversions` per variant from this table. But
  `ab_test_results.session_id` exists and nothing ever sets it: the widget's `sendTrackEvent`
  payloads for `click`, `view`, and `conversion` (`:3100-3108`, `:3121-3129`, `:3145-3155`)
  omit it, and `track/route.ts:149` writes `null` unconditionally. "Same page view" is
  therefore currently unrepresentable anywhere in this codebase — not degraded, not
  approximate, absent.

`s12` cannot depend on data `s09` is forbidden from producing, and it cannot use a column
that has never been populated. Something has to give, and it has to be decided once, not
rediscovered per implementer.

## Decision

**A conversion is defined over the existing per-visitor A/B event stream. The `s09` dependency
is dropped.** `s12`'s conversion metric is computed entirely from `ab_test_results` and
`visitor_buckets` — data the widget already emits and already persists — and needs nothing
from `s09`, built or unbuilt.

> **A conversion is a click on the tested element (or its nearest `<a>`/`<button>` ancestor)
> by a visitor bucketed into a variant, counted once per visitor. The denominator is that
> variant's assignment count from `visitor_buckets`.**

This resolves the "same page view" sub-problem by **rewording the criterion, not by minting a
page-view key.** The correlation the AC was reaching for is already structural rather than
something that needs a computed join: `setupClickTracking` (`recopyfast.src.js:3077-3111`)
binds its click listener to the element resolved from `self.elements` — the content map built
for that specific page view — and the matching `view` event for the tested section is emitted
two lines later in the same `init` sequence (`:904`, `:905`). A click can only be recorded from
a page view that also produced a `view` event for the tested section, because the listener that
produces the click does not exist otherwise. No page-view id needs to be minted, no widget
bytes are spent, and no ingest column is added to re-derive a fact the call graph already
guarantees.

"Counted once per visitor" is the second half of the decision and is load-bearing, not
pedantry. `view` rows are already deduplicated per `(visitor_id, test_id)` for the life of the
test (`src/app/api/ab-tests/track/route.ts:101-136`), while `click` rows are not deduplicated
at all. Computing a rate as `conversions / views` therefore divides an event count by a visitor
count — a ratio that can exceed 1.0 — which breaks the binomial assumption the pooled
two-proportion z-test rests on. Redefining conversion as "distinct visitors who clicked, over
visitors assigned" and fixing the statistics are the same fix: both halves come from
`visitor_buckets` and a deduplicated read of `ab_test_results`, so the same query answers
both the definition and the arithmetic.

## Considered options

**(a) Keep the `s09` edge and weaken `s09`'s anonymity to supply a join key.** Rejected. This
was `s09`'s Remediation B in its own M2 section: an in-memory, non-persisted, per-page-view
random id, regenerated on every page view and SPA route change, sent on both impression and
A/B events. It is weaker than a visitor id — it dies with the tab — but it is still a
per-visitor identifier within a page view, and it contradicts the literal words of `s09` AC 9.
It costs `s09` the one differentiator neither TinaCMS nor CloudCannon has and that the European
local-business segment is being sold on, in exchange for a correlation the A/B stream already
provides for free. Also rejected on process grounds: this is a privacy posture trade-off that
belongs in the PRD as a decision, not something a story silently absorbs — and it would apply
to every visitor on every page, not just to A/B traffic, since `s09`'s observer is a single
shared script path.

**(b) Keep the `s09` edge and build a parallel per-visitor impression pipeline inside `s12`.**
Rejected. `s09`'s own aggregate-count design is deliberate and would still not answer `s12`'s
question even if `s09` shipped first — an aggregate count has no visitor key to join against
regardless of whether `s12` waits for it. The only way to make the `s09` edge load-bearing
would be for `s12` to build and own a second, visitor-keyed impression stream parallel to
`s09`'s aggregate one, duplicating an entire ingest surface (observer semantics, batching,
a table, RLS, a rate-limit preset) that `s09` already owns for a different purpose. That is a
second ingest axis stacked on top of `s12`'s existing two — statistics and lifecycle — which
research scored as pushing the story from a 4 to a 5 (`docs/research/s12-ab-results.md`, "Real
complexity"). It would also serialize `s12` behind an unbuilt story for data it could never
actually use, since `s09` does not exist yet: no `IntersectionObserver` in `public/embed/`, no
impressions route under `src/app/api/` (both confirmed by grep in the `s09` research pass).

**(c) Define conversion without any page-view scoping — a bare `conversions / assignments`
with no structural link to a specific impression.** Assessed honestly: this is close to what
the decision above already does, and the cost is real but bounded, not open-ended. The
attribution accuracy given up is the case of a visitor who is bucketed into a variant, later
returns in a *different* page view where the tested element does not render (a template
change, a partial page, a different route), and clicks something else that happens to match
the tested element's selector on that later visit. That failure mode requires the tested
element's selector to also exist and be clickable outside the tested page — a narrower case
than it first sounds, and one the accepted decision already forecloses structurally (see
Decision above: the click listener is only ever attached where the `view` fired). This option
is listed separately from the Decision because it names what would be lost *if* the structural
argument did not hold — it is the fallback position, not the chosen one. It was not needed
because the call-graph argument in the Decision section holds without it.

## Consequences

**Easier.** `s12`'s dependency graph collapses to `s11a-ab-data-plane` and `s11b-ab-surface`
only — both of which already exist and already emit the data this story consumes. `s12` can
start as soon as `s11a`/`s11b` land, instead of waiting on an unbuilt `s09`, and the two
complexity-4 stories that were previously serialized by a false edge can now schedule in
parallel. `s09`'s privacy position, and the GDPR-consent-scope claim built on it, survive
untouched — this decision does not ask `s09` to change anything.

**Harder.** The conversion metric this ADR defines is a *unique-visitor click rate*, not the
"impressions and conversions" language in `s12` AC 1 taken literally — the UI must label the
denominator "Assignments," not "Impressions," and must state the definition in plain language
next to the numbers, because a marketer reading "impressions" will expect a page-view count
and get a visitor count instead. Getting the units right here is also what fixes the
statistics: `visitor_buckets` becomes the single source of truth for the sample-size gate
(`≥ 1,000 assignments per variant`), replacing today's mix of a hardcoded floor, a
views-summed-across-variants gate, and counts derived from an unbounded row fetch.

**Watch.** The point this ADR exists to guard against: **a wrong significance calculation does
not error.** It renders a confident, plausible, incorrect recommendation, and the customer
acts on it — promoting a variant to their live site on the strength of a p-value computed on
mismatched units. Nothing in the request/response cycle signals that failure; the number
comes back, looks like a percentage, and is wrong. This is why the significance calculation
that consumes this definition is not spot-checked but unit-tested against five known vectors
with `1e-6` tolerance, including two that are one conversion apart and straddle the 95%
threshold, and one — `0/1000` vs `0/1000` — that must not reach significance
(`docs/plans/s12-ab-results.md`, task T1). If that suite is wrong, everything built on top of
this ADR's definition is confidently wrong in the same silent way, and the tests will agree
with it. Re-open this ADR if a future story needs true page-view-level impression counts (for
example, if `s09`'s aggregate model is ever revisited to carry a page-view key) — that would
be a new decision, not an amendment to this one, since it trades away the privacy position
option (a) above rejected.
