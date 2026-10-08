# Review — s67-embed-spa-support

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff origin/main...feature/s67-embed-spa-support`
(merge-base `659778e`; implementation commit `05d2025`).

## Verdict summary

Tasks 1–9 present; Task 10 (production proof) correctly waits for deploy. Full jest 323 suites / 4,235 tests
(one load-related websocket join timeout on the first run, clean alone and on rerun), tsc, eslint/prettier on
changed files green. `build-embed --check` up to date at 45,866 / 33,092; a fresh build is byte-identical to the
committed artifact; ceilings went down from 45,880 / 33,120. `e2e/embed-spa.spec.ts` E1–E5 pass against a static
server and all five go red against `origin/main`'s artifact (authored copy; four React errors); no production
API reached. Every run interdict holds (no `history.*` assignment, no framework/site detection, only the embed's
own window names). 22 mutations: all but one turn tests red (finding 3).

## Findings

### Major

1. `public/embed/recopyfast.src.js:3685,3916-3921` — a route change whose re-render only updates text in place
   (React writes `firstChild.nodeValue` for a single text child; React Router / Vue Router reuse the component
   when only a param changes, e.g. `/blog/:slug`) is never rescanned: `checkRoute` unstamps page-scoped entries
   and sets `stale`, but a rescan only happens on a batch that adds nodes or on an edit click. Reproduced
   (jsdom probe, `/blog/a` → `/blog/b`): the GET for `/blog/b` goes out, the h1 loses its `data-rcf-id` and
   `elements.size` ends at 0; the published row is never applied. AC 3 unmet for this class of routes; ADR 049
   understates it. Fix: any records while `stale` (or `checkRoute` itself) schedule the existing debounce;
   jest case with a characterData-only route render.
2. `src/lib/sites/install-recipes.ts:51` (header `:20`) — the dashboard Installation card's Next.js tab still
   says the widget has no complete lifecycle for client-side route changes; s67 makes it false and it now
   contradicts `/docs/install`. Fix here and update `install-recipes.test.ts:50`.

### Minor

3. `recopyfast.src.js:44` — the M8 `typeof value === 'string'` guard has no biting test (every clobber test uses
   a cross-origin href); add a same-origin clobber case.
4. `recopyfast.src.js:6185` — Edit Board preview uses `textContent || originalContent`; image/input cards show
   the first-seen authored src/value instead of the published one. Use `getElementText`.
5. `recopyfast.src.js:4843` (`:5216`, `:5409`) — editor saves overwrite `originalContent` and never set
   `written`; a persistent page-scoped element edited then navigated keeps the saved copy and the next page's
   discovery reports it as authored (s65a invariant), edit mode only.
6. `recopyfast.src.js:3692,3728` — `checkRoute` starts `loadRows()` without awaiting/catching; a throw would be an
   `unhandledrejection` on the host page (hardening).
7. `scripts/build-embed.mjs:210` vs `build-size-gate.test.ts:88` quote different gross numbers.
8. Doc drift: `docs/architecture.md:90` ("fallback copy"), `server/README.md:294,461` (`RECOPYFAST_WS` "never
   set" — now `null`), `site-token-refusal.test.ts` assertion now vacuous.

## Not verified

Production proof (AC 1, 6, 10 — Task 10 after deploy); E1–E5 on `next start` and the other 45 Playwright specs
(CI); browsers without the Navigation API; real React Router / Vue Router / Next.js apps; large-DOM cost.

## Orchestrator note

Owner standing rule: fix majors (and cheap minors) before shipping. Findings 1–8 go to a fix run; the widget has
0 bytes of headroom, so every added byte must be funded in the same branch or the run stops and reports.

## Re-review after fix `d9feb63` (fresh reviewer, 2026-10-08)

Findings 1–8 closed (7 partly: see minor 1). Full jest 323 suites / 4,242 tests, type-check green; a fresh
build is byte-identical to the committed artifact at 45,860 / 33,089 (ceilings only went down); the funding
rewrites are behaviour-preserving. e2e E1–E5 green; E2 goes red at the new in-place step when only the stale
branch is reverted. Mutations bite except the form-save line (minor 1).

New findings:

- A (major) — `recopyfast.src.js:3930` with `dropEntry` `:3703-3706`: on a route change `checkRoute` restores
  authored copy on elements the embed had written; those writes are a text-only batch, and while `stale` that
  batch alone now schedules the rescan 200 ms later. With the Navigation API, an applied edit on the page
  being left, and a router that renders > 200 ms after `pushState` with no DOM change in between: the old
  page shows the new page's published copy before the new page renders, the new page's first frame is
  authored for up to 200 ms, and discovery reports the old page's text as the new page's authored copy —
  stored permanently (`ignoreDuplicates`, `content/[siteId]/route.ts:641`). ADR 049:138-141 understates it.
  Fix: the embed's own restore records must not count as a stale batch (e.g. `observer.takeRecords()` after
  the restore loop, aware it also drops pending host records), funded within the ceilings; jest case; ADR.
- minor 1 — `:5426`: the form save sets `written` to the placeholder but `dropEntry` compares `.value`, so it
  never matches; the comment at `:4850-4857` overclaims.
- minor 2 — leftovers: `e2e/realtime-parity.spec.ts:166` ("never set"), `scripts/build-embed.mjs:674`
  ("fallback"), a non-failing "Authored headline" assertion in `site-token-refusal.test.ts`.

Orchestrator: A + minors 1–2 go to a fix run (owner's standing rule).

## Verification of fix `2df68b1` (fresh reviewer, 2026-10-08)

Major A closed (no rescan before a late render; /b's first frame published; no /a text under /b). Minors 1–2
closed. The seven funding rewrites are behaviour-preserving; bytes 45,852 / 33,081 (fresh build byte-identical,
ceilings only down). Full jest 323 suites / 4,245 tests, type-check, e2e E1–E5 green.

New finding:

- B (major) — `recopyfast.src.js:3977-3980` with `:3924`, ADR 049 `:91`: the Navigation API handler now hands
  the host's pending records to the callback synchronously inside `pushState`; if they include any added node
  (spinner, announcer, analytics tag) added before `pushState` in the same task, `added && stale` rescans the
  OLD page under the new path; the real /b is unmapped in its first frame, and if /b's rows arrive in < 200 ms,
  discovery files /a's text under /b (permanent). Reproduced in jsdom and in real Chromium with the native
  Navigation API; `d9feb63` was correct here. Suggested direction: keep the discard but return the host's
  records on the microtask they would have arrived on (`const r = takeRecords(); checkRoute(); takeRecords();
  r.length && queueMicrotask(() => onRecords(r))`); jest case for add → push → render in one task; fund the
  bytes. Probes: `scratchpad/probe3/` (`sametask.js`, `chromium-sametask.js`).

Orchestrator: B goes to a fix run (owner's standing rule).

## Verification of fix `be5b841` (fresh reviewer, 2026-10-08)

Finding B closed: all five scenarios hold in jest and in real Chromium with the native Navigation API
(`probe3/chromium-sametask.js`, `probe4/chromium-all.js`, 12 rows). A 10-scenario regression hunt (double
navigation in one task, replaceState + write-back, hash + write-back, pushState/render in microtasks, destroy in
the same task, Back with popstate render, A/B variant on a persistent element, push-and-back in one task), each
with and without the Navigation API, found no regression — every difference from `2df68b1` is an improvement.
The `writeText` funding rewrite is equivalent (20,000-tree fuzz: 0 differences; a deliberately broken variant: 5,063).
Bytes 45,843 / 33,073, fresh build byte-identical, ceilings only down. Mutations bite. Full jest 323 suites /
4,252 tests, type-check, e2e E1–E5 green (E1 red on `2df68b1`'s artifact at the new step).

Minors:

1. ADR 049:176-177 says a render in the same task wins; that holds only for a SYNCHRONOUS render. React 19
   `createRoot` defers its render to a microtask, so spinner → pushState → microtask render still files the old
   text under the new path (same on `2df68b1` and without the Navigation API — the class ADR 049 already accepts
   under "To watch"; not a regression). The source comment at `recopyfast.src.js:3962-3964` also says the
   callback's own writes are "discarded" where they are passed to the callback when the observer's own delivery
   runs first (harmless).
2. `recopyfast.src.js:751`: changing `node.parentNode === element` to `true` turns no behavioural test red;
   add `<h1><span>x</span>Title</h1>` receiving the copy in its direct text node.

## PR #69 bot review (Devin, 2026-10-08)

- D1 (red) — `recopyfast.src.js:755` (`writeText`) with `applyRow` `:3777-3791` and the observer `:3913-3928`:
  when a parent and a mapped descendant both have edited rows, writing the parent blanks the child's text, the
  child's reapplication changes the parent's aggregate text, and they alternate until the 10-write caps — one
  edit ends missing or mixed. New with s67's reapply-on-overwrite.
- D2 (red) — `:3720` (`dropEntry`) with `applyVariants` `:3422-3452`: a persistent element keeps
  `data-rcf-variant` after a route change, and `applyRow` skips every variant-marked element, so the new
  route's published copy never applies.
- D3 (red) — `:3885`: the row index is a plain object; a content response row with `element_id: "__proto__"`
  changes its prototype and later lookups read inherited values.

Orchestrator: D1–D3 go to a fix run (owner rule: fix bot findings before merge).

Max severity: major
Ship allowed: yes
