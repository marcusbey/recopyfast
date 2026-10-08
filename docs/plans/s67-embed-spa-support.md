---
validated: no
---
# Plan — Story s67-embed-spa-support

Branch: `feature/s67-embed-spa-support`
Research: `docs/research/s67-embed-spa-support.md` (commit `3c807f0`). Read it first: this plan
does not repeat it. Every `:NNN` refers to `public/embed/recopyfast.src.js` at `3283850`.
ADR: `docs/decisions/049-embed-observes-the-host-never-patches-it.md`.

## Target story

`docs/stories.md` → s67, AC 1–13. The goal: the plain snippet works on sites that render in the
browser, on first load and after in-app navigation, with one generic mechanism and no site code.

Five owner decisions (2026-10-08) are recorded in the story:
1. Only edited rows write text.
2. Published copy wins over host re-renders, capped at 10 per element per page view.
3. Hash routes are out of scope.
4. s67 merges before PR #59.
5. AC 9 now reads "patches no host global".

This plan also adds scope:
- **AC 11**: edited rows only.
- **AC 12**: the security review's M8, config DOM clobbering.
- **AC 13**: host-safe writes. This is the React crash research measured.

Complexity 4. There are 10 tasks, the last one after deploy. That is at the limit the pipeline
allows, not over it, so no split is proposed. The cut line, if review wants one, is at the end
of Task 4:
- **s67a** = Tasks 1–4: funding, M8, fixture, in-place writes. Each ships alone and fixes a
  live crash.
- **s67b** = the SPA lifecycle.

Splitting costs a second review and deploy cycle ahead of #59's rebase.

## Byte budget

The ceilings today are **45,880 / 33,120** (bundle / widget, `zlib` level 9). The artifact
measures exactly that, so there are 0 bytes of headroom.

**Allocation: ≤ +850 gz gross on each measurement, net ≤ 0 on both ceilings.** The row is in
`docs/stories.md` § Byte budget.

| Item | Δ gz bundle / widget | Source |
|---|---|---|
| Funding: esbuild CSS minify of the 5 `style.textContent` literals at build time (`scripts/build-embed.mjs`) | −494 / −525 | measured |
| Funding: delete the unreachable socket.io fallback loader (`EMBED_SCRIPT_SRC` `:7`, `SOCKET_IO_FALLBACK_URL` `:51-69`, the `window.io` branch `:76-77`, the `<script>` injection in `loadSocketIO` `:3019-3049`) | −290 / −287 | measured |
| Funding: delete the `rcf-editable` class (`:1861`, `:2629`; nothing reads it) | −28 / −29 | measured |
| **Funded, first line** | **−812 / −841** | |
| SPA design, lean prototype (writer, apply rule, rows cache, observer, route change, authored restore, write cap, Navigation API, edit-click check) | +633 / +605 | measured |
| Discovery gating + coalescing | +56 / +60 | measured |
| try/catch ×2, shadow-root observe, singleton guard, variant skip, `destroy()` cleanup | +60–110 | estimate |
| M8 config origin (AC 12) | −10 to +40 | estimate |
| **Gross** | **≤ +850** | |
| Second-line reserve, only if net > 0 after Task 8: the uncalled `assessReadability` method (`:2708-2710`) + `getEditingColors` (PR #59 does not spend these) | −41 / −38 | measured |

Research's prototype "C2" (lean + coalescing + the three funding items) measured 45,739 / 32,964,
which is −141 / −156. The worst case of the remaining estimates is about +9 on the bundle. That
is why the reserve exists. If the branch is still over after the reserve, stop and report to the
owner. Never raise a ceiling, and never take PR #59's items (`startPolling`, `getFullElementText`,
`getElementText`, `waitForDOM`) without the owner. The lazy `generateSelector` (+38) is not
spent: it is a follow-up.

The ceilings stay where they are until Task 9. Then `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ` and the
test's `SEEDED_MAX_*` **ratchet down to the size measured on the branch**, with every delta
itemised in a `RATCHETED DOWN … (s67)` note. After each embed task, run `npm run build:embed` and
add the delta to the PR's byte table. A task that blows its row stops and trims before the next
task starts.

## Tasks (ordered)

Every task writes its test first and watches it fail for the stated reason before any
implementation. Jest boots the real source IIFE (`new Function(WIDGET_SOURCE)()`), following
the existing embed suites. "e2e E1–E5" are the Playwright tests written in Task 3.

1. [ ] **Fund the budget (no behaviour change).**
   - **Failing tests first**:
     - `src/__tests__/embed/style-literal-comments.test.ts` gains the case "each style literal
       ships minified". For each of the 5 source literals, `esbuild.transform(css,
       { loader: 'css', minify: true })`, trimmed, must equal the artifact literal at the same
       index. Today it fails because the artifact carries the indented CSS.
     - Widen the matcher to `"…"` strings as well as backticks. esbuild turns a template literal
       with no newline into a double-quoted string (checked: `` s.textContent=`.a{…}` `` →
       `s.textContent=".a{…}"`), so without this the existing "≥ 5 literals" assertion would go
       red for a cosmetic reason. Its assertions stay, plus the new equality.
     - New `src/__tests__/embed/embed-startup-config.test.ts`, case "no socket.io loader". With
       `data-ws-url` set and no `window.__recopyfastSocketIO`, the widget appends no `<script>`
       and degrades to HTTP without throwing. Today it injects `socket.io-client.min.js`.
   - **Implement**:
     - In `scripts/build-embed.mjs`, add `minifyStyleLiterals(esbuild, source)` before
       `buildWidget`. It uses the same literal regex as the test.
     - It **throws** if there are fewer than 5 literals, or if a source literal or its minified
       output contains `${`, `\` or a backtick. Raw text then equals cooked text, so no escaping
       question exists. None of today's 5 literals contains any of these (checked).
     - Pass a CSS `target` no newer than the widget's es2018 floor.
     - The `--check` path stays esbuild-free.
     - Delete the loader and `rcf-editable` lines listed in § Byte budget. `loadSocketIO`
       resolves `getSocketIOFactory()` or throws, and the existing catch (`:3013-3016`) falls
       back to `startPolling`.
     - Keep the `a.rcf-editable-link` selector (`:2597`).
     - Keep **writing `public/embed/socket.io-client.min.js`**. The gate measures the widget as
       "artifact minus that file", and `src/__tests__/middleware-matcher.test.ts:98` pins its
       URL.
     - Add a tombstone comment saying this pre-empts part of `s06c-embed-shrink`.
   - Record the measured delta. Expected ≈ −812 / −841.
2. [ ] **AC 12: startup config cannot be clobbered (security review M8).**
   - **Failing tests first**, in `embed-startup-config.test.ts`. The script `src` is
     `https://cdn.rcf.test/embed/recopyfast.js` and there is no `data-api-url`.
     - (a) `<a id="RECOPYFAST_API" href="https://evil.test/api">` in the page before boot. If
       jsdom has no named window access, assign that element object to
       `window.RECOPYFAST_API`, which is the value a browser yields, and say so in the test.
       Every fetch must go to `https://cdn.rcf.test/api…` and none to `evil.test`.
     - (b) A cross-origin string global is ignored, with the same assertion.
     - (c) A same-origin string global (`https://cdn.rcf.test/custom-api`) is honoured.
     - (d) `data-api-url` is still honoured when the global is ignored.
     - (e) A clobbered or cross-origin `window.RECOPYFAST_WS` never reaches the
       `__recopyfastSocketIO.io` spy. `data-ws-url` still does.
     - (f) A script with no `src` ignores the globals and uses the attributes.
   - **Implement**: rewrite the config IIFE (`:12-46`).
     - `scriptOrigin` = `new URL(script.src).origin`, or `null` inside a try.
     - A global counts only if `typeof v === 'string'` and its origin equals `scriptOrigin`.
     - API = honoured global, else `data-api-url`, else derived from `script.src`.
     - WS = honoured global, else `data-ws-url`, else none. The no-derived-WS tombstone
       (`:37-45`) stays.
     - Keep writing the resolved values to `window.RECOPYFAST_API/WS`, as today:
       `e2e/realtime-additive.spec.ts:223` asserts `window.RECOPYFAST_WS` equals the attribute.
     - Add a tombstone comment naming M8 and DOM clobbering.
   - **Test touched**: `editor-grant-edit-mode.test.ts:446` sets a cross-origin string global on
     a script with no `src`, so the new rule ignores it. Move the value to `data-api-url`. This
     changes the setup only, not the assertion.
3. [ ] **The SPA and React fixtures, written red.**
   - New `e2e/embed-spa.spec.ts`. A Node `http` host server on `RECOPYFAST_SPA_PORT || 4177`
     serves three pages:
     - **`/spa/*`**: a framework-free SPA, with the same shell for every path. It renders
       600 ms after load. Nav links do `history.pushState` + render, and `popstate` re-renders.
       A persistent tagline sits outside the outlet. A 100 ms ticker writes `nodeValue`, and
       the host writes the authored h1 back with `textContent` after 1 s.
     - **`/react/`**: a React 19.1 client render done synchronously with `flushSync` *before*
       the snippet, so today's artifact applies copy and then crashes.
       `<h1 data-rcf-id="r-hero">Hello{show && ' world'}</h1>`,
       `<p data-rcf-id="r-lead">{icon && <b>!</b>}Lead text</p>`, and a `window.__toggle()`.
     - **`/ssr/`**: `react-dom/server` `renderToString` + `hydrateRoot` with a
       `?hydrateDelay=` knob.
   - Bundle React at test time with esbuild (`define process.env.NODE_ENV="production"`, the
     same pattern as PR #59's `stable-copy-startup.spec.ts`). `react`, `react-dom` and
     `esbuild` are already dependencies.
   - The snippet loads `${APP_URL}/embed/recopyfast.js` (the real artifact) with
     `data-api-url="https://api.rcf-spa.test/api"`.
   - `context.route('**/*')`:
     - fulfils the fixture API from in-memory rows and records every GET and POST;
     - continues requests to `127.0.0.1:3000` and `localhost:<port>`;
     - **aborts everything else, and the test fails if anything was aborted**. No Supabase, no
       production API.
   - Page-scoped ids are learned, never re-implemented. A first context loads `/spa/` and
     `/spa/about` and records the discovery POST bodies. The test then "publishes" edited rows
     for chosen ids (`original_content` = the discovered text) plus one unedited row for the
     ticker, and a fresh context asserts.
   - Tests:
     - **E1**, vanilla SPA (AC 1–5, 9, 11): late render, published on load and after
       `pushState` nav, revisit, query/hash-only changes, host write-back, ticker, bounded
       discovery, `history.pushState` identity, 0 page errors.
     - **E2**, the same SPA with `window.navigation` removed by an init script: nav + Back, one
       GET per path (AC 3 without the Navigation API).
     - **E3**, React CSR crash regression (AC 13).
     - **E4**, React SSR: no crash after hydration, and stamping before hydration logs no React
       error (AC 6, 13).
     - **E5**, edit mode across in-app nav with the localhost `test_` demo token (`:993-1009`)
       and intercepted staging GETs (AC 7).
   - **Contract first**: `src/__tests__/e2e/playwright-ci-contract.test.ts:33-45` expects
     **50**, which is red. Then update `playwright.config.ts:14` and `.github/workflows/ci.yml`
     (the comment at `:165`, the placeholder at `:215`, the step name at `:341`, the checks at
     `:383-385` and the message at `:390`).
   - Run E1–E5 once against the artifact as built after Task 2 and record each failure in the
     PR: 0 elements; NotFoundError and an unmounted root; no GET for the new path. This proves
     the fixture reproduces the production bugs.
4. [ ] **AC 13: in-place text writes. This fixes the React crash hazard.**
   - **Failing tests first**:
     - New `src/__tests__/embed/embed-react-writes.test.tsx`. It uses jsdom and
       `react-dom/client` 19.1 with `act`, and the real IIFE booted on a React-rendered page
       with edited rows for author-written ids.
       - **R1c**: render `Hello{show && ' world'}`, apply, then `show=false`. There must be no
         `NotFoundError`: assert with `createRoot(…, { onUncaughtError, onRecoverableError })`
         spies and a window `error` listener. The root stays mounted and shows published copy.
       - **R1d**: an element inserted before the written text node. No `insertBefore` error.
       - The h1's first text node is the same `Node` React created (`toBe`).
       - `<button><svg/>Buy</button>` keeps its `svg`.
       - An already-matching DOM produces 0 `characterData` records.
       - All of these are red today.
     - e2e E3 stays red until the artifact is rebuilt.
   - **Implement**:
     - Add a module-level `writeText(element, text)`, outside the class, so the
       `site-token-refusal` slice is untouched.
     - It does nothing if `element.textContent === text`.
     - Otherwise it sets `nodeValue` on the first direct text node and blanks every other
       text node beneath the element. It appends one text node only if there is no direct one,
       and it never removes or replaces a node.
     - Route every runtime text write through it: `applyContentToElement` (`:3601`),
       `applyVariants` (`:3409`), and the editor's save, cancel and AI setter (`:4602`,
       `:4623`, `:4634`). `INPUT`/`TEXTAREA` `.value` and `applyImageSource` are unchanged.
     - `applyContentToElement` compares against the live DOM (`getElementText`) instead of
       `elementData.originalContent` (`:3592`), and stops overwriting `originalContent` with
       published copy (`:3606`). It stays the first-seen authored text, which discovery reports
       (the s65a invariant) and the route change restores.
     - The one reader that wanted "current text", the Edit Board card preview (`:5936-5937`),
       reads the live element instead.
     - Add a tombstone comment naming the NotFoundError and root-unmount incident.
5. [ ] **AC 2 + AC 11: per-path rows cache, edited rows only, variant precedence.**
   - **Failing tests first**, in a new `src/__tests__/embed/embed-spa.test.ts`:
     - A row with `current_content === original_content` writes nothing. One with a different
       value writes. One with no `original_content` writes. An `href`/`alt` attribute row still
       applies.
     - An element appended after hydrate gets its edited row, with no second content GET,
       within one rescan cycle.
     - An element with an assigned variant is never overwritten by the published re-apply.
   - These existing tests must pass **unchanged**:
     - `visitor-cookie.test.ts:227`, whose variant the prototype overwrote;
     - `editor-grant-requests.test.ts:218`, polling with `page_path=%2Fpricing`.
   - **Implement**:
     - `contentReadEndpoint(staged, token, path)` takes an explicit path. Update both callers,
       hydrate (`:3635`) and `startPolling` (`:5458`).
     - `this.rows[path]` holds a promise of an id-indexed object. Each normalized path is
       fetched once, with the path captured at request time. A failure deletes the entry.
     - `serverKnownElementIds` becomes a union and is never reset.
     - Rows are applied after the fetch and after every rescan, from cache.
     - `hydrateStoredContent` keeps its name and its position immediately before
       `setupMutationObserver() {`. New helpers live elsewhere.
     - Skip `data-rcf-editing` and variant-owned elements.
   - **Test touched**: `site-token-refusal.test.ts` (both cases). Keep the slice boundary. If
     hydrate gains a closure-level dependency or calls a new `this.` helper, add it to the
     loader's `new Function` parameters or fake widget as a pass-through. The refusal branch
     itself is not stubbed, and both assertions stay.
6. [ ] **AC 1 + AC 4 + AC 5: an early, bounded observer (and AC 9 for the observer).**
   - **Failing tests first**, in `embed-spa.test.ts`:
     - Content rendered while the content GET is pending (a delayed fetch mock) gets stamped
       (AC 1).
     - With fake timers and a 100 ms ticker, a rescan runs within 1,000 ms (AC 5). Today it
       never runs.
     - After apply, host write-backs get re-applied **synchronously**, through `textContent`,
       through `nodeValue`, and through unrelated text. After 11 write-backs there are exactly
       10 embed writes and then the host wins. The embed's own writes cause no further writes
       (AC 4).
     - A rescan over 1,000 mapped siblings makes no new `generateSelector` calls and prunes
       detached entries.
     - Late text inside an open shadow root is found.
     - A callback that throws once reaches no `window` `error` listener, and the next batch is
       still processed.
     - Booting the IIFE twice gives one instance. A clobbered `window.ReCopyFast` (an element)
       does not block boot.
     - After `destroy()`, a mutation triggers nothing.
   - **Implement**:
     - In `init` (`:923`), set `this.pagePath` and attach the observer right after
       `waitForDOM`, before staging, auth, fonts and fetches. The rest of `init` keeps its
       order (AC 6).
     - Observe `childList` + `characterData` + `subtree` on `document.body` and on every open
       shadow root `queryDeep` enters, once each. Do not observe `attributes`.
     - The callback runs inside try/catch:
       - the path check (Task 7);
       - a synchronous re-apply for mapped elements touched by the batch;
       - a rescan scheduled with a 200 ms debounce and a 1,000 ms max wait.
     - The rescan timer runs inside try/catch: a mapped-node fast path (no restamp, no
       selector), pruning, apply from cache, `applyVariants`, then discovery (Task 7).
     - The write counter lives on each entry, capped at 10.
     - Add a singleton guard at the top of the IIFE that checks for a real instance
       (`window.ReCopyFast.elements instanceof Map`), not just truthiness.
     - `destroy()` (`:5480`) also disconnects every observed root, clears both timers, and
       clears the polling interval. Store its handle.
   - **Tests touched**: the boot helpers in `content-attributes.test.ts` (fails at `:294`) and
       `edit-link-persistence.test.ts` (fails at `:237`, which already locks the previous
       instance) call `destroy()` on the previous instance before deleting it. This is a
       harness change only: earlier boots in the same jsdom window keep observing. Any other
       suite that turns red for the same reason gets the same fix, listed in the PR.
7. [ ] **AC 3 + AC 9: route change without patching, plus discovery gating and coalescing.**
   - **Failing tests first**, in `embed-spa.test.ts`:
     - **GET counts**: `pushState('/about')` makes exactly one GET with
       `page_path=%2Fabout`. Back via `popstate` makes 0 GETs. A `?q=1` or `#x` change makes 0.
     - **Ids**: a persisting element's id after in-app nav equals the id a fresh boot on
       `/about` computes.
     - **Authored restore**: a written page-scoped element shows authored text again if no
       new row applies. The old stamp is gone, and author-written (shared) ids are untouched.
     - **Navigation API**: a fake `window.navigation` firing `currententrychange` after a
       `pushState` that mutates no DOM triggers the GET.
     - **Edit-click check**: with the path changed, no mutation and no Navigation API, an
       edit-mode click re-identifies before opening the editor.
     - **Mid-fetch `replaceState`**: during the first fetch, `/` rows are never applied to
       `/about` elements and no discovery POST goes out for `/` ids.
     - **AC 9**:
       - `history.pushState` / `replaceState` are `===` the originals after boot and navigation.
       - The own window keys the embed adds are ⊆ {`ReCopyFast`, `recopyfast`, `rcf`,
         `RECOPYFAST_API`, `RECOPYFAST_WS`}.
       - A navigation path that throws reaches no `window` error.
     - **Discovery**:
       - No POST goes out before the current path's rows settle, at init or after nav.
       - A live feed (one `<li>` every 300 ms over 10 s of fake time) gives an immediate first
         report, then at most 1 per 10 s and at most 10 per page view.
       - Known ids are never re-reported.
   - **Implement**:
     - Add a `checkRoute()` method, not between hydrate and `setupMutationObserver`.
     - It runs from the observer callback, from a `currententrychange` listener (added only
       if `window.navigation` exists, removed in `destroy()`), and at the start of the edit
       click handler (`:3718`).
     - **On a path change**:
       - Page-scoped entries skip `data-rcf-editing`. If the embed wrote one and it still shows
         that copy, restore its authored text. Then unstamp and drop the entry.
       - Reset shared entries' write counters.
       - Set `pagePath`, load the rows (fetch once or use the cache), and rescan.
       - Before `init` starts its first hydrate, a change only updates `pagePath` and drops
         entries.
     - `sendContentMap` sends only when the rows for `pagePath` have settled, with the
       coalescing above.
     - Do not touch `normalizedPagePath`, `computeStableElementId`, `structuralPath` or
       `hashPath`.
8. [ ] **AC 7: edit mode across navigation.**
   - **Failing tests first**, in `embed-spa.test.ts`, using the `editor-grant-edit-mode`
     harness and the demo token:
     - After in-app nav, the staging banner and `stagingAccess` are kept, and one staging GET
       goes out with `page_path=%2Fabout`.
     - A newly rendered `/about` h1 click opens `contenteditable`.
     - After a save, a host re-render keeps the saved copy rather than the pre-save row.
     - A `handleContentUpdate` (realtime or polling) refreshes the cached row, so a later
       write-back re-applies the new content.
   - **Implement**:
     - A successful `persistContentUpdate` in the text, image and form paths (`:4589`,
       `:4958`, `:5156`) updates `rows[path][id].current_content`. `original_content` is kept,
       so the row still counts as edited.
     - `handleContentUpdate` (`:3545`) does the same.
     - No change to grants or staging auth.
   - e2e E1–E5 green against the rebuilt artifact. Check the byte table: apply the second-line
     reserve here if net > 0.
9. [ ] **Docs, ratchet, gates.**
   - **Failing tests first**:
     - `src/lib/docs/__tests__/installation-content.test.ts:54-70`: the required SPA strings
       change by owner decision. The new strings: history-mode routers are supported by the
       plain snippet; `/#/` hash routes are not; the workaround is history mode or unique
       author-written `data-rcf-id`; verify a full load and an in-app navigation.
     - `build-size-gate.test.ts:84-85`: `SEEDED_MAX_*` lowered to the measured size.
   - **Implement**:
     - Update `src/lib/docs/installation-content.ts`: the `spa` section (`:186-197`), the
       troubleshooting row (`:248`) and agent step 6 (`:307`). Section titles are unchanged
       (`page.test.tsx:52,97`). The guide still makes no universal SPA promise (s59).
     - Set `MAX_BUNDLE_GZ` / `MAX_WIDGET_GZ` to the measured values, with an itemised
       `RATCHETED DOWN 2026-10-… (s67-embed-spa-support)` note in `scripts/build-embed.mjs`
       and the matching note in the gate test.
     - Tick the story ACs with evidence.
     - ADR 049 is already written. Amend it on the branch if the implementation diverges.
   - **Gates**: `npm run precommit`, `npm run prepush`, the full `npm run test:e2e` locally
     (50 tests), and `node scripts/build-embed.mjs --check`.
   - Make one story commit.
10. [ ] **Production proof.** This runs after the owner merges and deploys, as the operator. See
    § Proof plan. Record the results in the PR and in the story's AC 1, 6 and 10 checkboxes.

## Tests to update

Six existing embed unit tests failed against research's prototype. Each is listed here with its
cause. "Code fix" means the test stays byte-identical and the code changes.

| Test | Why the prototype broke it | Change | Task |
|---|---|---|---|
| `content-attributes.test.ts:294` "sends the normalized page path and marks authored ids as shared" | An earlier boot in the same jsdom window keeps observing and reacts to this test's DOM and `history`. Passes in isolation | Boot helper calls `destroy()` on the previous instance (harness) | 6 |
| `edit-link-persistence.test.ts:237` "boots the next page of the site in edit mode…" | Same cause: two boots in one test | `boot()` also calls `destroy()` on the instance it already locks (harness) | 6 |
| `site-token-refusal.test.ts:91` "preserves authored copy without adding a token-specific warning" | The loader slices `async hydrateStoredContent() {` … `setupMutationObserver() {`; a method added between them broke the slice | Keep the two adjacent; pass any new closure or `this.` dependency into the loader (harness) | 5 |
| `site-token-refusal.test.ts:118` "preserves authored copy for a missing installed token" | Same slice | Same | 5 |
| `editor-grant-requests.test.ts:218` "polls with the grant header and a clean URL" | The prototype's polling dropped `page_path` | None. Code fix: polling passes the path to `contentReadEndpoint` | 5 |
| `visitor-cookie.test.ts:227` "mints rcf_vid once and carries it to bucketing and tracking" | The published re-apply overwrote the A/B variant (a design bug the test caught) | None. Code fix: variant-owned elements are skipped | 5 |

The prototype did not break the following, but this plan changes them, and the PR states each:

| Test | Reason | Task |
|---|---|---|
| `editor-grant-edit-mode.test.ts:446` | M8: a cross-origin string global on a `src`-less script is now ignored. The value moves to `data-api-url`. Setup only | 2 |
| `style-literal-comments.test.ts` | The matcher also accepts `"…"`, because esbuild turns newline-free templates into strings. A new equality assertion is added; nothing is removed | 1 |
| `src/__tests__/e2e/playwright-ci-contract.test.ts:33-45` | 45 → 50 (+E1–E5) | 3 |
| `src/lib/docs/__tests__/installation-content.test.ts:54-70` | The approved SPA wording changes by owner decision | 9 |
| `build-size-gate.test.ts:84-85` | Ratchet down | 9 |

`element-id-page-scope.test.ts` stays byte-identical and green, because ids are persistent.

## Run interdicts

- `git diff main...HEAD -- src/app/api supabase server src/middleware.ts` is empty. There is no
  server change. The v1 POST `original_content = null` follow-up is not part of s67.
- The bodies of `normalizedPagePath`, `computeStableElementId`, `structuralPath` and `hashPath`
  are unchanged in the diff.
- `grep -nE "history\.(pushState|replaceState)\s*=" public/embed/recopyfast.src.js` is empty.
  No new `setInterval`: route detection never polls. The embed assigns no host global beyond
  today's five.
- No code path detects a framework, router or site: no `__NEXT_DATA__`, no
  `_reactRootContainer`, no `__vue__`, no hostname checks. Tombstone comments naming the React
  crash are expected.
- `MAX_BUNDLE_GZ`, `MAX_WIDGET_GZ` and `SEEDED_MAX_*` only go down, and end at the measured
  size.
- `public/embed/recopyfast.js` changes only via `npm run build:embed`, and `--check` is clean.
  `socket.io-client.min.js` is still produced.
- `package.json` and the lockfiles are unchanged.
- Existing tests change only as § Tests to update lists. No assertion is weakened. No `.skip`,
  `.only`, `test.fixme` or opt-in env gate in `e2e/embed-spa.spec.ts`.
- `e2e/embed-spa.spec.ts` makes no request outside `localhost`, `127.0.0.1` and the fixture API
  host, and it asserts that.
- Out of scope, however adjacent:
  - hash routing;
  - observing `attributes`;
  - the lazy `generateSelector`, and sibling-index memoisation;
  - tearing down an inline editor whose element navigation removed;
  - `<picture><source>` removal in `applyImageSource`;
  - late A/B click and impression tracking;
  - anything on PR #59's branch.
- No `--no-verify`. No push to main, no merge, no deploy. Production edits are made only by the
  owner on openflows.ai.

## The point everything turns on

One `MutationObserver`, attached at DOMContentLoaded, is the single trigger for three things:
late render, route change (a path check per batch), and re-render enforcement. The only thing it
enforces is an edited row, written in place. Three places could be wrong:

1. **A navigation that mutates no DOM, on a browser without the Navigation API.** That means
   Safari < 26.2 or Firefox before Jan 2026. The embed keeps the old page's ids until the next
   mutation or edit click, and an edit saved in that window lands on the old path.
   - Compare with E2 (no Navigation API, nav + Back) and the jest edit-click case.
   - Also compare with research's option table: wrapping history misses late-loaded snippets,
     which is worse.
   - Real routers render on navigation. The gap is a router that changes only the path.
2. **"Edited" is decided by `original_content`.** Compare with both projections:
   - `PUBLIC_CONTENT_COLUMNS` (`src/lib/content/public-rows.ts:27-28`) carries
     `original_content`, with `current_content = published ?? original`;
   - the staging GET carries `current_content = staging ?? published`
     (`src/app/api/staging/content/[siteId]/route.ts:142`).

   Also compare with what the existing suites' fixture rows contain, and with v1 POST
   (`src/app/api/v1/content/route.ts:317-318`), the accepted loss. A row reverted to its
   authored text writes nothing, which is correct.
3. **Loop safety under a second enforcer.**
   - The re-apply must compare against the live DOM before every write. The embed's own
     `characterData` records must then produce 0 further writes, and the counter must reset
     per route visit and not per batch.
   - Compare with the jest cap case (11 write-backs → 10 writes) and E1's write and POST
     counts.

There is also the arithmetic: the bundle has about +9 gz of worst-case risk before the reserve.
The PR's byte table is the evidence.

## Files touched

- **Modified**:
  - `public/embed/recopyfast.src.js`
  - `public/embed/recopyfast.js` (generated)
  - `scripts/build-embed.mjs`
  - `src/lib/docs/installation-content.ts`
  - `playwright.config.ts`
  - `.github/workflows/ci.yml`
  - `docs/stories.md`
  - the tests in § Tests to update
- **New**:
  - `src/__tests__/embed/embed-startup-config.test.ts`
  - `src/__tests__/embed/embed-react-writes.test.tsx`
  - `src/__tests__/embed/embed-spa.test.ts`
  - `e2e/embed-spa.spec.ts` (with any small fixture helpers under `e2e/support/`)
  - `docs/decisions/049-embed-observes-the-host-never-patches-it.md` (in this commit)
- **Unchanged on purpose**: `public/embed/socket.io-client.min.js` (still built), and every
  server route.

## Test strategy

- **Jest** (unit, the real source IIFE in jsdom):
  - `embed-startup-config` covers M8 and the socket loader.
  - `embed-react-writes` uses real `react-dom` for AC 13.
  - `embed-spa` covers AC 1–5, 7, 9 and 11 with fake timers and fetch mocks.
- **The existing 17 embed suites** stay green, with the harness changes above.
- **Playwright** (`e2e/embed-spa.spec.ts`, E1–E5):
  - It runs in the existing **`e2e` job of `.github/workflows/ci.yml`**, inside the "Run all 50
    Playwright tests (blocking)" step, against `next start` serving the committed artifact.
  - It needs no Supabase. The API lives on a fake host answered by `context.route`, and every
    other host is aborted and asserted absent, so there are no production API calls.
  - The strict reporter's count goes 45 → 50.
  - Locally: `npm run test:e2e -- e2e/embed-spa.spec.ts` (the dev server via `webServer`).
- **Keep green**: `published-snapshot-ssr`, `share-edit-publish`, `realtime-parity`,
  `realtime-additive` and `try-preview`.
- **Production proof** is an operator step. Green tests never stand in for AC 1, AC 6 or AC 10.

## Proof plan (Task 10, after the owner merges and deploys)

**openflows.ai**, plain snippet (marcusbey/openflows-ai#3), headless Chromium with a fresh
context per run:
1. **Visitor probe on `/`.** The app moves itself to `/fr` at startup.
   - `[data-rcf-id]` count > 0 within 2 s of render settling, meaning no `childList` record for
     500 ms.
   - One content GET per path.
   - ≤ 1 discovery POST over 60 s idle.
   - 0 `pageerror`.
2. **Owner edits.** The owner, using their own edit link, edits and publishes one element on the
   landing route, and one on `/fr/blog` reached by **in-app** click (not a full load).
3. **Fresh visitor.**
   - Load `/`: published copy.
   - In-app click to `/fr/blog`: published copy, with exactly one new GET.
   - Back: published, 0 GETs.
   - Full load of `/fr/blog`: published.
   - 0 uncaught errors throughout.

**https://www.aicompoz.com**, non-regression for server-rendered copy (AC 6):
- Reuse the harness
  `/private/tmp/claude-501/-Users-marcusbey-Desktop-02-CS-05-Startup-recopyfast/c82f0c6d-49ad-4e89-953d-c7cf4cc2f977/scratchpad/probe/ssr-proof.mjs`:
  `node <that file> <repo root> https://www.aicompoz.com 10`.
- Pass means three things, for both the fresh and repeat series:
  - "published copy in first paint 10/10";
  - "zero hero mutations 10/10";
  - "embed loaded 10/10".
- Then one in-app navigation variant, extended in a scratchpad copy and never in the repo: load,
  click an internal link, return in-app. Hero mutations stay 0 and there are 0 page errors.
- The harness lives in a session scratchpad. If it is gone, rebuild it from its description:
  - an init-script `MutationObserver` on `h1 [data-rcf-id]` text;
  - FCP hero text;
  - 10 fresh + 10 repeat visits.

## Definition of Done

The repo DoD applies: a single PR; lint, type-check, format, build and test green; review passed;
deployed. Plus:
- AC 1–13 each ticked with evidence.
- The PR's byte table itemises every delta, and the ceilings are ratcheted to the measured size.
- CI e2e reports 50/50 under the strict contract.
- E1–E5 were recorded red against the pre-change artifact.
- ADR 049 and the install-guide update are merged.
- The production proof is recorded for openflows.ai and aicompoz.com.
- Follow-ups are listed in the PR:
  - v1 POST stores `original_content = null`;
  - hash routes as paths;
  - the lazy `generateSelector` and memoised sibling indexes;
  - inline editor teardown on navigation;
  - `<picture><source>`;
  - observing `src` for lazy-loaders;
  - PR #59 rebase notes.

## Risks

- **SSR before hydration.** React #418 and a client re-render still happen when published copy
  lands before hydration. s67 turns that into a self-healing double swap; s65a is the fix.
- **First visits.** Late elements show authored copy for the fetch latency, as on a full load.
  Async renders on cached routes can show it for up to the 200 ms debounce.
- **Large DOMs.** The O(n²) first scan pre-exists, but SPA renders now expose it: 3,005
  candidates take 2.3 s at 4× CPU.
- **Markup children.** Elements with markup children keep their child elements with the text
  blanked. That is a visible change from today, where they are destroyed.
- **Transient structure.** Suspense or streaming structure present at rescan time can stamp an
  id that sticks for that page view.
- **PR #59.** Its rebase conflicts on `init`, hydrate, `scanForContent`, `startPolling`, the
  build script, the gate test and the e2e count. That cost is accepted by owner decision 4.
