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

Max severity: major
Ship allowed: yes
