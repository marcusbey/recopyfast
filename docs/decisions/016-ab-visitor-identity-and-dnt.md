# ADR 016 — A/B visitor identity is `rcf_vid`, scoped to A/B alone; DNT and cookie refusal degrade to ephemeral, unrecorded bucketing

- Status: accepted
- Date: 2026-08-16
- Scope: story s11c-ab-variant-delivery

## Context

RecopyFast runs two visitor-facing measurement features in the same widget, and they need
opposite privacy postures to do their jobs.

`s11` (A/B testing) needs a *returning visitor to see the same variant on every visit for the
test's duration* — the story's own acceptance criterion, "bucketing is deterministic from a
stable input, never random per request" (`docs/stories.md:676`), reasserted as ±2 percentage
points over 10,000 simulated assignments, unit-tested (`docs/stories.md:677`). Both are only
checkable if the same visitor resolves to the same bucket twice, which requires a stable
identity to hash. The widget already has one: `initVisitorId()` reads or mints a UUID and
writes it as a first-party cookie on the host page's own origin —
`rcf_vid=…; path=/; max-age=31536000; SameSite=Lax` (`public/embed/recopyfast.src.js:2956-2976`,
the write itself at `:2975`). That identity already flows into the events the widget sends
today: a `click` handler that builds a `visitor_id`-carrying payload
(`recopyfast.src.js:3096-3109`), a batched `view` event per active test from `trackImpressions`
(`:3113-3135`), and a `conversion` event from `trackConversion` (`:3137-3161`) — all three
funneled through `sendTrackEvent`, which `POST`s to `/ab-tests/track` via `sendBeacon`
(`:3163-3180`) into `ab_test_results`, a table whose `visitor_id` column is `NOT NULL`
(`docs/stories.md:157`).

`s09` (section impressions) needs the opposite, on purpose. Its acceptance criterion reads
*"Do Not Track is respected, and no per-visitor identifier is stored"* (`docs/stories.md:595`),
and its agentic notes are explicit about why: *"No cookie, no fingerprint, no visitor id…
Aggregate counts only. This keeps the feature out of GDPR consent scope"*
(`docs/stories.md:622-624`). The backlog's own research review (M2, `docs/stories.md:149-161`)
leaned on that constraint to settle a real dependency question: `s12` needed a join key between
impressions and A/B events, `s09`'s anonymity forbids one existing, so `s12` was rewired to read
the A/B event stream instead — which *does* carry `visitor_id`, precisely because `s11` chose
differently. **The two features sit in the same script tag, on the same page, deliberately
answering "does this visitor have an identity?" in opposite ways.** That is not an inconsistency
to be reconciled away; it is the correct shape for each feature's job, and it is the reason this
ADR exists — to state the A/B side of it explicitly enough that nobody "fixes" the asymmetry by
sharing an identifier between the two.

What is genuinely undecided — carried as an open trap in research
(`docs/research/s11-ab-run-test.md:247-252`) and as an unwritten dependency in the plan
(`docs/plans/s11c-ab-variant-delivery.md:144-157`) — is narrower than "should A/B have an
identity"; that question is already settled by the acceptance criteria above. What's open is
what happens to a visitor who either sends `navigator.doNotTrack === "1"` or whose browser
silently refuses the cookie write (Safari private browsing, a cookie-blocking extension, or a
consent-management platform on the host page that hasn't obtained consent yet). The widget
cannot know in advance which of those a given page view is, and it must not break the host page
either way — the widget runs on someone else's site, and that constraint doesn't relax for a
privacy-conscious visitor.

## Decision

**A/B visitor identity is the `rcf_vid` first-party cookie, and it exists for A/B alone.**

1. **Identity mechanism.** `initVisitorId()` (`recopyfast.src.js:2956-2976`) is the single
   source of visitor identity for A/B. It is written on the host page's own origin, not
   `RECOPYFAST_API`'s: the script tag's `src` and the derived `RECOPYFAST_API` are the
   *widget's* origin (`:7`, `:14-28`), while `document.cookie` at `:2975` writes against the
   *page's* origin. That distinction is load-bearing: a cookie set via a `Set-Cookie` response
   header from `RECOPYFAST_API` would be a third-party cookie in the visitor's browser — already
   blocked or partitioned by Safari ITP and Chrome's phase-out on a large and growing share of
   traffic. `rcf_vid` avoids that failure mode entirely because it is written by the page's own
   JavaScript, on the page's own origin. Do not replace it with a server-minted identity.

2. **Do-Not-Track.** When `navigator.doNotTrack === "1"` (or the `window.doNotTrack` /
   `navigator.msDoNotTrack` equivalents some browsers still expose), the widget:
   - never calls `initVisitorId()` — no cookie is read or written, and no persistent id is
     minted;
   - still requests the active-test/variant content it needs to render something, and still
     assigns that page view a variant, using the client-side FNV-1a path already present for
     bucket-endpoint failures (`fnv1aHash`, `:3035-3042`, the cumulative-walk fallback at
     `:3014-3032`) seeded from a fresh, in-memory-only random value generated once per page view
     and never written anywhere;
   - never sends a `view`, `click`, or `conversion` event for that page view — `sendTrackEvent`
     is not called, full stop.
   The visitor experiences the test exactly as any other visitor does — masked element,
   swap-or-timeout, no flash. DNT changes nothing about what they see; it changes only whether
   anything durable is written about them. This is ephemeral, unrecorded bucketing: assigned,
   shown, forgotten.

3. **Cookie refused.** A silent refusal — the write at `:2975` executing but `document.cookie`
   not reflecting `rcf_vid=` on read-back, which happens under Safari private browsing, some
   cookie-blocking extensions, and consent-management platforms that intercept `document.cookie`
   before consent — is treated identically to DNT for that page view: verify the write by
   re-reading `document.cookie` immediately after `initVisitorId()`; if `rcf_vid=` is absent,
   fall through to the same ephemeral, unrecorded path in (2), with no retry. There is no code
   path in which a failed cookie write instead falls back to sending an un-cookied `visitor_id`
   to the server — that would produce exactly the outcome `s11a` was built to eliminate: an
   identity that changes every page view, recorded as if it were stable, silently inflating
   unique-visitor counts and corrupting the ±2pp and significance math both `s11a` and `s12`
   depend on. Refusing to record is not a privacy nicety here; it is also what keeps the numbers
   honest.

4. **Never shared with impressions.** `rcf_vid` and everything derived from it — the value, its
   presence, its absence — stay inside the A/B code path
   (`recopyfast.src.js:2952-3202`, the block this ADR's citations live in). `s09`'s impression
   pipeline must not read it, must not accept it as a parameter, and must not use its
   presence/absence as a signal. The two features are independently instrumented; sharing the
   identifier — even just checking "does this visitor have `rcf_vid` set" from the impression
   code — would make `s09`'s anonymity claim false the moment a customer runs both features on
   one page, which is the normal case, not an edge case.

This supersedes the specific pending draft in the plan
(`docs/plans/s11c-ab-variant-delivery.md:150-155`), which proposed applying no variant at all
under DNT — *"masks nothing, applies no variant and sends no event — the visitor sees the page
as published, and is simply not in the experiment."* This ADR decides otherwise: the visitor is
still bucketed and shown a variant; only the recording is withheld. Reverting unconditionally to
original content under DNT would also have been defensible on privacy grounds alone, but it
would make the test's *measured* population a biased sample of all visitors — systematically
excluding the privacy-conscious segment from the treatment as well as from the measurement —
rather than an unmeasured subset of an otherwise-uniform, uniformly-treated population. Bucketing
everyone and recording only some keeps the *shown* experience uniform across every visitor and
confines the privacy decision to the *measurement* layer, where it belongs and where `s11a`'s
honesty guarantees already live.

## Considered options

- **No identity — random variant per request.** Rejected outright. `s11`'s own acceptance
  criterion requires a returning visitor to see the same variant for the test's duration
  (`docs/stories.md:676`), and the ±2pp-over-10,000-assignments criterion (`:677`) is
  meaningless without a stable input to hash — a fresh random draw on every request produces an
  even split by definition and proves nothing about the bucketing function under test. `s11a`'s
  entire story is spent making assignment provably stable; discarding stability at the identity
  layer would make that work pointless.
- **Fingerprinting.** Rejected outright, not weighed against the others. Fingerprinting exists
  specifically to reconstruct an identity when the visitor has declined one — DNT and a refused
  cookie are both explicit declines. Using it here would mean the DNT/cookie-refusal branch of
  this decision does the opposite of what it claims to do, which is worse than not having the
  branch at all: a customer's client who reads the code, or anyone who profiles the network
  traffic, finds a widget that says it respects Do Not Track and doesn't. It also buys nothing
  for the visitors who do accept the cookie — there is no case where fingerprinting outperforms
  `rcf_vid`.
- **Server-side session identity** (a `Set-Cookie` from `RECOPYFAST_API` at first request, or an
  opaque token minted server-side and cached by the widget). Assessed, not dismissed out of
  hand — it would move identity minting off the page's own JavaScript, which might seem to
  simplify the DNT branch. It doesn't: as established in Decision §1, such a cookie is
  third-party from the visitor's browser's point of view — the exact category of cookie modern
  browsers are actively deprecating — so it would be *less* reliable than `rcf_vid` for the
  majority case while adding nothing for the DNT case, since DNT still has to be checked before
  the request that would mint it. It also adds a round trip before any assignment can happen,
  directly competing with `s11c`'s "at most one round trip between `DOMContentLoaded` and the
  swap" budget (`docs/plans/s11c-ab-variant-delivery.md:36`). Rejected: strictly worse on
  reliability and on the swap-window budget, for no privacy benefit over the first-party cookie.
- **Reuse or share an identifier with `s09`'s impression pipeline.** Rejected. `s09`'s AC 9 is
  "no per-visitor identifier is stored" (`docs/stories.md:595`), stated as the mechanism that
  keeps impressions out of GDPR consent scope (`:622-624`). Any identifier that touches both
  pipelines — even one used only for a join, never displayed — makes that claim false for every
  customer running both features, which the PRD expects to be most of them. `s12`'s own
  dependency was rewired at research specifically to avoid needing this join (M2,
  `docs/stories.md:149-161`); reintroducing it here to save `s11` from maintaining its own event
  stream would undo that resolution for no reason `s11c` needs.

## Consequences

**Easier.** No server-side DNT branch exists or is needed: DNT and cookie-refusal are entirely
client-side decisions about what the widget sends, so `s11a`'s data plane, `s11c`'s folded
`GET /api/content/:siteId?ab=1` route, and `authorizeSiteRequest` / `authorizeIngestRequest`
(ADR 002) need no changes and no fourth auth path to honor this ADR — a DNT visitor's page view
is indistinguishable to the server from a visitor on a site with no active test at all. The
ephemeral fallback also reuses code that already exists (`fnv1aHash` and the cumulative-walk
client fallback) rather than adding a new mechanism, which is the right side of `s11c`'s
≤ 2,000 gz A/B allowance and the byte-negative goal that story is held to
(`docs/plans/s11c-ab-variant-delivery.md:45-49`).

**Harder.** "Returning visitor sees the same variant" is now conditionally true, not universally
true — it holds for consenting, cookie-accepting visitors, and by design does not hold for DNT
or cookie-refused ones. That has to be documented for support and for the customer, not
discovered by them: a DNT visitor who refreshes and sees a different headline is not a bug
report waiting to happen, and the first support ticket that reads like one needs an answer
already written down, which this ADR is. Dashboards and results (`s12`) must be read as
"results over measurable traffic," not "results over all traffic" — a distinction that matters
most for exactly the privacy-conscious segment this ADR protects, which skews which customers'
numbers are most affected by it.

**Watch.** The widget runs on someone else's site, and identity resolution sits directly on the
path this ADR's own DNT/cookie check gates — a slow or failed bucket call must still fall back
to default content immediately and never block the host page's render; this ADR adds a branch to
that path, not a new way for it to hang (`navigator.doNotTrack` is synchronous, so the check
itself is never the source of latency). And the "never record an unstable identity" rule in
Decision §3 is a correctness rule with a test obligation, not a courtesy: `s11c`'s
`ab-dnt.test.ts` must assert all three of no cookie written, no `visitor_id` transmitted in any
request, and no track event sent — for both the explicit-DNT case and the silently-refused-cookie
case — or this ADR is unverified.
