# Research — Story s67-embed-spa-support

Source of truth for every line reference: `public/embed/recopyfast.src.js` at `3283850`
(main `659778e` + the story commit). "Measured" means run on 2026-10-07: production probes of
openflows.ai (3 page loads, GET only, the embed's discovery POST aborted by the probe) and local
fixtures served from the session scratchpad, loading the committed artifact against an API that
Playwright intercepts on a fake host. No fixture ever reached a production API.

## The six structuring facts

1. **Root cause confirmed.** On openflows.ai `/` the embed is constructed at 304 ms, DOMContentLoaded
   and the first scan run at 320 ms over 69 DOM nodes and find 0 candidates. React then renders
   (672 nodes) and the app calls `history.replaceState('/fr')` at 455 ms. The body observer is attached
   at 864 ms, after `hydrateStoredContent` (396 ms), `fetchActiveTests` (145 ms) and
   `establishConnection`. React's render predates the observer, so no rescan ever runs: 0 editable
   elements and no published copy. A manual scan finds 212. The story measured 1,230 ms for the same
   attach, so network variance moves it but never ahead of React.
2. **Rescans never apply published copy, and the one fetch can name the wrong page.** The observer
   rescans and reports only (`:3699-3702`). Rows are fetched once, keyed by the path at fetch time
   (`:3635` → `:839`). On openflows the fetch went out with `page_path=%2F` while the app moved to `/fr`
   during the request. After the in-app navigation to `/fr/blog` there was no GET, and the map held 241
   entries, 212 of them detached nodes from `/fr`.
3. **Today's write crashes React apps. This is observed, and it is a production hazard regardless of
   s67.** `applyContentToElement` writes `target.textContent = content` (`:3601`), which replaces the
   element's child nodes. When React later removes or inserts relative to one of its own text nodes,
   it throws `removeChild`/`insertBefore` NotFoundError, and React 19 unmounts the whole root (blank
   app). This happened on a client-rendered page and on an SSR page after hydration. s67 multiplies
   writes, so the write must become in-place.
4. **The budget has 0 bytes of headroom, and the design costs about 605–700 gz on the widget.** The
   artifact measures exactly 45,880 / 33,120 against ceilings of 45,880 / 33,120. The funding exists
   and was measured: minifying the five CSS template literals at build time saves −494 / −525, and the
   unreachable socket.io fallback loader is worth another −290 / −287. A funded prototype measures
   45,739 / 32,964 (§Byte budget).
5. **A route change must re-identify every page-scoped element.** Stamps are sticky
   (`computeStableElementId` returns an existing `data-rcf-id`, `:872-873`), and ids hash the path
   (`:879`). A node that persists or is reused across routes therefore keeps the old page's id, and an
   edit made after in-app navigation is saved under the wrong page. Measured on the fixture: the
   persistent tagline is `rcf-142l0mycfvy` on `/` and `rcf-17cjfw6102v` on a full load of `/about`.
   Today, in-app navigation keeps the first id.
6. **A rescan without a max wait starves. With a max wait and no coalescing, it floods discovery.**
   The current 500 ms debounce never fires under a 100 ms ticker (fixture: 1 element found, ever). A
   prototype with a 1 s max wait and no coalescing sent 33 discovery POSTs in 10 s from one visitor on
   a live feed. The per-site discovery limit is 100/min and fails closed
   (`src/app/api/content/[siteId]/route.ts:565-571`, `src/lib/security/rate-limiter.ts:423`), so one
   visitor would lock discovery for the whole site.

## Target story

`docs/stories.md` → `s67-embed-spa-support` (AC 1–10). The owner's rule is one generic mechanism:
no framework, router or site detection, and no host-side workaround.

## Current state of the code

**Init chain** (`init`, `:923-989`, all inside one try/catch):
- `waitForDOM` (`:925`, `:2562-2570`), then `initStagingMode` when staging or edit tokens are present
  (`:927-931`; one POST `/staging/validate`, `:1011`).
- `initEditorAuth` (`:939`): no request unless there is a handoff code or a stored grant (`:1097`).
- `Rules.whenFontsReady` (`:945`): up to 3,000 ms, in `src/lib/editingRules.core.ts:862`.
- `scanForContent` (`:947`), then `await hydrateStoredContent` (`:953`, one GET).
- Visitors only: `await fetchActiveTests`, `await bucketVisitor`, then `applyVariants`,
  `setupClickTracking`, `trackImpressions` (`:958-964`).
- `await establishConnection` (`:966`; immediate when no `data-ws-url`).
- `sendContentMap` (`:977`), `setupMutationObserver` (`:979`), `setupEditMode` (`:981-983`),
  `isInitialized` (`:985`).
- The observer therefore waits behind up to 4 network round trips and the font wait.
- The IIFE itself calls `history.replaceState` at boot to strip tokens (`:98`), before `init`.

**Identity**:
- `normalizedPagePath` (`:831-835`) uses pathname only: query and hash are ignored, `index.html` and
  trailing slashes are folded.
- `computeStableElementId` (`:871-880`) honours any existing `data-rcf-id`.
- `scanForContent` (`:2593-2632`) restamps every candidate on every scan. An existing stamp absent
  from the map is treated as author-written and given `path: null`, a shared row (`:2611-2613`).
- Map entries are never removed, so detached nodes accumulate.

**Apply**:
- `applyContentToElement` (`:3573-3608`) compares against the stale `elementData.originalContent`
  (`:3592`), not the live DOM. It writes `textContent` (`:3601`), `value`, or the image via
  `applyImageSource` (`:684-718`, which also `remove()`s `<picture><source>`, `:693-695`).
- `applyVariants` writes `textContent` too (`:3409`).
- The inline editor writes `textContent` on save, on cancel and for AI suggestions (`:4602`, `:4623`,
  `:4634`).

**Hydrate** (`:3631-3684`): one fetch → `serverKnownElementIds = new Set(rows)` (`:3663-3668`), then
applies rows to the elements mapped at that moment (`:3670-3683`). Every row is applied, including
discovery rows: discovery stores `published_content = original_content = DOM text`
(`route.ts:172-174`).

**Observer** (`:3686-3710`): `childList` only (`:3692`, `:3706-3709`), a 500 ms debounce reset on
every batch (`:3698-3702`), then scan + `sendContentMap`. There is no characterData, no max wait, no
try/catch in the callback or the timer, and no route awareness.

**Discovery**:
- `postContentMap` (`:3116-3213`) skips when every id is in `serverKnownElementIds`. With that set
  `null` it reports everything (`:3147`).
- The body is the whole map (`:3199`).
- Server: per-IP `IP_GENERAL` 200/min fail-open (`route.ts:288-296`, `:487`), then per-site
  `API_CONTENT` 100/min fail-closed (`:565-571`), then upsert with `ignoreDuplicates` (`:636-643`).
- The content GET is per-IP 200/min (`:328-329`).

**A/B**:
- `fetchActiveTests` is site-wide; `applyVariants` looks elements up once (`:3402`).
- `trackImpressions` counts every assigned test whether or not its element is on the page
  (`:3454-3476`).
- The A/B tables do not exist in production (`docs/stories.md`, "Revised after research").

**Edit mode**:
- Delegated `click`/`mouseover` on `[data-rcf-id]` (`:3718-3792`), so any newly stamped element is
  editable.
- The `rcf-editable` class (`:2628-2630`, `:1859-1862`) has no CSS rule and no reader anywhere
  (`src`, `e2e`).
- `EditBoardPanel` lists `rcf.elements` as is (`:5886-5896`).

## Measurements

Production, openflows.ai `/` (headless Chromium, fresh context, 2026-10-07):

| Event | ms |
|---|---|
| embed constructed / DOMContentLoaded / first scan (0 found, 69 DOM nodes, 0.4 ms) | 304 / 320 / 320 |
| app `replaceState('/fr')` + `navigatesuccess` | 455 |
| hydrate GET `page_path=%2F` resolves (396 ms) / A/B GET resolves (145 ms) | 717 / 862 |
| body observer attached | 864 |
| manual scan: 212 elements, 672 DOM nodes, 0 shadow hosts | 2.4–6.1 per scan (5 runs) |
| mutations in ~7.5 s: childList / characterData / attributes | 219 / 85 / 688–722 |
| in-app click to `/fr/blog`: `pushState` → synthetic `popstate` → `navigatesuccess` | 7,590 / 7,591 / 7,597 |
| debounced rescan after navigation (29 new, map 241, 212 detached, no GET) | 8,401 |

`history.pushState` is native and `window.navigation` exists. The router dispatches a synthetic
`popstate` after its own `pushState`.

Local fixtures:
- A framework-free SPA: renders after a delay, `pushState` router, hash routes, a host write-back.
- React 19.1 client-rendered (`createRoot`, plus a `flushSync` variant so the embed applies before
  React updates).
- React 19.1 SSR (`renderToString` + `hydrateRoot`, with a delay knob).

Every React case uses the production build. "Prototype" is the funded scratch prototype of the
design below (§Byte budget, row "prototype C2"). It never entered the repo.

| Scenario | Today (artifact) | Prototype |
|---|---|---|
| Vanilla, API latency 400/150 ms, render at 600 ms | 5 found, authored h1, never applied | published h1 |
| … click to `/about` | authored, no GET, 4 detached in map, POST of 8 | published, one GET `/about`, 0 detached, no POST |
| Host writes authored copy back (`textContent`, and `nodeValue`) | authored stays | published; 0 of 10 frames show authored |
| 100 ms ticker, render at 600 ms | 1 element (starved) | 5, published |
| App `replaceState` to another path during the first fetch | n/a | GET `/` then `/about`, published, no POST |
| No Navigation API, click then Back | n/a | published on both, one GET per path |
| React CSR, latency 400/150 (Vite-like) | 0 elements | 6, published |
| React, same props re-render | published stays | published stays |
| React, `Hello {name}` text update | silent no-op (React writes a detached node) | published stays, no error |
| React, conditional text removed (`{x && ' …'}`) | **NotFoundError removeChild, root unmounted** | no error, published |
| React, element inserted before a replaced text node | **NotFoundError insertBefore, root unmounted** | no error, published |
| React, single-text prop changed | React overwrites published | published re-applied |
| SSR, hydrate first, then the conditional text update | **removeChild, root unmounted** | no error |
| SSR, embed applies before hydration | React #418 mismatch, client re-render, authored copy back for good | #418 still, then re-applied: published → authored → published |
| SSR, stamping only (no edits) before hydration | no React error | no React error |
| Edit mode (demo token), navigate in-app | n/a | banner kept, staging GET per path, `/about` h1 opens contenteditable |
| Route revisit (rows cached), vanilla and React | n/a | first frame already published; first visits show authored copy for the fetch latency (309–311 ms at 300 ms mock latency) |
| Live feed, 1 `<li>` per 300 ms, 10 s | 1 POST | 33 POSTs without coalescing; 1 with it |

The hash routes `#/a` and `#/b` share all 3 ids (`rcf-142l0mycfvy`, `rcf-m4g74j9h3o`,
`rcf-19nl9zni4e`): structural twins collide.

Scan cost, measured on a synthetic list of 1,000 sibling sections (3,005 candidates, 5,045 nodes):

| Configuration | Cost |
|---|---|
| Today, first scan | 509 ms (desktop), 2,263 ms (4× CPU) |
| Prototype without a mapped-node fast path, rescans | 1,275–1,393 ms (4×), every ~1.3 s: main thread pinned |
| With the fast path, rescans | 6–11 ms (4×) |
| Computing `generateSelector` lazily, first scan | 847 ms (4×), cost moved to the first discovery report only |
| 9,005 candidates, first scan (unchanged, pre-existing) | ~20 s (4×) |

## Answers to the research questions

**Q1 Ordering.**
- Minimal safe reordering: set `pagePath` and attach the observer immediately after `waitForDOM`,
  before staging, auth, fonts and any fetch. Everything else stays in place, so the first scan →
  hydrate order (AC 6) is unchanged.
- Rescans can then run while auth or fetches are pending. They must not write before rows exist (they
  cannot: no index yet) and must not report discovery before the current path's rows have settled.
  The prototype initially POSTed 4 ids after navigation and after a startup `replaceState` until both
  `rescan` and init's `sendContentMap` were gated on `rowsPath === pagePath`.
- Staging and edit mode: rescans only stamp. `editMode` is decided before the first hydrate, and the
  delegated handlers cover late nodes.
- A/B: re-run `applyVariants` after each apply. Variant-owned elements must be skipped by the
  published re-apply (the prototype broke `visitor-cookie.test.ts:227` precisely on this).
- Write volume: GET once per path (cache); POST coalesced (§Design).

**Q2 Rescan semantics.**
- Today: no. A rescan never applies rows (`:3699-3702`).
- The cache belongs on the instance: `rows[path]` → promise of an id-indexed object. Fetch once per
  normalized path, with the path passed explicitly to `contentReadEndpoint`. On failure, delete the
  entry so a later visit retries. Keep `serverKnownElementIds` as a union.
- A/B rows are site-wide and already in memory, so `applyVariants` after each rescan reaches late
  targets. Late click and impression tracking is not addressed: the data plane is dead and PR #59
  rewrites "track only shown".

**Q3 Observer.**
- Add `characterData`. React's single-text update and i18n libraries write `nodeValue`: 85 records on
  openflows in 7.5 s.
- Do not add `attributes`: 688–722 records in 7.5 s, for little value. A lazy-loader swapping the
  `src` of an edited image is a known gap.
- Debounce 200 ms with a 1,000 ms max wait.
- Fast-path nodes already mapped under their id. Without it, rescans on large lists are seconds long.
- Observe each open shadow root that `queryDeep` enters (`:2587`). A body observer does not see inside
  them.
- The embed's own writes are idempotent: there is no write when the text already matches, so they
  never loop. Own UI insertions only cause cheap rescans.
- The callback and timers need try/catch: an exception there bypasses `init`'s try and reaches the
  host's `window`.

**Q4 Route detection.** See the table below.
- Recommended: (a) compare `normalizedPagePath()` on every observer batch, plus (c) Navigation API
  `currententrychange` where present, plus a check at edit-click time. No history wrapping, no polling.
- Hash routers: `normalizedPagePath` ignores the hash, so every hash route shares one path and twins
  collide (3/3 measured). AC 3 keeps hash changes out of scope (open question 3).

**Q5 Writes vs frameworks.**
- Observed: `textContent` replacement is safe only for single-text-node elements. Any later
  structural update React makes inside a replaced element throws and blanks the app (R1c, R1d, R3).
- In-place writing is crash-free in every case tested: set `nodeValue` of the first direct text node,
  blank the other text nodes, never remove or insert host nodes, and append one text node only if
  there is none.
- SSR with the embed applying before hydration triggers React 19 #418 and a full client re-render.
  Nothing generic can prevent that short of not writing before hydration. The design self-heals it,
  and s65a server-rendered copy is the real fix.

**Q6 Edit mode.**
- What survives a route change: the staging session (`stagingAccess`, in memory), the grant and the
  banner (a body child, outside the app root).
- What must re-run: stamping (rescan) and the path's staging rows. Both were measured working in the
  prototype.
- What must change:
  - Save and realtime must update the cached row, or the re-apply reverts a just-saved edit.
  - The editor's own `textContent` writes (`:4602`, `:4623`, `:4634`) should use the same in-place
    writer.
  - An inline editor whose element is removed by navigation needs a teardown. The terminal-failure
    path already has a sessionStorage draft keeper (`keepDraft`, `:1193-1202`) that can be reused.

**Q7 Tests.**
- 17 embed suites and 207 tests pass today (`build-size-gate` excluded; it measures the committed
  artifact). The lean prototype, copied into a scratch mirror, failed 6, each traced to a cause:
  - `content-attributes.test.ts:294` and `edit-link-persistence.test.ts:237`: earlier boots in the
    same jsdom window keep observing and now react to the next test's DOM and `history`. Both pass in
    isolation, so the fix is a `destroy()` teardown.
  - `site-token-refusal.test.ts:21-22` slices hydrate up to `setupMutationObserver() {` as an object
    literal, so no method may be added between them.
  - `editor-grant-requests.test.ts:218`: polling must pass the path.
  - `visitor-cookie.test.ts:227`: the variant was overwritten, a design bug the test caught.
- New: the unit suite, plus one e2e spec with framework-free and React fixtures. The count contract
  is 45, in `playwright.config.ts:14`, `.github/workflows/ci.yml:215,341,383` and
  `src/__tests__/e2e/playwright-ci-contract.test.ts:33-45`.
- s06b (fixture harness) was never built. `published-snapshot-ssr.spec.ts` (host server) is the
  in-repo precedent, and PR #59's `stable-copy-startup.spec.ts` bundles React with esbuild inside a
  test.

**Q8 Bytes.** See §Byte budget.

## Route detection options

| Option | Correctness across routers | Survives other libs | Byte cost (gz) | Degrades |
|---|---|---|---|---|
| (a) path check on each observer batch | Every router whose navigation mutates the DOM: React Router, Next app router, Vue Router, SvelteKit, Astro view transitions, synthetic popstate. Misses a route change with no DOM change until the next mutation | Patches nothing | ~10 | Yes |
| (b) wrap `pushState`/`replaceState` + `popstate` | Synchronous. Misses any router that captured the native function before the embed ran, which is every capture-at-init router once the snippet loads late (tag manager, async). Next.js's app router patches both itself, so ordering-dependent wrapper chains form | Must always call through, and must be removable by `destroy()` (it cannot be, if another lib wrapped after us) | ~60–90 | Riskier: a throw in the wrapper breaks host navigation (AC 9) |
| (c) Navigation API `currententrychange` | Every same-document navigation by anyone, captured originals included. Baseline 2026 (Chromium 102+, Safari 26.2, Firefox Jan 2026); measured firing for `replaceState` and `pushState` on openflows | Patches nothing | ~29 (measured) | Absent on older browsers → (a) covers them (measured E3) |
| (d) polling `location.pathname` | Correct with a lag up to the interval. Background-throttled | Patches nothing | ~20 | CPU on every page forever |

## Recommended design

1. **Ordering.** Set `pagePath` and attach the observer right after `waitForDOM`, before staging, auth,
   fonts and fetches. The rest of `init` keeps its order, so static and SSR first loads are unchanged.
2. **Rows cache.**
   - `rows[path]` holds a promise of an id-indexed object, fetched once per normalized path, with the
     path captured at request time. A failure deletes the entry.
   - `serverKnownElementIds` is the union of every path fetched.
   - Rows are applied after the fetch, after every rescan and synchronously for mutated mapped
     elements.
3. **Apply rule.**
   - Text is written only for edited rows (`current_content !== original_content`; an absent
     `original_content` counts as edited, which keeps the legacy test rows working). Attributes are
     handled as today.
   - The comparison is against the live DOM, not `originalContent`.
   - Skip elements marked `data-rcf-editing` or carrying an assigned variant.
   - Cap re-application at 10 writes per element per page view, so a second enforcer (machine
     translation, an i18n or A/B tool) converges instead of ping-ponging.
4. **In-place writer `writeText`.** Shared by hydrate, realtime, variants and the editor's
   save/cancel/AI paths. `textContent` replacement is removed from every runtime write path.
5. **Observer.**
   - `childList` + `characterData` on the body, and on each open shadow root found.
   - The callback is wrapped in try/catch.
   - A synchronous path re-applies to mapped elements touched by the batch: 0 authored frames
     measured.
   - Added nodes schedule a rescan with a 200 ms debounce and a 1,000 ms max wait.
   - Rescans prune detached entries and skip nodes already mapped under their id.
6. **Route detection without patching.** Check the path on every observer batch, plus Navigation API
   `currententrychange` when present, plus a check at the start of the edit click handler. The embed
   wraps no host global and adds no polling.
7. **A route change means full-load equivalence.**
   - For every page-scoped entry (`path` non-null): restore the authored text the embed replaced,
     remove the stamp, drop the entry.
   - Then fetch/apply the new path and rescan.
   - Author-written `data-rcf-id` (shared rows) are untouched.
   - The restore keeps the old page's published copy from being reported as the new page's authored
     copy (s65a's invariant).
8. **Discovery.**
   - Report only after the current path's rows have settled, at init too.
   - Coalesce: the first report is immediate, later ones at most one per 10 s and at most 10 per page
     view.
   - Compute `generateSelector` lazily, for reported entries only. This is optional: +38 gz, and it
     cuts the first scan of large lists ~60%.
9. **Safety.**
   - Singleton guard: the first instance wins, because two snippets today mis-stamp each other as
     shared ids.
   - `destroy()` stops the observer, the listener and the timers.
   - No exception reaches the host's `window`.
10. **Edit mode.** Saves and realtime updates refresh the cached row. Late elements become editable
    through the existing delegated handlers (measured).

## Byte budget

All figures are `zlib.gzipSync` level 9, measured by a scratch replica of `scripts/build-embed.mjs`
that reproduces 45,880 / 33,120 exactly on the current source. Values are bundle / widget.

| Item | Δ gz |
|---|---|
| Design, lean prototype, standalone on main (the whole of §Design except try/catch, shadow-root observe, singleton, variant skip, destroy, lazy selector) | **+633 / +605** |
| — of which: authored restore on a route change | +51 / +48 |
| — of which: write cap | +28 / +29 |
| — of which: Navigation API listener | +29 / +29 |
| — of which: edit-click route check | +2 / +4 |
| Discovery coalescing + gating init's report (measured on top of the funded build) | +56 / +60 |
| Not yet prototyped: try/catch ×2, shadow-root observe, singleton guard, variant skip, destroy cleanup | estimate +60–110 |
| Optional: lazy `generateSelector` | +38 / +38 |
| **Funding:** esbuild CSS minify of the 5 `style.textContent` literals at build time (none interpolates; `:1342`, `:1977`, `:2422`, `:3835`, `:5536`) | **−494 / −525** |
| Funding: socket.io fallback loader (`EMBED_SCRIPT_SRC` `:7`, `SOCKET_IO_FALLBACK_URL` `:58-69`, `window.io` fallback, `loadSocketIO` `:3019-3049`); the artifact always prepends socket.io | −290 / −287 |
| Funding: `rcf-editable` class (no CSS, no reader) | −28 / −29 |
| Reserve, not needed: `startPolling` deleted −129/−127 (or reused via hydrate −77/−78); `getFullElementText` inlined −43/−41; `assessReadability` (no caller) + `getEditingColors` −41/−38; `waitForDOM` inlined −34/−30; `getElementText` −17/−17 | dead pool total −556 / −553 |
| **Prototype C2** = lean + coalescing + CSS minify + socket loader + `rcf-editable` | **45,739 / 32,964** (−141 / −156 vs ceilings) |
| Lean + the whole dead pool + CSS minify | 45,429 / 32,657 |

Proposed allocation:
- s67 gross ≤ +850 gz on the widget.
- Paid by the CSS-minify build step, the socket fallback loader and `rcf-editable`.
- Both ceilings ratchet down to whatever the branch finally measures.

The CSS minification is a generic build-time transform that changes no behaviour:
- The build calls `esbuild.transform(css, { loader: 'css', minify: true })` on each literal.
- `style-literal-comments.test.ts` still finds ≥ 5 literals and `#rcf-editor-banner`.
- It pre-empts part of the never-built `s06c-embed-shrink`; record that in the ratchet note.

## Test strategy

**Unit** (jest, booting the real source IIFE). New `embed-spa.test.ts`:
- AC 2 — late elements get cached rows without a refetch.
- AC 3:
  - `pushState` gives one GET per path; a revisit makes none; a query- or hash-only change makes none.
  - Persisting elements carry the same id as on a full load of the new path.
- AC 4 — `textContent` and `nodeValue` write-backs are re-applied, own writes produce no further
  writes, and the cap holds.
- AC 5 — fake timers, continuous mutation → rescan within 1,000 ms.
- AC 9 — a throwing host `MutationObserver` path and a throwing navigation handler do not reach a
  `window` error listener, and `history.pushState` keeps its identity.
- In-place writes keep text-node identity.
- Unedited rows never write.
- A variant wins over published copy.
- Discovery waits for the current path's rows and is coalesced.

Existing suites to touch (§Q7):
- Teardown in the multi-boot suites.
- Keep `hydrateStoredContent` immediately followed by `setupMutationObserver`.
- Polling path.
- Ratchet seeds in `build-size-gate.test.ts`.

**E2E** (CI, blocking): `e2e/embed-spa.spec.ts`.
- A Node host server serves:
  - a framework-free SPA (late render, `pushState` nav, text re-render);
  - React 19 CSR and SSR pages bundled with esbuild at test time.
- The page loads `${APP_URL}/embed/recopyfast.js` (the real artifact) with the API on a fake host
  answered by `page.route`, so it needs no Supabase.
- The React page asserts the R1c/R1d no-crash regression.
- Raise the contract from 45 to the new count in the four places listed in §Q7.
- Keep green: `published-snapshot-ssr`, `share-edit-publish`, `realtime-parity`, `realtime-additive`,
  `try-preview`.

**Production proof** (AC 10, after deploy):
- openflows.ai, plain snippet:
  - `/` and `/fr`: `[data-rcf-id]` > 0 within 2 s of render settling.
  - Edit and publish on `/` and on a route reached in-app (`/fr/blog`).
  - A fresh visitor sees published copy on load and after navigation.
  - One GET per path.
  - Count POSTs over 60 s idle: expect ≤ 1.
- aicompoz.com (Next.js app router, server-rendered `data-rcf-id` anchors):
  - An s65a-style observer installed before page scripts records 0 text changes on anchored
    elements at first paint.
  - Repeat after one in-app navigation.

## PR #59 (s61) — conflict surface and sequencing

PR #59 is open and its review says "Ship allowed: no"; rollout is blocked, and re-pointing it to the
s65a snapshot is a follow-up (`docs/stories.md`, s61). Its embed diff touches exactly s67's ground:
- `init`: `waitForDOM` inlined, fonts only for private content, `STARTUP_MARKED` branches,
  `hydrateStableStartup`.
- `hydrateStoredContent` split into `applyStoredContent`/`hydrateStoredImages`.
  `applyStoredContent` resets `serverKnownElementIds` on every call, which breaks a per-path union.
- Late-swap refusals in `hydrateStoredContent`/`handleContentUpdate` after a failed startup. This is
  a policy conflict with s67's late application.
- `scanForContent`/`shouldSkipElement` edits.
- `startPolling` reduced to `hydrateStoredContent`.
- `applyVariants` returns the tests shown.
- `scripts/build-embed.mjs` (bootstrap build + gate), `build-size-gate.test.ts`,
  `site-token-refusal.test.ts` and the e2e count.

Its byte plan spends the same dead code (socket loader, wrappers, `getFullElementText`,
`getElementText`, `waitForDOM`, polling) to land 45,840 / 33,085 on its own base.

Recommendation:
- Ship s67 first. It is owner-decided, production-proven, and independent of the blocked rollout.
- Fund it from the CSS-minify step, which #59 does not touch, plus the socket loader (an identical
  deletion in #59, so that conflict is trivial). This leaves #59 the rest of its savings.
- #59 then rebases onto s67's `init`/rows-cache shape. Whether a head-bootstrap install may apply
  late SPA content after its reveal deadline is an owner decision for s61's rebase. s67's synchronous
  re-apply and cached-route applies are flash-free, as measured.

## Traps and constraints

- `site-token-refusal.test.ts` slices the source between two method headers. New methods go
  elsewhere.
- jsdom keeps every booted instance alive, which is why the observer and route listener need
  `destroy()` in teardown.
- `contentReadEndpoint` is used by hydrate (`:3635`) and polling (`:5458`). Give it an explicit path
  parameter and update both callers.
- `normalizedPagePath` must stay byte-identical: ids are persistent (`element-id-page-scope.test.ts`).
- Today `elementData.originalContent` is overwritten with published copy after an apply (`:3606`). The
  fast path keeps the first-seen, authored text, which is what discovery must report.
- v1 POST creates rows with `original_content = published_content`
  (`src/app/api/v1/content/route.ts:317-318`). Under the edited-only rule such rows no longer write
  text (open question 1).
- An exception in a `MutationObserver` callback or a `setTimeout` is outside `init`'s try. Today's
  observer callback and rescan timer already lack one.

## Risks

- **SSR before hydration.** React 19 #418 and a full client re-render on SSR sites when published copy
  lands before hydration (measured). s67 shortens it to a double swap; s65a removes it.
- **Late elements on first visits.** They paint authored copy for the fetch latency, as on a full
  load. Async or lazy route renders on cached routes can show authored copy for up to the 200 ms
  debounce. Synchronous routers and React discrete updates measured 0 frames.
- **Transient structure** (Suspense, streaming) at rescan time can stamp an id that sticks for that
  page view.
- **Large DOMs.** The first scan is O(n²) on wide sibling lists: 3,005 candidates take 509 ms on
  desktop and 2.3 s at 4×; 9,005 take ~20 s at 4×. This pre-exists, but SPA renders are newly
  exposed. Use the lazy selector, and open a follow-up to memoise sibling indexes.
- **In-place writes on elements with markup children** keep element nodes (icons stay) with their text
  blanked. Today they are destroyed. This is a visible behaviour change on such elements.
- **A dynamic element with an edited row is frozen to published copy** (capped). This is consistent
  with today's R1b, and it is the product's promise.

## Open questions for the owner (with recommended defaults)

1. **Unedited discovery rows.** Should rows whose published copy equals the discovered copy still be
   written? *Default: no.* Writing them reverts dynamic text, such as a reordered post list, to
   whatever the first visitor saw. This becomes systemic on SPAs. The only loss is v1 POST-created
   rows, so make v1 POST store `original_content = null` in a follow-up.
2. **Host writes over an edited element.** *Default: published copy always wins, capped at 10 writes
   per element per page view.* The alternative is to re-apply only when the host restores the authored
   copy (AC 4's literal), which lets other host text show until the next rescan and makes behaviour
   depend on timing.
3. **Hash routers** (`/#/route`). *Default: out of scope as AC 3 states; document `data-rcf-id` for
   them.* Follow-up: treat `#/` and `#!/` hashes as paths, which changes ids on such sites.
4. **Sequencing with PR #59.** *Default: s67 merges first, funded by CSS minification + the socket
   fallback loader.* #59 rebases and decides its late-swap policy against s67's model.
5. **AC 9 wording.** The design patches no history method. *Default: restate AC 9's history clause as
   "the embed patches no host global; `history.pushState` keeps its identity", asserted by a test.*
