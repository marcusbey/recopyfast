---
validated: yes
---
# Plan — Story s11c-ab-variant-delivery

Branch: `feature/s11c-ab-variant-delivery`
Research: `docs/research/s11-ab-run-test.md` — read it first; this plan does not repeat it.
In particular read `## M3 — the anti-flicker criterion` in full before the first task.

## Target story

`s11c — variant delivery and the swap window` (complexity 4), the third of the three stories
`s11-ab-run-test` was split into (`docs/stories.md:136`).

> *As a site owner I want a test on my page to be invisible to my visitors so that running one
> never costs me the impression the page makes.*

**No UI.** One API route and one widget source file.

**M3 is settled: the "applied before first paint" criterion is WITHDRAWN**
(`docs/stories.md:679`, `:163-170`). Three facts each defeat it on their own: the snippet is a
plain non-`async`, non-`defer` `<script>` that the product instructs every customer to paste
before `</body>` (`src/lib/sites/embed-script.ts:98`,
`src/components/sections/HowItWorks.tsx:32`); `init()`'s first statement is
`await this.waitForDOM()`, which resolves on `DOMContentLoaded`
(`public/embed/recopyfast.src.js:868`, `:2321-2329`); and three sequential fetches separate that
from `applyVariants()` (`:896`, `:901`, `:902`, `:903`). "Before first paint" is a
synchronous-script property, and RecopyFast's entire install pitch — one tag, before `</body>`,
no build step — depends on it not being one. This story replaces it with a **measured swap
window**.

### The swap-window budget, as numbers

| Budget | Value | How it is asserted |
|---|---|---|
| Network round trips between `DOMContentLoaded` and the variant swap | **≤ 1** | request counter in the JSDOM widget harness |
| Additional requests versus the same install with no active test | **0** | same counter — a no-test site issues **zero** extra requests |
| Elapsed time from the widget's first synchronous statement to the swap | **≤ 200 ms**, hard | measured and reported by the test; also the mask timeout |
| Mask scope | the tested element **only** — never `<html>`, never `<body>` | asserted on the document element |
| Variant applied after the 200 ms timeout | **never** | original revealed, test abandoned for that page view |
| Net gzipped change to the widget vs. the post-`s06a` baseline | **≤ 0** | `s06a`'s build gate |
| A/B block, standalone gzipped | **≤ 2,000** | measured in the same gate run |
| Widget total | **≤ 30,000** eventually; **must not exceed the `s06a` baseline now** | `s06a`'s `MAX_WIDGET_GZ` |

The last row is stated honestly rather than aspirationally. The widget alone measures **34,063
gz** today and the artifact 46,781 (`docs/stories.md:130-133`); `s06a` seeds `MAX_WIDGET_GZ` at
34,063 and `s06c` owns the shrink to 30,000. `s11c` cannot reach 30,000 and must not pretend to.
What it owes is a **byte-negative** diff: deleting `fetchActiveTests` and `bucketVisitor` from
the widget should make this story reclaim bytes, not spend them.

**Dependencies.** `s06a-embed-byte-gate` (there is no answer to "does this fit?" until the
ceiling is enforced by the build), `s11a-ab-data-plane` (assignment must be proven honest before
it is moved onto the hot path), `s11b-ab-surface` (a test has to be startable to be delivered).

## Tasks (ordered)

- [ ] **1 — Record the byte baseline before touching anything.**
  Run `gzip -9c public/embed/recopyfast.js | wc -c` and the same for the A/B block sliced
  between its `// A/B TESTING METHODS` / `// END A/B TESTING METHODS` markers. Write both
  numbers into this file under this task, alongside `s06a`'s `MAX_WIDGET_GZ`. Every later claim
  in this story is a delta against these two numbers. Confirm `s06a`'s gate is wired and fails
  on a deliberate over-budget edit before trusting it.
  *Fails when:* the gate does not exist, or does not fail on an over-budget artifact.

- [ ] **2 — Fold the active-test set and the assignment into `GET /api/content/:siteId`, opt-in.**
  This is the lever the whole story turns on. **The response is a bare array today**
  (`src/app/api/content/[siteId]/route.ts:305-311`) and the widget reads it as one
  (`recopyfast.src.js:3304-3311`, `Array.isArray(rows)`). Changing the top-level shape
  unconditionally would break every already-loaded, browser-cached copy of the widget. So the
  fold is **opt-in by query parameter**: `?ab=1&visitor_id=…`.
  - Without `ab=1`: the response body is unchanged, byte for byte. A test asserts this.
  - With `ab=1`: `{ content: [...], ab: { tests: [...], assignments: {...}, geo: {...} } }`,
    where `tests` is exactly the `active/[siteId]` payload shape (`:84-107`) and `assignments`
    exactly the `bucket/[siteId]` payload shape (`:210-213`), so no third format enters the
    system.
  The route already authorises the widget's token/origin path
  (`authorizeSiteRequest`, `:255-278`) and already sheds unauthenticated load
  (`shedUnauthenticatedLoad(request, "content/read")`, `:234`) — reuse both; do not add a fourth
  auth path. Reuse `bucketVisitorToVariant` from `s11a` rather than copying it.
  **`/ab-tests/active` and `/ab-tests/bucket` stay live and unchanged** — cached widgets still
  call them, and `/embed/recopyfast.js` is a permanent public URL.
  *Fails when:* a request without `ab=1` returns anything but the array it returns today.

- [ ] **3 — The folded response must never be shared-cached.**
  `active/[siteId]` sets `Cache-Control: public, max-age=60, stale-while-revalidate=300`
  (`:20-23`). That is safe for a site-wide test list and lethal the moment the same body carries
  one visitor's assignment: a CDN or a corporate proxy hands visitor A's variant to visitor B,
  both are recorded under different `visitor_id`s, and every number `s11a` made honest is wrong
  again — silently, and worse than before, because now the split *looks* right. When `ab=1` is
  present the response sets `Cache-Control: private, no-store`. Without it, the content route's
  existing headers are unchanged.
  *Fails when:* an `ab=1` response carries any cache directive permitting a shared cache.

- [ ] **4 — Take `fetchActiveTests` and `bucketVisitor` off the widget's critical path.**
  `hydrateStoredContent` (`recopyfast.src.js:3276-3336`) sends `?ab=1&visitor_id=…` and reads the
  envelope, populating `this.activeTests` and `this.variantAssignments` from it. `init()`
  (`:896-906`) loses the `await this.fetchActiveTests()` and `await this.bucketVisitor()` calls;
  `applyVariants`, `setupClickTracking` and `trackImpressions` follow the single fetch. Keep
  `fetchActiveTests`/`bucketVisitor` **only** as the refresh path used by `handleABTestUpdate`
  (`:3182-3195`), which runs long after paint and is not on the critical path — or delete them
  and have `handleABTestUpdate` re-hydrate. Either is fine; deleting is byte-cheaper and is the
  preference. `initVisitorId()` must run **before** the content fetch, since its id is now a
  query parameter. Edit `recopyfast.src.js` only.
  *Fails when:* the request counter sees more than one round trip between `DOMContentLoaded` and
  the swap, or sees any A/B request at all on a site with no active test.

- [ ] **5 — Element-scoped mask with a 200 ms hard timeout.**
  From the widget's first synchronous statement, set `visibility: hidden` on the elements a
  running test targets — **that element only**. Not `opacity: 0` (it does not hide a background
  image — a documented gotcha with Optimize-style snippets), and never the page or the document
  element (DebugBear measured whole-page hiding costing 3.3 s of LCP on a live Mutiny install).
  Released at the swap or at **200 ms**, whichever comes first. The aggressive timeout is
  affordable precisely *because* the mask is element-scoped: the failure mode is "one headline
  appears as authored", not "a blank site". Note honestly in a comment that at first paint the
  widget does not yet know which elements are targeted — so on the first page view the mask is
  applied at `scanForContent()` time against the assignment from the *previous* page view's
  cookie-stable state, and on a cold visitor there is nothing to mask and nothing to hide. Do not
  invent a synchronous pre-DOM path; there isn't one, and M3 explains why.
  *Fails when:* `document.documentElement` or `document.body` acquires a `visibility` style at
  any point, or the mask outlives 200 ms.

- [ ] **6 — A variant is never applied late, and an unshown variant is never counted.**
  After the timeout the original is revealed and the test is abandoned **for that page view**.
  A customer's client does not report "the swap took 340 ms"; they report "the headline changed
  while I was reading it". And `trackImpressions` must not record a `view` for a variant it did
  not show — an unshown variant counted as an impression poisons `s12`'s conversion rate at the
  denominator, where it is invisible.
  *Fails when:* a response arriving at 250 ms still swaps the text, or emits a `view` event.

- [ ] **7 — The mask can never strand the page.**
  Released on **every** exit path, one test each: success; timeout; a rejected fetch; a thrown
  error anywhere in `applyVariants`; and the target element having vanished from the DOM between
  scan and swap. Plus: a site with no active test masks nothing at all.
  *Fails when:* any one of those six leaves a `visibility: hidden` element behind.

- [ ] **8 — Stop `applyVariants` flattening the customer's markup.**
  `elementData.element.textContent = variant.variant_content` (`recopyfast.src.js:3068`) turns
  `<h1>Ship <span class="accent">faster</span></h1>` into flat text and the styling silently
  disappears — on the customer's page, with no error. `hydrateStoredContent` already goes through
  `applyContentToElement` (`:3331`) for exactly this reason; the A/B path does not. Route the
  swap through the same function, and leave the tombstone comment saying why.
  *Fails when:* applying a variant to an element with child markup destroys the children.

- [ ] **9 — State the `rcf_vid` / Do Not Track posture, and honour it. Needs an ADR.**
  `s11` writes a one-year first-party cookie (`:2975`) while `s09`'s trap paragraph sells the
  opposite — *"No cookie, no fingerprint, no visitor id… keeps the feature out of GDPR consent
  scope"* (`docs/stories.md`, `s09` agentic notes). Both can be live on one customer's page, and
  the review carries this open as `m4`. **This is a PRD-level trade and requires an operator
  decision recorded as `docs/decisions/016-ab-visitor-identity-and-dnt.md`, written on this
  branch, before this task executes.** The behaviour this plan implements pending that decision,
  and which the ADR should either ratify or replace: when `navigator.doNotTrack === "1"` (or
  `window.doNotTrack`/`navigator.msDoNotTrack` equivalents), the widget writes **no** `rcf_vid`
  cookie, requests **no** assignment, masks nothing, applies no variant and sends no event — the
  visitor sees the page as published, and is simply not in the experiment. This mirrors `s09`'s
  own DNT criterion rather than inventing a second privacy posture.
  *Fails when:* DNT is set and a cookie is written, a request carries `visitor_id`, or any event
  is sent.

- [ ] **10 — Rebuild, measure, report.**
  `npm run build:embed`; `node scripts/build-embed.mjs --check` green; `s06a`'s gate green. Write
  the after-numbers into this file next to Task 1's baseline: artifact gz, A/B block gz, and the
  net delta. The delta must be **≤ 0**. Also record the measured swap window the harness reports.
  *Fails when:* the artifact is stale, the gate fails, or the diff is byte-positive.

## Run interdicts

- **`public/embed/recopyfast.src.js` is the source. `recopyfast.js` is generated.** Never
  hand-edit the artifact — the next build overwrites it silently. `--check` fails on a stale one.
- **`/embed/recopyfast.js` is a permanent public URL**, baked into every snippet ever issued. It
  can never move or break for existing installs. That is why Task 2's fold is opt-in and why
  `/ab-tests/active` and `/ab-tests/bucket` stay alive: browsers hold cached copies of the old
  widget, and those copies must keep working.
- **Trap — it runs on someone else's site.** A slow or failed bucket must fall back to default
  content **immediately** and must never block the host page's render. The mask is bounded at
  200 ms; there is no path on which the host page waits for us.
- **The widget degrades, never breaks.** No uncaught exception may reach the host page's
  `window`. There is no error surface on their domain — a broken branch presents as "editing
  stopped working on one site", months later.
- **No snippet change.** This story is met entirely inside `recopyfast.src.js` and one API route.
  Touching `buildEmbedScript` would create an `s02` dependency nobody owns and would break the
  install story the PRD sells.
- **Do not regress `3099c07`.** The folded path must keep the site token *and* the Origin pin
  (`src/lib/security/site-auth.ts:118`, `:163`). The token is public by construction — it ships
  as a plain attribute in the customer's markup — so the Origin pin is the whole defence. Reuse
  `authorizeSiteRequest`; do not write a fourth auth path (ADR 002).
- **Never `Cache-Control: public` on a response carrying a visitor's assignment.**
- **No zod** (ADR 003). New query-parameter validation goes through
  `src/lib/api/validation.ts`, extended if needed.
- **No UI.** Nothing under `src/app/dashboard/` or `src/components/`.
- **`framer-motion`, `three`/R3F and `lenis` may not reach the widget.** Neither may any new
  dependency: every byte is charged against the gate.
- **Do not lower `jest.config.js` coverage thresholds.** Ratchet only.

## The point everything turns on

**One fetch, or none.**

Folding the active-test set and the assignment into the response the widget *already awaits* is
not one optimisation among several — it is the single change that makes four separate
obligations true at once, and nothing else makes any of them true:

- it collapses three sequential round trips to one, which is the only reason a 200 ms swap
  window is a budget rather than a wish;
- it makes *"a visitor to a site with no active test receives default content and the widget
  makes no additional network request"* literally true, instead of a guard that still costs a
  request. Today `recopyfast.src.js:901` calls `/ab-tests/active` on **every page load of every
  site**, tests or not — one guaranteed wasted request per visitor, product-wide;
- it **deletes** `fetchActiveTests` and `bucketVisitor` from the widget, so the byte allowance
  is reclaimed rather than spent, and this story helps the ceiling instead of competing with it;
- and it removes the fall-through defect entirely: with no separate bucket call there is no
  non-OK bucket response to fall through from.

The trap sitting directly on top of it is the one to hold in view for the whole task: **the
response the widget already awaits is a bare array, and the widget is on other people's pages
in versions we do not control.** Changing that shape unconditionally is a silent, delayed,
site-wide breakage of exactly the kind `AGENTS.md` non-negotiable 2 exists to prevent. Hence the
query parameter. And the moment that one response carries a per-visitor assignment, its
cacheability stops being a performance question and becomes a correctness question — a shared
cache serving one visitor's variant to another is the same silent-bucketing failure `s11a` spent
a whole story eliminating, re-entering through the CDN.

The flash itself, worth saying plainly one more time: it is **not new to A/B**.
`hydrateStoredContent` already replaces the host page's authored copy after paint, on every
install, today. Every customer already sees this swap for ordinary edits. The right trade is not
to hold A/B to a standard the core product does not meet — it is to make the window small,
bounded, measured, and to make a *late* swap impossible.

## Files touched

**Modified**
- `src/app/api/content/[siteId]/route.ts` — opt-in `ab=1` envelope; `private, no-store` on it;
  reuse of the existing auth and load-shed paths (2, 3)
- `public/embed/recopyfast.src.js` — envelope read in `hydrateStoredContent`; `init()` loses two
  awaits; `initVisitorId` moves ahead of the content fetch; element-scoped mask and timeout;
  never-late guard; impression suppression; `applyContentToElement` on the A/B path; DNT
  short-circuit (4, 5, 6, 7, 8, 9). **Source only.**
- `public/embed/recopyfast.js` — regenerated by `npm run build:embed`, never hand-edited
- `jest.config.js` — coverage ratchet up

**Created**
- `docs/decisions/016-ab-visitor-identity-and-dnt.md` — the `rcf_vid` / DNT posture (9).
  Operator decision; written on this branch, per `AGENTS.md` ("story decisions travel with
  `feature/<id>`")
- `src/__tests__/embed/ab-swap-window.test.ts` — round-trip count, elapsed-time budget, mask
  scope, never-late, six release paths, no-test-site zero-request case (4, 5, 6, 7)
- `src/__tests__/embed/ab-apply-preserves-markup.test.ts` (8)
- `src/__tests__/embed/ab-dnt.test.ts` (9)
- `src/__tests__/api/content/ab-envelope.test.ts` — unchanged-without-`ab=1`, envelope shape,
  cache headers, token and Origin refusals (2, 3)

**Read, not modified**
- `src/lib/security/site-auth.ts`, `src/lib/sites/embed-script.ts`,
  `src/app/api/ab-tests/active/[siteId]/route.ts`, `src/app/api/ab-tests/bucket/[siteId]/route.ts`
  (both stay live for cached widgets), `scripts/build-embed.mjs`,
  `src/__tests__/embed/element-id-page-scope.test.ts`

## Test strategy

**The widget tests run the shipped widget.** Every widget assertion here uses the harness at
`src/__tests__/embed/element-id-page-scope.test.ts:33-40`: the relevant block is sliced out of
the real `public/embed/recopyfast.src.js` and evaluated in JSDOM with `document`, a stubbed
`fetch` and a fake timer injected. Its own header states the reason and it applies verbatim
here — *"a transcription… into this file would pass forever while the widget rotted; this
cannot."*

**Instrumentation the swap-window tests need:**
- a `fetch` stub that **counts** calls and records their URLs, so "≤ 1 round trip" and "0
  additional requests" are assertions and not impressions;
- fake timers, so the 200 ms boundary is tested at 199 ms and at 201 ms rather than raced;
- a `MutationObserver` (or a patched style setter) watching `document.documentElement` and
  `document.body`, asserting neither ever acquires a `visibility` style — the page-scoped mask
  must be impossible, not merely absent;
- a `window.onerror` / `unhandledrejection` spy that must stay clean across every failure path,
  because "degrades, never breaks" is otherwise untestable;
- elapsed-ms from harness start to swap, **recorded and printed** by the test, so the number in
  the budget table above is measured on each run rather than asserted once and forgotten.

**Route tests** mock Supabase at the module boundary, as `src/__tests__/api/` already does:
- no `ab=1` → the response body is deep-equal to today's array (this is the
  cached-widget-compatibility guard, and it is the most important test in the file)
- `ab=1` → the envelope, with `tests` matching `active`'s shape and `assignments` matching
  `bucket`'s
- `ab=1` → `Cache-Control: private, no-store`; no `ab=1` → today's headers unchanged
- missing token → refused; foreign `Origin` → refused (guards `3099c07` on the new path)
- a site with no active test → `ab.tests` empty, and no assignment work performed

**Byte tests** are `s06a`'s gate, run in CI, with the before/after numbers recorded in this file.

**Not tested here:** distribution and hash parity (`s11a`), the dashboard (`s11b`), significance
and promotion (`s12`).

## Definition of Done

- [ ] Baseline and after byte numbers recorded in this file; net delta **≤ 0**; A/B block
      ≤ 2,000 gz; `s06a`'s gate green and `MAX_WIDGET_GZ` not raised.
- [ ] `GET /api/content/:siteId` without `ab=1` returns exactly what it returns today, asserted
      by a test. With `ab=1` it returns the envelope, and only then.
- [ ] The `ab=1` response is `private, no-store`.
- [ ] The widget makes **at most one** network round trip between `DOMContentLoaded` and the
      swap, asserted by a request counter. A site with no active test issues **zero** additional
      requests.
- [ ] The measured elapsed time from the widget's first synchronous statement to the swap is
      ≤ **200 ms**, recorded and reported by the test.
- [ ] Only the tested element is ever masked; `document.documentElement` and `document.body`
      never acquire a `visibility` style. `visibility: hidden`, not `opacity: 0`.
- [ ] A variant is **never** applied after the 200 ms timeout, and no `view` event is recorded
      for a variant that was not shown.
- [ ] The mask is released on all six exit paths: success, timeout, rejected fetch, thrown
      error, vanished element, no-test site.
- [ ] No uncaught exception reaches the host page's `window` on any failure path.
- [ ] A variant applied to an element with child markup preserves the children.
- [ ] `docs/decisions/016-ab-visitor-identity-and-dnt.md` exists, records the operator's
      decision with the rejected options, and the widget's DNT behaviour matches it.
- [ ] `/ab-tests/active` and `/ab-tests/bucket` still work for a cached widget; the embed snippet
      is unchanged.
- [ ] `npm run build:embed` run; `node scripts/build-embed.mjs --check` passes.
- [ ] `lint`, `type-check`, `format:check`, `build`, `test` all green; coverage ratcheted up.
- [ ] `git diff main...feature/s11c-ab-variant-delivery` touches no file under
      `src/app/dashboard/` or `src/components/`, and does not modify `buildEmbedScript`.
